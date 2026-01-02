// LLM Integration for IOM Job Scraper

import { getLLMConfig } from "./config.js";

/**
 * Make a request to the LLM API
 */
async function makeLLMRequest(systemPrompt, userPrompt, env, options) {
    const { temperature, maxTokens, parseAsJson } = options;
    const llmConfig = getLLMConfig(env);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), llmConfig.timeoutMs);

    try {
        const response = await fetch(llmConfig.apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${env.LLM_API_KEY}`,
            },
            body: JSON.stringify({
                model: llmConfig.model,
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userPrompt },
                ],
                temperature,
                max_tokens: maxTokens,
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle specific error codes
        if (response.status === 429) {
            const error = new Error("LLM rate limit exceeded");
            error.isRateLimit = true;
            throw error;
        }
        if (response.status === 401 || response.status === 403) {
            const error = new Error("LLM authentication failed");
            error.isAuthError = true;
            throw error;
        }
        if (response.status >= 500) {
            const error = new Error("LLM server error");
            error.isServerError = true;
            throw error;
        }
        if (!response.ok) {
            throw new Error(`LLM request failed with status ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error("Empty response from LLM");
        }

        if (parseAsJson) {
            return parseJSONResponse(content);
        }

        return content.trim();
    } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === "AbortError") {
            const timeoutError = new Error("LLM request timeout");
            timeoutError.isTimeout = true;
            throw timeoutError;
        }

        throw error;
    }
}

/**
 * Parse JSON from LLM response, handling markdown code blocks
 */
function parseJSONResponse(content) {
    let jsonStr = content.trim();

    // Remove markdown code blocks if present
    if (jsonStr.startsWith("```json")) {
        jsonStr = jsonStr.slice(7);
    } else if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.slice(3);
    }
    if (jsonStr.endsWith("```")) {
        jsonStr = jsonStr.slice(0, -3);
    }

    jsonStr = jsonStr.trim();

    try {
        return JSON.parse(jsonStr);
    } catch (error) {
        console.error("Failed to parse LLM response as JSON:", jsonStr);
        throw new Error("Invalid JSON response from LLM");
    }
}

/**
 * Sleep utility for retry logic
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute LLM request with retry logic
 */
async function executeWithRetry(systemPrompt, userPrompt, env, options, label) {
    const llmConfig = getLLMConfig(env);
    let lastError;

    for (let attempt = 0; attempt <= llmConfig.maxRetries; attempt++) {
        try {
            console.log(`${label}: Attempt ${attempt + 1}`);
            const result = await makeLLMRequest(systemPrompt, userPrompt, env, options);
            return result;
        } catch (error) {
            lastError = error;

            // Don't retry on rate limits or auth errors
            if (error.isRateLimit || error.isAuthError) {
                throw error;
            }

            // Retry on server errors
            if (attempt < llmConfig.maxRetries && error.isServerError) {
                console.log(`${label}: Server error, retrying in 1s...`);
                await sleep(1000);
                continue;
            }

            throw error;
        }
    }

    throw lastError;
}

/**
 * Query LLM for structured response (query parsing)
 */
export async function queryLLM(systemPrompt, userPrompt, env) {
    const llmConfig = getLLMConfig(env);

    return executeWithRetry(systemPrompt, userPrompt, env, {
        temperature: llmConfig.temperature.structured,
        maxTokens: llmConfig.maxTokens.structured,
        parseAsJson: true,
    }, "QUERY_PARSE");
}

/**
 * Generate natural language response with relevance filtering
 * Returns { answer: string, relevant_ids: number[] }
 */
export async function generateResponse(systemPrompt, userPrompt, env) {
    const llmConfig = getLLMConfig(env);

    return executeWithRetry(systemPrompt, userPrompt, env, {
        temperature: llmConfig.temperature.natural,
        maxTokens: llmConfig.maxTokens.natural,
        parseAsJson: true,
    }, "RESPONSE_GEN");
}
