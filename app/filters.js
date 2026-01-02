// Filter Component for IOM Job Scraper
// Includes search, job type, hours type, salary, and recent days filters

// Classification options from source site
const CLASSIFICATIONS = [
    { value: "", label: "All Classifications" },
    { value: "BEAUTY", label: "Beauty" },
    { value: "BRICKLAYER", label: "Bricklayer" },
    { value: "CLEANING SERVICES", label: "Cleaning Services" },
    { value: "CONSTRUCTION: OTHER SKILLED", label: "Construction: Other Skilled" },
    { value: "CONSTRUCTION: UNSKILLED", label: "Construction: Unskilled" },
    { value: "CONSULTANT (BUSINESS / LEGAL)", label: "Consultant (Business / Legal)" },
    { value: "CULTURAL & SPORT OCCUPATIONS", label: "Cultural & Sport Occupations" },
    { value: "CUSTOMER SERVICE OCCUPATIONS", label: "Customer Service Occupations" },
    { value: "DRIVER: HGV, PSV ETC", label: "Driver: HGV, PSV etc" },
    { value: "DRIVER: OTHER", label: "Driver: Other" },
    { value: "EDUCATION / TEACHING / NURSERY", label: "Education / Teaching / Nursery" },
    { value: "ELECTRICIAN", label: "Electrician" },
    { value: "ENGINEERING: SKILLED", label: "Engineering: Skilled" },
    { value: "ENGINEERING: UNSKILLED", label: "Engineering: Unskilled" },
    { value: "FARMING / AGRICULTURE / FISHERIES", label: "Farming / Agriculture / Fisheries" },
    { value: "FINANCE & ACCOUNTANCY", label: "Finance & Accountancy" },
    { value: "FLOORING / TILING", label: "Flooring / Tiling" },
    { value: "GARDENER / LANDSCAPER", label: "Gardener / Landscaper" },
    { value: "GLAZIER", label: "Glazier" },
    { value: "GROUNDWORK / PLANT OPERATOR", label: "Groundwork / Plant Operator" },
    { value: "HEALTHCARE", label: "Healthcare" },
    { value: "HOTEL / CATERER / BAR WORK", label: "Hotel / Caterer / Bar Work" },
    { value: "INFORMATION TECHNOLOGY", label: "Information Technology" },
    { value: "INSURANCE / BANKING ADMIN", label: "Insurance / Banking Admin" },
    { value: "IS / TELECOMMUNICATIONS", label: "IS / Telecommunications" },
    { value: "JOINER", label: "Joiner" },
    { value: "MANAGEMENT", label: "Management" },
    { value: "MECHANIC", label: "Mechanic" },
    { value: "NO PREVIOUS JOB", label: "No Previous Job" },
    { value: "NOT KNOWN", label: "Not Known" },
    { value: "NURSING", label: "Nursing" },
    { value: "OTHER ADMIN / CLERICAL", label: "Other Admin / Clerical" },
    { value: "OTHER ELEMENTARY SERVICES OCCUPATIONS", label: "Other Elementary Services" },
    { value: "OTHER PROFESSIONS", label: "Other Professions" },
    { value: "PAINTER & DECORATOR", label: "Painter & Decorator" },
    { value: "PLASTERER", label: "Plasterer" },
    { value: "PLUMBER", label: "Plumber" },
    { value: "PRODUCTION / ASSEMBLY OPERATIVE", label: "Production / Assembly Operative" },
    { value: "PROTECTIVE SERVICE OCCUPATIONS", label: "Protective Service Occupations" },
    { value: "RETAIL / SALES / WHOLESALE / BUYER", label: "Retail / Sales / Wholesale / Buyer" },
    { value: "ROOFER", label: "Roofer" },
    { value: "SCAFFOLDER", label: "Scaffolder" },
    { value: "SCIENTIFIC / CHEMIST", label: "Scientific / Chemist" },
    { value: "TEXTILES & PAINTING", label: "Textiles & Painting" },
    { value: "WELDER", label: "Welder" },
];

