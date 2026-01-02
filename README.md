# IOM Job Scraper

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A job search application that scrapes and displays Isle of Man Government job listings with AI-powered natural language queries.

## Features

- **Job Listings Display** - Browse all current Isle of Man Government job vacancies
- **Advanced Filtering** - Filter by employer, location, classification, salary range, and hours type
- **Natural Language Queries** - Ask questions like "What IT jobs are available?" or "Show me part-time jobs in Douglas"
- **Jobtrain Enrichment** - Automatically fetches full job details from jobtrain.co.uk when listings only contain redirect links
- **Daily Updates** - Automated scraping keeps listings current via cron
- **Responsive Design** - Works on desktop and mobile devices
- **SEO Optimized** - Includes structured data, sitemap, and meta tags

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐     ┌─────────────────┐
│   Frontend      │────▶│  Cloudflare Worker   │────▶│  D1 Database    │
│  (Static Site)  │     │       (API)          │     │   (SQLite)      │
└─────────────────┘     └──────────────────────┘     └─────────────────┘
                               │         │
                               │         ▼
                               │   ┌──────────────┐
                               │   │  Venice.ai   │
                               │   │    (LLM)     │
                               │   └──────────────┘
                               │
                               ▼
                        ┌──────────────┐
                        │   gov.im     │
                        │  Job Portal  │
                        └──────────────┘
```

- **Frontend** (`/app`): Vanilla JavaScript SPA deployed to Cloudflare Pages
- **Backend** (`/worker`): Cloudflare Worker with D1 database
- **Data Source**: Isle of Man Government job search portal
- **AI**: Venice.ai for natural language query processing

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (`npm install -g wrangler`)
- Cloudflare account (free tier works)
- [Venice.ai API key](https://venice.ai/) (for natural language queries)

---

## Deployment Guide

### Step 1: Clone and Install

```bash
git clone https://github.com/your-username/iom-job-scraper.git
cd iom-job-scraper
cd worker
npm install
```

### Step 2: Authenticate with Cloudflare

```bash
wrangler login
```

### Step 3: Create Cloudflare Resources

**Create D1 Database:**
```bash
wrangler d1 create iom-jobs
```
Note the `database_id` from the output.

**Create KV Namespace:**
```bash
wrangler kv:namespace create RATE_LIMITER
```
Note the `id` from the output.

### Step 4: Configure Worker

```bash
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml` and replace the placeholder IDs:
```toml
[[d1_databases]]
binding = "DB"
database_name = "iom-jobs"
database_id = "YOUR_D1_DATABASE_ID"  # ← Replace this

[[kv_namespaces]]
binding = "RATE_LIMITER"
id = "YOUR_KV_NAMESPACE_ID"  # ← Replace this
```

### Step 5: Initialize Database

```bash
wrangler d1 execute iom-jobs --file=database.sql
```

### Step 6: Set Secrets

**Required - LLM API Key:**
```bash
wrangler secret put LLM_API_KEY
# Enter your Venice.ai API key when prompted
```

**Required - Admin API Key (for manual scrape triggers):**
```bash
wrangler secret put ADMIN_API_KEY
# Enter a secure random string (e.g., generate with: openssl rand -hex 32)
```

### Step 7: Deploy Worker

```bash
wrangler deploy
```

Note the Worker URL from the output (e.g., `https://iom-job-scraper.your-subdomain.workers.dev`)

### Step 8: Configure Frontend

Edit `app/config.js` and update the production URL:
```javascript
const PRODUCTION_API_URL = "https://iom-job-scraper.YOUR-SUBDOMAIN.workers.dev";
```

Edit `app/index.html` and update all `https://your-domain.com` URLs with your domain (Cloudflare Pages URL or custom domain).

Edit `app/robots.txt` and `app/_redirects` - update the Worker URL.

### Step 9: Deploy Frontend

```bash
cd ../app
wrangler pages project create iom-jobs
wrangler pages deploy . --project-name=iom-jobs
```

Note the Pages URL from the output (e.g., `https://iom-jobs.pages.dev`)

### Step 10: Trigger Initial Scrape

```bash
curl -X POST "https://iom-job-scraper.YOUR-SUBDOMAIN.workers.dev/scrape" \
  -H "Authorization: Bearer YOUR_ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type":"full"}'
```

This will take 2-3 minutes to scrape all job listings.

### Step 11: Verify

1. Visit your Pages URL - you should see job listings
2. Check `/robots.txt` returns the robots file
3. Check the Worker's `/sitemap.xml` returns XML
4. Check `/stats` returns job statistics

---

## Local Development

### Quick Start

