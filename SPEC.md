# IOM Job Scraper Specification

## Overview

A job scraper application that collects job listings from the Isle of Man Government job search portal, stores them in a database, and provides a UI for browsing, filtering, and querying jobs using natural language.

## Architecture

### Technology Stack

Following the established patterns in this codebase:

| Layer | Technology |
|-------|------------|
| Backend | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Rate Limiting | Cloudflare KV |
| Frontend | Vanilla JavaScript (ES6+) |
| Scraping | Native fetch + HTML parsing |
| LLM | Venice.ai (OpenAI-compatible) |
| Validation | Zod |

### Directory Structure

```
iom-job-scraper/
├── app/                    # Frontend (Static Site)
│   ├── index.html         # Main HTML template
│   ├── app.js             # Main application controller
│   ├── askComponent.js    # Natural language query UI
│   ├── jobCard.js         # Job listing card renderer
│   ├── filters.js         # Filter component
│   ├── config.js          # Frontend configuration
│   ├── utils.js           # Shared utilities
│   └── styles.css         # Responsive styling
│
└── worker/                 # Backend (Cloudflare Worker)
    ├── worker.js          # Entry point & routing
    ├── config.js          # Centralized configuration
    ├── scraper.js         # Job scraping logic
    ├── parser.js          # HTML parsing utilities
    ├── ask.js             # Natural language query handler
    ├── llm.js             # LLM integration
    ├── queryBuilder.js    # Dynamic SQL generation
    ├── validation.js      # Zod input validation
    ├── prompts.js         # LLM prompts
    ├── rateLimiter.js     # Rate limiting
    ├── utils.js           # Backend utilities
    ├── database.sql       # Database schema
    ├── package.json       # Dependencies
    └── wrangler.toml      # Cloudflare configuration
```

---

## Data Source

### URLs

| Type | URL | Purpose |
|------|-----|---------|
| Full Listing | `https://services.gov.im/job-search/results?AreaId=&ClassificationId=&SearchText=&LastThreeDays=False&JobHoursOption=` | Initial scrape to populate database with all available jobs |
| Recent Only | `https://services.gov.im/job-search/results?AreaId=&ClassificationId=&SearchText=&LastThreeDays=True&JobHoursOption=` | Daily incremental updates (jobs from last 3 days) |

### Scraping Strategy

1. **First Run Detection**: Check if `jobs` table is empty
   - If empty → use Full Listing URL
   - If populated → use Recent Only URL

2. **Execution Frequency**: Once per day via Cloudflare scheduled trigger
   - Recommended time: `0 6 * * *` (06:00 UTC daily)

3. **Pagination Handling**: Parse and follow pagination links if present

4. **Job Detail Fetching**: Optionally fetch individual job pages for full descriptions

---

## Database Schema

### Tables

#### `jobs`

Primary table storing all scraped job listings.

```sql
CREATE TABLE jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Core job information
    title TEXT NOT NULL,
    employer TEXT,                    -- Department or organisation
    location TEXT,

    -- Compensation
    salary_text TEXT,                 -- Raw salary string (e.g., "£25,000 - £30,000")
    salary_min REAL,                  -- Denormalized minimum (25000)
    salary_max REAL,                  -- Denormalized maximum (30000)
    salary_type TEXT,                 -- 'annual' | 'hourly' | 'daily' | NULL

    -- Job classification
    job_type TEXT,                    -- 'full-time' | 'part-time' | 'temporary' | 'permanent' | etc.
    classification TEXT,              -- Job category from source
    area TEXT,                        -- Geographic area from source
    hours_option TEXT,                -- Hours type from source

    -- Dates
    posted_date TEXT,                 -- Date job was posted (YYYY-MM-DD)
    closing_date TEXT,                -- Application deadline (YYYY-MM-DD)

    -- Content
    summary TEXT,                     -- Short description from listing
    description TEXT,                 -- Full job description (if fetched)

    -- Links
    source_url TEXT NOT NULL,         -- URL to job listing page
    apply_url TEXT,                   -- Direct application URL if available

    -- Deduplication & metadata
    guid TEXT UNIQUE NOT NULL,        -- Unique identifier (hash of URL or source ID)
    scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- Status
    is_active INTEGER DEFAULT 1       -- 1 = active, 0 = expired/removed
);
```

