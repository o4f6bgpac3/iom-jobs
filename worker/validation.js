// Input validation schemas for IOM Job Scraper
import { z } from "zod";

// Query parameter validation for job listings
export const JobQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(1000).default(100),
    employer: z.string().max(200).optional(),
    location: z.string().max(200).optional(),
    classification: z.string().max(200).optional(),
    job_type: z.string().max(50).optional(),
    hours_type: z.enum(["full-time", "part-time"]).optional(),
    last_days: z.coerce.number().int().min(1).max(365).optional(),
    salary_min: z.coerce.number().min(0).optional(),
    salary_max: z.coerce.number().min(0).optional(),
    closing_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    posted_after: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    search: z.string().max(200).optional(),
    active_only: z.string().optional().transform(val => val !== "false").default(true),
    sort: z.enum(["posted_date", "closing_date", "salary_min", "title", "employer"]).default("closing_date"),
    order: z.enum(["asc", "desc"]).default("asc"),
});

// Scrape request validation (admin endpoint)
export const ScrapeRequestSchema = z.object({
    type: z.enum(["full", "recent"]).default("recent"),
});

// Injection patterns to detect and reject
const INJECTION_PATTERNS = [
    /ignore\s+(all\s+)?(previous|above|prior)/i,
    /disregard\s+(all\s+)?(previous|above|prior|your)/i,
    /pretend\s+(you\s+are|to\s+be|you're)/i,
    /act\s+as\s+(if\s+you\s+are|a)/i,
    /you\s+are\s+now/i,
    /new\s+instructions/i,
    /system\s*prompt/i,
    /reveal\s+(your|the)\s+(instructions|prompt|rules)/i,
    /what\s+are\s+your\s+(instructions|rules)/i,
    /bypass\s+(the\s+)?(rules|restrictions|filters)/i,
    /override\s+(the\s+)?(rules|restrictions|safety)/i,
    /jailbreak/i,
    /\[\s*system\s*\]/i,
    /\[\s*assistant\s*\]/i,
    /\[\s*user\s*\]/i,
    /<\s*system\s*>/i,
    /base64|atob|btoa/i,
    /\bhex\s*decode/i,
    /rot13/i,
];

// Question input validation for /ask endpoint
export const QuestionInputSchema = z.object({
    question: z
        .string()
        .min(3, "Question must be at least 3 characters")
        .max(500, "Question must be at most 500 characters")
        .refine((q) => !/<[^>]*>/.test(q), "HTML tags are not allowed")
        .refine((q) => !/[<>";]/.test(q), "Special characters not allowed")
        .refine(
            (q) => !INJECTION_PATTERNS.some((p) => p.test(q)),
            "Invalid question format"
        ),
});

// Allowed query types for LLM responses
const QueryTypeSchema = z.enum([
    "search",
    "count",
    "salary_range",
    "closing_soon",
    "by_employer",
    "by_location",
    "by_classification",
    "latest",
    "recommend",
    "compare",
]);

// Allowed fields for queries
const AllowedFieldSchema = z.enum([
    "title",
    "employer",
    "location",
    "classification",
    "job_type",
    "salary_min",
    "salary_max",
    "posted_date",
    "closing_date",
    "is_active",
]);

// Allowed operators
const AllowedOperatorSchema = z.enum([
    "eq",
    "neq",
    "gt",
    "gte",
    "lt",
    "lte",
    "contains",
    "starts_with",
    "in",
]);

// Numeric fields that can use comparison operators
const NUMERIC_FIELDS = ["salary_min", "salary_max"];

// Condition schema for filters
const ConditionSchema = z
    .object({
        field: AllowedFieldSchema,
        operator: AllowedOperatorSchema,
        value: z.union([z.string(), z.number(), z.array(z.string()), z.null()]),
    })
    .refine(
        (data) => {
            const numericOperators = ["gt", "gte", "lt", "lte"];
            if (numericOperators.includes(data.operator)) {
                return NUMERIC_FIELDS.includes(data.field) && typeof data.value === "number";
            }
            if (data.operator === "contains" || data.operator === "starts_with") {
                return typeof data.value === "string";
            }
            if (data.operator === "in") {
                return Array.isArray(data.value);
            }
            return true;
        },
        { message: "Invalid operator/field/value combination" }
    );

// Date range schema
const DateRangeSchema = z.object({
    start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    relative: z.enum(["today", "this_week", "next_week", "this_month"]).optional(),
});

// LLM query intent schema
export const QueryIntentSchema = z
    .object({
        query_type: QueryTypeSchema,
        conditions: z.array(ConditionSchema).max(5).optional(),
        date_range: DateRangeSchema.optional(),
        fields: z.array(AllowedFieldSchema).max(5).optional(),
        sort: z
            .object({
                field: AllowedFieldSchema,
                order: z.enum(["asc", "desc"]),
            })
            .optional(),
        limit: z.number().int().min(1).max(50).optional(),
        search_text: z.string().max(200).optional(),
    })
    .refine(
        (data) => {
            // Validate required fields for certain query types
            switch (data.query_type) {
                case "salary_range":
                    return data.conditions?.some((c) =>
                        c.field === "salary_min" || c.field === "salary_max"
                    );
                case "closing_soon":
                    return data.date_range !== undefined;
                case "by_employer":
                    return data.conditions?.some((c) => c.field === "employer");
                case "by_location":
                    return data.conditions?.some((c) => c.field === "location");
                default:
                    return true;
            }
        },
        { message: "Missing required fields for query type" }
    );

// Schema for unanswerable questions
export const UnanswerableSchema = z.object({
    unanswerable: z.literal(true),
    reason: z.string(),
});

// Schema for rejected questions
export const RejectedSchema = z.object({
    rejected: z.literal(true),
    reason: z.string(),
});

// Combined LLM response schema
export const LLMResponseSchema = z.union([
    QueryIntentSchema,
    UnanswerableSchema,
    RejectedSchema,
]);

/**
 * Validate query parameters from URL
 */
export function validateQueryParams(searchParams) {
    const params = {};

    for (const [key, value] of searchParams.entries()) {
        params[key] = value;
    }

    return JobQuerySchema.safeParse(params);
}

/**
 * Validate question input
 */
export function validateQuestion(body) {
    return QuestionInputSchema.safeParse(body);
}

/**
 * Validate LLM response
 */
export function validateLLMResponse(response) {
    return LLMResponseSchema.safeParse(response);
}
