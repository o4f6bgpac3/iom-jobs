// HTML Parser for IOM Government Job Search
// Extracts job listings from the search results page

import { cleanText, parseDate, generateJobGuid } from "./utils.js";

/**
 * Extract jobtrain.co.uk URL from description text
 * @param {string} text - Description text that may contain a jobtrain link
 * @returns {string|null} The jobtrain URL if found, null otherwise
 */
export function extractJobtrainUrl(text) {
    if (!text) return null;

    // Match jobtrain.co.uk URLs with various patterns
    const patterns = [
        /https?:\/\/(?:www\.)?jobtrain\.co\.uk\/[^\s<>"']+/gi,
    ];

    for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) {
            // Clean up the URL - remove trailing punctuation and tracking params for cleaner URLs
            let url = match[0].replace(/[.,;:!?)]+$/, "");
            return url;
        }
    }

    return null;
}

/**
 * Check if a description is essentially just a jobtrain link
 * (minimal content that just points to jobtrain for full details)
 * @param {string} text - Description text
 * @returns {boolean} True if description is minimal and contains jobtrain link
 */
export function isJobtrainRedirect(text) {
    if (!text) return false;

    // Simple check: contains jobtrain URL and is short (just a redirect, not full content)
    const hasJobtrainUrl = /jobtrain\.co\.uk/i.test(text);
    const isShort = text.length < 500;

    return hasJobtrainUrl && isShort;
}

/**
 * Parse jobtrain.co.uk page content
 * Extracts job details from JSON-LD structured data
 * @param {string} html - HTML content of the jobtrain page
 * @returns {Object} Parsed job details
 */
export function parseJobtrainDetail(html) {
    const detail = {
        description: null,
        salary: null,
        employer: null,
        location: null,
        job_type: null,
        closing_date: null,
        posted_date: null,
        title: null,
    };

    // Extract JSON-LD structured data (most reliable source)
    const jsonLdPattern = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
    let match;

    while ((match = jsonLdPattern.exec(html)) !== null) {
        try {
            const jsonStr = match[1].trim();
            const data = JSON.parse(jsonStr);

            // Check if this is a JobPosting schema
            if (data["@type"] === "JobPosting") {
                // Extract description - it's HTML formatted
                if (data.description) {
                    detail.description = cleanHtmlDescription(data.description);
                }

                // Extract other fields
                if (data.baseSalary) {
                    detail.salary = cleanText(data.baseSalary);
                }

                if (data.title) {
                    detail.title = cleanText(data.title);
                }

                if (data.employmentType) {
                    detail.job_type = data.employmentType.toLowerCase();
                }

                if (data.validThrough) {
                    detail.closing_date = data.validThrough.split("T")[0];
                }

                if (data.datePosted) {
                    detail.posted_date = data.datePosted;
                }

                if (data.hiringOrganization?.name) {
                    detail.employer = data.hiringOrganization.name;
                }

                if (data.jobLocation?.address) {
                    const addr = data.jobLocation.address;
                    const parts = [addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean);
                    if (parts.length > 0) {
                        detail.location = parts.join(", ");
                    }
                }

                break; // Found JobPosting, no need to continue
            }
        } catch (e) {
            // JSON parse error, continue to next match
            console.log("Failed to parse JSON-LD:", e.message);
        }
    }

    // Fallback: Try to extract from page content if JSON-LD failed
    if (!detail.description) {
        // Look for job description container
        const descPatterns = [
            /<div[^>]*class="[^"]*JT-text[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i,
            /<div[^>]*class="[^"]*job-description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
            /<div[^>]*class="[^"]*description[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
        ];

        for (const pattern of descPatterns) {
            const descMatch = html.match(pattern);
            if (descMatch) {
                detail.description = cleanHtmlDescription(descMatch[1]);
                break;
            }
        }
    }

    return detail;
}