#### `scrape_log`

Tracks scraping operations for monitoring and debugging.

```sql
CREATE TABLE scrape_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    url_type TEXT NOT NULL,           -- 'full' | 'recent'
    jobs_found INTEGER DEFAULT 0,
    jobs_inserted INTEGER DEFAULT 0,
    jobs_updated INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',    -- 'running' | 'success' | 'failed'
    error_message TEXT
);
```

### Indexes

```sql
-- Primary query indexes
CREATE INDEX idx_jobs_closing_date ON jobs(closing_date);
CREATE INDEX idx_jobs_posted_date ON jobs(posted_date);
CREATE INDEX idx_jobs_employer ON jobs(employer);
CREATE INDEX idx_jobs_location ON jobs(location);
CREATE INDEX idx_jobs_classification ON jobs(classification);
CREATE INDEX idx_jobs_salary ON jobs(salary_min, salary_max);
CREATE INDEX idx_jobs_active ON jobs(is_active, closing_date);

-- Composite index for common filter combinations
CREATE INDEX idx_jobs_active_posted ON jobs(is_active, posted_date DESC);
```

---

## API Endpoints

### `GET /`

Fetch job listings with optional filters.

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Results per page (default: 20, max: 100) |
| `employer` | string | Filter by employer/department |
| `location` | string | Filter by location |
| `classification` | string | Filter by job classification |
| `job_type` | string | Filter by job type |
| `salary_min` | number | Minimum salary filter |
| `salary_max` | number | Maximum salary filter |
| `closing_after` | string | Jobs closing after date (YYYY-MM-DD) |
| `posted_after` | string | Jobs posted after date (YYYY-MM-DD) |
| `search` | string | Full-text search in title and description |
| `active_only` | boolean | Only show active jobs (default: true) |
| `sort` | string | Sort field (default: 'posted_date') |
| `order` | string | Sort order: 'asc' or 'desc' (default: 'desc') |

**Response:**

```json
{
    "success": true,
    "data": {
        "jobs": [...],
        "pagination": {
            "page": 1,
            "limit": 20,
            "total": 150,
            "totalPages": 8
        },
        "filters": {
            "employers": [...],
            "locations": [...],
            "classifications": [...],
            "job_types": [...]
        }
    }
}
```

### `GET /job/:id`

Fetch a single job by ID with full details.

**Response:**

```json
{
    "success": true,
    "data": {
        "job": {...},
        "related": [...]
    }
}
```

### `POST /ask`

Natural language query endpoint.

**Request:**

```json
{
    "question": "What IT jobs are available with salaries over £40,000?"
}
```

**Response:**

```json
{
    "success": true,
    "answer": "I found 5 IT-related positions...",
    "citations": [
        { "id": 123, "title": "Senior Developer", "employer": "Treasury" }
    ],
    "query_type": "filtered_search"
}
```

**Rate Limiting:** 10 requests per 24 hours per IP.

### `GET /stats`

Get summary statistics about job listings.

**Response:**

```json
{
    "success": true,
    "data": {
        "total_jobs": 150,
        "active_jobs": 120,
        "jobs_closing_this_week": 15,
        "jobs_posted_today": 3,
        "by_employer": {...},
        "by_location": {...},
        "salary_ranges": {...},
        "last_scrape": "2025-12-30T06:00:00Z"
    }
}
```

### `POST /scrape` (Admin)

Manually trigger a scrape operation.

**Headers:** `Authorization: Bearer <ADMIN_API_KEY>`

**Request:**

```json
{
    "type": "full"  // 'full' | 'recent'
}
```

