// Job Scraper Module for IOM Government Jobs
// Fetches, parses, and stores job listings with real-time updates

import { CONFIG, CLASSIFICATIONS } from "./config.js";
import { parseJobListings, parseJobDetail, parsePagination, extractJobtrainUrl, isJobtrainRedirect, parseJobtrainDetail } from "./parser.js";
import { getBrowserHeaders, sleep, generateJobGuid, parseSalaryRange } from "./utils.js";

/**
 * Main scraping function - fetches and stores jobs with real-time updates
 * Scrapes by classification to properly categorize jobs
 * @param {Object} env - Cloudflare environment bindings
 * @param {boolean} forceFullScrape - Force full scrape even if DB has data
 * @returns {Object} Scrape results
 */
export async function scrapeJobs(env, forceFullScrape = false) {
    const startTime = new Date();
    let logId = null;
    let totalFound = 0;
    let totalInserted = 0;
    let totalUpdated = 0;

    try {
        // Determine if this is a first run (empty database)
        const isFirstRun = await isEmptyDatabase(env);
        const useFullListing = forceFullScrape || isFirstRun;

        const urlType = useFullListing ? "full" : "recent";
        console.log(`Starting ${urlType} scrape by classification...`);

        // Log scrape start
        logId = await logScrapeStart(env, urlType);

        // Iterate through each classification
        const classificationIds = Object.keys(CLASSIFICATIONS);
        console.log(`Scraping ${classificationIds.length} classifications...`);

        for (const classId of classificationIds) {
            const classificationName = CLASSIFICATIONS[classId];
            const baseParams = useFullListing
                ? `AreaId=&ClassificationId=${classId}&SearchText=&LastThreeDays=False&JobHoursOption=`
                : `AreaId=&ClassificationId=${classId}&SearchText=&LastThreeDays=True&JobHoursOption=`;

            let currentUrl = `${CONFIG.scraper.baseUrl}?${baseParams}`;
            let pageCount = 0;
            const maxPages = 20;
            let classFound = 0;

            while (currentUrl && pageCount < maxPages) {
                pageCount++;
                console.log(`[${classificationName}] Page ${pageCount}: ${currentUrl}`);

                const html = await fetchPage(currentUrl);
                if (!html) {
                    console.error(`[${classificationName}] Failed to fetch page ${pageCount}`);
                    break;
                }

                const jobs = parseJobListings(html);

                // Set classification on each job
                for (const job of jobs) {
                    job.classification = classificationName;
                }

                classFound += jobs.length;
                totalFound += jobs.length;

                // IMMEDIATELY save jobs to database (basic info only)
                if (jobs.length > 0) {
                    const { inserted, updated } = await storeJobsBasic(env, jobs);
                    totalInserted += inserted;
                    totalUpdated += updated;
                    console.log(`[${classificationName}] Page ${pageCount}: ${jobs.length} found, ${inserted} new, ${updated} updated`);

                    // Update scrape log with progress
                    await updateScrapeProgress(env, logId, totalFound, totalInserted, totalUpdated);
                }

                // Check for next page
                const pagination = parsePagination(html);
                if (pagination.hasMore && pagination.nextUrl) {
                    currentUrl = pagination.nextUrl;
                    await sleep(CONFIG.scraper.requestDelayMs);
                } else {
                    currentUrl = null;
                }
            }

            console.log(`[${classificationName}] Complete: ${classFound} jobs`);

            // Brief pause between classifications
            await sleep(500);
        }

        console.log(`Listing scrape complete: ${totalFound} jobs found`);

        // Now fetch detailed info for jobs that need it (in background-friendly batches)
        await enrichJobDetails(env, logId);

        // Mark expired jobs
        await markExpiredJobs(env);

        // Log completion
        await logScrapeComplete(env, logId, totalFound, totalInserted, totalUpdated, "success");

        const duration = (new Date() - startTime) / 1000;
        console.log(`Scrape completed in ${duration}s: ${totalInserted} inserted, ${totalUpdated} updated`);

        return {
            success: true,
            message: `Scraped ${totalFound} jobs`,
            stats: {
                found: totalFound,
                inserted: totalInserted,
                updated: totalUpdated,
                duration: `${duration.toFixed(1)}s`,
            },
        };
    } catch (error) {
        console.error("Scrape error:", error);

        if (logId) {
            await logScrapeComplete(env, logId, totalFound, totalInserted, totalUpdated, "failed", error.message);
        }

        return {
            success: false,
            error: error.message,
            stats: { found: totalFound, inserted: totalInserted, updated: totalUpdated },
        };
    }
}

