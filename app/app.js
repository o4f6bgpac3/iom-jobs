// Main Application Controller for IOM Job Scraper
// List view with sortable columns, expandable details, and client-side filtering

import { CONFIG } from "./config.js";
import { getPaginationHTML, getStatsHTML } from "./jobCard.js";
import { getJobListHTML } from "./jobList.js";
import { getFilterPanelHTML, getFilterValues } from "./filters.js";
import { AskComponent } from "./askComponent.js";

class JobsApp {
    constructor() {
        this.API_URL = CONFIG.api.baseUrl;
        this.allJobs = [];      // All jobs from API
        this.filteredJobs = []; // Jobs after client-side filtering
        this.filterOptions = {};
        this.stats = {};
        this.isLoading = false;

        // Sort and expand state
        this.sortConfig = { column: "closing_date", direction: "asc" };
        this.expandedJobId = null;
        this.collapsedSections = new Set(); // Track collapsed classification sections
        this.showAllJobsSections = new Set(); // Track sections showing all jobs (not limited)

        // Debounce timer
        this.filterDebounceTimer = null;
        this.DEBOUNCE_DELAY = 200; // ms

        this.init();
    }

    async init() {
        // Cache DOM elements
        this.jobsContainer = document.getElementById("jobs-container");
        this.filterPanel = document.getElementById("filter-panel");
        this.paginationContainer = document.getElementById("pagination-container");
        this.loadingElement = document.getElementById("loading");
        this.errorElement = document.getElementById("error-message");
        this.statsContainer = document.getElementById("stats-container");

        // Load all jobs from API
        await this.loadAllJobs();

        // Initialize Ask component
        this.askComponent = new AskComponent();

        // Setup event listeners
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Filter panel events - auto-filter on input with debounce
        this.filterPanel?.addEventListener("input", (e) => {
            // Show/hide search clear button
            if (e.target.id === "filter-search") {
                this.toggleSearchClear(e.target.value);
            }
            // Debounce filter application
            this.debouncedFilter();
        });

        // Also handle select changes
        this.filterPanel?.addEventListener("change", (e) => {
            if (e.target.tagName === "SELECT") {
                this.debouncedFilter();
            }
            // Active only checkbox triggers server reload
            if (e.target.id === "filter-active-only") {
                this.loadAllJobs();
            }
        });

        // Search clear button and Clear Filters button
        this.filterPanel?.addEventListener("click", (e) => {
            if (e.target.id === "search-clear") {
                this.clearSearch();
            }
            if (e.target.id === "clear-filters") {
                this.clearAllFilters();
            }
        });

        // Job list events (click on rows and headers)
        this.jobsContainer?.addEventListener("click", (e) => {
            // Classification header click (collapse/expand section)
            const classificationHeader = e.target.closest(".classification-header");
            if (classificationHeader) {
                const section = classificationHeader.closest(".classification-section");
                const classification = section?.dataset.classification;
                if (classification) {
                    this.toggleSection(classification);
                }
                return;
            }

            // Collapse/Expand all buttons
            if (e.target.classList.contains("btn-collapse-all")) {
                this.collapseAll();
                return;
            }
            if (e.target.classList.contains("btn-expand-all")) {
                this.expandAll();
                return;
            }

            // Show all jobs in section button
            if (e.target.classList.contains("btn-show-all-jobs")) {
                const section = e.target.closest(".classification-section");
                const classification = section?.dataset.classification;
                if (classification) {
                    this.showAllJobsInSection(classification);
                }
                return;
            }

            // Sort header click
            const headerCell = e.target.closest(".job-list-header-cell");
            if (headerCell) {
                const column = headerCell.dataset.sort;
                if (column) {
                    this.handleSort(column);
                }
                return;
            }

            // Close detail button
            if (e.target.classList.contains("btn-close-detail")) {
                this.expandedJobId = null;
                this.displayJobs();
                return;
            }

            // Job row click
            const jobRow = e.target.closest(".job-row");
            if (jobRow) {
                const jobId = parseInt(jobRow.dataset.jobId, 10);
                this.handleRowClick(jobId);
            }
        });

        // Listen for selectJob event from ask component
        document.addEventListener("selectJob", (e) => {
            const { jobId } = e.detail;
            if (jobId) {
                this.selectJobById(jobId);
            }
        });
    }

