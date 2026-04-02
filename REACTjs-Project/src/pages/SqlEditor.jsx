import { useEffect, useMemo, useState } from "react";
import { adminApi } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import "./SqlEditor.css";

const QUERY_HISTORY_STORAGE_KEY = "rx1011_admin_sql_history";
const MAX_HISTORY_ITEMS = 20;

function toCleanText(value) {
  return String(value ?? "").trim();
}

function normalizeRole(value) {
  return toCleanText(value).toUpperCase();
}

function readStoredHistory() {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(QUERY_HISTORY_STORAGE_KEY);
    const parsed = JSON.parse(rawValue || "[]");
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((entry, index) => ({
        id: toCleanText(entry?.id) || `history-${index}`,
        sql: toCleanText(entry?.sql),
        executedAt: toCleanText(entry?.executedAt),
        ok: Boolean(entry?.ok),
        statementType: toCleanText(entry?.statementType),
        rowCount: Number.isFinite(Number(entry?.rowCount)) ? Number(entry.rowCount) : null,
        truncated: Boolean(entry?.truncated),
        message: toCleanText(entry?.message),
      }))
      .filter((entry) => entry.sql)
      .slice(0, MAX_HISTORY_ITEMS);
  } catch {
    return [];
  }
}

function writeStoredHistory(history) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(QUERY_HISTORY_STORAGE_KEY, JSON.stringify(history));
}

function createHistoryEntry(sql, result, errorMessage) {
  const executedAt = new Date().toISOString();

  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sql,
    executedAt,
    ok: !errorMessage,
    statementType: toCleanText(result?.statementType),
    rowCount: Number.isFinite(Number(result?.rowCount)) ? Number(result.rowCount) : null,
    truncated: Boolean(result?.truncated),
    message: errorMessage ? toCleanText(errorMessage) : "",
  };
}

function buildHistoryPreview(sql) {
  const singleLine = toCleanText(sql).replace(/\s+/g, " ");
  if (singleLine.length <= 140) {
    return singleLine;
  }
  return `${singleLine.slice(0, 137)}...`;
}

