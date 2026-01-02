-- IOM Job Scraper Database Schema
-- Run with: wrangler d1 execute iom-jobs --file=./database.sql

-- Jobs table - stores all scraped job listings
CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Core job information
    title TEXT NOT NULL,
    employer TEXT,
    location TEXT,

    -- Compensation (denormalized for efficient querying)
    salary_text TEXT,
    salary_min REAL,
    salary_max REAL,
    salary_type TEXT,

    -- Job classification
    job_type TEXT,
    classification TEXT,
    area TEXT,
    hours_option TEXT,
    hours_type TEXT,  -- 'full-time', 'part-time', or NULL

    -- Dates
    posted_date TEXT,
    closing_date TEXT,
    start_date TEXT,

    -- Content
    summary TEXT,
    description TEXT,

    -- Contact details (denormalized for LLM queries)
    reference TEXT,
    contact_name TEXT,
    contact_email TEXT,
    contact_phone TEXT,

    -- Additional structured fields
    qualifications TEXT,
    experience TEXT,
    benefits TEXT,
    how_to_apply TEXT,

    -- All additional fields as JSON (for LLM and future use)
    additional_info TEXT,

    -- Raw HTML for retroactive re-parsing if site structure changes
    raw_html TEXT,

    -- Links
    source_url TEXT NOT NULL,
    apply_url TEXT,

    -- Deduplication & metadata
    guid TEXT UNIQUE NOT NULL,
    scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    -- Status
    is_active INTEGER DEFAULT 1
);

-- Scrape log table - tracks scraping operations
CREATE TABLE IF NOT EXISTS scrape_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    url_type TEXT NOT NULL,
    jobs_found INTEGER DEFAULT 0,
    jobs_inserted INTEGER DEFAULT 0,
    jobs_updated INTEGER DEFAULT 0,
    status TEXT DEFAULT 'running',
    error_message TEXT
);

-- Primary query indexes
CREATE INDEX IF NOT EXISTS idx_jobs_closing_date ON jobs(closing_date);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_date ON jobs(posted_date);
CREATE INDEX IF NOT EXISTS idx_jobs_employer ON jobs(employer);
CREATE INDEX IF NOT EXISTS idx_jobs_location ON jobs(location);
CREATE INDEX IF NOT EXISTS idx_jobs_classification ON jobs(classification);
CREATE INDEX IF NOT EXISTS idx_jobs_salary ON jobs(salary_min, salary_max);
CREATE INDEX IF NOT EXISTS idx_jobs_job_type ON jobs(job_type);

-- Composite indexes for common filter combinations
CREATE INDEX IF NOT EXISTS idx_jobs_active_posted ON jobs(is_active, posted_date DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_active_closing ON jobs(is_active, closing_date);
CREATE INDEX IF NOT EXISTS idx_jobs_hours_type ON jobs(hours_type);