    debouncedFilter() {
        clearTimeout(this.filterDebounceTimer);
        this.filterDebounceTimer = setTimeout(() => {
            this.applyClientFilters();
        }, this.DEBOUNCE_DELAY);
    }

    handleSort(column) {
        // Toggle direction if same column, otherwise default to asc (except salary = desc)
        if (this.sortConfig.column === column) {
            this.sortConfig.direction = this.sortConfig.direction === "asc" ? "desc" : "asc";
        } else {
            this.sortConfig.column = column;
            this.sortConfig.direction = column === "salary_min" ? "desc" : "asc";
        }
        this.displayJobs();
    }

    handleRowClick(jobId) {
        if (this.expandedJobId === jobId) {
            this.expandedJobId = null;
        } else {
            this.expandedJobId = jobId;
        }
        this.displayJobs();
    }

    selectJobById(jobId) {
        // Check if job exists in allJobs
        const job = this.allJobs.find(j => j.id === jobId);
        if (!job) return;

        // Clear filters to ensure job is visible
        const search = document.getElementById("filter-search");
        if (search) search.value = "";
        const classification = document.getElementById("filter-classification");
        if (classification) classification.value = "";
        const hoursType = document.getElementById("filter-hours-type");
        if (hoursType) hoursType.value = "";
        const lastDays = document.getElementById("filter-last-days");
        if (lastDays) lastDays.value = "";
        this.toggleSearchClear("");

        // Reset filtered jobs to all jobs
        this.filteredJobs = [...this.allJobs];

        // Expand the job's section if collapsed, and show all jobs in section
        const jobClassification = job.classification || "Other";
        this.collapsedSections.delete(jobClassification);
        this.showAllJobsSections.add(jobClassification);

        // Set the expanded job
        this.expandedJobId = jobId;
        this.displayJobs();

        // Scroll to the job row
        setTimeout(() => {
            const jobRow = document.querySelector(`.job-row[data-job-id="${jobId}"]`);
            if (jobRow) {
                jobRow.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        }, 100);
    }

    toggleSection(classification) {
        if (this.collapsedSections.has(classification)) {
            this.collapsedSections.delete(classification);
        } else {
            this.collapsedSections.add(classification);
        }
        this.displayJobs();
    }

    collapseAll() {
        // Get all current classifications from filtered jobs
        const classifications = new Set(
            this.filteredJobs.map(job => job.classification || "Other")
        );
        this.collapsedSections = classifications;
        this.displayJobs();
    }

    expandAll() {
        this.collapsedSections.clear();
        this.displayJobs();
    }

    showAllJobsInSection(classification) {
        this.showAllJobsSections.add(classification);
        this.displayJobs();
    }

    async loadAllJobs() {
        if (this.isLoading) return;

        this.isLoading = true;
        this.showLoading();
        this.hideError();

        try {
            // Load all jobs (no pagination, high limit)
            const params = new URLSearchParams();
            params.set("limit", "1000");
            const activeOnly = document.getElementById("filter-active-only")?.checked ?? true;
            params.set("active_only", activeOnly.toString());

            const response = await fetch(`${this.API_URL}?${params.toString()}`);
            const data = await response.json();

            if (data.success) {
                this.allJobs = data.data.jobs;
                this.filteredJobs = [...this.allJobs];
                this.filterOptions = data.data.filters;
                this.stats = data.data.stats;

                // Preserve checkbox state before re-rendering filters
                const wasActiveOnly = activeOnly;
                this.displayFilters();
                // Restore checkbox state
                const checkbox = document.getElementById("filter-active-only");
                if (checkbox) checkbox.checked = wasActiveOnly;

                // When showing inactive jobs, collapse all sections by default
                // and reset the "show all" state for performance
                if (!activeOnly) {
                    const classifications = new Set(
                        this.allJobs.map(job => job.classification || "Other")
                    );
                    this.collapsedSections = classifications;
                    this.showAllJobsSections.clear();
                } else {
                    // Reset collapse state when switching back to active only
                    this.collapsedSections.clear();
                    this.showAllJobsSections.clear();
                }

                this.displayStats(this.stats);
                // Inject SEO structured data
                this.injectJobPostingSchema(this.allJobs);
                // Apply any active client-side filters
                this.applyClientFilters();
            } else {
                this.showError(data.message || "Failed to load jobs");
            }
        } catch (error) {
            console.error("Error loading jobs:", error);
            this.showError("Failed to connect to the server. Please try again later.");
        } finally {
            this.isLoading = false;
            this.hideLoading();
        }
    }

    applyClientFilters() {
        const filters = getFilterValues();
        this.expandedJobId = null;

        this.filteredJobs = this.allJobs.filter(job => {
            // Search filter (title, employer, description)
            if (filters.search) {
                const searchLower = filters.search.toLowerCase();
                const titleMatch = job.title?.toLowerCase().includes(searchLower);
                const employerMatch = job.employer?.toLowerCase().includes(searchLower);
                const descMatch = job.description?.toLowerCase().includes(searchLower);
                const locationMatch = job.location?.toLowerCase().includes(searchLower);
                if (!titleMatch && !employerMatch && !descMatch && !locationMatch) {
                    return false;
                }
            }

            // Classification filter
            if (filters.classification && job.classification !== filters.classification) {
                return false;
            }

            // Hours type filter
            if (filters.hours_type && job.hours_type !== filters.hours_type) {
                return false;
            }

            // Last days filter (use scraped_at as fallback since source has no posted date)
            if (filters.last_days) {
                const daysAgo = parseInt(filters.last_days, 10);
                // Normalize cutoff date to start of day for fair comparison
                const cutoffDate = new Date();
                cutoffDate.setHours(0, 0, 0, 0);
                cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
                // Use posted_date if available, otherwise fall back to scraped_at
                const dateStr = job.posted_date || job.scraped_at;
                const jobDate = dateStr ? new Date(dateStr) : null;
                if (jobDate) {
                    jobDate.setHours(0, 0, 0, 0);
                }
                if (!jobDate || jobDate < cutoffDate) {
                    return false;
                }
            }

            return true;
        });

        this.displayJobs();
        this.updateResultCount();
        this.toggleClearFiltersButton(filters);
    }

    displayJobs() {
        if (!this.jobsContainer) return;
        this.jobsContainer.innerHTML = getJobListHTML(
            this.filteredJobs,
            this.expandedJobId,
            this.sortConfig,
            this.collapsedSections,
            this.showAllJobsSections
        );
    }

    displayFilters() {
        if (!this.filterPanel) return;
        this.filterPanel.innerHTML = getFilterPanelHTML(this.filterOptions, {});
    }

    updateResultCount() {
        // Clear pagination container - count is shown in stats at the top
        if (this.paginationContainer) {
            this.paginationContainer.innerHTML = "";
        }

        // Update filter results indicator
        const filterResults = document.getElementById("filter-results");
        if (!filterResults) return;

        const filteredCount = this.filteredJobs.length;
        const totalCount = this.allJobs.length;
        const hasActiveFilters = filteredCount !== totalCount;

        if (hasActiveFilters) {
            filterResults.textContent = `Showing ${filteredCount} of ${totalCount} jobs`;
            filterResults.hidden = false;
        } else {
            filterResults.hidden = true;
        }
    }

    displayStats(stats) {
        if (!this.statsContainer || !stats) return;
        this.statsContainer.innerHTML = getStatsHTML(stats);
        this.updateLastUpdated(stats.last_updated);
    }

    updateLastUpdated(timestamp) {
        const element = document.getElementById("last-updated");
        if (!element) return;

        if (!timestamp) {
            element.textContent = "Update time unavailable";
            return;
        }

        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        let timeAgo;
        if (diffHours < 1) {
            timeAgo = "less than an hour ago";
        } else if (diffHours === 1) {
            timeAgo = "1 hour ago";
        } else if (diffHours < 24) {
            timeAgo = `${diffHours} hours ago`;
        } else if (diffDays === 1) {
            timeAgo = "1 day ago";
        } else {
            timeAgo = `${diffDays} days ago`;
        }

        const formatted = date.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });

