// Ask Component for IOM Job Scraper
// Natural language query interface for job searches

import { CONFIG } from "./config.js";

export class AskComponent {
    constructor() {
        this.apiUrl = CONFIG.api.baseUrl;
        this.container = null;
        this.isExpanded = false;
        this.init();
    }

    init() {
        this.container = document.getElementById("ask-container");
        if (!this.container) return;

        this.render();
        this.setupEventListeners();
    }

    render() {
        this.container.innerHTML = `
            <div class="ask-section">
                <button class="ask-toggle" aria-expanded="false" type="button">
                    <span class="ask-toggle-icon">?</span>
                    <span class="ask-toggle-text">Ask a question about jobs</span>
                    <span class="ask-toggle-arrow">▼</span>
                </button>
                <div class="ask-panel" hidden>
                    <form class="ask-form">
                        <div class="ask-input-wrapper">
                            <div class="ask-input-container">
                                <input
                                    type="text"
                                    class="ask-input"
                                    placeholder="e.g., Show me IT jobs closing this week"
                                    maxlength="500"
                                    aria-label="Job question"
                                    autocomplete="off"
                                />
                                <button type="button" class="ask-clear" aria-label="Clear question" hidden>
                                    ✕
                                </button>
                            </div>
                            <button type="submit" class="ask-submit" aria-label="Submit question">
                                Ask
                            </button>
                        </div>
                        <div class="ask-hints">
                            Try: "Jobs paying over £40k" or "What government jobs are available?"
                        </div>
                    </form>
                    <div class="ask-result" hidden>
                        <div class="ask-answer"></div>
                        <div class="ask-citations"></div>
                    </div>
                    <div class="ask-loading" hidden>
                        <div class="ask-spinner"></div>
                        <span>Searching...</span>
                    </div>
                    <div class="ask-error" hidden></div>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        const toggle = this.container.querySelector(".ask-toggle");
        const panel = this.container.querySelector(".ask-panel");
        const form = this.container.querySelector(".ask-form");
        const input = this.container.querySelector(".ask-input");
        const clearBtn = this.container.querySelector(".ask-clear");

        toggle.addEventListener("click", () => {
            this.isExpanded = !this.isExpanded;
            toggle.setAttribute("aria-expanded", this.isExpanded);
            panel.hidden = !this.isExpanded;
            toggle.querySelector(".ask-toggle-arrow").textContent = this.isExpanded ? "▲" : "▼";

            if (this.isExpanded) {
                input.focus();
            }
        });

        form.addEventListener("submit", (e) => this.handleSubmit(e));

        // Allow Enter key to submit
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                form.dispatchEvent(new Event("submit"));
            }
        });

        // Show/hide clear button based on input content
        input.addEventListener("input", () => {
            clearBtn.hidden = input.value.length === 0;
        });

        // Clear button click handler
        clearBtn.addEventListener("click", () => {
            input.value = "";
            clearBtn.hidden = true;
            input.focus();
        });

        // Citation click handler - dispatch event to select job
        this.container.addEventListener("click", (e) => {
            const citationLink = e.target.closest(".citation-link");
            if (citationLink) {
                e.preventDefault();
                const jobId = parseInt(citationLink.dataset.jobId, 10);
                if (jobId) {
                    document.dispatchEvent(new CustomEvent("selectJob", { detail: { jobId } }));
                }
            }
        });
    }

    async handleSubmit(e) {
        e.preventDefault();

        const input = this.container.querySelector(".ask-input");
        const question = input.value.trim();

        if (!question) {
            this.showError("Please enter a question.");
            return;
        }

        if (question.length < 3) {
            this.showError("Question is too short.");
            return;
        }

        this.showLoading();
        this.hideError();
        this.hideResult();

        try {
            // Use streaming endpoint for faster perceived response
            await this.handleStreamingRequest(question);
        } catch (error) {
            console.error("Ask error:", error);
            // Fall back to non-streaming endpoint on error
            await this.handleNonStreamingRequest(question);
        } finally {
            this.hideLoading();
        }
    }

    /**
     * Handle streaming SSE request with named events
     */
    async handleStreamingRequest(question) {
        const response = await fetch(`${this.apiUrl}/ask/stream`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question }),
        });

        // If not SSE, handle as regular response
        if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream")) {
            const data = await response.json();
            if (data.success === false) {
                this.handleErrorResponse(data);
                return;
            }
            throw new Error("Unexpected response type");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamedAnswer = "";

        // Show result container immediately
        this.container.querySelector(".ask-result").hidden = false;
        const answerDiv = this.container.querySelector(".ask-answer");
        const citationsDiv = this.container.querySelector(".ask-citations");
        answerDiv.textContent = "";
        citationsDiv.hidden = true;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                // Parse named SSE events: "event: <name>\ndata: <json>\n\n"
                const events = buffer.split("\n\n");
                buffer = events.pop() || "";

                for (const block of events) {
                    const lines = block.split("\n");
                    let eventName = null;
                    let eventData = null;

                    for (const line of lines) {
                        if (line.startsWith("event: ")) {
                            eventName = line.slice(7).trim();
                        } else if (line.startsWith("data: ")) {
                            try {
                                eventData = JSON.parse(line.slice(6).trim());
                            } catch {
                                // Skip malformed data
                            }
                        }
                    }

                    if (!eventName || !eventData) continue;

                    if (eventName === "status") {
                        // Update loading message
                        const loadingSpan = this.container.querySelector(".ask-loading span");
                        if (loadingSpan) {
                            loadingSpan.textContent = eventData.message || "Searching...";
                        }
                        // Also show in answer area as streaming indicator
                        answerDiv.innerHTML = `<span class="streaming-indicator">${eventData.message || "Searching..."}</span>`;
                        this.container.querySelector(".ask-loading").hidden = true;
                    } else if (eventName === "chunk") {
                        // Append plain text chunk
                        streamedAnswer += eventData.text;
                        answerDiv.textContent = streamedAnswer;
                    } else if (eventName === "complete") {
                        // Finalise answer and render citations
                        if (!streamedAnswer) {
                            answerDiv.textContent = "Done.";
                        }
                        this.renderCitations(eventData.citations || []);
                    } else if (eventName === "error") {
                        this.handleErrorResponse(eventData);
                    }
                }
            }
        } finally {
            reader.releaseLock();
        }
    }

    /**
     * Render citations list
     */
    renderCitations(citations) {
        const citationsDiv = this.container.querySelector(".ask-citations");
        // Filter out any malformed citations and check for valid ones
        const validCitations = (citations || []).filter(c => c && c.id && c.title);

        if (validCitations.length > 0) {
            citationsDiv.innerHTML = `
                <div class="citations-label">Related jobs:</div>
                ${validCitations
                    .map(
                        (c) => `
                    <div class="citation">
                        <a href="#" class="citation-link" data-job-id="${c.id}">
                            ${c.title}${c.employer ? ` - ${c.employer}` : ""}
                        </a>
                    </div>
                `
                    )
                    .join("")}
            `;
            citationsDiv.hidden = false;
        } else {
            citationsDiv.innerHTML = "";
            citationsDiv.hidden = true;
        }
    }

    /**
     * Handle error response
     */
    handleErrorResponse(data) {
        let errorMessage = data.message || "Something went wrong. Please try again.";

        if (data.error === "rate_limited" || data.error === "rate_limit_exceeded") {
            errorMessage = "You've reached the daily question limit. Please try again tomorrow.";
        } else if (data.error === "unanswerable") {
            errorMessage = data.message;
        }

        this.showError(errorMessage);
    }

    /**
     * Fallback to non-streaming endpoint
     */
    async handleNonStreamingRequest(question) {
        try {
            const response = await fetch(`${this.apiUrl}/ask`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ question }),
            });

            const data = await response.json();

            if (data.success) {
                this.showResult(data);
            } else {
                this.handleErrorResponse(data);
            }
        } catch (error) {
            console.error("Non-streaming fallback error:", error);
            this.showError("Failed to connect. Please check your connection and try again.");
        }
    }

    showResult(data) {
        const resultDiv = this.container.querySelector(".ask-result");
        const answerDiv = this.container.querySelector(".ask-answer");
        const citationsDiv = this.container.querySelector(".ask-citations");

        answerDiv.textContent = data.answer;

        if (data.citations && data.citations.length > 0) {
            citationsDiv.innerHTML = `
                <div class="citations-label">Related jobs:</div>
                ${data.citations
                    .map(
                        (c) => `
                    <div class="citation">
                        <a href="#" class="citation-link" data-job-id="${c.id}">
                            ${c.title}${c.employer ? ` - ${c.employer}` : ""}
                        </a>
                    </div>
                `
                    )
                    .join("")}
            `;
            citationsDiv.hidden = false;
        } else {
            citationsDiv.hidden = true;
        }

        resultDiv.hidden = false;
    }

    hideResult() {
        this.container.querySelector(".ask-result").hidden = true;
    }

    showLoading() {
        this.container.querySelector(".ask-loading").hidden = false;
        this.container.querySelector(".ask-submit").disabled = true;
        this.container.querySelector(".ask-input").disabled = true;
    }

    hideLoading() {
        this.container.querySelector(".ask-loading").hidden = true;
        this.container.querySelector(".ask-submit").disabled = false;
        this.container.querySelector(".ask-input").disabled = false;
    }

    showError(message) {
        const errorDiv = this.container.querySelector(".ask-error");
        errorDiv.textContent = message;
        errorDiv.hidden = false;
    }

    hideError() {
        this.container.querySelector(".ask-error").hidden = true;
    }
}
