// SQL Validator for LLM-generated queries
// Ensures only safe SELECT queries run against allowed tables

const ALLOWED_TABLES = ["jobs"];

const WRITE_KEYWORDS = [
    "INSERT", "UPDATE", "DELETE", "DROP", "ALTER",
    "CREATE", "REPLACE", "TRUNCATE", "MERGE",
];

const BLOCKED_PATTERNS = [
    /sqlite_master/i,
    /sqlite_schema/i,
    /\bPRAGMA\b/i,
    /\bATTACH\b/i,
    /\bDETACH\b/i,
];

const DEFAULT_LIMIT = 50;

/**
 * Extract table names from FROM and JOIN clauses
 */
function extractTableNames(sql) {
    const tables = new Set();
    const pattern = /\b(?:FROM|JOIN)\s+(\w+)/gi;
    let match;
    while ((match = pattern.exec(sql)) !== null) {
        tables.add(match[1].toLowerCase());
    }
    return [...tables];
}

/**
 * Validate LLM-generated SQL for safety
 * @param {string} sql - Raw SQL from LLM
 * @returns {{ valid: boolean, error?: string, sanitisedSql?: string }}
 */
export function validateSQL(sql) {
    if (!sql || typeof sql !== "string") {
        return { valid: false, error: "Empty or invalid SQL" };
    }

    const trimmed = sql.trim();

    // Must start with SELECT
    if (!/^SELECT\b/i.test(trimmed)) {
        return { valid: false, error: "Only SELECT statements are allowed" };
    }

    // Block write keywords
    for (const keyword of WRITE_KEYWORDS) {
        const pattern = new RegExp(`\\b${keyword}\\b`, "i");
        if (pattern.test(trimmed)) {
            return { valid: false, error: `Blocked keyword: ${keyword}` };
        }
    }

    // Block schema introspection
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(trimmed)) {
            return { valid: false, error: "Schema introspection is not allowed" };
        }
    }

    // Reject multiple statements (semicolon in body, not at very end)
    const body = trimmed.endsWith(";") ? trimmed.slice(0, -1) : trimmed;
    if (body.includes(";")) {
        return { valid: false, error: "Multiple statements are not allowed" };
    }

    // Validate table names against allowlist
    const tables = extractTableNames(trimmed);
    if (tables.length === 0) {
        return { valid: false, error: "No table found in query" };
    }

    for (const table of tables) {
        if (!ALLOWED_TABLES.includes(table)) {
            return { valid: false, error: `Table not allowed: ${table}` };
        }
    }

    // Auto-append LIMIT if not present
    let sanitisedSql = body;
    if (!/\bLIMIT\b/i.test(sanitisedSql)) {
        sanitisedSql += ` LIMIT ${DEFAULT_LIMIT}`;
    }

    return { valid: true, sanitisedSql };
}