/**
 * Check if the jobs table is empty
 */
async function isEmptyDatabase(env) {
    try {
        const result = await env.DB.prepare("SELECT COUNT(*) as count FROM jobs").first();
        return result.count === 0;
    } catch (error) {
        console.error("Error checking database:", error);
        return true;
    }
}

/**
 * Fetch a single page with browser-like headers
 */
async function fetchPage(url) {
    try {
        // Build headers with Referer to help pass WAF checks
        const headers = getBrowserHeaders();
        // Add Referer header - WAFs often check this
        const urlObj = new URL(url);
        headers["Referer"] = `${urlObj.origin}/`;
        headers["Origin"] = urlObj.origin;

        const response = await fetch(url, {
            method: "GET",
            headers,
            redirect: "follow",
        });

        if (!response.ok) {
            console.error(`HTTP error ${response.status} for ${url}`);
            return null;
        }

        const text = await response.text();

        // Detect WAF block pages (gov.im uses F5/Volterra WAF)
        if (text.includes("Request Rejected") || text.includes("URL was rejected")) {
            console.error(`WAF blocked request for ${url}`);
            return null;
        }

        return text;
    } catch (error) {
        console.error(`Fetch error for ${url}:`, error.message);
        return null;
    }
}

/**
 * Store jobs with basic info immediately (for real-time display)
 */
async function storeJobsBasic(env, jobs) {
    let inserted = 0;
    let updated = 0;

    const stmt = env.DB.prepare(`
        INSERT INTO jobs (
            title, employer, location,
            salary_text, salary_min, salary_max, salary_type,
            job_type, classification, area, hours_option,
            posted_date, closing_date,
            summary,
            source_url,
            guid, scraped_at, updated_at, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(guid) DO UPDATE SET
            title = excluded.title,
            employer = COALESCE(excluded.employer, jobs.employer),
            location = COALESCE(excluded.location, jobs.location),
            salary_text = COALESCE(excluded.salary_text, jobs.salary_text),
            salary_min = COALESCE(excluded.salary_min, jobs.salary_min),
            salary_max = COALESCE(excluded.salary_max, jobs.salary_max),
            closing_date = COALESCE(excluded.closing_date, jobs.closing_date),
            summary = COALESCE(excluded.summary, jobs.summary),
            classification = COALESCE(excluded.classification, jobs.classification),
            updated_at = excluded.updated_at,
            is_active = 1
    `);

    const now = new Date().toISOString();

    // Helper to convert undefined to null (D1 doesn't accept undefined)
    const n = (v) => v === undefined ? null : v;

    for (const job of jobs) {
        try {
            await stmt.bind(
                n(job.title),
                n(job.employer),
                n(job.location),
                n(job.salary_text),
                n(job.salary_min),
                n(job.salary_max),
                n(job.salary_type),
                n(job.job_type),
                n(job.classification),
                n(job.area),
                n(job.hours_option),
                n(job.posted_date),
                n(job.closing_date),
                n(job.summary),
                n(job.source_url),
                n(job.guid),
                now,
                now,
                1
            ).run();
            inserted++;
        } catch (error) {
            if (error.message?.includes("UNIQUE constraint")) {
                updated++;
            } else {
                console.error(`Error storing job ${job.title}:`, error.message);
            }
        }
    }

    return { inserted, updated };
}

/**
 * Enrich jobs with detailed information (fetches detail pages)
 */