/**
 * Generate filter panel HTML
 */
export function getFilterPanelHTML(filterOptions, currentFilters = {}) {
    const { job_types = [], hours_types = [] } = filterOptions;

    return `
        <div class="filter-grid">
            <div class="filter-group filter-group-wide">
                <label for="filter-search">Search</label>
                <div class="search-input-wrapper">
                    <input type="text" id="filter-search" placeholder="Search jobs, employers..."
                           value="${escapeHtml(currentFilters.search || "")}" autocomplete="off">
                    <button type="button" class="search-clear" id="search-clear" title="Clear search" ${currentFilters.search ? "" : "hidden"}>×</button>
                </div>
            </div>

            <div class="filter-group">
                <label for="filter-classification">Classification</label>
                <select id="filter-classification">
                    ${CLASSIFICATIONS.map(c => `
                        <option value="${escapeHtml(c.value)}" ${currentFilters.classification === c.value ? "selected" : ""}>${escapeHtml(c.label)}</option>
                    `).join("")}
                </select>
            </div>

            <div class="filter-group">
                <label for="filter-hours-type">Hours</label>
                <select id="filter-hours-type">
                    <option value="">Both</option>
                    <option value="full-time" ${currentFilters.hours_type === "full-time" ? "selected" : ""}>Full-time</option>
                    <option value="part-time" ${currentFilters.hours_type === "part-time" ? "selected" : ""}>Part-time</option>
                </select>
            </div>

            <div class="filter-group">
                <label for="filter-last-days">Posted</label>
                <select id="filter-last-days">
                    <option value="">Any time</option>
                    <option value="1" ${currentFilters.last_days === "1" ? "selected" : ""}>New (24h)</option>
                    <option value="3" ${currentFilters.last_days === "3" ? "selected" : ""}>Last 3 days</option>
                    <option value="7" ${currentFilters.last_days === "7" ? "selected" : ""}>Last 7 days</option>
                    <option value="14" ${currentFilters.last_days === "14" ? "selected" : ""}>Last 14 days</option>
                    <option value="30" ${currentFilters.last_days === "30" ? "selected" : ""}>Last 30 days</option>
                </select>
            </div>

            <div class="filter-group filter-group-actions">
                <label class="checkbox-label">
                    <input type="checkbox" id="filter-active-only" checked>
                    <span>Active jobs only</span>
                </label>
                <button type="button" class="btn-clear-filters" id="clear-filters" hidden>Clear</button>
            </div>
        </div>
    `;
}

/**
 * Extract filter values from the DOM
 */
export function getFilterValues() {
    return {
        search: document.getElementById("filter-search")?.value?.trim() || undefined,
        classification: document.getElementById("filter-classification")?.value || undefined,
        hours_type: document.getElementById("filter-hours-type")?.value || undefined,
        last_days: document.getElementById("filter-last-days")?.value || undefined,
    };
}

/**
 * Clear all filter inputs
 */
export function clearFilters() {
    const search = document.getElementById("filter-search");
    if (search) search.value = "";

    const classification = document.getElementById("filter-classification");
    if (classification) classification.value = "";

    const hoursType = document.getElementById("filter-hours-type");
    if (hoursType) hoursType.value = "";

    const lastDays = document.getElementById("filter-last-days");
    if (lastDays) lastDays.value = "";
}

/**
 * Count active filters
 */
export function countActiveFilters() {
    let count = 0;

    if (document.getElementById("filter-search")?.value?.trim()) count++;
    if (document.getElementById("filter-classification")?.value) count++;
    if (document.getElementById("filter-hours-type")?.value) count++;
    if (document.getElementById("filter-last-days")?.value) count++;

    return count;
}

/**
 * Update filter count badge
 */
export function updateFilterCount() {
    const count = countActiveFilters();
    const badge = document.getElementById("filter-count");

    if (badge) {
        badge.textContent = count;
        badge.hidden = count === 0;
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return "";
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
}
