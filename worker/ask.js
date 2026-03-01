// Ask Handler for IOM Job Scraper
// Text-to-SQL pipeline for natural language job queries

import { checkRateLimit } from "./rateLimiter.js";
import { validateQuestion } from "./validation.js";
import { validateSQL } from "./sqlValidator.js";
import { generateSQLWithRetry, generateResponse, generateResponseStreaming } from "./llm.js";
import {
    SQL_SYSTEM_PROMPT,
    RESPONSE_SYSTEM_PROMPT,
    buildResponsePrompt,
    injectDates,
} from "./prompts.js";

// Response cache settings
const RESPONSE_CACHE_TTL = 14400; // 4 hours
const RESPONSE_CACHE_PREFIX = "ask:v2:";

/**
 * Normalise question for cache key generation
 */
function normalizeQuestion(question) {
    return question
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Generate a SHA-256 cache key from question + date context
 */
async function generateCacheKey(question) {
    const today = new Date().toISOString().split("T")[0];
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    const weekStartStr = weekStart.toISOString().split("T")[0];

    const input = JSON.stringify({
        q: normalizeQuestion(question),
        today,
        weekStart: weekStartStr,
    });

    const encoded = new TextEncoder().encode(input);
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

    return RESPONSE_CACHE_PREFIX + hashHex;
}

/**
 * Get cached response or null
 */
async function getCachedResponse(question, env) {
    try {
        const key = await generateCacheKey(question);
        const cached = await env.RATE_LIMITER.get(key, { type: "json" });
        if (cached) {
            console.log("Response cache hit:", key);
            return cached;
        }
    } catch (error) {
        console.error("Cache read error:", error);
    }
    return null;
}

/**
 * Cache a successful response
 */
async function cacheResponse(question, response, env) {
    try {
        const key = await generateCacheKey(question);
        await env.RATE_LIMITER.put(key, JSON.stringify(response), {
            expirationTtl: RESPONSE_CACHE_TTL,
        });
        console.log("Response cached:", key);
    } catch (error) {
        console.error("Cache write error:", error);
    }
}

/**
 * Create a SQL executor that validates then runs against D1
 */
function createSQLExecutor(env) {
    return async function executeSQL(sql) {
        const validation = validateSQL(sql);
        if (!validation.valid) {
            throw new Error(validation.error);
        }

        const stmt = env.DB.prepare(validation.sanitisedSql);
        const response = await stmt.all();
        return response.results || [];
    };
}

/**
 * Build citations from query result rows
 */
function buildCitations(results) {
    if (!Array.isArray(results) || results.length === 0) {
        return [];
    }

    // COUNT queries return [{count: N}] — no citations
    if (results.length === 1 && results[0].count !== undefined && !results[0].title) {
        return [];
    }

    return results
        .filter(row => row.id && row.title)
        .slice(0, 5)
        .map(row => ({
            id: row.id,
            title: row.title,
            employer: row.employer,
            closing_date: row.closing_date,
            source_url: row.source_url,
        }));
}

/**
 * Map error types to HTTP status codes
 */
function mapErrorStatus(error) {
    if (error.isTimeout) return 504;
    if (error.isRateLimit) return 503;
    if (error.isQuotaExceeded) return 503;
    if (error.isAuthError) return 502;
    return 502;
}

/**
 * Format a named SSE event
 */
function formatSSE(event, data) {
    return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * Standard SSE response headers
 */
const sseHeaders = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
};

/**
 * Handle /ask endpoint (non-streaming)
 */
export async function handleAskRequest(request, env) {
    // 1. Rate limit check
    const rateLimit = await checkRateLimit(request, env, "ask");
    if (!rateLimit.allowed) {
        return {
            result: {
                success: false,
                error: "rate_limit_exceeded",
                message: `Daily limit reached. Try again in ${Math.ceil(rateLimit.resetIn / 3600)} hours.`,
            },
            status: 429,
        };
    }

    // 2. Parse and validate request body
    let body;
    try {
        body = await request.json();
    } catch {
        return {
            result: { success: false, error: "invalid_request", message: "Invalid JSON body" },
            status: 400,
        };
    }

    const inputValidation = validateQuestion(body);
    if (!inputValidation.success) {
        return {
            result: {
                success: false,
                error: "invalid_question",
                message: inputValidation.error.errors[0].message,
            },
            status: 400,
        };
    }

    const question = inputValidation.data.question;

    // 3. Check response cache
    const cached = await getCachedResponse(question, env);
    if (cached) {
        return { result: { ...cached, cached: true }, status: 200 };
    }

    // 4. Generate SQL via text-to-SQL with self-correction
    let sqlResult;
    try {
        const systemPrompt = injectDates(SQL_SYSTEM_PROMPT);
        const executor = createSQLExecutor(env);
        sqlResult = await generateSQLWithRetry(systemPrompt, question, env, executor);
    } catch (error) {
        console.error("SQL generation error:", error);
        const message = error.isQuotaExceeded
            ? "AI service temporarily unavailable. Please try again later."
            : "Failed to process question.";
        return {
            result: { success: false, error: "llm_error", message },
            status: mapErrorStatus(error),
        };
    }

    // 5. Handle sentinels
    if (sqlResult.sentinel) {
        const { type, reason } = sqlResult.sentinel;
        return {
            result: {
                success: false,
                error: type,
                message: reason || "I can only answer questions about Isle of Man Government job listings.",
            },
            status: 400,
        };
    }

    const { results } = sqlResult;

    // 6. Generate natural language response
    let answer;
    try {
        const responseSystemPrompt = injectDates(RESPONSE_SYSTEM_PROMPT);
        const responseUserPrompt = buildResponsePrompt(question, results);
        answer = await generateResponse(responseSystemPrompt, responseUserPrompt, env);
    } catch (error) {
        console.error("Response generation error:", error);
        answer = results.length > 0
            ? `I found ${results.length} job${results.length > 1 ? "s" : ""} matching your search.`
            : "I couldn't find any jobs matching your criteria. Try broadening your search.";
    }

    // 7. Build citations and cache
    const citations = buildCitations(results);
    const responseData = {
        success: true,
        answer,
        citations,
        result_count: results.length,
    };

    await cacheResponse(question, responseData, env);

    return { result: responseData, status: 200 };
}

/**
 * Handle /ask/stream endpoint — Server-Sent Events
 */
export async function handleAskStreamRequest(request, env) {
    // 1. Rate limit check
    const rateLimit = await checkRateLimit(request, env, "ask");
    if (!rateLimit.allowed) {
        return new Response(
            JSON.stringify({
                success: false,
                error: "rate_limit_exceeded",
                message: `Daily limit reached. Try again in ${Math.ceil(rateLimit.resetIn / 3600)} hours.`,
            }),
            { status: 429, headers: { "Content-Type": "application/json" } },
        );
    }

    // 2. Parse and validate request
    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(
            JSON.stringify({ success: false, error: "invalid_request", message: "Invalid JSON body" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
        );
    }

    const inputValidation = validateQuestion(body);
    if (!inputValidation.success) {
        return new Response(
            JSON.stringify({
                success: false,
                error: "invalid_question",
                message: inputValidation.error.errors[0].message,
            }),
            { status: 400, headers: { "Content-Type": "application/json" } },
        );
    }

    const question = inputValidation.data.question;

    // 3. Check response cache
    const cached = await getCachedResponse(question, env);
    if (cached) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                // Send cached answer as chunks then complete
                controller.enqueue(encoder.encode(formatSSE("status", { phase: "cached", message: "Found cached answer" })));
                controller.enqueue(encoder.encode(formatSSE("chunk", { text: cached.answer })));
                controller.enqueue(encoder.encode(formatSSE("complete", {
                    success: true,
                    citations: cached.citations,
                    cached: true,
                })));
                controller.close();
            },
        });
        return new Response(stream, { headers: sseHeaders });
    }

    // 4. Stream the full pipeline
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            const send = (event, data) => {
                controller.enqueue(encoder.encode(formatSSE(event, data)));
            };

            try {
                // Phase 1: Generate SQL
                send("status", { phase: "sql", message: "Understanding your question..." });

                const systemPrompt = injectDates(SQL_SYSTEM_PROMPT);
                const executor = createSQLExecutor(env);
                let sqlResult;

                try {
                    sqlResult = await generateSQLWithRetry(systemPrompt, question, env, executor);
                } catch (error) {
                    console.error("SQL generation error:", error);
                    const message = error.isQuotaExceeded
                        ? "AI service temporarily unavailable. Please try again later."
                        : "Failed to process question.";
                    send("error", { error: "llm_error", message });
                    controller.close();
                    return;
                }

                // Handle sentinels
                if (sqlResult.sentinel) {
                    const { type, reason } = sqlResult.sentinel;
                    send("error", {
                        error: type,
                        message: reason || "I can only answer questions about Isle of Man Government job listings.",
                    });
                    controller.close();
                    return;
                }

                const { results } = sqlResult;
                const citations = buildCitations(results);

                // Phase 2: Stream natural language response
                send("status", { phase: "response", message: "Composing answer..." });

                const responseSystemPrompt = injectDates(RESPONSE_SYSTEM_PROMPT);
                const responseUserPrompt = buildResponsePrompt(question, results);

                let fullAnswer = "";
                try {
                    fullAnswer = await generateResponseStreaming(
                        responseSystemPrompt,
                        responseUserPrompt,
                        env,
                        (chunk) => send("chunk", { text: chunk }),
                    );
                } catch (error) {
                    console.error("Streaming response error:", error);
                    // Fallback to non-streaming
                    try {
                        fullAnswer = await generateResponse(responseSystemPrompt, responseUserPrompt, env);
                        send("chunk", { text: fullAnswer });
                    } catch {
                        fullAnswer = results.length > 0
                            ? `I found ${results.length} job${results.length > 1 ? "s" : ""} matching your search.`
                            : "I couldn't find any jobs matching your criteria.";
                        send("chunk", { text: fullAnswer });
                    }
                }

                // Phase 3: Complete
                send("complete", { success: true, citations, cached: false });

                // Cache the response in the background
                const responseData = {
                    success: true,
                    answer: fullAnswer,
                    citations,
                    result_count: results.length,
                };
                cacheResponse(question, responseData, env).catch(err =>
                    console.error("Background cache error:", err)
                );
            } catch (error) {
                console.error("Stream error:", error);
                send("error", { error: "internal_error", message: "Something went wrong." });
            }

            controller.close();
        },
    });

    return new Response(stream, { headers: sseHeaders });
}
