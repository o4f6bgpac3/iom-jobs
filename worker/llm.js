// LLM Integration for IOM Job Scraper — Text-to-SQL

import { getLLMConfig } from "./config.js";

/**
 * Make a request to the LLM API
 * Always returns raw text content.
 */
async function makeLLMRequest(systemPrompt, userPrompt, env, options = {}) {
    const { temperature, maxTokens, stream } = options;
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
                ...(stream ? { stream: true } : {}),
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

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

        if (stream) {
            return response.body;
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            throw new Error("Empty response from LLM");
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
 * Sleep utility for retry logic
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute LLM request with retry logic for server errors
 */
async function executeWithRetry(systemPrompt, userPrompt, env, options, label) {
    const llmConfig = getLLMConfig(env);
    let lastError;

    for (let attempt = 0; attempt <= llmConfig.maxRetries; attempt++) {
        try {
            console.log(`${label}: Attempt ${attempt + 1}`);
            return await makeLLMRequest(systemPrompt, userPrompt, env, options);
        } catch (error) {
            lastError = error;

            if (error.isRateLimit || error.isAuthError) {
                throw error;
            }

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
 * Strip markdown code fences from LLM output
 */
export function stripCodeFences(text) {
    let result = text.trim();
    if (result.startsWith("```sql")) {
        result = result.slice(6);
    } else if (result.startsWith("```")) {
        result = result.slice(3);
    }
    if (result.endsWith("```")) {
        result = result.slice(0, -3);
    }
    return result.trim();
}

/**
 * Check if LLM response is a sentinel (UNANSWERABLE or REJECTED)
 */
export function isSentinel(response) {
    return /^(UNANSWERABLE|REJECTED):/i.test(response.trim());
}

/**
 * Parse a sentinel response into type and reason
 * @returns {{ type: "unanswerable"|"rejected", reason: string }}
 */
export function parseSentinel(response) {
    const trimmed = response.trim();
    const colonIndex = trimmed.indexOf(":");
    const type = trimmed.slice(0, colonIndex).toLowerCase();
    const reason = trimmed.slice(colonIndex + 1).trim();
    return { type, reason };
}

/**
 * Generate SQL from a user question (low temperature, deterministic)
 * Returns raw text — either SQL or a sentinel string.
 */
export async function generateSQL(systemPrompt, question, env) {
    const llmConfig = getLLMConfig(env);

    const raw = await executeWithRetry(systemPrompt, question, env, {
        temperature: llmConfig.temperature.structured,
        maxTokens: llmConfig.maxTokens.structured,
    }, "SQL_GEN");

    return stripCodeFences(raw);
}

/**
 * Generate SQL with self-correction retry
 *
 * @param {string} systemPrompt - The SQL system prompt
 * @param {string} question - User's question
 * @param {Object} env - Cloudflare env bindings
 * @param {Function} validateAndExecute - async (sql) => { results } or throws on validation/SQL error
 * @returns {{ results: any[], sql: string } | { sentinel: { type: string, reason: string } }}
 */
export async function generateSQLWithRetry(systemPrompt, question, env, validateAndExecute) {
    const llmConfig = getLLMConfig(env);

    // First attempt
    let sql = await generateSQL(systemPrompt, question, env);
    console.log("SQL_GEN: Generated SQL:", sql);

    // Check for sentinel
    if (isSentinel(sql)) {
        return { sentinel: parseSentinel(sql) };
    }

    try {
        const results = await validateAndExecute(sql);
        return { results, sql };
    } catch (firstError) {
        console.log("SQL_GEN: First attempt failed:", firstError.message);

        // Self-correction: feed the error back to the LLM
        const correctionPrompt = `${question}

My previous SQL query failed with this error: ${firstError.message}
The failing query was: ${sql}

Please generate a corrected SQL query.`;

        const correctedRaw = await executeWithRetry(systemPrompt, correctionPrompt, env, {
            temperature: llmConfig.temperature.structured,
            maxTokens: llmConfig.maxTokens.structured,
        }, "SQL_RETRY");

        const correctedSql = stripCodeFences(correctedRaw);
        console.log("SQL_RETRY: Corrected SQL:", correctedSql);

        if (isSentinel(correctedSql)) {
            return { sentinel: parseSentinel(correctedSql) };
        }

        // Second attempt — let it throw if it fails again
        const results = await validateAndExecute(correctedSql);
        return { results, sql: correctedSql };
    }
}

/**
 * Generate a natural language response (plain text)
 */
export async function generateResponse(systemPrompt, userPrompt, env) {
    const llmConfig = getLLMConfig(env);

    return executeWithRetry(systemPrompt, userPrompt, env, {
        temperature: llmConfig.temperature.natural,
        maxTokens: llmConfig.maxTokens.natural,
    }, "RESPONSE_GEN");
}

/**
 * Generate a streaming natural language response
 * Calls onChunk(text) for each content token.
 * Returns the full accumulated text.
 */
export async function generateResponseStreaming(systemPrompt, userPrompt, env, onChunk) {
    const llmConfig = getLLMConfig(env);

    const stream = await makeLLMRequest(systemPrompt, userPrompt, env, {
        temperature: llmConfig.temperature.natural,
        maxTokens: llmConfig.maxTokens.natural,
        stream: true,
    });

    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullText = "";

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
                if (line.startsWith("data: ")) {
                    const data = line.slice(6).trim();
                    if (data === "[DONE]") return fullText;

                    try {
                        const parsed = JSON.parse(data);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            fullText += content;
                            onChunk(content);
                        }
                    } catch {
                        // Skip malformed chunks
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }

    return fullText;
}