/**
 * Clean HTML description to plain text
 * @param {string} html - HTML string
 * @returns {string} Cleaned plain text
 */
function cleanHtmlDescription(html) {
    if (!html) return null;

    let text = html
        // Convert common block elements to newlines
        .replace(/<\/p>/gi, "\n\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<\/div>/gi, "\n")
        .replace(/<\/li>/gi, "\n")
        .replace(/<\/h[1-6]>/gi, "\n\n")
        // Remove all remaining HTML tags
        .replace(/<[^>]+>/g, "")
        // Decode common HTML entities
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/gi, (_, dec) => String.fromCharCode(parseInt(dec, 10)))
        // Clean up whitespace
        .replace(/[ \t]+/g, " ")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    return text;
}

/**
 * Parse job listings from the search results HTML
 * The gov.im page groups jobs by classification with <h2> headers:
 *   <h2 id=Header_xxx>Classification Name</h2>
 *   <table>
 *     <tr><td>ID</td><td><a href="viewjob?Id=...">Title</a></td><td>Employer</td><td>Hours</td></tr>
 *   </table>
 * @param {string} html - The HTML content of the search results page
 * @returns {Array} Array of parsed job objects with classification, employer, hours
 */
export function parseJobListings(html) {
    const jobs = [];

    // Try the efficient grouped format first (h2 headers + tables)
    const groupedJobs = parseGroupedJobListings(html);
    if (groupedJobs.length > 0) {
        console.log(`Found ${groupedJobs.length} jobs using grouped format`);
        return groupedJobs;
    }

    // Fallback: find job links directly
    console.log("No grouped format found, falling back to link parsing...");
    return parseJobLinks(html);
}

/**
 * Parse jobs grouped by classification headers
 * Extracts classification from <h2> headers and job details from tables
 */
function parseGroupedJobListings(html) {
    const jobs = [];

    // Pattern to find classification headers: <h2 id=Header_xxx>Classification Name</h2>
    // Followed by a table with job rows
    const sectionPattern = /<h2[^>]*id=Header_[^>]*>([^<]+)<\/h2>[\s\S]*?<table[^>]*class="table"[^>]*>([\s\S]*?)<\/table>/gi;

    let sectionMatch;
    while ((sectionMatch = sectionPattern.exec(html)) !== null) {
        const classification = cleanText(sectionMatch[1]).toUpperCase();
        const tableHtml = sectionMatch[2];

        // Parse job rows from this table
        // Skip header row, find data rows with viewjob links
        const rowPattern = /<tr>[\s\S]*?<td>(\d+)<\/td>[\s\S]*?<a[^>]*href="([^"]*viewjob[^"]*)"[^>]*>([^<]+)<\/a>[\s\S]*?<td>([^<]*)<\/td>[\s\S]*?<td>([^<]*)<\/td>[\s\S]*?<\/tr>/gi;

        let rowMatch;
        while ((rowMatch = rowPattern.exec(tableHtml)) !== null) {
            const jobId = rowMatch[1];
            const url = rowMatch[2];
            const title = cleanText(rowMatch[3]);
            const employer = cleanText(rowMatch[4]);
            const hours = cleanText(rowMatch[5]);

            // Determine hours_type from hours text
            let hoursType = null;
            const hoursLower = hours.toLowerCase();
            if (hoursLower.includes("full time") || hoursLower.includes("full-time")) {
                hoursType = "full-time";
            } else if (hoursLower.includes("part time") || hoursLower.includes("part-time")) {
                hoursType = "part-time";
            }

            jobs.push({
                title,
                employer: employer || null,
                classification,
                hours_option: hours || null,
                hours_type: hoursType,
                source_url: normalizeUrl(url),
                guid: generateJobGuid(url),
                scraped_at: new Date().toISOString(),
            });
        }
    }

    return jobs;
}

/**
 * Parse job links from the page when no structured containers found
 */