function formatExecutedAt(value) {
  const text = toCleanText(value);
  if (!text) return "-";

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return text;
  }

  return new Intl.DateTimeFormat("th-TH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

function formatCellValue(value) {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getResultColumns(result) {
  if (Array.isArray(result?.columns) && result.columns.length) {
    return result.columns.map((column) => toCleanText(column)).filter(Boolean);
  }

  const firstRow = Array.isArray(result?.rows) ? result.rows[0] : null;
  if (!firstRow || typeof firstRow !== "object") {
    return [];
  }

  return Object.keys(firstRow);
}

export default function SqlEditor() {
  const { user } = useAuth();
  const [sqlText, setSqlText] = useState("");
  const [history, setHistory] = useState(() => readStoredHistory());
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);

  const resultColumns = useMemo(() => getResultColumns(result), [result]);
  const isAdmin = normalizeRole(user?.role) === "ADMIN";

  useEffect(() => {
    writeStoredHistory(history);
  }, [history]);

  function pushHistory(entry) {
    setHistory((previous) => {
      const next = [
        entry,
        ...previous.filter((item) => toCleanText(item?.sql) !== entry.sql),
      ].slice(0, MAX_HISTORY_ITEMS);
      return next;
    });
  }

  async function handleRun() {
    const sql = toCleanText(sqlText);
    if (!sql || isRunning) {
      return;
    }

    setIsRunning(true);
    setError("");
    setResult(null);

    try {
      const payload = await adminApi.executeSql(sql);
      setResult(payload);
      pushHistory(createHistoryEntry(sql, payload, ""));
    } catch (requestError) {
      const message = toCleanText(requestError?.message) || "ไม่สามารถรันคำสั่ง SQL ได้";
      setError(message);
      pushHistory(createHistoryEntry(sql, null, message));
    } finally {
      setIsRunning(false);
    }
  }

  function handleClear() {
    setSqlText("");
    setResult(null);
    setError("");
  }

  function handleEditorKeyDown(event) {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      void handleRun();
    }
  }

  return (
    <section className="sql-editor-page">
      <header className="sql-editor-header">
        <div>
          <p className="sql-editor-eyebrow">Admin Tools</p>
          <h1>SQL Editor</h1>
          <p>
            รันคำสั่งอ่านข้อมูลผ่าน backend ที่จำกัดสิทธิ์เฉพาะ admin พร้อม timeout,
            row cap และ audit logging
          </p>
        </div>
        <div className="sql-editor-session-card" aria-label="ข้อมูลผู้ใช้งาน">
          <strong>{toCleanText(user?.username) || "ADMIN"}</strong>
          <span>{isAdmin ? "สิทธิ์ ADMIN" : "ไม่มีสิทธิ์ใช้งาน"}</span>
        </div>
      </header>

      <div className="sql-editor-grid">
        <div className="sql-editor-main">
          <section className="sql-editor-card">
            <div className="sql-editor-card-header">
              <div>
                <h2>Query</h2>
                <p>
                  รองรับเฉพาะ <code>SELECT</code>, <code>WITH</code>, และ <code>EXPLAIN</code>
                </p>
              </div>
              <div className="sql-editor-toolbar">
                <button
                  type="button"
                  className="sql-editor-button"
                  onClick={handleClear}
                  disabled={isRunning}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="sql-editor-button sql-editor-button--primary"
                  onClick={() => void handleRun()}
                  disabled={isRunning || !toCleanText(sqlText)}
                >
                  {isRunning ? "Running..." : "Run"}
                </button>
              </div>
            </div>

            <textarea
              className="sql-editor-textarea"
              value={sqlText}
              onChange={(event) => setSqlText(event.target.value)}
              onKeyDown={handleEditorKeyDown}
              spellCheck="false"
              placeholder={[
                "-- ตัวอย่าง",
                "select now() as server_time;",
                "",
                "-- กด Ctrl/Cmd + Enter เพื่อรัน",
              ].join("\n")}
              aria-label="SQL query editor"
            />

            <p className="sql-editor-help">
              ระบบจะบันทึก query history ไว้ในเครื่องนี้ผ่าน localStorage และผลลัพธ์จะถูกตัดตาม
              row cap ของ backend อัตโนมัติ
            </p>
          </section>

          <section className="sql-editor-card">
            <div className="sql-editor-card-header">
              <div>
                <h2>Results</h2>
                <p>ผลลัพธ์จาก endpoint `/api/admin/sql/execute`</p>
              </div>
              {result ? (
                <div className="sql-editor-result-meta">
                  <span>{toCleanText(result?.statementType) || "QUERY"}</span>
                  <span>{Number(result?.rowCount || 0)} rows</span>
                  <span>{Number(result?.executionMs || 0)} ms</span>
                  {result?.truncated ? <span>truncated</span> : null}
                </div>
              ) : null}
            </div>

            {isRunning ? (
              <div className="sql-editor-state sql-editor-state--loading">กำลังรันคำสั่ง...</div>
            ) : error ? (
              <div className="sql-editor-state sql-editor-state--error">{error}</div>
            ) : result ? (
              <>
                <div className="sql-editor-result-summary">
                  <span>Statement timeout: {Number(result?.statementTimeoutMs || 0)} ms</span>
                  <span>Row cap: {Number(result?.rowCap || 0)}</span>
                </div>
                {Array.isArray(result?.rows) && result.rows.length ? (
                  <div className="sql-editor-table-wrap">
                    <table className="sql-editor-table">
                      <thead>
                        <tr>
                          {resultColumns.map((column) => (
                            <th key={column}>{column}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.rows.map((row, rowIndex) => (
                          <tr key={`row-${rowIndex}`}>
                            {resultColumns.map((column) => (
                              <td key={`${rowIndex}-${column}`}>
                                <code>{formatCellValue(row?.[column])}</code>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="sql-editor-state">คำสั่งสำเร็จ แต่ไม่มีแถวข้อมูลส่งกลับ</div>
                )}
              </>
            ) : (
              <div className="sql-editor-state">ยังไม่มีผลลัพธ์ ลองรัน query ทางด้านบน</div>
            )}
          </section>
        </div>

        <aside className="sql-editor-side">
          <section className="sql-editor-card">
            <div className="sql-editor-card-header">
              <div>
                <h2>History</h2>
                <p>เก็บไว้ใน browser เครื่องนี้เท่านั้น</p>
              </div>
            </div>

            {history.length ? (
              <div className="sql-editor-history-list">
                {history.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="sql-editor-history-item"
                    onClick={() => setSqlText(entry.sql)}
                    title={entry.sql}
                  >
                    <div className="sql-editor-history-row">
                      <strong>{entry.ok ? "Success" : "Error"}</strong>
                      <span>{formatExecutedAt(entry.executedAt)}</span>
                    </div>
                    <code>{buildHistoryPreview(entry.sql)}</code>
                    <div className="sql-editor-history-row sql-editor-history-row--muted">
                      <span>{entry.statementType || "QUERY"}</span>
                      <span>
                        {entry.rowCount === null ? entry.message || "-" : `${entry.rowCount} rows`}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="sql-editor-state">ยังไม่มีประวัติการรัน query</div>
            )}
          </section>
        </aside>
      </div>
    </section>
  );
}