async function enrichJobDetails(env, logId) {
    // Get jobs that need detail enrichment:
    // 1. No description yet
    // 2. Description is just a jobtrain redirect (needs enrichment)
    const jobsNeedingDetails = await env.DB.prepare(`
        SELECT id, title, source_url, description FROM jobs
        WHERE source_url IS NOT NULL
          AND (description IS NULL
               OR (description LIKE '%jobtrain.co.uk%'
                   AND length(description) < 500))
        ORDER BY scraped_at DESC
        LIMIT 100
    `).all();

    const jobs = jobsNeedingDetails.results || [];
    console.log(`Enriching details for ${jobs.length} jobs`);

    let enriched = 0;

    for (const job of jobs) {
        try {
            console.log(`Fetching details for: ${job.title?.substring(0, 50)}`);

            const html = await fetchPage(job.source_url);
            if (html) {
                let details = parseJobDetail(html);
                let info = details.additional_info || {};

                // Check if the description is just a jobtrain redirect
                // If so, fetch the full content from jobtrain
                // Note: jobtrain fetching may fail in local wrangler dev due to TLS issues
                // Use `npm run dev:remote` for full testing
                if (isJobtrainRedirect(details.description)) {
                    const jobtrainUrl = extractJobtrainUrl(details.description);
                    if (jobtrainUrl) {
                        console.log(`  → Fetching jobtrain content: ${jobtrainUrl}`);
                        await sleep(CONFIG.scraper.requestDelayMs);
                        let jobtrainHtml = null;
                        try {
                            jobtrainHtml = await fetchPage(jobtrainUrl);
                        } catch (e) {
                            console.log(`  ✗ Jobtrain fetch error (expected in local dev): ${e.message}`);
                        }
                        if (jobtrainHtml) {
                            const jobtrainDetails = parseJobtrainDetail(jobtrainHtml);
                            if (jobtrainDetails.description) {
                                // Use jobtrain description as the main description
                                // Append the original link for users to apply
                                details.description = jobtrainDetails.description +
                                    "\n\n---\n\nFor more details and to apply, visit:\n" + jobtrainUrl;
                                // Also update apply_url to point to jobtrain
                                details.apply_url = details.apply_url || jobtrainUrl;
                                // Merge other fields if not already set
                                if (jobtrainDetails.salary && !info.salary) {
                                    info.salary = jobtrainDetails.salary;
                                }
                                if (jobtrainDetails.job_type && !info.job_type) {
                                    info.job_type = jobtrainDetails.job_type;
                                }
                                if (jobtrainDetails.closing_date && !info.closing_date) {
                                    info.closing_date = jobtrainDetails.closing_date;
                                }
                                if (jobtrainDetails.location && !info.location) {
                                    info.location = jobtrainDetails.location;
                                }
                                console.log(`  ✓ Enriched with jobtrain content (${details.description?.length || 0} chars)`);
                            } else {
                                console.log(`  ✗ Jobtrain page had no description`);
                            }
                        } else {
                            console.log(`  ✗ Failed to fetch jobtrain page`);
                        }
                    }
                }

                // Parse salary from detail page
                let salaryMin = null;
                let salaryMax = null;
                let salaryType = null;
                if (info.salary) {
                    const parsed = parseSalaryRange(info.salary);
                    salaryMin = parsed.min;
                    salaryMax = parsed.max;
                    salaryType = parsed.type;
                }

                // Determine hours_type from hours_option
                let hoursType = null;
                const hoursLower = (info.hours_option || "").toLowerCase();
                if (hoursLower.includes("full-time") || hoursLower.includes("full time")) {
                    hoursType = "full-time";
                } else if (hoursLower.includes("part-time") || hoursLower.includes("part time")) {
                    hoursType = "part-time";
                }

                // Store all additional info as JSON (excluding private _label fields)
                const additionalInfoJson = JSON.stringify(
                    Object.fromEntries(
                        Object.entries(info).filter(([k]) => !k.startsWith("_"))
                    )
                );

                // Update job with ALL details + raw HTML for future re-parsing
                await env.DB.prepare(`
                    UPDATE jobs SET
                        description = ?,
                        apply_url = ?,
                        employer = COALESCE(?, employer),
                        location = COALESCE(?, location),
                        salary_text = COALESCE(?, salary_text),
                        salary_min = COALESCE(?, salary_min),
                        salary_max = COALESCE(?, salary_max),
                        salary_type = COALESCE(?, salary_type),
                        hours_option = COALESCE(?, hours_option),
                        hours_type = COALESCE(?, hours_type),
                        job_type = COALESCE(?, job_type),
                        closing_date = COALESCE(?, closing_date),
                        start_date = COALESCE(?, start_date),
                        reference = COALESCE(?, reference),
                        contact_name = COALESCE(?, contact_name),
                        contact_email = COALESCE(?, contact_email),
                        contact_phone = COALESCE(?, contact_phone),
                        qualifications = COALESCE(?, qualifications),
                        experience = COALESCE(?, experience),
                        benefits = COALESCE(?, benefits),
                        how_to_apply = COALESCE(?, how_to_apply),
                        additional_info = ?,
                        raw_html = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `).bind(
                    details.description,
                    details.apply_url,
                    info.employer || null,
                    info.location || null,
                    info.salary || null,
                    salaryMin,
                    salaryMax,
                    salaryType,
                    info.hours_option || null,
                    hoursType,
                    info.job_type || null,
                    info.closing_date || null,
                    info.start_date || null,
                    info.reference || null,
                    info.contact_name || null,
                    info.contact_email || null,
                    info.contact_phone || null,
                    info.qualifications || null,
                    info.experience || null,
                    info.benefits || null,
                    info.how_to_apply || null,
                    additionalInfoJson,
                    html,  // Store raw HTML for future re-parsing
                    job.id
                ).run();

                enriched++;
            }

            // Rate limit
            await sleep(CONFIG.scraper.requestDelayMs);
        } catch (error) {
            console.error(`Error enriching ${job.title}:`, error.message);
        }
    }

    console.log(`Enriched ${enriched} jobs with details`);
    return enriched;
}

