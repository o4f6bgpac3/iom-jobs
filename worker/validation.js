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
