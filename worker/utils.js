// Utility functions for IOM Job Scraper

/**
 * Generate a unique GUID for a job listing
 * Uses a simple hash of the source URL to ensure deduplication
 */
export function generateJobGuid(sourceUrl) {
    if (!sourceUrl) {
        return `job-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    // Simple hash function for consistent GUIDs
    let hash = 0;
    const str = sourceUrl.toLowerCase().trim();
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }

    return `iom-gov-${Math.abs(hash).toString(36)}`;
}

/**
 * Parse salary range from text
 * Handles formats like: "£25,000 - £30,000", "£25k-£30k", "From £25,000"
 * Returns { min: number|null, max: number|null, type: string|null }
 */
export function parseSalaryRange(salaryText) {
    if (!salaryText || typeof salaryText !== "string") {
        return { min: null, max: null, type: null };
    }

    const text = salaryText.toLowerCase().replace(/,/g, "").trim();

    // Determine salary type
    let type = null;
    if (text.includes("per annum") || text.includes("p.a.") || text.includes("annual")) {
        type = "annual";
    } else if (text.includes("per hour") || text.includes("hourly") || text.includes("/hour")) {
        type = "hourly";
    } else if (text.includes("per day") || text.includes("daily") || text.includes("/day")) {
        type = "daily";
    } else if (text.includes("per week") || text.includes("weekly")) {
        type = "weekly";
    }

    // Extract all numbers, handling "k" suffix
    const numbers = [];
    const regex = /£?([\d.]+)\s*k?/gi;
    let match;

    while ((match = regex.exec(text)) !== null) {
        let value = parseFloat(match[1]);
        // Check if followed by 'k' (case insensitive)
        const afterMatch = text.substring(match.index + match[0].length);
        if (afterMatch.startsWith("k") || match[0].toLowerCase().includes("k")) {
            // Already handled in regex if 'k' is attached
        }
        // Check the original text for 'k' suffix
        const fullMatch = text.substring(match.index, match.index + match[0].length + 1);
        if (fullMatch.toLowerCase().endsWith("k")) {
            value *= 1000;
        } else if (value < 1000 && type === "annual") {
            // Likely in thousands if annual and small number
            value *= 1000;
        }
        numbers.push(value);
    }

    if (numbers.length === 0) {
        return { min: null, max: null, type };
    }

    // Sort and extract min/max
    numbers.sort((a, b) => a - b);
    return {
        min: numbers[0],
        max: numbers.length > 1 ? numbers[numbers.length - 1] : numbers[0],
        type: type || "annual",
    };
}

/**
 * Parse a date string into YYYY-MM-DD format
 * Handles various formats: "31 Dec 2025", "31/12/2025", "December 31, 2025"
 */
export function parseDate(dateText) {
    if (!dateText || typeof dateText !== "string") {
        return null;
    }

    const text = dateText.trim();

    // Try parsing with Date constructor first
    const parsed = new Date(text);
    if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split("T")[0];
    }

    // Handle UK date format: DD/MM/YYYY
    const ukMatch = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (ukMatch) {
        const [, day, month, year] = ukMatch;
        return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }

    // Handle format: "31 December 2025"
    const months = {
        january: "01", february: "02", march: "03", april: "04",
        may: "05", june: "06", july: "07", august: "08",
        september: "09", october: "10", november: "11", december: "12",
        jan: "01", feb: "02", mar: "03", apr: "04",
        jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
    };

    const textMatch = text.toLowerCase().match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
    if (textMatch) {
        const [, day, monthName, year] = textMatch;
        const month = months[monthName];
        if (month) {
            return `${year}-${month}-${day.padStart(2, "0")}`;
        }
    }

    return null;
}

/**
 * Format a date for display
 */
export function formatDateDisplay(dateStr) {
    if (!dateStr) return "";

    const date = new Date(dateStr + "T12:00:00Z");
    return date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

/**
 * Calculate days until a date
 */
export function daysUntil(dateStr) {
    if (!dateStr) return null;

    const target = new Date(dateStr + "T23:59:59Z");
    const now = new Date();
    const diff = target.getTime() - now.getTime();

    return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/**
 * Clean HTML entities and tags from text
 */
export function cleanText(text) {
    if (!text) return "";

    return text
        .replace(/<[^>]*>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&pound;/g, "£")
        .replace(/&#163;/g, "£")
        .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Extract text content from an HTML element string
 */
export function extractText(html, selector) {
    // Simple regex-based extraction for common patterns
    const patterns = {
        title: /<h[1-6][^>]*>(.*?)<\/h[1-6]>/is,
        link: /<a[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/is,
        span: /<span[^>]*>(.*?)<\/span>/is,
        div: /<div[^>]*>(.*?)<\/div>/is,
        p: /<p[^>]*>(.*?)<\/p>/is,
    };

    const pattern = patterns[selector];
    if (pattern) {
        const match = html.match(pattern);
        return match ? cleanText(match[1]) : "";
    }

    return "";
}

/**
 * Sleep utility for rate limiting
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get browser-like headers for requests
 */
export function getBrowserHeaders() {
    return {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Connection": "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
        "Cache-Control": "max-age=0",
    };
}

/**
 * Truncate text to a maximum length
 */
export function truncate(text, maxLength = 200) {
    if (!text || text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + "...";
}
