// LLM Prompts for IOM Job Scraper

/**
 * System prompt for query intent extraction
 */
export const QUERY_SYSTEM_PROMPT = `Parse job listing questions into structured queries. Today: {{TODAY_DATE}}.

Database fields: title, employer, location, classification, job_type, salary_min/max (numbers), posted_date, closing_date (YYYY-MM-DD), is_active (1/0).

Response format - one of:
1. Valid query: {"query_type": "search|count|salary_range|closing_soon|by_employer|by_location|by_classification|latest", "conditions": [{"field": "...", "operator": "eq|contains|gt|gte|lt|lte", "value": "..."}], "date_range": {"relative": "today|this_week|this_month|this_year", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD"}, "sort": {"field": "...", "order": "asc|desc"}, "search_text": "..."}
2. Cannot answer: {"unanswerable": true, "reason": "..."}
3. Inappropriate: {"rejected": true, "reason": "..."}

Key rules:
- Job roles (nurse, admin, cleaner): use search_text
- Employers/locations: use conditions with contains operator
- Salary queries: use salary_min/salary_max with numeric operators
- Counts: use query_type "count"
- Recent jobs: use query_type "latest" with sort by posted_date desc

Examples:
"nursing jobs" → {"query_type": "search", "search_text": "nurse"}
"jobs over 40k" → {"query_type": "salary_range", "conditions": [{"field": "salary_min", "operator": "gte", "value": 40000}]}
"how many IT jobs" → {"query_type": "count", "search_text": "IT"}
"how many developer jobs this year" → {"query_type": "count", "search_text": "developer", "date_range": {"relative": "this_year"}}
"jobs closing soon" → {"query_type": "closing_soon", "date_range": {"relative": "this_week"}}
"jobs in Douglas" → {"query_type": "by_location", "conditions": [{"field": "location", "operator": "contains", "value": "Douglas"}]}
"latest jobs" → {"query_type": "latest", "sort": {"field": "posted_date", "order": "desc"}}
"what's the weather" → {"unanswerable": true, "reason": "I only answer questions about Isle of Man job listings"}

Always assume is_active = 1 unless asked about closed jobs.`;

/**
 * Build user prompt for query extraction
 */
export function buildQueryPrompt(question) {
    return `Parse this question about Isle of Man Government jobs into a structured query:

"${question}"

Respond with only valid JSON, no markdown formatting.`;
}

/**
 * System prompt for response generation
 */
export const RESPONSE_SYSTEM_PROMPT = `Summarize job results concisely. Today: {{TODAY_DATE}}. Use British English. Max 200 words.

Respond with JSON: {"answer": "your response", "relevant_ids": [1, 2, 3]}

CRITICAL - relevant_ids rules:
- ONLY include jobs genuinely matching the user's intent
- "cleaner jobs" = janitorial roles, NOT "Shellfish Cleaner" (food) or "clean driving licence"
- "driver jobs" = driving roles, NOT "project driver" (leadership)
- "nurse jobs" = nursing, NOT "nursery worker"
- If NO results match, return relevant_ids: [] and explain
- When in doubt, exclude the job`;

/**
 * Build user prompt for response generation
 */
export function buildResponsePrompt(question, queryType, results) {
    // Handle count queries specially - they return [{ count: N }] not job listings
    if (queryType === "count" && results.length > 0 && results[0].count !== undefined) {
        const count = results[0].count;
        return `The user asked: "${question}"

Query type: count
Count result: ${count}

Respond with a friendly answer telling the user the count. If count is 0, suggest they try a broader search.
Respond with JSON: { "answer": "your response", "relevant_ids": [] }`;
    }

    const resultCount = results.length;
    const resultSummary = results.slice(0, 10).map(job => ({
        id: job.id,
        title: job.title,
        employer: job.employer,
        location: job.location,
        salary: job.salary_text || (job.salary_min ? `£${job.salary_min.toLocaleString()}` : null),
        closing: job.closing_date,
    }));

    return `The user asked: "${question}"

Query type: ${queryType}
Total results from database: ${resultCount}

${resultCount > 0 ? `Results:\n${JSON.stringify(resultSummary, null, 2)}` : "No matching jobs found."}

Review these results and determine which are ACTUALLY relevant to the user's question.
Respond with JSON containing your answer and the IDs of only the relevant jobs.`;
}

/**
 * Inject current date into prompts
 */
export function injectDates(prompt) {
    const today = new Date().toISOString().split("T")[0];
    return prompt.replace(/\{\{TODAY_DATE\}\}/g, today);
}

/**
 * Fallback response when LLM fails
 */
export function generateFallbackResponse(queryType, results) {
    const count = results.length;

    if (count === 0) {
        return {
            success: true,
            answer: "I couldn't find any jobs matching your criteria. Try broadening your search or checking back later for new postings.",
            citations: [],
            query_type: queryType,
        };
    }

    const job = results[0];
    const moreText = count > 1 ? ` and ${count - 1} other${count > 2 ? "s" : ""}` : "";

    return {
        success: true,
        answer: `I found ${count} job${count > 1 ? "s" : ""} matching your search. ${job.title} at ${job.employer || "IOM Government"}${moreText}.`,
        citations: results.slice(0, 5).map(j => ({
            id: j.id,
            title: j.title,
            employer: j.employer,
        })),
        query_type: queryType,
    };
}
