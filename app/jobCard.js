// Stats and Pagination Components for IOM Job Scraper
// Job list rendering has moved to jobList.js

/**
 * Generate pagination HTML
 */
export function getPaginationHTML(pagination) {
    const { page, totalPages, total } = pagination;

    if (totalPages <= 1) {
        return `<div class="pagination"><div class="pagination-info">Showing all ${total} jobs</div></div>`;
    }

    const pages = [];
    const maxVisible = 5;
    let start = Math.max(1, page - Math.floor(maxVisible / 2));
    let end = Math.min(totalPages, start + maxVisible - 1);

    if (end - start < maxVisible - 1) {
        start = Math.max(1, end - maxVisible + 1);
    }

    // Previous button
    pages.push(`<button class="page-btn" data-page="${page - 1}" ${page <= 1 ? "disabled" : ""}>←</button>`);

    // First page
    if (start > 1) {
        pages.push(`<button class="page-btn" data-page="1">1</button>`);
        if (start > 2) {
            pages.push(`<span class="page-ellipsis">...</span>`);
        }
    }

    // Page numbers
    for (let i = start; i <= end; i++) {
        pages.push(`
            <button class="page-btn ${i === page ? 'active' : ''}" data-page="${i}">${i}</button>
        `);
    }

    // Last page
    if (end < totalPages) {
        if (end < totalPages - 1) {
            pages.push(`<span class="page-ellipsis">...</span>`);
        }
        pages.push(`<button class="page-btn" data-page="${totalPages}">${totalPages}</button>`);
    }

    // Next button
    pages.push(`<button class="page-btn" data-page="${page + 1}" ${page >= totalPages ? "disabled" : ""}>→</button>`);

    return `
        <div class="pagination">
            <div class="pagination-info">Page ${page} of ${totalPages} (${total} jobs)</div>
            <div class="pagination-controls">${pages.join("")}</div>
        </div>
    `;
}

/**
 * Generate stats HTML
 */
export function getStatsHTML(stats) {
    if (!stats) return "";

    return `
        <div class="stats-grid">
            <div class="stat-item">
                <span class="stat-value">${stats.total_jobs || 0}</span>
                <span class="stat-label">Total Jobs</span>
            </div>
            <div class="stat-item">
                <span class="stat-value">${stats.active_jobs || 0}</span>
                <span class="stat-label">Active</span>
            </div>
            ${stats.closing_this_week ? `
                <div class="stat-item">
                    <span class="stat-value">${stats.closing_this_week}</span>
                    <span class="stat-label">Closing Soon</span>
                </div>
            ` : ""}
        </div>
    `;
}