/**
 * Extract additional fields from parsed detail info
 */
function extractAdditionalFields(additionalInfo) {
    const fields = {};

    if (!additionalInfo) return fields;

    // Map common field names
    const fieldMap = {
        "department": "employer",
        "organisation": "employer",
        "area": "area",
        "classification": "classification",
        "hours": "hours_option",
        "contract_type": "job_type",
    };

    for (const [key, targetField] of Object.entries(fieldMap)) {
        if (additionalInfo[key]) {
            fields[targetField] = additionalInfo[key];
        }
    }

    return fields;
}

/**
 * Mark jobs as inactive if their closing date has passed
 */
async function markExpiredJobs(env) {
    try {
        const result = await env.DB.prepare(`
            UPDATE jobs
            SET is_active = 0, updated_at = CURRENT_TIMESTAMP
            WHERE closing_date < date('now')
            AND is_active = 1
        `).run();

        console.log(`Marked ${result.meta?.changes || 0} jobs as expired`);
    } catch (error) {
        console.error("Error marking expired jobs:", error);
    }
}

/**
 * Log the start of a scrape operation
 */
async function logScrapeStart(env, urlType) {
    try {
        const result = await env.DB.prepare(`
            INSERT INTO scrape_log (url_type, status)
            VALUES (?, 'running')
        `).bind(urlType).run();

        return result.meta?.last_row_id;
    } catch (error) {
        console.error("Error logging scrape start:", error);
        return null;
    }
}

/**
 * Update scrape progress (for real-time monitoring)
 */
async function updateScrapeProgress(env, logId, found, inserted, updated) {
    if (!logId) return;

    try {
        await env.DB.prepare(`
            UPDATE scrape_log
            SET jobs_found = ?,
                jobs_inserted = ?,
                jobs_updated = ?
            WHERE id = ?
        `).bind(found, inserted, updated, logId).run();
    } catch (error) {
        console.error("Error updating scrape progress:", error);
    }
}

/**
 * Log the completion of a scrape operation
 */
async function logScrapeComplete(env, logId, found, inserted, updated, status, errorMessage = null) {
    if (!logId) return;

    try {
        await env.DB.prepare(`
            UPDATE scrape_log
            SET completed_at = CURRENT_TIMESTAMP,
                jobs_found = ?,
                jobs_inserted = ?,
                jobs_updated = ?,
                status = ?,
                error_message = ?
            WHERE id = ?
        `).bind(found, inserted, updated, status, errorMessage, logId).run();
    } catch (error) {
        console.error("Error logging scrape completion:", error);
    }
}

/**
 * Get the last scrape status
 */
/**
 * Run enrichment only (without listing fetch)
 * Useful for catching up on jobs that need enrichment
 */
export async function enrichJobDetailsOnly(env) {
    console.log("Starting standalone enrichment...");
    const startTime = Date.now();
    const enriched = await enrichJobDetails(env, null);
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`Enrichment complete: ${enriched} jobs enriched in ${duration}s`);
    return {
        success: true,
        enriched,
        duration: `${duration}s`,
    };
}

export async function getLastScrapeStatus(env) {
    try {
        return await env.DB.prepare(`
            SELECT * FROM scrape_log
            ORDER BY started_at DESC
            LIMIT 1
        `).first();
    } catch (error) {
        console.error("Error getting last scrape status:", error);
        return null;
    }
}
