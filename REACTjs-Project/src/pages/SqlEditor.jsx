import { useCallback, useEffect, useMemo, useState } from "react";
import { adminApi } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import "./SqlEditor.css";

const QUERY_HISTORY_STORAGE_KEY = "rx1011_admin_sql_history";
const MAX_HISTORY_ITEMS = 20;
const TABLE_ROW_LIMIT_OPTIONS = [50, 100, 200, 500];
const DIAGRAM_NODE_WIDTH = 280;
const DIAGRAM_NODE_HEIGHT = 190;
const DIAGRAM_COLUMN_GAP = 110;
const DIAGRAM_ROW_GAP = 90;
const DIAGRAM_PADDING = 36;

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

function formatApproxCount(value) {
  const count = Number(value || 0);
  if (!Number.isFinite(count) || count <= 0) return "0";
  return new Intl.NumberFormat("th-TH", {
    notation: count >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(count);
}

function quoteSqlIdentifier(value) {
  return `"${toCleanText(value).replace(/"/g, '""')}"`;
}

function buildSelectSql(tableName, limit = 100) {
  const safeLimit = Number.isFinite(Number(limit)) ? Number(limit) : 100;
  return `select *\nfrom public.${quoteSqlIdentifier(tableName)}\nlimit ${safeLimit};`;
}

function normalizeSchemaTable(table) {
  const name = toCleanText(table?.name);
  return {
    ...table,
    name,
    columns: Array.isArray(table?.columns) ? table.columns : [],
    primaryKeyColumns: Array.isArray(table?.primaryKeyColumns) ? table.primaryKeyColumns : [],
    indexes: Array.isArray(table?.indexes) ? table.indexes : [],
    rowEstimate: Number(table?.rowEstimate || 0),
    foreignKeyCount: Number(table?.foreignKeyCount || 0),
  };
}

function filterTables(tables, searchTerm) {
  const term = toCleanText(searchTerm).toLowerCase();
  const normalized = (Array.isArray(tables) ? tables : []).map(normalizeSchemaTable);
  if (!term) return normalized;
  return normalized.filter((table) => {
    const haystack = [
      table.name,
      table.comment,
      ...table.columns.map((column) => `${column?.name || ""} ${column?.type || ""}`),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
}

function getColumnBadges(column) {
  const badges = [];
  if (column?.isPrimaryKey) badges.push("PK");
  if (column?.isForeignKey) badges.push("FK");
  if (Array.isArray(column?.uniqueConstraints) && column.uniqueConstraints.length) {
    badges.push("UNIQUE");
  }
  if (column?.isNullable === false) badges.push("NOT NULL");
  return badges;
}

function buildDiagramLayout(tables, relationships, selectedTableName) {
  const visibleTables = (Array.isArray(tables) ? tables : []).map(normalizeSchemaTable);
  const tableNames = new Set(visibleTables.map((table) => table.name));
  const visibleRelationships = (Array.isArray(relationships) ? relationships : []).filter(
    (relationship) =>
      tableNames.has(toCleanText(relationship?.sourceTable)) &&
      tableNames.has(toCleanText(relationship?.targetTable))
  );
  const connected = new Set();
  visibleRelationships.forEach((relationship) => {
    connected.add(toCleanText(relationship.sourceTable));
    connected.add(toCleanText(relationship.targetTable));
  });
  const sortedTables = [...visibleTables].sort((left, right) => {
    const leftSelected = left.name === selectedTableName ? 0 : 1;
    const rightSelected = right.name === selectedTableName ? 0 : 1;
    if (leftSelected !== rightSelected) return leftSelected - rightSelected;
    const leftConnected = connected.has(left.name) ? 0 : 1;
    const rightConnected = connected.has(right.name) ? 0 : 1;
    if (leftConnected !== rightConnected) return leftConnected - rightConnected;
    return left.name.localeCompare(right.name);
  });

  const columns = sortedTables.length <= 2 ? Math.max(sortedTables.length, 1) : 3;
  const positions = new Map();
  sortedTables.forEach((table, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    positions.set(table.name, {
      x: DIAGRAM_PADDING + column * (DIAGRAM_NODE_WIDTH + DIAGRAM_COLUMN_GAP),
      y: DIAGRAM_PADDING + row * (DIAGRAM_NODE_HEIGHT + DIAGRAM_ROW_GAP),
    });
  });

  const rows = Math.max(Math.ceil(sortedTables.length / columns), 1);
  const width =
    DIAGRAM_PADDING * 2 +
    columns * DIAGRAM_NODE_WIDTH +
    Math.max(columns - 1, 0) * DIAGRAM_COLUMN_GAP;
  const height =
    DIAGRAM_PADDING * 2 +
    rows * DIAGRAM_NODE_HEIGHT +
    Math.max(rows - 1, 0) * DIAGRAM_ROW_GAP;
  const selectedRelations = new Set();
  visibleRelationships.forEach((relationship) => {
    if (
      selectedTableName &&
      (relationship.sourceTable === selectedTableName || relationship.targetTable === selectedTableName)
    ) {
      selectedRelations.add(relationship.constraintName);
    }
  });

  return {
    width,
    height,
    tables: sortedTables.map((table) => ({
      ...table,
      position: positions.get(table.name),
      highlighted:
        !selectedTableName ||
        table.name === selectedTableName ||
        visibleRelationships.some(
          (relationship) =>
            relationship.constraintName &&
            selectedRelations.has(relationship.constraintName) &&
            (relationship.sourceTable === table.name || relationship.targetTable === table.name)
        ),
    })),
    relationships: visibleRelationships
      .map((relationship) => {
        const source = positions.get(toCleanText(relationship.sourceTable));
        const target = positions.get(toCleanText(relationship.targetTable));
        if (!source || !target) return null;

        const sourceRight = source.x + DIAGRAM_NODE_WIDTH;
        const targetLeft = target.x;
        const sourceCenter = {
          x: source.x + DIAGRAM_NODE_WIDTH / 2,
          y: source.y + DIAGRAM_NODE_HEIGHT / 2,
        };
        const targetCenter = {
          x: target.x + DIAGRAM_NODE_WIDTH / 2,
          y: target.y + DIAGRAM_NODE_HEIGHT / 2,
        };
        const sourcePoint =
          sourceCenter.x <= targetCenter.x
            ? { x: sourceRight, y: sourceCenter.y }
            : { x: source.x, y: sourceCenter.y };
        const targetPoint =
          sourceCenter.x <= targetCenter.x
            ? { x: targetLeft, y: targetCenter.y }
            : { x: target.x + DIAGRAM_NODE_WIDTH, y: targetCenter.y };
        const curve = Math.max(Math.abs(targetPoint.x - sourcePoint.x) / 2, 48);
        const path = [
          `M ${sourcePoint.x} ${sourcePoint.y}`,
          `C ${sourcePoint.x + curve} ${sourcePoint.y}, ${targetPoint.x - curve} ${targetPoint.y}, ${targetPoint.x} ${targetPoint.y}`,
        ].join(" ");
        return {
          ...relationship,
          path,
          highlighted:
            !selectedTableName ||
            relationship.sourceTable === selectedTableName ||
            relationship.targetTable === selectedTableName,
        };
      })
      .filter(Boolean),
  };
}

export default function SqlEditor() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState("tables");
  const [sqlText, setSqlText] = useState("");
  const [history, setHistory] = useState(() => readStoredHistory());
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [schema, setSchema] = useState(null);
  const [schemaError, setSchemaError] = useState("");
  const [isLoadingSchema, setIsLoadingSchema] = useState(false);
  const [tableSearch, setTableSearch] = useState("");
  const [selectedTableName, setSelectedTableName] = useState("");
  const [tableRowsResult, setTableRowsResult] = useState(null);
  const [tableRowsError, setTableRowsError] = useState("");
  const [isLoadingTableRows, setIsLoadingTableRows] = useState(false);
  const [tableRowLimit, setTableRowLimit] = useState(100);
  const [tableRowOffset, setTableRowOffset] = useState(0);
  const [tableSort, setTableSort] = useState({ orderBy: "", order: "ASC" });
  const [diagramSearch, setDiagramSearch] = useState("");
  const [selectedDiagramTable, setSelectedDiagramTable] = useState("");

  const resultColumns = useMemo(() => getResultColumns(result), [result]);
  const isAdmin = normalizeRole(user?.role) === "ADMIN";
  const schemaTables = useMemo(
    () => (Array.isArray(schema?.tables) ? schema.tables.map(normalizeSchemaTable) : []),
    [schema]
  );
  const filteredTables = useMemo(
    () => filterTables(schemaTables, tableSearch),
    [schemaTables, tableSearch]
  );
  const selectedTable = useMemo(
    () => schemaTables.find((table) => table.name === selectedTableName) || null,
    [schemaTables, selectedTableName]
  );
  const diagramTables = useMemo(
    () => filterTables(schemaTables, diagramSearch),
    [schemaTables, diagramSearch]
  );
  const diagramLayout = useMemo(
    () => buildDiagramLayout(diagramTables, schema?.relationships || [], selectedDiagramTable),
    [diagramTables, schema, selectedDiagramTable]
  );
  const tableRowsColumns = useMemo(() => getResultColumns(tableRowsResult), [tableRowsResult]);
  const selectedTableRelationships = useMemo(() => {
    const relationships = Array.isArray(schema?.relationships) ? schema.relationships : [];
    if (!selectedTableName) return [];
    return relationships.filter(
      (relationship) =>
        relationship.sourceTable === selectedTableName || relationship.targetTable === selectedTableName
    );
  }, [schema, selectedTableName]);

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

  const loadSchema = useCallback(async () => {
    if (!isAdmin) return;

    setIsLoadingSchema(true);
    setSchemaError("");
    try {
      const payload = await adminApi.databaseSchema();
      const nextTables = Array.isArray(payload?.tables)
        ? payload.tables.map(normalizeSchemaTable)
        : [];
      setSchema({
        ...payload,
        tables: nextTables,
        relationships: Array.isArray(payload?.relationships) ? payload.relationships : [],
      });
      setSelectedTableName((previous) =>
        previous && nextTables.some((table) => table.name === previous)
          ? previous
          : nextTables[0]?.name || ""
      );
      setSelectedDiagramTable((previous) =>
        previous && nextTables.some((table) => table.name === previous)
          ? previous
          : nextTables[0]?.name || ""
      );
    } catch (requestError) {
      setSchemaError(toCleanText(requestError?.message) || "โหลด schema ไม่สำเร็จ");
    } finally {
      setIsLoadingSchema(false);
    }
  }, [isAdmin]);

  const loadTableRows = useCallback(async () => {
    if (!selectedTableName || !isAdmin) return;

    setIsLoadingTableRows(true);
    setTableRowsError("");
    try {
      const payload = await adminApi.tableRows(selectedTableName, {
        limit: tableRowLimit,
        offset: tableRowOffset,
        orderBy: tableSort.orderBy,
        order: tableSort.order,
      });
      setTableRowsResult(payload);
      setTableSort({
        orderBy: toCleanText(payload?.orderBy),
        order: toCleanText(payload?.order).toUpperCase() || "ASC",
      });
    } catch (requestError) {
      setTableRowsResult(null);
      setTableRowsError(toCleanText(requestError?.message) || "โหลดข้อมูลตารางไม่สำเร็จ");
    } finally {
      setIsLoadingTableRows(false);
    }
  }, [isAdmin, selectedTableName, tableRowLimit, tableRowOffset, tableSort.order, tableSort.orderBy]);

  useEffect(() => {
    void loadSchema();
  }, [loadSchema]);

  useEffect(() => {
    if (activeTab !== "tables") return;
    void loadTableRows();
  }, [activeTab, loadTableRows]);

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

  function handleSelectTable(tableName) {
    const nextTableName = toCleanText(tableName);
    setSelectedTableName(nextTableName);
    setSelectedDiagramTable(nextTableName);
    setTableRowOffset(0);
    setTableSort({ orderBy: "", order: "ASC" });
  }

  function handleUseSelectSql(tableName = selectedTableName) {
    if (!tableName) return;
    setSqlText(buildSelectSql(tableName, tableRowLimit));
    setActiveTab("sql");
  }

  function handleSortTableRows(columnName) {
    const nextColumn = toCleanText(columnName);
    if (!nextColumn) return;

    setTableRowOffset(0);
    setTableSort((previous) => ({
      orderBy: nextColumn,
      order:
        previous.orderBy === nextColumn && toCleanText(previous.order).toUpperCase() === "ASC"
          ? "DESC"
          : "ASC",
    }));
  }

  function handlePreviousRowsPage() {
    setTableRowOffset((previous) => Math.max(Number(previous || 0) - tableRowLimit, 0));
  }

  function handleNextRowsPage() {
    if (!tableRowsResult?.hasMore) return;
    setTableRowOffset((previous) => Number(previous || 0) + tableRowLimit);
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
          <h1>Database Workspace</h1>
          <p>
            เปิดดูตาราง, relationships และรัน read-only SQL ผ่าน backend ที่จำกัดสิทธิ์เฉพาะ admin
          </p>
        </div>
        <div className="sql-editor-session-card" aria-label="ข้อมูลผู้ใช้งาน">
          <strong>{toCleanText(user?.username) || "ADMIN"}</strong>
          <span>{isAdmin ? "สิทธิ์ ADMIN" : "ไม่มีสิทธิ์ใช้งาน"}</span>
        </div>
      </header>

      <nav className="sql-editor-tabs" aria-label="Database workspace tabs">
        {[
          ["tables", "Tables"],
          ["diagram", "Diagram"],
          ["sql", "SQL"],
        ].map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            className={`sql-editor-tab${activeTab === tab ? " is-active" : ""}`}
            onClick={() => setActiveTab(tab)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="sql-editor-button sql-editor-button--compact"
          onClick={() => void loadSchema()}
          disabled={isLoadingSchema}
        >
          {isLoadingSchema ? "Refreshing..." : "Refresh schema"}
        </button>
      </nav>

      {schemaError ? (
        <div className="sql-editor-state sql-editor-state--error">{schemaError}</div>
      ) : null}

      {activeTab === "tables" ? (
        <div className="sql-browser-grid">
          <aside className="sql-editor-card sql-browser-sidebar">
            <div className="sql-editor-card-header">
              <div>
                <h2>Tables</h2>
                <p>{schemaTables.length} objects in public schema</p>
              </div>
            </div>
            <input
              className="sql-editor-input"
              type="search"
              value={tableSearch}
              onChange={(event) => setTableSearch(event.target.value)}
              placeholder="ค้นหาตารางหรือ column"
              aria-label="ค้นหาตาราง"
            />
            <div className="sql-table-list">
              {filteredTables.length ? (
                filteredTables.map((table) => (
                  <button
                    key={table.name}
                    type="button"
                    className={`sql-table-list-item${
                      table.name === selectedTableName ? " is-selected" : ""
                    }`}
                    onClick={() => handleSelectTable(table.name)}
                  >
                    <strong>{table.name}</strong>
                    <span>
                      {table.columns.length} columns · ~{formatApproxCount(table.rowEstimate)} rows
                    </span>
                  </button>
                ))
              ) : (
                <div className="sql-editor-state">ไม่พบตารางที่ตรงกับคำค้น</div>
              )}
            </div>
          </aside>

          <div className="sql-editor-main">
            <section className="sql-editor-card">
              <div className="sql-editor-card-header">
                <div>
                  <h2>{selectedTable?.name || "เลือกตาราง"}</h2>
                  <p>
                    {selectedTable
                      ? `${selectedTable.kind} · ${selectedTable.columns.length} columns · ${selectedTable.foreignKeyCount} foreign keys`
                      : "เลือกตารางทางซ้ายเพื่อดู metadata และ rows"}
                  </p>
                </div>
                <div className="sql-editor-toolbar">
                  <select
                    className="sql-editor-select"
                    value={tableRowLimit}
                    onChange={(event) => {
                      setTableRowLimit(Number(event.target.value));
                      setTableRowOffset(0);
                    }}
                  >
                    {TABLE_ROW_LIMIT_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value} rows
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="sql-editor-button"
                    onClick={() => handleUseSelectSql()}
                    disabled={!selectedTableName}
                  >
                    Open as SQL
                  </button>
                  <button
                    type="button"
                    className="sql-editor-button sql-editor-button--primary"
                    onClick={() => void loadTableRows()}
                    disabled={!selectedTableName || isLoadingTableRows}
                  >
                    {isLoadingTableRows ? "Loading..." : "Reload rows"}
                  </button>
                </div>
              </div>

              {selectedTable ? (
                <>
                  <div className="sql-column-grid">
                    {selectedTable.columns.map((column) => (
                      <div key={column.name} className="sql-column-chip">
                        <div>
                          <strong>{column.name}</strong>
                          <code>{column.type}</code>
                        </div>
                        <div className="sql-column-badges">
                          {getColumnBadges(column).map((badge) => (
                            <span key={badge}>{badge}</span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedTableRelationships.length ? (
                    <div className="sql-relationship-strip">
                      {selectedTableRelationships.map((relationship) => (
                        <button
                          type="button"
                          key={`${relationship.constraintName}-${relationship.sourceColumn}`}
                          onClick={() => {
                            setSelectedDiagramTable(
                              relationship.sourceTable === selectedTableName
                                ? relationship.targetTable
                                : relationship.sourceTable
                            );
                            setActiveTab("diagram");
                          }}
                        >
                          <code>{relationship.sourceTable}.{relationship.sourceColumn}</code>
                          <span>→</span>
                          <code>{relationship.targetTable}.{relationship.targetColumn}</code>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="sql-editor-state">ยังไม่มีตารางที่เลือก</div>
              )}
            </section>

            <section className="sql-editor-card">
              <div className="sql-editor-card-header">
                <div>
                  <h2>Rows</h2>
                  <p>
                    {tableRowsResult
                      ? `offset ${Number(tableRowsResult.offset || 0)} · ${Number(
                          tableRowsResult.executionMs || 0
                        )} ms`
                      : "ข้อมูลจาก read-only table browser endpoint"}
                  </p>
                </div>
                <div className="sql-editor-result-meta">
                  {tableRowsResult?.orderBy ? (
                    <span>
                      sort {tableRowsResult.orderBy} {tableRowsResult.order}
                    </span>
                  ) : null}
                  {tableRowsResult ? <span>{Number(tableRowsResult.rowCount || 0)} rows</span> : null}
                </div>
              </div>

              {isLoadingTableRows ? (
                <div className="sql-editor-state sql-editor-state--loading">กำลังโหลด rows...</div>
              ) : tableRowsError ? (
                <div className="sql-editor-state sql-editor-state--error">{tableRowsError}</div>
              ) : tableRowsResult && Array.isArray(tableRowsResult.rows) ? (
                <>
                  {tableRowsResult.rows.length ? (
                    <div className="sql-editor-table-wrap sql-browser-table-wrap">
                      <table className="sql-editor-table">
                        <thead>
                          <tr>
                            {tableRowsColumns.map((column) => (
                              <th key={column}>
                                <button
                                  type="button"
                                  className="sql-sort-button"
                                  onClick={() => handleSortTableRows(column)}
                                >
                                  {column}
                                  {tableRowsResult.orderBy === column ? (
                                    <span>{tableRowsResult.order === "DESC" ? "DESC" : "ASC"}</span>
                                  ) : null}
                                </button>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {tableRowsResult.rows.map((row, rowIndex) => (
                            <tr key={`table-row-${rowIndex}`}>
                              {tableRowsColumns.map((column) => (
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
                    <div className="sql-editor-state">ตารางนี้ยังไม่มี rows ในช่วงที่เลือก</div>
                  )}
                  <div className="sql-pagination">
                    <button
                      type="button"
                      className="sql-editor-button"
                      onClick={handlePreviousRowsPage}
                      disabled={tableRowOffset <= 0 || isLoadingTableRows}
                    >
                      Previous
                    </button>
                    <span>
                      {tableRowOffset + 1} - {tableRowOffset + Number(tableRowsResult.rowCount || 0)}
                    </span>
                    <button
                      type="button"
                      className="sql-editor-button"
                      onClick={handleNextRowsPage}
                      disabled={!tableRowsResult.hasMore || isLoadingTableRows}
                    >
                      Next
                    </button>
                  </div>
                </>
              ) : (
                <div className="sql-editor-state">เลือกตารางเพื่อโหลด rows</div>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {activeTab === "diagram" ? (
        <div className="sql-editor-card sql-diagram-panel">
          <div className="sql-editor-card-header">
            <div>
              <h2>Relational Diagram</h2>
              <p>
                แสดง primary key, foreign key, column type และเส้นความสัมพันธ์ของ public schema
              </p>
            </div>
            <div className="sql-editor-toolbar">
              <input
                className="sql-editor-input sql-editor-input--compact"
                type="search"
                value={diagramSearch}
                onChange={(event) => setDiagramSearch(event.target.value)}
                placeholder="ค้นหา table/column"
                aria-label="ค้นหาใน diagram"
              />
              <select
                className="sql-editor-select"
                value={selectedDiagramTable}
                onChange={(event) => setSelectedDiagramTable(event.target.value)}
              >
                <option value="">All relationships</option>
                {schemaTables.map((table) => (
                  <option key={table.name} value={table.name}>
                    {table.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isLoadingSchema ? (
            <div className="sql-editor-state sql-editor-state--loading">กำลังโหลด schema...</div>
          ) : diagramLayout.tables.length ? (
            <div className="sql-diagram-scroll">
              <div
                className="sql-diagram-canvas"
                style={{
                  width: `${diagramLayout.width}px`,
                  height: `${diagramLayout.height}px`,
                }}
              >
                <svg
                  className="sql-diagram-edges"
                  width={diagramLayout.width}
                  height={diagramLayout.height}
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="sql-diagram-arrow"
                      viewBox="0 0 10 10"
                      refX="8"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 0 L 10 5 L 0 10 z" />
                    </marker>
                  </defs>
                  {diagramLayout.relationships.map((relationship) => (
                    <path
                      key={`${relationship.constraintName}-${relationship.sourceColumn}`}
                      className={`sql-diagram-edge${relationship.highlighted ? " is-highlighted" : ""}`}
                      d={relationship.path}
                      markerEnd="url(#sql-diagram-arrow)"
                    />
                  ))}
                </svg>

                {diagramLayout.tables.map((table) => (
                  <button
                    key={table.name}
                    type="button"
                    className={`sql-diagram-node${table.highlighted ? " is-highlighted" : ""}${
                      table.name === selectedDiagramTable ? " is-selected" : ""
                    }`}
                    style={{
                      left: `${table.position.x}px`,
                      top: `${table.position.y}px`,
                      width: `${DIAGRAM_NODE_WIDTH}px`,
                      height: `${DIAGRAM_NODE_HEIGHT}px`,
                    }}
                    onClick={() => {
                      setSelectedDiagramTable(table.name);
                      setSelectedTableName(table.name);
                    }}
                  >
                    <div className="sql-diagram-node-header">
                      <strong>{table.name}</strong>
                      <span>{table.columns.length} cols</span>
                    </div>
                    <div className="sql-diagram-node-columns">
                      {table.columns.slice(0, 7).map((column) => (
                        <div key={column.name}>
                          <span>
                            {column.isPrimaryKey ? "PK " : ""}
                            {column.isForeignKey ? "FK " : ""}
                            {column.name}
                          </span>
                          <code>{column.type}</code>
                        </div>
                      ))}
                      {table.columns.length > 7 ? (
                        <div>
                          <span>+{table.columns.length - 7} columns</span>
                          <code />
                        </div>
                      ) : null}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="sql-editor-state">ไม่พบ schema ที่นำมาวาด diagram ได้</div>
          )}

          {diagramLayout.relationships.length ? (
            <div className="sql-diagram-legend">
              {diagramLayout.relationships
                .filter((relationship) => relationship.highlighted)
                .slice(0, 12)
                .map((relationship) => (
                  <button
                    key={`legend-${relationship.constraintName}-${relationship.sourceColumn}`}
                    type="button"
                    onClick={() => {
                      setSelectedTableName(relationship.sourceTable);
                      setActiveTab("tables");
                    }}
                  >
                    <code>{relationship.sourceTable}.{relationship.sourceColumn}</code>
                    <span>references</span>
                    <code>{relationship.targetTable}.{relationship.targetColumn}</code>
                  </button>
                ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "sql" ? (
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
                ระบบจะบันทึก query history ไว้ในเครื่องนี้ผ่าน localStorage และผลลัพธ์จะถูกตัดตาม row cap
                ของ backend อัตโนมัติ
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
      ) : null}
    </section>
  );
}
