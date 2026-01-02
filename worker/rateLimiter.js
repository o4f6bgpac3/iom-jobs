// Tiered rate limiter using Cloudflare KV
// Supports different limits for API endpoints vs LLM queries
import { CONFIG } from "./config.js";

/**
 * Rate limit tiers
 * - "api": General API endpoints (GET /, /job/:id, /stats)
 * - "ask": LLM-powered queries (POST /ask) - more restrictive
 */
const TIERS = CONFIG.rateLimit;

/**
 * Check if a request is allowed based on rate limiting
 * @param {Request} request - The incoming request
 * @param {Object} env - Cloudflare environment bindings
 * @param {string} tier - Rate limit tier: "api" or "ask"
 * @returns {Object} { allowed, remaining, resetIn, limit }
 */
export async function checkRateLimit(request, env, tier = "api") {
    const tierConfig = TIERS[tier] || TIERS.api;
    const { maxRequests, windowSeconds } = tierConfig;

    // Extract IP from Cloudflare header
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = `ratelimit:${ip}`;

    try {
        // Retrieve current rate limit data for this IP
        const data = await env.RATE_LIMITER.get(key, { type: "json" });
        const now = Math.floor(Date.now() / 1000);

        // Initialize default structure
        const defaultTierData = { count: 0, windowStart: now };

        if (!data) {
            // First request from this IP - initialize
            const newData = {
                api: tier === "api" ? { count: 1, windowStart: now } : defaultTierData,
                ask: tier === "ask" ? { count: 1, windowStart: now } : defaultTierData,
            };
            await env.RATE_LIMITER.put(key, JSON.stringify(newData), {
                expirationTtl: Math.max(TIERS.api.windowSeconds, TIERS.ask.windowSeconds),
            });
            return {
                allowed: true,
                remaining: maxRequests - 1,
                resetIn: windowSeconds,
                limit: maxRequests,
            };
        }

        // Get or initialize tier data
        const tierData = data[tier] || defaultTierData;
        const { count, windowStart } = tierData;

        // Check if window has expired for this tier
        if (now - windowStart >= windowSeconds) {
            // Reset the window for this tier
            data[tier] = { count: 1, windowStart: now };
            await env.RATE_LIMITER.put(key, JSON.stringify(data), {
                expirationTtl: Math.max(TIERS.api.windowSeconds, TIERS.ask.windowSeconds),
            });
            return {
                allowed: true,
                remaining: maxRequests - 1,
                resetIn: windowSeconds,
                limit: maxRequests,
            };
        }

        // Within current window
        const resetIn = windowSeconds - (now - windowStart);

        if (count >= maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                resetIn,
                limit: maxRequests,
            };
        }

        // Increment count for this tier
        data[tier] = { count: count + 1, windowStart };
        await env.RATE_LIMITER.put(key, JSON.stringify(data), {
            expirationTtl: Math.max(TIERS.api.windowSeconds, TIERS.ask.windowSeconds),
        });

        return {
            allowed: true,
            remaining: maxRequests - count - 1,
            resetIn,
            limit: maxRequests,
        };
    } catch (error) {
        console.error("Rate limit check failed:", error);
        // Fail open - allow the request if KV is unavailable
        return {
            allowed: true,
            remaining: maxRequests - 1,
            resetIn: windowSeconds,
            limit: maxRequests,
        };
    }
}

/**
 * Get current rate limit status for an IP (without incrementing)
 * @param {Request} request - The incoming request
 * @param {Object} env - Cloudflare environment bindings
 * @param {string} tier - Rate limit tier: "api" or "ask"
 */
export async function getRateLimitStatus(request, env, tier = "api") {
    const tierConfig = TIERS[tier] || TIERS.api;
    const { maxRequests, windowSeconds } = tierConfig;

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const key = `ratelimit:${ip}`;

    try {
        const data = await env.RATE_LIMITER.get(key, { type: "json" });
        const now = Math.floor(Date.now() / 1000);

        if (!data || !data[tier]) {
            return {
                used: 0,
                remaining: maxRequests,
                resetIn: windowSeconds,
                limit: maxRequests,
            };
        }

        const { count, windowStart } = data[tier];
        const elapsed = now - windowStart;

        // Window expired
        if (elapsed >= windowSeconds) {
            return {
                used: 0,
                remaining: maxRequests,
                resetIn: windowSeconds,
                limit: maxRequests,
            };
        }

        const resetIn = windowSeconds - elapsed;

        return {
            used: count,
            remaining: Math.max(0, maxRequests - count),
            resetIn,
            limit: maxRequests,
        };
    } catch (error) {
        console.error("Error getting rate limit status:", error);
        return {
            used: 0,
            remaining: maxRequests,
            resetIn: windowSeconds,
            limit: maxRequests,
        };
    }
}

/**
 * Add rate limit headers to a response
 * @param {Headers} headers - Response headers to modify
 * @param {Object} rateLimitResult - Result from checkRateLimit
 */
export function addRateLimitHeaders(headers, rateLimitResult) {
    const { limit, remaining, resetIn } = rateLimitResult;
    const resetTime = Math.floor(Date.now() / 1000) + resetIn;

    headers.set("X-RateLimit-Limit", String(limit));
    headers.set("X-RateLimit-Remaining", String(remaining));
    headers.set("X-RateLimit-Reset", String(resetTime));
}
