// Frontend configuration for IOM Job Scraper
//
// FORK: Update PRODUCTION_API_URL with your Cloudflare Worker URL
// after running `wrangler deploy` in the worker/ directory.

/**
 * Deployed Worker URL (from `wrangler deploy` output)
 */
const PRODUCTION_API_URL = "https://iom-job-scraper.r4qavgnsae.workers.dev";

/**
 * Detect the appropriate API URL based on hostname
 */
function detectApiUrl() {
    const hostname = window.location.hostname;

    // Local development - wrangler dev runs on port 8787
    if (hostname === "localhost" || hostname === "127.0.0.1") {
        return "http://localhost:8787";
    }

    // Production - your deployed Worker
    return PRODUCTION_API_URL;
}

export const CONFIG = {
    api: {
        baseUrl: detectApiUrl(),
    },
    display: {
        jobsPerPage: 100,
        maxSummaryLength: 200,
    },
};