---

## Scraping Logic

### Process Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     Scheduled Trigger (Daily)                    │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Check if First Run                            │
│           (SELECT COUNT(*) FROM jobs) == 0 ?                     │
└─────────────────────────────────────────────────────────────────┘
                    │                       │
                   YES                     NO
                    │                       │
                    ▼                       ▼
        ┌──────────────────┐    ┌──────────────────┐
        │ Use Full Listing │    │ Use Recent Only  │
        │      URL         │    │      URL         │
        └──────────────────┘    └──────────────────┘
                    │                       │
                    └───────────┬───────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Fetch HTML Page                               │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Parse Job Listings                             │
│         Extract: title, employer, location, salary,             │
│         dates, classification, job_type, source_url              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Handle Pagination                               │
│              If next page exists, fetch and parse                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│               Optionally Fetch Job Details                       │
│         For each job, fetch full description page                │
│              (with rate limiting: 1 req/sec)                     │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                Generate GUID for Each Job                        │
│           Hash of source_url or use source job ID                │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Upsert to Database                             │
│     INSERT OR REPLACE based on GUID (no duplicates)              │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Mark Expired Jobs                               │
│  UPDATE is_active = 0 WHERE closing_date < CURRENT_DATE         │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                   Log Scrape Results                             │
└─────────────────────────────────────────────────────────────────┘
```

### GUID Generation

To ensure no duplicate jobs are stored:

```javascript
function generateGuid(job) {
    // Option 1: Use source job ID if available
    if (job.sourceId) {
        return `iom-gov-${job.sourceId}`;
    }

    // Option 2: Hash the canonical URL
    const canonical = job.sourceUrl.toLowerCase().trim();
    return `url-${hashString(canonical)}`;
}
```

### Error Handling

1. **Network Errors**: Retry up to 3 times with exponential backoff
2. **Parse Errors**: Log error, skip job, continue processing
3. **Database Errors**: Rollback transaction, log error, send notification
4. **Rate Limiting**: If source returns 429, pause and retry after delay

---

## Frontend UI

### Views

#### 1. Job Listings View (Default)

- **Header**: Logo, navigation, search bar
- **Filters Panel** (collapsible on mobile):
  - Employer/Department dropdown (multi-select)
  - Location dropdown (multi-select)
  - Classification dropdown (multi-select)
  - Job Type checkboxes
  - Salary Range slider
  - Closing Date picker
  - Active Jobs Only toggle
- **Results Area**:
  - Sort controls (Posted Date, Closing Date, Salary)
  - Job cards in a responsive grid/list
  - Pagination controls
- **Ask Panel** (expandable): Natural language query interface

#### 2. Job Detail View

- Full job information
- Apply button (links to source)
- Related jobs section
- Share functionality

#### 3. Statistics Dashboard

- Total jobs count
- Jobs by employer chart
- Jobs by location chart
- Salary distribution
- Trend over time (jobs posted per week)

### Job Card Component

```
┌────────────────────────────────────────────────────────────────┐
│  [Classification Badge]                      [Closing in X days] │
│                                                                  │
│  Job Title                                                       │
│  Employer Name                                                   │
│                                                                  │
│  📍 Location    💷 £XX,XXX - £XX,XXX    ⏰ Full-time             │
│                                                                  │
│  Brief summary text truncated after two lines...                 │
│                                                                  │
│  Posted: DD MMM YYYY                              [View Details] │
└────────────────────────────────────────────────────────────────┘
```

### Responsive Breakpoints

| Breakpoint | Layout |
|------------|--------|
| Desktop (>1024px) | Sidebar filters + 3-column grid |
| Tablet (768-1024px) | Top filters + 2-column grid |
| Mobile (<768px) | Hidden filters (modal) + single column |

---

## LLM Integration

### Supported Query Types

1. **Filtered Search**: "Show me IT jobs in Douglas"
2. **Salary Queries**: "Jobs paying over £35,000"
3. **Deadline Queries**: "Jobs closing this week"
4. **Statistical**: "How many nursing jobs are available?"
5. **Comparative**: "Which department has the most openings?"
6. **Recommendation**: "Best jobs for a software developer"

### Query Intent Schema

```typescript
interface QueryIntent {
    query_type: 'search' | 'count' | 'compare' | 'recommend' | 'stats';
    filters: {
        field: string;
        operator: 'eq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'between';
        value: string | number | [number, number];
    }[];
    sort?: {
        field: string;
        order: 'asc' | 'desc';
    };
    limit?: number;
}
```

### Prompt Engineering

System prompt should include:
- Available fields and their types
- Valid filter operators
- Current date for relative date calculations
- Sample queries and expected outputs

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `LLM_API_KEY` | Yes | API key for Venice.ai or OpenAI-compatible LLM |
| `LLM_API_URL` | No | Override LLM endpoint (default: Venice.ai) |
| `LLM_MODEL` | No | Model identifier |
| `ADMIN_API_KEY` | Yes | API key for admin endpoints |
| `SMTP2GO_API_KEY` | No | For error notifications |
| `NOTIFICATION_EMAIL_TO` | No | Error notification recipient |
| `NOTIFICATION_EMAIL_FROM` | No | Error notification sender |

### Wrangler Configuration

```toml
name = "iom-job-scraper"
main = "worker/worker.js"
compatibility_date = "2024-12-01"

