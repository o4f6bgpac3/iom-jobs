// SQL Query Builder for LLM-parsed job queries

/**
 * Build a safe parameterized SQL query from parsed intent
 * @param {Object} intent - The validated query intent from LLM
 * @returns {Object} { sql: string, params: array }
 */
export function buildQuery(intent) {
    const { query_type, conditions = [], date_range, sort, limit, search_text } = intent;

    let whereClauses = ["is_active = 1"];
    let params = [];
    let selectFields = "*";
    let orderBy = "posted_date DESC";
    let limitClause = limit ? `LIMIT ${Math.min(limit, 50)}` : "LIMIT 20";

    // Process conditions
    for (const condition of conditions) {
        const { clause, value } = buildCondition(condition);
        if (clause) {
            whereClauses.push(clause);
            if (Array.isArray(value)) {
                params.push(...value);
            } else if (value !== null) {
                params.push(value);
            }
        }
    }

    // Process date range
    if (date_range) {
        const dateClauses = buildDateRange(date_range);
        whereClauses.push(...dateClauses.clauses);
        params.push(...dateClauses.params);
    }

    // Process search text
    if (search_text) {
        whereClauses.push("(title LIKE ? OR summary LIKE ? OR description LIKE ?)");
        const searchTerm = `%${search_text}%`;
        params.push(searchTerm, searchTerm, searchTerm);
    }

    // Process sort
    if (sort) {
        const validSortFields = ["posted_date", "closing_date", "salary_min", "salary_max", "title", "employer"];
        if (validSortFields.includes(sort.field)) {
            const order = sort.order === "asc" ? "ASC" : "DESC";
            orderBy = `${sort.field} ${order}`;
        }
    }

    // Handle special query types
    switch (query_type) {
        case "count":
            selectFields = "COUNT(*) as count";
            limitClause = "";
            orderBy = "";
            break;

        case "salary_range":
            selectFields = "*, (salary_min + salary_max) / 2 as avg_salary";
            orderBy = sort ? orderBy : "salary_max DESC";
            break;

        case "closing_soon":
            if (!date_range) {
                whereClauses.push("closing_date >= date('now')");
                whereClauses.push("closing_date <= date('now', '+7 days')");
            }
            orderBy = "closing_date ASC";
            break;

        case "latest":
            orderBy = "posted_date DESC";
            break;

        case "compare":
            // Group by the field being compared
            const compareField = conditions.find(c => c.field === "location" || c.field === "employer")?.field || "employer";
            selectFields = `${compareField}, COUNT(*) as job_count, AVG(salary_min) as avg_salary_min, AVG(salary_max) as avg_salary_max`;
            orderBy = `job_count DESC`;
            return {
                sql: `SELECT ${selectFields} FROM jobs WHERE ${whereClauses.join(" AND ")} GROUP BY ${compareField} ${orderBy ? `ORDER BY ${orderBy}` : ""} ${limitClause}`.trim(),
                params,
            };

        case "recommend":
            // Sort by closing soon and salary
            orderBy = "CASE WHEN closing_date IS NOT NULL THEN 0 ELSE 1 END, closing_date ASC, salary_max DESC";
            break;
    }

    // Build final SQL
    const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    const orderClause = orderBy ? `ORDER BY ${orderBy}` : "";

    const sql = `SELECT ${selectFields} FROM jobs ${whereClause} ${orderClause} ${limitClause}`.trim();

    return { sql, params };
}

/**
 * Build a single condition clause
 */
function buildCondition(condition) {
    const { field, operator, value } = condition;

    // Validate field
    const validFields = [
        "title", "employer", "location", "classification", "job_type",
        "salary_min", "salary_max", "posted_date", "closing_date", "is_active"
    ];

    if (!validFields.includes(field)) {
        return { clause: null, value: null };
    }

    const numericFields = ["salary_min", "salary_max", "is_active"];
    const isNumeric = numericFields.includes(field);

    switch (operator) {
        case "eq":
            return { clause: `${field} = ?`, value };

        case "neq":
            return { clause: `${field} != ?`, value };

        case "gt":
            if (!isNumeric) return { clause: null, value: null };
            return { clause: `${field} > ?`, value };

        case "gte":
            if (!isNumeric) return { clause: null, value: null };
            return { clause: `${field} >= ?`, value };

        case "lt":
            if (!isNumeric) return { clause: null, value: null };
            return { clause: `${field} < ?`, value };

        case "lte":
            if (!isNumeric) return { clause: null, value: null };
            return { clause: `${field} <= ?`, value };

        case "contains":
            return { clause: `${field} LIKE ?`, value: `%${value}%` };

        case "starts_with":
            return { clause: `${field} LIKE ?`, value: `${value}%` };

        case "in":
            if (!Array.isArray(value) || value.length === 0) {
                return { clause: null, value: null };
            }
            const placeholders = value.map(() => "?").join(", ");
            return { clause: `${field} IN (${placeholders})`, value };

        default:
            return { clause: null, value: null };
    }
}

/**
 * Build date range clauses
 */
function buildDateRange(dateRange) {
    const clauses = [];
    const params = [];

    if (dateRange.relative) {
        switch (dateRange.relative) {
            case "today":
                clauses.push("closing_date = date('now')");
                break;

            case "this_week":
                clauses.push("closing_date >= date('now')");
                clauses.push("closing_date <= date('now', '+7 days')");
                break;

            case "next_week":
                clauses.push("closing_date >= date('now', '+7 days')");
                clauses.push("closing_date <= date('now', '+14 days')");
                break;

            case "this_month":
                clauses.push("closing_date >= date('now')");
                clauses.push("closing_date <= date('now', '+30 days')");
                break;
        }
    } else {
        if (dateRange.start) {
            clauses.push("closing_date >= ?");
            params.push(dateRange.start);
        }
        if (dateRange.end) {
            clauses.push("closing_date <= ?");
            params.push(dateRange.end);
        }
    }

    return { clauses, params };
}

/**
 * Build citations from query results
 */
export function buildCitations(intent, results) {
    return results.slice(0, 5).map(job => ({
        id: job.id,
        title: job.title,
        employer: job.employer,
        closing_date: job.closing_date,
        source_url: job.source_url,
    }));
}
