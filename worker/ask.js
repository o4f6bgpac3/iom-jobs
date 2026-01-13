// Ask Handler for IOM Job Scraper
// Processes natural language questions about jobs

import { checkRateLimit } from "./rateLimiter.js";
import { validateQuestion, QueryIntentSchema, UnanswerableSchema, RejectedSchema } from "./validation.js";
import { queryLLM, generateResponse, streamResponse, parseSSEStream } from "./llm.js";
import { buildQuery, buildCitations } from "./queryBuilder.js";
import {
    QUERY_SYSTEM_PROMPT,
    RESPONSE_SYSTEM_PROMPT,
    buildQueryPrompt,
    buildResponsePrompt,
    injectDates,
    generateFallbackResponse,
} from "./prompts.js";

// Intent cache settings
const INTENT_CACHE_TTL = 86400; // 24 hours
const INTENT_CACHE_PREFIX = "intent:";

/**
 * Normalize question for cache key
 * Lowercases, removes punctuation, collapses whitespace
 */
function normalizeQuestion(question) {
    return question
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Get cached intent or null
 */
async function getCachedIntent(question, env) {
    const cacheKey = INTENT_CACHE_PREFIX + normalizeQuestion(question);
    try {
        const cached = await env.KV.get(cacheKey, { type: "json" });
        if (cached) {
            console.log("Intent cache hit:", cacheKey);
            return cached;
        }
    } catch (error) {
        console.error("Intent cache read error:", error);
    }
    return null;
}

/**
 * Cache a successful intent
 */
async function cacheIntent(question, intent, env) {
    const cacheKey = INTENT_CACHE_PREFIX + normalizeQuestion(question);
    try {
        await env.KV.put(cacheKey, JSON.stringify(intent), { expirationTtl: INTENT_CACHE_TTL });
        console.log("Intent cached:", cacheKey);
    } catch (error) {
        console.error("Intent cache write error:", error);
    }
}

/**
 * Handle /ask endpoint
 * @param {Request} request
 * @param {Object} env
 * @returns {Object} { result, status }
 */
export async function handleAskRequest(request, env) {
    // 1. Check rate limit (ask tier: 10 requests per day)
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

    // 3. Parse question into structured query - check cache first
    let llmResponse;
    let intentFromCache = false;

    // Try cache first
    llmResponse = await getCachedIntent(question, env);
    if (llmResponse) {
        intentFromCache = true;
    } else {
        // Cache miss - call LLM
        try {
            const systemPrompt = injectDates(QUERY_SYSTEM_PROMPT);
            const userPrompt = buildQueryPrompt(question);
            llmResponse = await queryLLM(systemPrompt, userPrompt, env);
        } catch (error) {
            console.error("LLM query parsing error:", error);

            if (error.isTimeout) {
                return {
                    result: { success: false, error: "timeout", message: "Request timed out. Please try again." },
                    status: 504,
                };
            }
            if (error.isRateLimit) {
                return {
                    result: { success: false, error: "llm_rate_limit", message: "AI service temporarily unavailable." },
                    status: 503,
                };
            }
            if (error.isAuthError) {
                return {
                    result: { success: false, error: "configuration_error", message: "Service configuration error." },
                    status: 502,
                };
            }

            return {
                result: { success: false, error: "llm_error", message: "Failed to process question." },
                status: 502,
            };
        }
    }

    // 4. Check for rejected or unanswerable
    if (RejectedSchema.safeParse(llmResponse).success) {
        return {
            result: {
                success: false,
                error: "rejected",
                message: llmResponse.reason || "This question cannot be answered.",
            },
            status: 400,
        };
    }

    if (UnanswerableSchema.safeParse(llmResponse).success) {
        return {
            result: {
                success: false,
                error: "unanswerable",
                message: llmResponse.reason || "I can only answer questions about Isle of Man Government job listings.",
            },
            status: 400,
        };
    }

    // 5. Validate the query intent
    const intentValidation = QueryIntentSchema.safeParse(llmResponse);
    if (!intentValidation.success) {
        console.error("Invalid LLM response:", llmResponse, intentValidation.error);
        return {
            result: { success: false, error: "llm_invalid_response", message: "Failed to understand the question." },
            status: 500,
        };
    }

    const intent = intentValidation.data;

    // Cache the validated intent (only if it came from LLM, not cache)
    if (!intentFromCache) {
        await cacheIntent(question, llmResponse, env);
    }

    // 6. Build and execute database query
    let results;
    let jobsForCitations = []; // Actual job rows for building citations
    try {
        const { sql, params } = buildQuery(intent);
        console.log("Executing SQL:", sql, "Params:", params);

        const stmt = env.DB.prepare(sql);
        const bound = params.length > 0 ? stmt.bind(...params) : stmt;
        const response = await bound.all();
        results = response.results || [];

        // For count queries, also fetch actual jobs for citations
        if (intent.query_type === "count" && results.length > 0 && results[0].count !== undefined) {
            const jobsIntent = { ...intent, query_type: "search", limit: 10 };
            const { sql: jobsSql, params: jobsParams } = buildQuery(jobsIntent);
            const jobsStmt = env.DB.prepare(jobsSql);
            const jobsBound = jobsParams.length > 0 ? jobsStmt.bind(...jobsParams) : jobsStmt;
            const jobsResponse = await jobsBound.all();
            jobsForCitations = jobsResponse.results || [];
        }
    } catch (dbError) {
        console.error("Database query error:", dbError);
        return {
            result: { success: false, error: "database_error", message: "Failed to search jobs." },
            status: 500,
        };
    }

    // 7. Generate natural language response with relevance filtering
    let answer;
    let relevantIds = [];
    try {
        const systemPrompt = injectDates(RESPONSE_SYSTEM_PROMPT);
        const userPrompt = buildResponsePrompt(question, intent.query_type, results);
        const response = await generateResponse(systemPrompt, userPrompt, env);

        // Extract answer and relevant IDs from structured response
        answer = response.answer || response;
        relevantIds = Array.isArray(response.relevant_ids) ? response.relevant_ids : [];
    } catch (error) {
        console.error("Response generation error:", error);
        // Fall back to template response
        return {
            result: generateFallbackResponse(intent.query_type, results),
            status: 200,
        };
    }

    // 8. Filter results to only include relevant jobs
    // For count queries, use jobsForCitations; otherwise filter from results
    const isCountQuery = intent.query_type === "count" && results.length > 0 && results[0].count !== undefined;
    const jobResults = isCountQuery ? jobsForCitations : results;
    const relevantResults = relevantIds.length > 0
        ? jobResults.filter(job => relevantIds.includes(job.id))
        : jobResults;

    // 9. Return success response
    return {
        result: {
            success: true,
            answer,
            citations: buildCitations(intent, relevantResults),
            query_type: intent.query_type,
            result_count: isCountQuery ? results[0].count : relevantResults.length,
        },
        status: 200,
    };
}

/**
 * Handle /ask/stream endpoint - Server-Sent Events for real-time responses
 * Streams results immediately, then streams LLM summary
 * @param {Request} request
 * @param {Object} env
 * @returns {Response} SSE stream
 */
export async function handleAskStreamRequest(request, env) {
    // 1. Check rate limit
    const rateLimit = await checkRateLimit(request, env, "ask");
    if (!rateLimit.allowed) {
        return new Response(
            JSON.stringify({
                success: false,
                error: "rate_limit_exceeded",
                message: `Daily limit reached. Try again in ${Math.ceil(rateLimit.resetIn / 3600)} hours.`,
            }),
            { status: 429, headers: { "Content-Type": "application/json" } }
        );
    }

    // 2. Parse and validate request
    let body;
    try {
        body = await request.json();
    } catch {
        return new Response(
            JSON.stringify({ success: false, error: "invalid_request", message: "Invalid JSON body" }),
            { status: 400, headers: { "Content-Type": "application/json" } }
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
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    const question = inputValidation.data.question;

    // 3. Parse question - check cache first
    let llmResponse;
    let intentFromCache = false;

    llmResponse = await getCachedIntent(question, env);
    if (llmResponse) {
        intentFromCache = true;
    } else {
        try {
            const systemPrompt = injectDates(QUERY_SYSTEM_PROMPT);
            const userPrompt = buildQueryPrompt(question);
            llmResponse = await queryLLM(systemPrompt, userPrompt, env);
        } catch (error) {
            console.error("LLM query parsing error:", error);
            return new Response(
                JSON.stringify({ success: false, error: "llm_error", message: "Failed to process question." }),
                { status: 502, headers: { "Content-Type": "application/json" } }
            );
        }
    }

    // 4. Check for rejected/unanswerable
    if (RejectedSchema.safeParse(llmResponse).success) {
        return new Response(
            JSON.stringify({ success: false, error: "rejected", message: llmResponse.reason }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    if (UnanswerableSchema.safeParse(llmResponse).success) {
        return new Response(
            JSON.stringify({ success: false, error: "unanswerable", message: llmResponse.reason }),
            { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }

    // 5. Validate intent
    const intentValidation = QueryIntentSchema.safeParse(llmResponse);
    if (!intentValidation.success) {
        return new Response(
            JSON.stringify({ success: false, error: "llm_invalid_response", message: "Failed to understand question." }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }

    const intent = intentValidation.data;

    // Cache if from LLM
    if (!intentFromCache) {
        await cacheIntent(question, llmResponse, env);
    }

    // 6. Execute database query
    let results;
    let jobsForCitations = [];
    try {
        const { sql, params } = buildQuery(intent);
        const stmt = env.DB.prepare(sql);
        const bound = params.length > 0 ? stmt.bind(...params) : stmt;
        const response = await bound.all();
        results = response.results || [];

        // For count queries, also fetch actual jobs for citations
        if (intent.query_type === "count" && results.length > 0 && results[0].count !== undefined) {
            const jobsIntent = { ...intent, query_type: "search", limit: 10 };
            const { sql: jobsSql, params: jobsParams } = buildQuery(jobsIntent);
            const jobsStmt = env.DB.prepare(jobsSql);
            const jobsBound = jobsParams.length > 0 ? jobsStmt.bind(...jobsParams) : jobsStmt;
            const jobsResponse = await jobsBound.all();
            jobsForCitations = jobsResponse.results || [];
        }
    } catch (dbError) {
        console.error("Database error:", dbError);
        return new Response(
            JSON.stringify({ success: false, error: "database_error", message: "Failed to search jobs." }),
            { status: 500, headers: { "Content-Type": "application/json" } }
        );
    }

    // Determine if this is a count query and get appropriate job list
    const isCountQuery = intent.query_type === "count" && results.length > 0 && results[0].count !== undefined;
    const jobResults = isCountQuery ? jobsForCitations : results;

    // 7. Create SSE stream
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            // Send initial results immediately
            const initialData = {
                type: "results",
                query_type: intent.query_type,
                result_count: isCountQuery ? results[0].count : jobResults.length,
                citations: buildCitations(intent, jobResults.slice(0, 10)),
            };
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`));

            // Stream LLM response
            try {
                const systemPrompt = injectDates(RESPONSE_SYSTEM_PROMPT);
                const userPrompt = buildResponsePrompt(question, intent.query_type, results);
                const llmStream = await streamResponse(systemPrompt, userPrompt, env);

                let fullContent = "";
                for await (const chunk of parseSSEStream(llmStream)) {
                    fullContent += chunk;
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "chunk", content: chunk })}\n\n`));
                }

                // Parse final response for relevant_ids
                let relevantIds = [];
                try {
                    const parsed = JSON.parse(fullContent.replace(/```json\n?|\n?```/g, "").trim());
                    relevantIds = Array.isArray(parsed.relevant_ids) ? parsed.relevant_ids : [];

                    // Send final answer with filtered results
                    const relevantResults = relevantIds.length > 0
                        ? jobResults.filter(job => relevantIds.includes(job.id))
                        : jobResults;

                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: "complete",
                        answer: parsed.answer || fullContent,
                        citations: buildCitations(intent, relevantResults.slice(0, 5)),
                        result_count: isCountQuery ? results[0].count : relevantResults.length,
                    })}\n\n`));
                } catch {
                    // If parsing fails, send raw content
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                        type: "complete",
                        answer: fullContent,
                        citations: buildCitations(intent, jobResults.slice(0, 5)),
                        result_count: isCountQuery ? results[0].count : jobResults.length,
                    })}\n\n`));
                }
            } catch (error) {
                console.error("Streaming error:", error);
                // Fall back to template response
                const fallback = generateFallbackResponse(intent.query_type, results);
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({
                    type: "complete",
                    ...fallback,
                })}\n\n`));
            }

            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    });
}