        element.textContent = `Last updated: ${formatted} (${timeAgo})`;
    }

    clearSearch() {
        const searchInput = document.getElementById("filter-search");
        if (searchInput) {
            searchInput.value = "";
            searchInput.focus();
        }
        this.toggleSearchClear("");
        this.debouncedFilter();
    }

    toggleSearchClear(value) {
        const clearBtn = document.getElementById("search-clear");
        if (clearBtn) {
            clearBtn.hidden = !value || value.trim() === "";
        }
    }

    toggleClearFiltersButton(filters) {
        const clearBtn = document.getElementById("clear-filters");
        if (!clearBtn) return;

        const activeOnlyUnchecked = !document.getElementById("filter-active-only")?.checked;
        const hasActiveFilters = filters.search || filters.classification ||
            filters.hours_type || filters.last_days || activeOnlyUnchecked;
        clearBtn.hidden = !hasActiveFilters;
    }

    clearAllFilters() {
        const search = document.getElementById("filter-search");
        if (search) search.value = "";

        const classification = document.getElementById("filter-classification");
        if (classification) classification.value = "";

        const hoursType = document.getElementById("filter-hours-type");
        if (hoursType) hoursType.value = "";

        const lastDays = document.getElementById("filter-last-days");
        if (lastDays) lastDays.value = "";

        const activeOnly = document.getElementById("filter-active-only");
        const wasUnchecked = activeOnly && !activeOnly.checked;
        if (activeOnly) activeOnly.checked = true;

        this.toggleSearchClear("");

        // If we were showing all jobs, reload to get active only
        if (wasUnchecked) {
            this.loadAllJobs();
        } else {
            this.applyClientFilters();
        }
    }

    showLoading() {
        if (this.loadingElement) {
            this.loadingElement.hidden = false;
        }
        if (this.jobsContainer) {
            this.jobsContainer.style.opacity = "0.5";
        }
    }

    hideLoading() {
        if (this.loadingElement) {
            this.loadingElement.hidden = true;
        }
        if (this.jobsContainer) {
            this.jobsContainer.style.opacity = "1";
        }
    }

    showError(message) {
        if (this.errorElement) {
            this.errorElement.textContent = message;
            this.errorElement.hidden = false;
        }
    }

    hideError() {
        if (this.errorElement) {
            this.errorElement.hidden = true;
        }
    }

    /**
     * Inject JobPosting structured data for SEO
     * @param {Array} jobs - Array of job objects
     */
    injectJobPostingSchema(jobs) {
        // Remove any existing job schema
        const existing = document.getElementById("job-posting-schema");
        if (existing) existing.remove();

        if (!jobs || jobs.length === 0) return;

        const schema = {
            "@context": "https://schema.org",
            "@type": "ItemList",
            "itemListElement": jobs.slice(0, 100).map((job, index) => ({
                "@type": "ListItem",
                "position": index + 1,
                "item": {
                    "@type": "JobPosting",
                    "title": job.title,
                    "description": job.description || job.summary || "",
                    "datePosted": job.posted_date || undefined,
                    "validThrough": job.closing_date ? `${job.closing_date}T23:59:59` : undefined,
                    "employmentType": job.hours_type === "full-time" ? "FULL_TIME" :
                                      job.hours_type === "part-time" ? "PART_TIME" : undefined,
                    "hiringOrganization": {
                        "@type": "Organization",
                        "name": job.employer || "Isle of Man Government"
                    },
                    "jobLocation": {
                        "@type": "Place",
                        "address": {
                            "@type": "PostalAddress",
                            "addressLocality": job.location || "Isle of Man",
                            "addressRegion": "Isle of Man",
                            "addressCountry": "IM"
                        }
                    },
                    ...(job.salary_min && {
                        "baseSalary": {
                            "@type": "MonetaryAmount",
                            "currency": "GBP",
                            "value": {
                                "@type": "QuantitativeValue",
                                "minValue": job.salary_min,
                                "maxValue": job.salary_max || job.salary_min,
                                "unitText": job.salary_type === "hourly" ? "HOUR" : "YEAR"
                            }
                        }
                    })
                }
            }))
        };

        const script = document.createElement("script");
        script.id = "job-posting-schema";
        script.type = "application/ld+json";
        script.textContent = JSON.stringify(schema);
        document.head.appendChild(script);
    }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    new JobsApp();
});