[triggers]
crons = ["0 6 * * *"]  # Run daily at 06:00 UTC

[[d1_databases]]
binding = "DB"
database_name = "iom-jobs"
database_id = "<your-database-id>"

[[kv_namespaces]]
binding = "RATE_LIMITER"
id = "<your-kv-id>"
```

---

## Security Considerations

### Input Validation

- All query parameters validated with Zod schemas
- Maximum lengths enforced on all text inputs
- SQL injection prevention via parameterized queries only
- XSS prevention via HTML escaping on output

### LLM Safety

- Prompt injection detection (reject instruction-like inputs)
- Output validation against whitelist of allowed operations
- Query type restrictions (no DELETE, UPDATE, etc.)
- Rate limiting on /ask endpoint

### Scraping Ethics

- Respect robots.txt if present
- Rate limit requests to source (1 request/second max)
- Include proper User-Agent header
- Cache responses where appropriate

---

## Deployment

### Initial Setup

1. Create Cloudflare account and enable Workers
2. Create D1 database: `wrangler d1 create iom-jobs`
3. Create KV namespace: `wrangler kv:namespace create RATE_LIMITER`
4. Update `wrangler.toml` with database and KV IDs
5. Set secrets: `wrangler secret put LLM_API_KEY`
6. Initialize database: `wrangler d1 execute iom-jobs --file=./worker/database.sql`
7. Deploy: `wrangler deploy`

### Manual Triggers

```bash
# Trigger full scrape
curl -X POST https://your-worker.workers.dev/scrape \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "full"}'

# Trigger recent scrape
curl -X POST https://your-worker.workers.dev/scrape \
  -H "Authorization: Bearer YOUR_ADMIN_KEY" \
  -H "Content-Type: application/json" \
  -d '{"type": "recent"}'
```

---

## Future Enhancements

1. **Email Notifications**: Daily digest of new jobs matching user criteria
2. **Job Alerts**: User subscriptions for specific search criteria
3. **Salary Insights**: Historical salary trends by role/department
4. **External Sources**: Expand to other IOM job boards
5. **CV Matching**: Upload CV and get matched jobs using LLM
6. **Application Tracking**: Track which jobs user has applied to
7. **API Access**: Public API for third-party integrations

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Scrape success rate | >99% |
| Data freshness | <24 hours |
| API response time (p95) | <500ms |
| LLM query accuracy | >90% |
| UI load time (LCP) | <2.5s |
| Zero duplicate jobs | 100% |
