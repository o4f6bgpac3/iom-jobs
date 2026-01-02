// Centralized configuration for IOM Job Scraper

// Classification IDs from source site
export const CLASSIFICATIONS = {
    "1253": "BEAUTY",
    "5312": "BRICKLAYER",
    "9230": "CLEANING SERVICES",
    "5319": "CONSTRUCTION: OTHER SKILLED",
    "9120": "CONSTRUCTION: UNSKILLED",
    "3500": "CONSULTANT (BUSINESS / LEGAL)",
    "3400": "CULTURAL & SPORT OCCUPATIONS",
    "7200": "CUSTOMER SERVICE OCCUPATIONS",
    "8211": "DRIVER: HGV, PSV ETC",
    "8212": "DRIVER: OTHER",
    "2300": "EDUCATION / TEACHING / NURSERY",
    "5241": "ELECTRICIAN",
    "2120": "ENGINEERING: SKILLED",
    "3113": "ENGINEERING: UNSKILLED",
    "5119": "FARMING / AGRICULTURE / FISHERIES",
    "2400": "FINANCE & ACCOUNTANCY",
    "5322": "FLOORING / TILING",
    "5113": "GARDENER / LANDSCAPER",
    "5316": "GLAZIER",
    "8120": "GROUNDWORK / PLANT OPERATOR",
    "2200": "HEALTHCARE",
    "6200": "HOTEL / CATERER / BAR WORK",
    "3130": "INFORMATION TECHNOLOGY",
    "4100": "INSURANCE / BANKING ADMIN",
    "2130": "IS / TELECOMMUNICATIONS",
    "5315": "JOINER",
    "1100": "MANAGEMENT",
    "5230": "MECHANIC",
    "9900": "NO PREVIOUS JOB",
    "9999": "NOT KNOWN",
    "6100": "NURSING",
    "4200": "OTHER ADMIN / CLERICAL",
    "9270": "OTHER ELEMENTARY SERVICES OCCUPATIONS",
    "1200": "OTHER PROFESSIONS",
    "5323": "PAINTER & DECORATOR",
    "5321": "PLASTERER",
    "5314": "PLUMBER",
    "8130": "PRODUCTION / ASSEMBLY OPERATIVE",
    "3300": "PROTECTIVE SERVICE OCCUPATIONS",
    "7100": "RETAIL / SALES / WHOLESALE / BUYER",
    "5313": "ROOFER",
    "8141": "SCAFFOLDER",
    "3110": "SCIENTIFIC / CHEMIST",
    "5400": "TEXTILES & PAINTING",
    "5215": "WELDER",
};

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
    model: "llama-3.3-70b",
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
