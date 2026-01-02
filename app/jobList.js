// Job List Component for IOM Job Scraper
// Responsive list view with expandable detail panels showing full job info

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Format text for HTML display - escapes HTML, converts URLs to links, and newlines to <br>
 */
function formatText(text) {
    if (!text) return "";
    return escapeHtml(text)
        // Convert URLs to clickable links
        .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
        // Convert newlines to <br>
        .replace(/\n/g, "<br>");
}

/**
 * Format date for display
 */
function formatDate(dateStr) {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    return date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
    });
}

/**
 * Calculate days until closing date
 */
function daysUntil(dateStr) {
    if (!dateStr) return null;
    // Compare dates at midnight to get whole day difference
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const target = new Date(dateStr + "T00:00:00");
    target.setHours(0, 0, 0, 0);

    const diffMs = target.getTime() - today.getTime();
    return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Get closing status text and class
 */
function getClosingStatus(dateStr) {
    const daysLeft = daysUntil(dateStr);

    if (daysLeft === null) return { text: "", className: "" };
    if (daysLeft < 0) return { text: "Closed", className: "closing-closed" };
    if (daysLeft === 0) return { text: "Today!", className: "closing-urgent" };
    if (daysLeft === 1) return { text: "Tomorrow", className: "closing-urgent" };
    if (daysLeft <= 7) return { text: `${daysLeft} days`, className: "closing-soon" };
    return { text: formatDate(dateStr), className: "" };
}

/**
 * Format salary for display
 */
function formatSalary(job) {
    if (job.salary_text && job.salary_text !== "To be advised") {
        return escapeHtml(job.salary_text);
    }
    if (job.salary_min && job.salary_max && job.salary_min !== job.salary_max) {
        return `£${job.salary_min.toLocaleString()} - £${job.salary_max.toLocaleString()}`;
    }
    if (job.salary_min) {
        return `£${job.salary_min.toLocaleString()}`;
    }
    return "—";
}

/**
 * Get sort indicator arrow
 */
function getSortIndicator(column, sortConfig) {
    if (sortConfig.column !== column) return "";
    return sortConfig.direction === "asc" ? " ▲" : " ▼";
}

/**
 * Generate sortable list header HTML
 */
export function getJobListHeaderHTML(sortConfig = { column: "closing_date", direction: "asc" }) {
    return `
        <div class="job-list-header">
            <div class="job-list-header-cell" data-sort="title">
                Title${getSortIndicator("title", sortConfig)}
            </div>
            <div class="job-list-header-cell" data-sort="employer">
                Employer${getSortIndicator("employer", sortConfig)}
            </div>
            <div class="job-list-header-cell" data-sort="location">
                Location${getSortIndicator("location", sortConfig)}
            </div>
            <div class="job-list-header-cell" data-sort="hours_type">
                Hours${getSortIndicator("hours_type", sortConfig)}
            </div>
            <div class="job-list-header-cell" data-sort="salary_min">
                Salary${getSortIndicator("salary_min", sortConfig)}
            </div>
            <div class="job-list-header-cell" data-sort="closing_date">
                Closing${getSortIndicator("closing_date", sortConfig)}
            </div>
        </div>
    `;
}

/**
 * Generate job row HTML
 */
function getJobRowHTML(job, isExpanded = false) {
    const closing = getClosingStatus(job.closing_date);
    const salary = formatSalary(job);
    const hours = job.hours_type ? job.hours_type.charAt(0).toUpperCase() + job.hours_type.slice(1) : "—";

    return `
        <div class="job-row ${isExpanded ? "expanded" : ""}" data-job-id="${job.id}">
            <div class="job-row-cell job-row-title">${escapeHtml(job.title)}</div>
            <div class="job-row-cell job-row-employer">${escapeHtml(job.employer) || "Isle of Man Government"}</div>
            <div class="job-row-cell job-row-location">${escapeHtml(job.location) || "—"}</div>
            <div class="job-row-cell job-row-hours">${hours}</div>
            <div class="job-row-cell job-row-salary">${salary}</div>
            <div class="job-row-cell job-row-closing">
                <span class="${closing.className}">${closing.text}</span>
            </div>
            <!-- Mobile meta line -->
            <div class="job-row-meta">
                <span class="meta-employer">${escapeHtml(job.employer) || "Isle of Man Government"}</span>
                <div class="meta-details">
                    ${job.location ? `<span class="meta-item"><span class="meta-icon">📍</span>${escapeHtml(job.location)}</span>` : ""}
                    <span class="meta-item"><span class="meta-icon">⏱</span>${hours}</span>
                    <span class="meta-item meta-salary">${salary}</span>
                </div>
                <span class="meta-closing ${closing.className}">Closes: ${closing.text}</span>
            </div>
        </div>
    `;
}

/**
 * Generate expanded detail panel HTML with ALL job information
 */
export function getJobDetailHTML(job) {
    const sections = [];

    // Key Info Section
    const keyInfo = [];
    if (job.employer) keyInfo.push(`<dt>Employer</dt><dd>${escapeHtml(job.employer)}</dd>`);
    if (job.location) keyInfo.push(`<dt>Location</dt><dd>${escapeHtml(job.location)}</dd>`);
    if (job.salary_text) keyInfo.push(`<dt>Salary</dt><dd>${escapeHtml(job.salary_text)}</dd>`);
    if (job.hours_option) keyInfo.push(`<dt>Hours</dt><dd>${escapeHtml(job.hours_option)}</dd>`);
    if (job.job_type) keyInfo.push(`<dt>Contract</dt><dd>${escapeHtml(job.job_type)}</dd>`);
    if (job.classification) keyInfo.push(`<dt>Category</dt><dd>${escapeHtml(job.classification)}</dd>`);
    if (job.area) keyInfo.push(`<dt>Area</dt><dd>${escapeHtml(job.area)}</dd>`);
    if (job.reference) keyInfo.push(`<dt>Reference</dt><dd>${escapeHtml(job.reference)}</dd>`);

    if (keyInfo.length > 0) {
        sections.push(`
            <div class="detail-section">
                <h4>Job Details</h4>
                <dl class="detail-grid">${keyInfo.join("")}</dl>
            </div>
        `);
    }

    // Dates Section
    const dates = [];
    if (job.posted_date) dates.push(`<dt>Posted</dt><dd>${formatDate(job.posted_date)}</dd>`);
    if (job.closing_date) dates.push(`<dt>Closing</dt><dd>${formatDate(job.closing_date)}</dd>`);
    if (job.start_date) dates.push(`<dt>Start Date</dt><dd>${escapeHtml(job.start_date)}</dd>`);

    if (dates.length > 0) {
        sections.push(`
            <div class="detail-section">
                <h4>Dates</h4>
                <dl class="detail-grid">${dates.join("")}</dl>
            </div>
        `);
    }

    // Description
    if (job.description) {
        sections.push(`
            <div class="detail-section">
                <h4>Description</h4>
                <div class="detail-text">${formatText(job.description)}</div>
            </div>
        `);
    } else if (job.summary) {
        sections.push(`
            <div class="detail-section">
                <h4>Summary</h4>
                <div class="detail-text">${formatText(job.summary)}</div>
            </div>
        `);
    }

    // Requirements
    const requirements = [];
    if (job.qualifications) {
        requirements.push(`
            <div class="detail-subsection">
                <h5>Qualifications</h5>
                <div class="detail-text">${formatText(job.qualifications)}</div>
            </div>
        `);
    }
    if (job.experience) {
        requirements.push(`
            <div class="detail-subsection">
                <h5>Experience</h5>
                <div class="detail-text">${formatText(job.experience)}</div>
            </div>
        `);
    }

    if (requirements.length > 0) {
        sections.push(`
            <div class="detail-section">
                <h4>Requirements</h4>
                ${requirements.join("")}
            </div>
        `);
    }

    // Benefits
    if (job.benefits) {
        sections.push(`
            <div class="detail-section">
                <h4>Benefits</h4>
                <div class="detail-text">${formatText(job.benefits)}</div>
            </div>
        `);
    }

    // How to Apply
    if (job.how_to_apply) {
        sections.push(`
            <div class="detail-section">
                <h4>How to Apply</h4>
                <div class="detail-text">${formatText(job.how_to_apply)}</div>
            </div>
        `);
    }

    // Contact Information
    const contact = [];
    if (job.contact_name) contact.push(`<dt>Contact</dt><dd>${escapeHtml(job.contact_name)}</dd>`);
    if (job.contact_email) contact.push(`<dt>Email</dt><dd><a href="mailto:${escapeHtml(job.contact_email)}">${escapeHtml(job.contact_email)}</a></dd>`);
    if (job.contact_phone) contact.push(`<dt>Phone</dt><dd>${escapeHtml(job.contact_phone)}</dd>`);

    if (contact.length > 0) {
        sections.push(`
            <div class="detail-section">
                <h4>Contact</h4>
                <dl class="detail-grid">${contact.join("")}</dl>
            </div>
        `);
    }

    // Additional Info (any extra fields from JSON)
    if (job.additional_info && typeof job.additional_info === "object") {
        const extra = [];
        for (const [key, value] of Object.entries(job.additional_info)) {
            // Skip already displayed fields
            if (["employer", "location", "salary", "hours_option", "job_type", "closing_date", "start_date", "reference",
                "contact_name", "contact_email", "contact_phone", "qualifications", "experience", "benefits", "how_to_apply"].includes(key)) {
                continue;
            }
            if (value && typeof value === "string" && value.length > 0) {
                const label = key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
                extra.push(`<dt>${escapeHtml(label)}</dt><dd>${formatText(value)}</dd>`);
            }
        }
        if (extra.length > 0) {
            sections.push(`
                <div class="detail-section">
                    <h4>Additional Information</h4>
                    <dl class="detail-grid">${extra.join("")}</dl>
                </div>
            `);
        }
    }

    // Check if job listing has expired (1 day after closing date)
    const isExpired = isJobExpired(job.closing_date);

    return `
        <div class="job-detail" data-job-id="${job.id}">
            ${sections.join("")}

            <div class="detail-actions">
                ${job.source_url ? `
                    ${isExpired ? `
                        <span class="btn-secondary btn-disabled" title="Original listing no longer available">
                            Source Expired
                        </span>
                    ` : `
                        <a href="${escapeHtml(job.source_url)}" target="_blank" rel="noopener" class="btn-apply">
                            View Source
                        </a>
                    `}
                ` : ""}
                <button type="button" class="btn-close-detail">Close</button>
            </div>
        </div>
    `;
}

/**
 * Check if a job has expired (1 day after closing date)
 */
function isJobExpired(closingDateStr) {
    if (!closingDateStr) return false;

    const closingDate = new Date(closingDateStr + "T23:59:59");
    const expiryDate = new Date(closingDate);
    expiryDate.setDate(expiryDate.getDate() + 1);

    return new Date() > expiryDate;
}

// Maximum jobs to show per section before requiring "Show all"
const JOBS_PER_SECTION_LIMIT = 10;

/**
 * Generate job list HTML
 */
export function getJobListHTML(jobs, expandedJobId = null, sortConfig = { column: "closing_date", direction: "asc" }, collapsedSections = new Set(), showAllJobsSections = new Set()) {
    if (!jobs || jobs.length === 0) {
        return `
            <div class="no-jobs">
                <h3>No jobs found</h3>
                <p>Try adjusting your filters or search terms.</p>
            </div>
        `;
    }

    // Group jobs by classification
    const grouped = {};
    for (const job of jobs) {
        const classification = job.classification || "Other";
        if (!grouped[classification]) {
            grouped[classification] = [];
        }
        grouped[classification].push(job);
    }

    // Sort classifications alphabetically, but put "Other" at the end
    const sortedClassifications = Object.keys(grouped).sort((a, b) => {
        if (a === "Other") return 1;
        if (b === "Other") return -1;
        return a.localeCompare(b);
    });

    // Collapse/Expand controls
    let html = `
        <div class="classification-controls">
            <button type="button" class="btn-collapse-all">Collapse All</button>
            <button type="button" class="btn-expand-all">Expand All</button>
        </div>
    `;

    for (const classification of sortedClassifications) {
        const classJobs = sortJobs(grouped[classification], sortConfig);
        const totalCount = classJobs.length;
        const isCollapsed = collapsedSections.has(classification);
        const showAll = showAllJobsSections.has(classification);
        const isLimited = !showAll && totalCount > JOBS_PER_SECTION_LIMIT;
        const displayJobs = isLimited ? classJobs.slice(0, JOBS_PER_SECTION_LIMIT) : classJobs;
        const hiddenCount = totalCount - displayJobs.length;

        html += `
            <div class="classification-section${isCollapsed ? " collapsed" : ""}" data-classification="${escapeHtml(classification)}">
                <div class="classification-header" role="button" aria-expanded="${!isCollapsed}">
                    <span class="collapse-icon">${isCollapsed ? "▶" : "▼"}</span>
                    <h3 class="classification-title">${escapeHtml(classification)}</h3>
                    <span class="classification-count">${totalCount} job${totalCount !== 1 ? "s" : ""}</span>
                </div>
                <div class="classification-content">
        `;

        html += getJobListHeaderHTML(sortConfig);
        html += '<div class="job-list-body">';

        for (const job of displayJobs) {
            const isExpanded = job.id === expandedJobId;
            html += getJobRowHTML(job, isExpanded);
            if (isExpanded) {
                html += getJobDetailHTML(job);
            }
        }

        html += '</div>';

        // Show "Show all" button if there are hidden jobs
        if (isLimited) {
            html += `
                <div class="show-all-container">
                    <button type="button" class="btn-show-all-jobs">
                        Show all ${totalCount} jobs (+${hiddenCount} more)
                    </button>
                </div>
            `;
        }

        html += '</div></div>';
    }

    return html;
}

/**
 * Sort jobs array by column and direction
 * Inactive (closed) jobs are always sorted to the bottom
 */
function sortJobs(jobs, sortConfig) {
    const { column, direction } = sortConfig;
    const modifier = direction === "asc" ? 1 : -1;

    return [...jobs].sort((a, b) => {
        // Always push inactive jobs to the bottom
        if (a.is_active !== b.is_active) {
            return a.is_active ? -1 : 1;
        }

        let aVal = a[column];
        let bVal = b[column];

        // Handle null/undefined
        if (aVal == null && bVal == null) return 0;
        if (aVal == null) return 1;
        if (bVal == null) return -1;

        // Numeric comparison for salary
        if (column === "salary_min" || column === "salary_max") {
            return (aVal - bVal) * modifier;
        }

        // Date comparison
        if (column === "closing_date" || column === "posted_date") {
            return (new Date(aVal) - new Date(bVal)) * modifier;
        }

        // String comparison
        return String(aVal).localeCompare(String(bVal)) * modifier;
    });
}
