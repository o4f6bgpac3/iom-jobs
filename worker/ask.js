// Ask Handler for IOM Job Scraper
// Processes natural language questions about jobs

import { checkRateLimit } from "./rateLimiter.js";
import { validateQuestion, QueryIntentSchema, UnanswerableSchema, RejectedSchema } from "./validation.js";
import { queryLLM, generateResponse } from "./llm.js";
import { buildQuery, buildCitations } from "./queryBuilder.js";
import {
    QUERY_SYSTEM_PROMPT,
    RESPONSE_SYSTEM_PROMPT,
    buildQueryPrompt,
    buildResponsePrompt,
    injectDates,
    generateFallbackResponse,
} from "./prompts.js";

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

    // 3. Parse question into structured query using LLM
    let llmResponse;
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

    // 6. Build and execute database query
    let results;
    try {
        const { sql, params } = buildQuery(intent);
        console.log("Executing SQL:", sql, "Params:", params);

        const stmt = env.DB.prepare(sql);
        const bound = params.length > 0 ? stmt.bind(...params) : stmt;
        const response = await bound.all();
        results = response.results || [];
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
    const relevantResults = relevantIds.length > 0
        ? results.filter(job => relevantIds.includes(job.id))
        : results;

    // 9. Return success response
    return {
        result: {
            success: true,
            answer,
            citations: buildCitations(intent, relevantResults),
            query_type: intent.query_type,
            result_count: relevantResults.length,
        },
        status: 200,
    };
}
