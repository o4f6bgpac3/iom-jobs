#!/usr/bin/env node
// Trigger a scrape on the local or remote API
//
// Usage:
//   npm run scrape              # Recent jobs, local API
//   npm run scrape:full         # Full scrape, local API
//   npm run scrape:remote       # Recent jobs, remote/production API
//   npm run scrape:full:remote  # Full scrape, remote/production API

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Parse arguments
const args = process.argv.slice(2);
const isFullScrape = args.includes("full");
const isRemote = args.includes("--remote");

// API URLs
const LOCAL_API = "http://localhost:8787";
const REMOTE_API = "https://iom-job-scraper.r4qavgnsae.workers.dev"; // Update this after deploy

function getAdminKey() {
    try {
        const devVars = readFileSync(join(__dirname, "../worker/.dev.vars"), "utf-8");
        const match = devVars.match(/ADMIN_API_KEY=(.+)/);
        return match ? match[1].trim() : null;
    } catch (e) {
        console.error("Could not read worker/.dev.vars - make sure it exists with ADMIN_API_KEY set");
        process.exit(1);
    }
}

async function main() {
    const type = isFullScrape ? "full" : "recent";
    const apiUrl = isRemote ? REMOTE_API : LOCAL_API;
    const adminKey = getAdminKey();

    console.log(`\n🔄 Triggering ${type} scrape on ${apiUrl}`);
    console.log(`   Mode: ${isRemote ? "REMOTE (production DB)" : "LOCAL (local DB)"}\n`);

    if (!isRemote) {
        console.log("   (Make sure 'npm run dev' is running in another terminal)\n");
    }

    try {
        const startTime = Date.now();
        const response = await fetch(`${apiUrl}/scrape`, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${adminKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ type }),
        });

        const result = await response.json();

        if (result.success) {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
            console.log("✅ Scrape completed successfully!");
            console.log(`   Jobs found:  ${result.stats.found}`);
            console.log(`   Inserted:    ${result.stats.inserted}`);
            console.log(`   Updated:     ${result.stats.updated}`);
            console.log(`   Duration:    ${result.stats.duration || elapsed + "s"}`);
        } else {
            console.error("❌ Scrape failed:", result.error);
            if (result.message) {
                console.error("   Message:", result.message);
            }
            process.exit(1);
        }
    } catch (error) {
        if (error.cause?.code === "ECONNREFUSED") {
            console.error("❌ Could not connect to", apiUrl);
            if (!isRemote) {
                console.error("   Make sure 'npm run dev' is running in another terminal");
            }
        } else {
            console.error("❌ Error:", error.message);
        }
        process.exit(1);
    }
}

main();
