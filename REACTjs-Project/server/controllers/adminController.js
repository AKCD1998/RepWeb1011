import { getClient, query } from "../db/pool.js";
import { httpError } from "../utils/httpError.js";

const SQL_TEXT_MAX_LENGTH = readIntegerEnv("ADMIN_SQL_EXECUTOR_MAX_SQL_LENGTH", 20000, {
  min: 1000,
  max: 200000,
});
const STATEMENT_TIMEOUT_MS = readIntegerEnv("ADMIN_SQL_EXECUTOR_TIMEOUT_MS", 5000, {
  min: 100,
  max: 60000,
});
const ROW_CAP = readIntegerEnv("ADMIN_SQL_EXECUTOR_ROW_CAP", 200, {
  min: 1,
  max: 1000,
});
const RESULT_LIMIT = ROW_CAP + 1;
const ALLOWED_START_TOKENS = new Set(["SELECT", "WITH", "EXPLAIN"]);
const PROHIBITED_TOKENS = new Set([
  "ALTER",
  "ANALYZE",
  "BEGIN",
  "CALL",
  "CHECKPOINT",
  "CLUSTER",
  "COMMENT",
  "COMMIT",
  "COPY",
  "CREATE",
  "DEALLOCATE",
  "DELETE",
  "DISCARD",
  "DO",
  "DROP",
  "EXECUTE",
  "GRANT",
  "IMPORT",
  "INSERT",
  "INTO",
  "LISTEN",
  "LOCK",
  "MERGE",
  "NOTIFY",
  "PREPARE",
  "REFRESH",
  "REINDEX",
  "RELEASE",
  "RESET",
  "REVOKE",
  "ROLLBACK",
  "SAVEPOINT",
  "SECURITY",
  "SET",
  "TRUNCATE",
  "UNLISTEN",
  "UPDATE",
  "VACUUM",
]);

