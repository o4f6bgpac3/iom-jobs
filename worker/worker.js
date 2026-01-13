// IOM Job Scraper - Cloudflare Worker
// Main entry point for API and scheduled scraping

import { CONFIG } from "./config.js";
import { scrapeJobs, getLastScrapeStatus } from "./scraper.js";
import { validateQueryParams, ScrapeRequestSchema } from "./validation.js";
import { handleAskRequest, handleAskStreamRequest } from "./ask.js";

/**
 * Generate CORS headers
 */
function corsHeaders(origin) {
    return {
        "Access-Control-Allow-Origin": origin || CONFIG.cors.defaultOrigin,
        "Access-Control-Allow-Methods": CONFIG.cors.allowedMethods,
        "Access-Control-Allow-Headers": CONFIG.cors.allowedHeaders,
        "Access-Control-Max-Age": CONFIG.cors.maxAge,
    };
}

/**
 * Handle job listings endpoint
 */
async function handleJobsRequest(request, env) {
    const url = new URL(request.url);
    const validation = validateQueryParams(url.searchParams);

    if (!validation.success) {
        return {
            result: {
                success: false,
                error: "invalid_parameters",
                message: validation.error.errors[0].message,
            },
            status: 400,
        };
    }

    const params = validation.data;

    try {
        // Build query dynamically
        let whereClause = [];
        let queryParams = [];
        let paramIndex = 0;

        // Active jobs filter
        if (params.active_only) {
            whereClause.push("is_active = 1");
        }

        // Employer filter
        if (params.employer) {
            whereClause.push(`employer LIKE ?`);
            queryParams.push(`%${params.employer}%`);
        }

        // Location filter
        if (params.location) {
            whereClause.push(`location LIKE ?`);
            queryParams.push(`%${params.location}%`);
        }

        // Classification filter
        if (params.classification) {
            whereClause.push(`classification LIKE ?`);
            queryParams.push(`%${params.classification}%`);
        }

        // Job type filter
        if (params.job_type) {
            whereClause.push(`job_type LIKE ?`);
            queryParams.push(`%${params.job_type}%`);
        }

        // Hours type filter (full-time, part-time)
        if (params.hours_type) {
            whereClause.push(`hours_type = ?`);
            queryParams.push(params.hours_type);
        }

        // Last N days filter
        if (params.last_days) {
            whereClause.push(`posted_date >= date('now', '-' || ? || ' days')`);
            queryParams.push(params.last_days);
        }

        // Salary filters
        if (params.salary_min !== undefined) {
            whereClause.push(`salary_max >= ?`);
            queryParams.push(params.salary_min);
        }
        if (params.salary_max !== undefined) {
            whereClause.push(`salary_min <= ?`);
            queryParams.push(params.salary_max);
        }

        // Date filters
        if (params.closing_after) {
            whereClause.push(`closing_date >= ?`);
            queryParams.push(params.closing_after);
        }
        if (params.posted_after) {
            whereClause.push(`posted_date >= ?`);
            queryParams.push(params.posted_after);
        }

        // Search filter (includes title, employer, description, summary)
        if (params.search) {
            whereClause.push(`(title LIKE ? OR employer LIKE ? OR description LIKE ? OR summary LIKE ?)`);
            const searchTerm = `%${params.search}%`;
            queryParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        // Build WHERE clause
        const where = whereClause.length > 0 ? `WHERE ${whereClause.join(" AND ")}` : "";

        // Get total count
        const countSql = `SELECT COUNT(*) as total FROM jobs ${where}`;
        const countResult = await env.DB.prepare(countSql).bind(...queryParams).first();
        const total = countResult?.total || 0;

        // Calculate pagination
        const offset = (params.page - 1) * params.limit;
        const totalPages = Math.ceil(total / params.limit);

        // Get jobs with all fields needed for display
        const jobsSql = `
            SELECT id, title, employer, location, salary_text, salary_min, salary_max, salary_type,
                   job_type, hours_option, hours_type, classification, area,
                   posted_date, closing_date, start_date, scraped_at,
                   summary, description,
                   reference, contact_name, contact_email, contact_phone,
                   qualifications, experience, benefits, how_to_apply,
                   additional_info,
                   source_url, apply_url, is_active
            FROM jobs
            ${where}
            ORDER BY ${params.sort} ${params.order}
            LIMIT ? OFFSET ?
        `;

        const jobsResult = await env.DB.prepare(jobsSql)
            .bind(...queryParams, params.limit, offset)
            .all();

        // Get filter options, stats, and last scrape time in parallel
        const [employers, locations, classifications, jobTypes, hoursTypes, totalCount, activeCount, closingSoon, lastScrape] = await Promise.all([
            env.DB.prepare("SELECT DISTINCT employer FROM jobs WHERE employer IS NOT NULL ORDER BY employer").all(),
            env.DB.prepare("SELECT DISTINCT location FROM jobs WHERE location IS NOT NULL ORDER BY location").all(),
            env.DB.prepare("SELECT DISTINCT classification FROM jobs WHERE classification IS NOT NULL ORDER BY classification").all(),
            env.DB.prepare("SELECT DISTINCT job_type FROM jobs WHERE job_type IS NOT NULL ORDER BY job_type").all(),
            env.DB.prepare("SELECT DISTINCT hours_type FROM jobs WHERE hours_type IS NOT NULL ORDER BY hours_type").all(),
            env.DB.prepare("SELECT COUNT(*) as count FROM jobs").first(),
            env.DB.prepare("SELECT COUNT(*) as count FROM jobs WHERE is_active = 1").first(),
            env.DB.prepare(`
                SELECT COUNT(*) as count FROM jobs
                WHERE is_active = 1 AND closing_date BETWEEN date('now') AND date('now', '+7 days')
            `).first(),
            env.DB.prepare("SELECT completed_at FROM scrape_log WHERE status = 'success' ORDER BY completed_at DESC LIMIT 1").first(),
        ]);

        // Parse additional_info JSON for each job
        const jobs = (jobsResult.results || []).map(job => {
            if (job.additional_info) {
                try {
                    job.additional_info = JSON.parse(job.additional_info);
                } catch (e) {
                    job.additional_info = {};
                }
            }
            return job;
        });

        return {
            result: {
                success: true,
                data: {
                    jobs,
                    pagination: {
                        page: params.page,
                        limit: params.limit,
                        total,
                        totalPages,
                    },
                    filters: {
                        employers: employers.results?.map(r => r.employer) || [],
                        locations: locations.results?.map(r => r.location) || [],
                        classifications: classifications.results?.map(r => r.classification) || [],
                        job_types: jobTypes.results?.map(r => r.job_type) || [],
                        hours_types: hoursTypes.results?.map(r => r.hours_type) || [],
                    },
                    stats: {
                        total_jobs: totalCount?.count || 0,
                        active_jobs: activeCount?.count || 0,
                        closing_this_week: closingSoon?.count || 0,
                        last_updated: lastScrape?.completed_at || null,
                    },
                },
            },
            status: 200,
        };
    } catch (error) {
        console.error("Error fetching jobs:", error);
        return {
            result: {
                success: false,
                error: "internal_error",
                message: "Failed to fetch jobs",
            },
            status: 500,
        };
    }
}

/**
 * Handle single job endpoint
 */
async function handleJobDetailRequest(request, env, jobId) {
    try {
        const job = await env.DB.prepare(`
            SELECT * FROM jobs WHERE id = ?
        `).bind(jobId).first();

        if (!job) {
            return {
                result: { success: false, error: "not_found", message: "Job not found" },
                status: 404,
            };
        }

        // Get related jobs (same employer or classification)
        const related = await env.DB.prepare(`
            SELECT id, title, employer, location, salary_text, closing_date
            FROM jobs
            WHERE id != ? AND is_active = 1
            AND (employer = ? OR classification = ?)
            ORDER BY posted_date DESC
            LIMIT 5
        `).bind(jobId, job.employer, job.classification).all();

        return {
            result: {
                success: true,
                data: {
                    job,
                    related: related.results || [],
                },
            },
            status: 200,
        };
    } catch (error) {
        console.error("Error fetching job:", error);
        return {
            result: { success: false, error: "internal_error" },
            status: 500,
        };
    }
}

/**
 * Handle health endpoint for external monitoring
 * Returns health status based on recent scrape/enrichment activity
 */
async function handleHealthRequest(env) {
    try {
        // Get recent scrape logs (last 7 days)
        const recentLogs = await env.DB.prepare(`
            SELECT id, started_at, completed_at, url_type, jobs_found, jobs_inserted,
                   status, error_message
            FROM scrape_log
            WHERE started_at > datetime('now', '-7 days')
            ORDER BY started_at DESC
            LIMIT 20
        `).all();

        const logs = recentLogs.results || [];

        // Separate scrape and enrichment logs
        const scrapeLogs = logs.filter(l => l.url_type !== "enrichment");
        const enrichmentLogs = logs.filter(l => l.url_type === "enrichment");

        // Analyze health
        const lastScrape = scrapeLogs[0] || null;
        const lastEnrichment = enrichmentLogs[0] || null;

        // Check for issues
        const issues = [];

        // Issue: No scrapes in last 48 hours
        if (lastScrape) {
            const hoursSinceLastScrape = (Date.now() - new Date(lastScrape.started_at + "Z").getTime()) / (1000 * 60 * 60);
            if (hoursSinceLastScrape > 48) {
                issues.push(`No scrape in ${Math.round(hoursSinceLastScrape)} hours`);
            }
        } else {
            issues.push("No scrapes found in last 7 days");
        }

        // Issue: Last scrape failed
        if (lastScrape && lastScrape.status === "failed") {
            issues.push(`Last scrape failed: ${lastScrape.error_message || "unknown error"}`);
        }

        // Issue: Recent scrapes have high failure rate
        const recentFailedScrapes = scrapeLogs.filter(l => l.status === "failed").length;
        if (scrapeLogs.length >= 3 && recentFailedScrapes / scrapeLogs.length > 0.5) {
            issues.push(`High scrape failure rate: ${recentFailedScrapes}/${scrapeLogs.length} failed`);
        }

        // Issue: Last enrichment failed
        if (lastEnrichment && lastEnrichment.status === "failed") {
            issues.push(`Last enrichment failed: ${lastEnrichment.error_message || "unknown error"}`);
        }

        // Determine overall health
        const healthy = issues.length === 0;
        const status = healthy ? "healthy" : "unhealthy";

        return {
            result: {
                status,
                healthy,
                issues,
                lastScrape: lastScrape ? {
                    time: lastScrape.started_at,
                    type: lastScrape.url_type,
                    status: lastScrape.status,
                    jobsFound: lastScrape.jobs_found,
                    error: lastScrape.error_message,
                } : null,
                lastEnrichment: lastEnrichment ? {
                    time: lastEnrichment.started_at,
                    status: lastEnrichment.status,
                    jobsEnriched: lastEnrichment.jobs_inserted,
                    error: lastEnrichment.error_message,
                } : null,
                recentActivity: {
                    scrapes: scrapeLogs.length,
                    scrapesFailed: recentFailedScrapes,
                    enrichments: enrichmentLogs.length,
                },
            },
            status: healthy ? 200 : 503,
        };
    } catch (error) {
        console.error("Health check error:", error);
        return {
            result: {
                status: "error",
                healthy: false,
                issues: [`Health check failed: ${error.message}`],
            },
            status: 500,
        };
    }
}

/**
 * Handle stats endpoint (with KV caching)
 */
async function handleStatsRequest(env) {
    const cacheKey = "cache:stats";

    try {
        // Check KV cache first
        const cached = await env.RATE_LIMITER.get(cacheKey, { type: "json" });
        if (cached) {
            return {
                result: {
                    success: true,
                    data: cached,
                    cached: true,
                },
                status: 200,
            };
        }

        // Cache miss - query database
        const [
            totalJobs,
            activeJobs,
            closingThisWeek,
            byEmployer,
            byLocation,
            salaryStats,
            lastScrape,
        ] = await Promise.all([
            env.DB.prepare("SELECT COUNT(*) as count FROM jobs").first(),
            env.DB.prepare("SELECT COUNT(*) as count FROM jobs WHERE is_active = 1").first(),
            env.DB.prepare(`
                SELECT COUNT(*) as count FROM jobs
                WHERE is_active = 1 AND closing_date BETWEEN date('now') AND date('now', '+7 days')
            `).first(),
            env.DB.prepare(`
                SELECT employer, COUNT(*) as count FROM jobs
                WHERE is_active = 1 AND employer IS NOT NULL
                GROUP BY employer ORDER BY count DESC LIMIT 10
            `).all(),
            env.DB.prepare(`
                SELECT location, COUNT(*) as count FROM jobs
                WHERE is_active = 1 AND location IS NOT NULL
                GROUP BY location ORDER BY count DESC LIMIT 10
            `).all(),
            env.DB.prepare(`
                SELECT
                    MIN(salary_min) as min_salary,
                    MAX(salary_max) as max_salary,
                    AVG(salary_min) as avg_min,
                    AVG(salary_max) as avg_max
                FROM jobs
                WHERE is_active = 1 AND salary_min IS NOT NULL
            `).first(),
            getLastScrapeStatus(env),
        ]);

        const statsData = {
            total_jobs: totalJobs?.count || 0,
            active_jobs: activeJobs?.count || 0,
            closing_this_week: closingThisWeek?.count || 0,
            by_employer: byEmployer.results || [],
            by_location: byLocation.results || [],
            salary_stats: salaryStats || {},
            last_scrape: lastScrape,
            generated_at: new Date().toISOString(),
        };

        // Store in KV cache with TTL
        await env.RATE_LIMITER.put(cacheKey, JSON.stringify(statsData), {
            expirationTtl: CONFIG.cache.statsTtlSeconds,
        });

        return {
            result: {
                success: true,
                data: statsData,
                cached: false,
            },
            status: 200,
        };
    } catch (error) {
        console.error("Error fetching stats:", error);
        return {
            result: { success: false, error: "internal_error" },
            status: 500,
        };
    }
}

/**
 * Handle manual scrape trigger (admin only)
 */
async function handleScrapeRequest(request, env) {
    // Verify admin authorization
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return {
            result: { success: false, error: "unauthorized" },
            status: 401,
        };
    }

    const token = authHeader.substring(7);
    if (token !== env.ADMIN_API_KEY) {
        return {
            result: { success: false, error: "forbidden" },
            status: 403,
        };
    }

    try {
        const body = await request.json();
        const validation = ScrapeRequestSchema.safeParse(body);

        if (!validation.success) {
            return {
                result: { success: false, error: "invalid_request" },
                status: 400,
            };
        }

        const forceFullScrape = validation.data.type === "full";
        const result = await scrapeJobs(env, forceFullScrape);

        return {
            result,
            status: result.success ? 200 : 500,
        };
    } catch (error) {
        console.error("Scrape error:", error);
        return {
            result: { success: false, error: error.message },
            status: 500,
        };
    }
}