function parseJobLinks(html) {
    const jobs = [];

    // Look for links that might be job listings
    const linkPattern = /<a[^>]*href=["']([^"']*(?:job|vacancy|position|career)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    const matches = [...html.matchAll(linkPattern)];

    // Track seen URLs to avoid duplicates
    const seenUrls = new Set();

    for (const match of matches) {
        const url = match[1];
        const linkText = cleanText(match[2]);

        // Skip navigation/filter links and page elements
        if (linkText.length < 5 || linkText.length > 200) continue;
        if (url.includes("page=") || url.includes("sort=")) continue;

        // Skip page titles and generic navigation
        const lowerText = linkText.toLowerCase();
        if (lowerText === "job search" || lowerText === "jobs" || lowerText === "vacancies") continue;

        // Only include actual job detail pages (viewjob URLs)
        if (!url.includes("viewjob")) continue;

        // Skip duplicate URLs
        const normalizedUrl = normalizeUrl(url);
        if (seenUrls.has(normalizedUrl)) continue;
        seenUrls.add(normalizedUrl);

        jobs.push({
            title: linkText,
            source_url: normalizedUrl,
            guid: generateJobGuid(url),
            scraped_at: new Date().toISOString(),
        });
    }

    return jobs;
}

/**
 * Parse job detail page for full description
 * The services.gov.im job pages use a table with 4-column layout:
 * | Label | Value | Label | Value |
 * Plus a Notes row spanning full width for description
 */
export function parseJobDetail(html) {
    const detail = {
        description: null,
        apply_url: null,
        additional_info: {},
    };

    // Extract all table rows and process cell pairs
    // The gov.im pages use: <tr><td>Label</td><td>Value</td><td>Label</td><td>Value</td></tr>
    // Or sometimes: <th>Label</th><td>Value</td>

    // Pattern 1: Extract all <td> contents from rows
    const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    const cellPattern = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;

    let rowMatch;
    while ((rowMatch = rowPattern.exec(html)) !== null) {
        const rowHtml = rowMatch[1];
        const cells = [];
        let cellMatch;

        // Reset cellPattern lastIndex for each row
        cellPattern.lastIndex = 0;
        while ((cellMatch = cellPattern.exec(rowHtml)) !== null) {
            cells.push(cleanText(cellMatch[1]));
        }

        // Process cells in pairs (label, value)
        for (let i = 0; i < cells.length - 1; i += 2) {
            const rawKey = cells[i];
            const value = cells[i + 1];

            if (!rawKey || !value) continue;

            const key = rawKey.toLowerCase().replace(/[:\s]+/g, "_").replace(/_+$/, "");

            // Map to standard field names
            mapFieldToDetail(detail, key, rawKey, value);
        }
    }

    // Fallback: Try th/td pattern if no data found
    if (Object.keys(detail.additional_info).length === 0) {
        const thTdPattern = /<th[^>]*>([^<]+)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi;
        let match;
        while ((match = thTdPattern.exec(html)) !== null) {
            const rawKey = cleanText(match[1]);
            const value = cleanText(match[2]);
            const key = rawKey.toLowerCase().replace(/[:\s]+/g, "_").replace(/_+$/, "");
            mapFieldToDetail(detail, key, rawKey, value);
        }
    }

    // Extract apply URL
    const applyPatterns = [
        /<a[^>]*class="[^"]*apply[^"]*"[^>]*href=["']([^"']+)["']/i,
        /<a[^>]*href=["']([^"']+)["'][^>]*>(?:[^<]*apply[^<]*)<\/a>/i,
        /<a[^>]*href=["']([^"']*apply[^"']*)["']/i,
    ];

    for (const pattern of applyPatterns) {
        const applyMatch = html.match(pattern);
        if (applyMatch) {
            detail.apply_url = normalizeUrl(applyMatch[1]);
            break;
        }
    }

    return detail;
}

/**
 * Map a parsed field to the detail object
 */
function mapFieldToDetail(detail, key, rawKey, value) {
    if (!key || !value) return;

    // Store raw label for display
    detail.additional_info[`_label_${key}`] = rawKey;

    switch (key) {
        case "firm":
        case "employer":
        case "organisation":
        case "department":
        case "company":
            detail.additional_info.employer = value;
            break;
        case "address":
        case "location":
        case "work_location":
            detail.additional_info.location = value;
            break;
        case "salary":
        case "pay":
        case "wage":
            detail.additional_info.salary = value;
            break;
        case "hours":
        case "working_hours":
            detail.additional_info.hours_option = value;
            break;
        case "duration":
        case "contract_type":
        case "employment_type":
            detail.additional_info.job_type = value;
            break;
        case "end_date":
        case "closing_date":
        case "deadline":
            detail.additional_info.closing_date = parseDate(value);
            break;
        case "start_date":
            detail.additional_info.start_date = value;
            break;
        case "notes":
        case "description":
        case "job_description":
            detail.description = value;
            break;
        case "reference_id":
        case "reference":
        case "ref":
        case "job_reference":
        case "vacancy_reference":
            detail.additional_info.reference = value;
            break;
        case "job_title":
            detail.additional_info.title = value;
            break;
        case "number_required":
            detail.additional_info.number_required = value;
            break;
        case "contact":
        case "contact_name":
            detail.additional_info.contact_name = value;
            break;
        case "contact_email":
        case "email":
            detail.additional_info.contact_email = value;
            break;
        case "tel_no":
        case "contact_phone":
        case "phone":
        case "telephone":
            detail.additional_info.contact_phone = value;
            break;
        case "qualifications":
        case "required_qualifications":
            detail.additional_info.qualifications = value;
            break;
        case "experience":
        case "required_experience":
            detail.additional_info.experience = value;
            break;
        case "benefits":
            detail.additional_info.benefits = value;
            break;
        case "how_to_apply":
        case "application_method":
            detail.additional_info.how_to_apply = value;
            break;
        default:
            // Store all other fields for LLM queries
            if (key.length < 50 && !key.startsWith("_")) {
                detail.additional_info[key] = value;
            }
    }
}

/**
 * Extract pagination info from the page
 */
export function parsePagination(html) {
    const pagination = {
        currentPage: 1,
        totalPages: 1,
        nextUrl: null,
        hasMore: false,
    };

    // Look for "next" link
    const nextPatterns = [
        /<a[^>]*class="[^"]*next[^"]*"[^>]*href=["']([^"']+)["']/i,
        /<a[^>]*href=["']([^"']+)["'][^>]*>(?:next|›|»|>)/i,
        /<a[^>]*href=["']([^"']+page=\d+[^"']*)["'][^>]*rel=["']next["']/i,
    ];

    for (const pattern of nextPatterns) {
        const match = html.match(pattern);
        if (match) {
            pagination.nextUrl = normalizeUrl(match[1]);
            pagination.hasMore = true;
            break;
        }
    }

    // Try to extract page numbers
    const pageMatch = html.match(/page\s*(\d+)\s*of\s*(\d+)/i);
    if (pageMatch) {
        pagination.currentPage = parseInt(pageMatch[1], 10);
        pagination.totalPages = parseInt(pageMatch[2], 10);
        pagination.hasMore = pagination.currentPage < pagination.totalPages;
    }

    return pagination;
}

/**
 * Normalize URL to absolute path
 */
function normalizeUrl(url) {
    if (!url) return null;

    url = url.trim();

    // Already absolute
    if (url.startsWith("http://") || url.startsWith("https://")) {
        return url;
    }

    // Protocol-relative
    if (url.startsWith("//")) {
        return "https:" + url;
    }

    // Relative to domain
    const baseUrl = "https://services.gov.im";
    if (url.startsWith("/")) {
        return baseUrl + url;
    }

    // Relative to current path
    return baseUrl + "/" + url;
}