function readIntegerEnv(name, fallback, options = {}) {
  const min = Number.isFinite(options.min) ? options.min : Number.NEGATIVE_INFINITY;
  const max = Number.isFinite(options.max) ? options.max : Number.POSITIVE_INFINITY;
  const rawValue = String(process.env[name] ?? "").trim();
  const parsed = Number.parseInt(rawValue || String(fallback), 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function toCleanText(value) {
  return String(value ?? "").trim();
}

function truncateText(value, maxLength = 2000) {
  const text = toCleanText(value);
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(maxLength - 3, 0))}...`;
}

function getClientIp(req) {
  const forwardedFor = String(req.headers?.["x-forwarded-for"] || "").trim();
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "";
  }

  return toCleanText(req.ip || req.socket?.remoteAddress);
}

function readDollarQuoteTag(sql, index) {
  const slice = sql.slice(index);
  const matched = slice.match(/^\$[A-Za-z_][A-Za-z0-9_]*\$/) || slice.match(/^\$\$/);
  return matched?.[0] || "";
}

function analyzeSql(sqlText) {
  let state = "normal";
  let blockCommentDepth = 0;
  let dollarQuoteTag = "";
  let separatorCount = 0;
  let lastSeparatorIndex = -1;
  let lastSignificantChar = "";
  let normalized = "";

  for (let index = 0; index < sqlText.length; ) {
    const char = sqlText[index];
    const nextChar = sqlText[index + 1] || "";

    if (state === "single-quote") {
      if (char === "'" && nextChar === "'") {
        index += 2;
        continue;
      }
      if (char === "'") {
        state = "normal";
        normalized += " ";
      }
      index += 1;
      continue;
    }

    if (state === "double-quote") {
      if (char === '"' && nextChar === '"') {
        index += 2;
        continue;
      }
      if (char === '"') {
        state = "normal";
        normalized += " ";
      }
      index += 1;
      continue;
    }

    if (state === "line-comment") {
      if (char === "\n") {
        state = "normal";
        normalized += " ";
      }
      index += 1;
      continue;
    }

    if (state === "block-comment") {
      if (char === "/" && nextChar === "*") {
        blockCommentDepth += 1;
        index += 2;
        continue;
      }
      if (char === "*" && nextChar === "/") {
        blockCommentDepth -= 1;
        index += 2;
        if (blockCommentDepth === 0) {
          state = "normal";
          normalized += " ";
        }
        continue;
      }
      index += 1;
      continue;
    }

    if (state === "dollar-quote") {
      if (dollarQuoteTag && sqlText.startsWith(dollarQuoteTag, index)) {
        index += dollarQuoteTag.length;
        dollarQuoteTag = "";
        state = "normal";
        normalized += " ";
        continue;
      }
      index += 1;
      continue;
    }

    if (char === "'") {
      state = "single-quote";
      index += 1;
      continue;
    }

    if (char === '"') {
      state = "double-quote";
      index += 1;
      continue;
    }

    if (char === "-" && nextChar === "-") {
      state = "line-comment";
      index += 2;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      state = "block-comment";
      blockCommentDepth = 1;
      index += 2;
      continue;
    }

    const tag = char === "$" ? readDollarQuoteTag(sqlText, index) : "";
    if (tag) {
      state = "dollar-quote";
      dollarQuoteTag = tag;
      index += tag.length;
      continue;
    }

    if (char === ";") {
      separatorCount += 1;
      lastSeparatorIndex = index;
    }

    normalized += char;
    if (!/\s/.test(char)) {
      lastSignificantChar = char;
    }
    index += 1;
  }

  if (state !== "normal") {
    throw httpError(400, "SQL statement is not terminated correctly");
  }

  const collapsed = normalized.replace(/\s+/g, " ").trim();
  const tokens = (collapsed.match(/[A-Za-z_][A-Za-z0-9_$]*/g) || []).map((token) =>
    token.toUpperCase()
  );

  return {
    collapsed,
    tokens,
    separatorCount,
    lastSeparatorIndex,
    lastSignificantChar,
  };
}

function validateAndPrepareSql(rawSql) {
  if (typeof rawSql !== "string") {
    throw httpError(400, "sql must be a string");
  }

  const sqlText = rawSql.trim();
  if (!sqlText) {
    throw httpError(400, "sql is required");
  }
  if (sqlText.length > SQL_TEXT_MAX_LENGTH) {
    throw httpError(400, `sql exceeds max length of ${SQL_TEXT_MAX_LENGTH} characters`);
  }

  const analyzed = analyzeSql(sqlText);
  if (!analyzed.tokens.length) {
    throw httpError(400, "SQL statement is empty after removing comments");
  }

  if (analyzed.separatorCount > 1) {
    throw httpError(400, "Only a single SQL statement is allowed");
  }
  if (analyzed.separatorCount === 1 && analyzed.lastSignificantChar !== ";") {
    throw httpError(400, "Only a single SQL statement is allowed");
  }

  const statementType = analyzed.tokens[0];
  if (!ALLOWED_START_TOKENS.has(statementType)) {
    throw httpError(400, "Only SELECT, WITH, or EXPLAIN statements are allowed");
  }

  const prohibitedToken = analyzed.tokens.find((token) => PROHIBITED_TOKENS.has(token));
  if (prohibitedToken) {
    throw httpError(400, `Token ${prohibitedToken} is not allowed in read-only SQL executor`);
  }

  if (statementType === "WITH" && !analyzed.tokens.includes("SELECT")) {
    throw httpError(400, "WITH queries must resolve to a SELECT statement");
  }

  if (statementType === "EXPLAIN") {
    const explainsReadOnlyQuery = analyzed.tokens.some(
      (token) => token === "SELECT" || token === "WITH"
    );
    if (!explainsReadOnlyQuery) {
      throw httpError(400, "EXPLAIN is limited to SELECT or WITH queries");
    }
  }

  const sqlForExecution =
    analyzed.separatorCount === 1 && analyzed.lastSeparatorIndex >= 0
      ? sqlText.slice(0, analyzed.lastSeparatorIndex).trim()
      : sqlText;

  if (!sqlForExecution) {
    throw httpError(400, "SQL statement is empty");
  }

  return {
    statementType,
    sqlForExecution,
  };
}

function buildWrappedSelectSql(sqlForExecution) {
  return `SELECT * FROM (${sqlForExecution}) AS admin_sql_executor_result LIMIT ${RESULT_LIMIT}`;
}

function normalizeExecutionError(error) {
  if (error?.status) {
    return error;
  }

  const code = toCleanText(error?.code).toUpperCase();
  const message = truncateText(error?.message || "SQL execution failed");

  if (code === "57014") {
    return httpError(408, `SQL statement timed out after ${STATEMENT_TIMEOUT_MS} ms`);
  }
  if (code === "25006") {
    return httpError(400, "SQL statement must remain read-only");
  }
  if (code) {
    return httpError(400, message || "SQL execution failed");
  }

  return httpError(500, message || "SQL execution failed");
}

async function writeSqlAuditLog({
  executedBy,
  statementType,
  sqlText,
  succeeded,
  resultRowCount,
  wasTruncated,
  executionMs,
  clientIp,
  errorMessage,
}) {
  try {
    await query(
      `
        INSERT INTO admin_sql_query_audits (
          executed_by,
          statement_type,
          sql_text,
          succeeded,
          result_row_count,
          was_truncated,
          execution_ms,
          statement_timeout_ms,
          row_cap,
          client_ip,
          error_message
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11
        )
      `,
      [
        executedBy,
        statementType,
        sqlText,
        succeeded,
        resultRowCount,
        wasTruncated,
        executionMs,
        STATEMENT_TIMEOUT_MS,
        ROW_CAP,
        clientIp || null,
        truncateText(errorMessage, 4000) || null,
      ]
    );
  } catch (auditError) {
    console.error("[admin-sql] failed to persist audit log", auditError);
  }
}

async function runReadOnlyQuery(statementType, sqlForExecution) {
  const client = await getClient();
  const startedAt = Date.now();

  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('statement_timeout', $1, true)", [
      String(STATEMENT_TIMEOUT_MS),
    ]);

    const result =
      statementType === "EXPLAIN"
        ? await client.query(sqlForExecution)
        : await client.query(buildWrappedSelectSql(sqlForExecution));

    await client.query("ROLLBACK");

    const rawRows = Array.isArray(result.rows) ? result.rows : [];
    const wasTruncated = rawRows.length > ROW_CAP;
    const rows = wasTruncated ? rawRows.slice(0, ROW_CAP) : rawRows;

    return {
      columns: Array.isArray(result.fields) ? result.fields.map((field) => field.name) : [],
      rows,
      resultRowCount: rows.length,
      wasTruncated,
      executionMs: Date.now() - startedAt,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback failures so the original SQL error can surface.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function executeSql(req, res) {
  const executedBy = toCleanText(req.user?.id);
  const clientIp = getClientIp(req);
  const sqlText = typeof req.body?.sql === "string" ? req.body.sql : req.body?.sql;
  let statementType = "UNKNOWN";
  let sqlForAudit = typeof sqlText === "string" ? sqlText.trim() : toCleanText(sqlText);

  try {
    const validated = validateAndPrepareSql(sqlText);
    statementType = validated.statementType;
    sqlForAudit = validated.sqlForExecution;

    const result = await runReadOnlyQuery(validated.statementType, validated.sqlForExecution);

    await writeSqlAuditLog({
      executedBy,
      statementType,
      sqlText: sqlForAudit,
      succeeded: true,
      resultRowCount: result.resultRowCount,
      wasTruncated: result.wasTruncated,
      executionMs: result.executionMs,
      clientIp,
      errorMessage: "",
    });

    return res.json({
      ok: true,
      statementType,
      statementTimeoutMs: STATEMENT_TIMEOUT_MS,
      rowCap: ROW_CAP,
      columns: result.columns,
      rows: result.rows,
      rowCount: result.resultRowCount,
      truncated: result.wasTruncated,
      executionMs: result.executionMs,
    });
  } catch (error) {
    const normalizedError = normalizeExecutionError(error);

    await writeSqlAuditLog({
      executedBy,
      statementType,
      sqlText: sqlForAudit,
      succeeded: false,
      resultRowCount: null,
      wasTruncated: false,
      executionMs: null,
      clientIp,
      errorMessage: normalizedError.message,
    });

    throw normalizedError;
  }
}