```bash
# Install dependencies
npm install

# Copy environment file
cp worker/.dev.vars.example worker/.dev.vars
# Edit worker/.dev.vars with your API keys

# Start both API and frontend
npm run dev
```

This starts:
- API at `http://localhost:8787`
- Frontend at `http://localhost:3005`

### Development Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start API + frontend (local DB) |
| `npm run dev:remote` | Start API + frontend (production DB) |
| `npm run scrape` | Trigger recent jobs scrape (local) |
| `npm run scrape:full` | Trigger full scrape (local) |
| `npm run scrape:remote` | Trigger recent jobs scrape (production) |
| `npm run scrape:full:remote` | Trigger full scrape (production) |
| `npm run db` | Open D1 console (local) |
| `npm run db:remote` | Open D1 console (production) |
| `npm run deploy` | Deploy worker |
| `npm run deploy:app` | Deploy frontend |
| `npm run deploy:all` | Deploy worker + frontend |

### Running Scrapes

```bash
# Scrape recent jobs (last 3 days) - local database
npm run scrape

# Full scrape of all jobs - production database
npm run scrape:full:remote
```

> **Note:** Jobtrain enrichment requires network access to jobtrain.co.uk. Use `npm run dev:remote` for full testing as local dev may have TLS issues with external fetches.

---

## Deploying Updates

After making changes, deploy both the worker and frontend:

```bash
# Deploy everything
npm run deploy:all

# Or deploy separately:
npm run deploy      # Worker (API)
npm run deploy:app  # Frontend (Pages)
```

Both must be deployed separately - the worker and Pages are independent.

---

## API Endpoints

### GET /
Returns job listings with optional filtering.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `employer` | string | Filter by employer name |
| `location` | string | Filter by location |
| `classification` | string | Filter by job classification |
| `hours_type` | string | Filter by hours (full-time, part-time) |
| `active_only` | boolean | Only return active jobs (default: true) |
| `limit` | number | Maximum results (default: 100) |
| `offset` | number | Pagination offset |

### GET /job/:id
Returns a single job with full details.

### GET /stats
Returns summary statistics about available jobs.

### GET /sitemap.xml
Returns XML sitemap of all active jobs.

### GET /robots.txt
Returns robots.txt for search engines.

### POST /ask
Natural language job queries (rate-limited to 10/day per IP).

**Request:**
```json
{ "question": "What IT jobs are available in Douglas?" }
```

### POST /scrape
Manually trigger a scrape (requires admin API key).

**Request:**
```json
{ "type": "full" }  // or "recent" for last 3 days only
```

---

## Configuration

### Environment Variables (Secrets)

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_API_KEY` | Yes | API key for LLM service (Venice.ai) |
| `ADMIN_API_KEY` | Yes | API key for admin endpoints |

### Optional LLM Configuration

These can be set as secrets to override defaults:

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_API_URL` | Venice.ai URL | LLM API endpoint |
| `LLM_MODEL` | llama-3.3-70b | Model identifier |
| `LLM_TIMEOUT_MS` | 15000 | Request timeout |
| `LLM_MAX_RETRIES` | 1 | Retry attempts |

> **Note:** Only Venice.ai has been tested. Other OpenAI-compatible APIs may work but are unverified.

### Scheduled Scraping

Jobs are automatically scraped daily at 06:00 UTC via Cloudflare cron triggers (configured in `wrangler.toml`).

---

## Forking This Project

When deploying your own instance, look for `FORK:` comments in these files:

| File | What to Change |
|------|----------------|
| `worker/wrangler.toml` | D1 database ID, KV namespace ID, preview_id |
| `package.json` | `--project-name=iom-jobs` in deploy:app script |
| `app/config.js` | `PRODUCTION_API_URL` - your Worker URL |
| `app/index.html` | Canonical URL, og:url, JSON-LD URLs |
| `app/robots.txt` | Sitemap URL |
| `app/_redirects` | Sitemap redirect URL |

---

## Technology Stack

- **Frontend**: Vanilla JavaScript, HTML5, CSS3
- **Backend**: Cloudflare Workers
- **Database**: Cloudflare D1 (SQLite)
- **Cache/Rate Limiting**: Cloudflare KV
- **LLM**: Venice.ai (configurable)
- **Validation**: Zod

## Security

- SQL injection prevention via parameterized queries
- Input validation with Zod schemas
- Prompt injection detection for LLM queries
- Per-IP rate limiting
- CORS restrictions

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development guidelines.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Job data provided by the [Isle of Man Government](https://www.gov.im/)
- LLM services by [Venice.ai](https://venice.ai/)
