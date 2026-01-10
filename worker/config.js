// Centralized configuration for IOM Job Scraper

// Scraper settings
const SCRAPER_DEFAULTS = {
    baseUrl: "https://services.gov.im/job-search/results",
    fullListingParams: "AreaId=&ClassificationId=&SearchText=&LastThreeDays=False&JobHoursOption=",
    recentListingParams: "AreaId=&ClassificationId=&SearchText=&LastThreeDays=True&JobHoursOption=",
    requestDelayMs: 1000,
    userAgent: "IOM-Job-Scraper/1.0 (+https://github.com/example/iom-job-scraper)",
};

// LLM settings (Venice.ai default, OpenAI-compatible)
const LLM_DEFAULTS = {
    apiUrl: "https://api.venice.ai/api/v1/chat/completions",
    model: "zai-org-glm-4.7",
    timeoutMs: 15000,
    maxRetries: 1,
    temperature: {
        structured: 0.1,
        natural: 0.7,
    },
    maxTokens: {
        structured: 500,
        natural: 500,
    },
};

// Rate limiting settings (tiered)
const RATE_LIMIT_DEFAULTS = {
    // API endpoints: GET /, /job/:id, /stats
    api: {
        maxRequests: 60,
        windowSeconds: 60, // 60 requests per minute
    },
    // Ask endpoint: POST /ask (LLM queries - expensive)
    ask: {
        maxRequests: 10,
        windowSeconds: 86400, // 10 requests per day
    },
};

// Cache settings
const CACHE_DEFAULTS = {
    statsTtlSeconds: 300, // 5 minutes for /stats
    httpMaxAge: 120, // 2 minutes for Cache-Control headers
};

// CORS settings
const CORS_DEFAULTS = {
    defaultOrigin: "https://iom-jobs.pages.dev",
    allowedMethods: "GET, POST, OPTIONS",
    allowedHeaders: "Content-Type, Authorization",
    maxAge: "86400",
};

// API settings
const API_DEFAULTS = {
    defaultPageSize: 100,
    maxPageSize: 200,
};

/**
 * Get LLM configuration with environment variable overrides
 */
export function getLLMConfig(env = {}) {
    return {
        apiUrl: env.LLM_API_URL || LLM_DEFAULTS.apiUrl,
        model: env.LLM_MODEL || LLM_DEFAULTS.model,
        timeoutMs: env.LLM_TIMEOUT_MS ? parseInt(env.LLM_TIMEOUT_MS, 10) : LLM_DEFAULTS.timeoutMs,
        maxRetries: env.LLM_MAX_RETRIES ? parseInt(env.LLM_MAX_RETRIES, 10) : LLM_DEFAULTS.maxRetries,
        temperature: LLM_DEFAULTS.temperature,
        maxTokens: LLM_DEFAULTS.maxTokens,
    };
}

/**
 * Get full listing URL for initial scrape
 */
export function getFullListingUrl() {
    return `${SCRAPER_DEFAULTS.baseUrl}?${SCRAPER_DEFAULTS.fullListingParams}`;
}

/**
 * Get recent listing URL for daily updates
 */
export function getRecentListingUrl() {
    return `${SCRAPER_DEFAULTS.baseUrl}?${SCRAPER_DEFAULTS.recentListingParams}`;
}

// Central configuration object
export const CONFIG = {
    scraper: SCRAPER_DEFAULTS,
    llm: LLM_DEFAULTS,
    rateLimit: RATE_LIMIT_DEFAULTS,
    cache: CACHE_DEFAULTS,
    cors: CORS_DEFAULTS,
    api: API_DEFAULTS,
};