/**
 * Handle sitemap.xml request - returns XML sitemap for SEO
 */
async function handleSitemapRequest(env) {
    try {
        const jobs = await env.DB.prepare(`
            SELECT id, updated_at FROM jobs WHERE is_active = 1
        `).all();

        const baseUrl = "https://jobs.balley.xyz";
        const today = new Date().toISOString().split("T")[0];

        const urls = [
            { loc: `${baseUrl}/`, priority: "1.0", changefreq: "daily", lastmod: today },
            ...(jobs.results || []).map(job => ({
                loc: `${baseUrl}/#job-${job.id}`,
                priority: "0.8",
                changefreq: "weekly",
                lastmod: job.updated_at?.split("T")[0] || today,
            })),
        ];

        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join("\n")}
</urlset>`;

        return new Response(xml, {
            headers: {
                "Content-Type": "application/xml",
                "Cache-Control": "public, max-age=3600",
            },
        });
    } catch (error) {
        console.error("Sitemap error:", error);
        return new Response("Error generating sitemap", { status: 500 });
    }
}

/**
 * Handle robots.txt request
 */
function handleRobotsRequest() {
    const robotsTxt = `User-agent: *
Allow: /

Sitemap: https://jobs.balley.xyz/sitemap.xml
`;

    return new Response(robotsTxt, {
        headers: {
            "Content-Type": "text/plain",
            "Cache-Control": "public, max-age=86400",
        },
    });
}

/**
 * Main fetch handler
 */
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const origin = request.headers.get("Origin");

        // Handle CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                status: 204,
                headers: corsHeaders(origin),
            });
        }

        let response;

        try {
            // Route handling
            if (url.pathname === "/" && request.method === "GET") {
                response = await handleJobsRequest(request, env);
            } else if (url.pathname.match(/^\/job\/(\d+)$/) && request.method === "GET") {
                const jobId = url.pathname.match(/^\/job\/(\d+)$/)[1];
                response = await handleJobDetailRequest(request, env, parseInt(jobId, 10));
            } else if (url.pathname === "/stats" && request.method === "GET") {
                response = await handleStatsRequest(env);
            } else if (url.pathname === "/health" && request.method === "GET") {
                response = await handleHealthRequest(env);
            } else if (url.pathname === "/scrape" && request.method === "POST") {
                response = await handleScrapeRequest(request, env);
            } else if (url.pathname === "/enrich" && request.method === "POST") {
                // Enrich-only endpoint - runs enrichment without listing fetch
                const authHeader = request.headers.get("Authorization");
                if (!authHeader || !authHeader.startsWith("Bearer ") || authHeader.substring(7) !== env.ADMIN_API_KEY) {
                    response = { result: { success: false, error: "unauthorized" }, status: 401 };
                } else {
                    const { enrichJobDetailsOnly } = await import("./scraper.js");
                    const result = await enrichJobDetailsOnly(env);
                    response = { result, status: 200 };
                }
            } else if (url.pathname === "/ask" && request.method === "POST") {
                response = await handleAskRequest(request, env);
            } else if (url.pathname === "/ask/stream" && request.method === "POST") {
                // Return SSE stream directly (not JSON wrapped)
                const streamResponse = await handleAskStreamRequest(request, env);
                // Add CORS headers
                const headers = new Headers(streamResponse.headers);
                Object.entries(corsHeaders(origin)).forEach(([key, value]) => {
                    headers.set(key, value);
                });
                return new Response(streamResponse.body, {
                    status: streamResponse.status,
                    headers,
                });
            } else if (url.pathname === "/sitemap.xml" && request.method === "GET") {
                // Return sitemap directly (not JSON)
                return await handleSitemapRequest(env);
            } else if (url.pathname === "/robots.txt" && request.method === "GET") {
                // Return robots.txt directly (not JSON)
                return handleRobotsRequest();
            } else {
                response = {
                    result: { success: false, error: "not_found" },
                    status: 404,
                };
            }
        } catch (error) {
            console.error("Request error:", error);
            response = {
                result: { success: false, error: "internal_error", message: error.message },
                status: 500,
            };
        }

        return Response.json(response.result, {
            status: response.status,
            headers: corsHeaders(origin),
        });
    },

    /**
     * Scheduled handler for daily scraping and enrichment
     * - 06:00 and 18:00 UTC: Main scrape (listing pages)
     * - 06:30 and 18:30 UTC: Enrichment (detail pages)
     */
    async scheduled(event, env, ctx) {
        const isEnrichmentTrigger = event.cron === "30 6,18 * * *";

        if (isEnrichmentTrigger) {
            console.log("Scheduled enrichment triggered at:", new Date().toISOString());
            try {
                const { enrichJobDetailsOnly } = await import("./scraper.js");
                const result = await enrichJobDetailsOnly(env);
                console.log("Scheduled enrichment result:", result);
            } catch (error) {
                console.error("Scheduled enrichment failed:", error);
            }
        } else {
            console.log("Scheduled scrape triggered at:", new Date().toISOString());
            try {
                const result = await scrapeJobs(env, false);
                console.log("Scheduled scrape result:", result);
            } catch (error) {
                console.error("Scheduled scrape failed:", error);
            }
        }
    },
};
