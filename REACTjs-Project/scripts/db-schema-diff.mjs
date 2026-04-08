import { Pool } from "pg";
import {
  describeDatabaseTarget,
  formatDatabaseTarget,
  loadMigrationEnvironment,
  parseCliArgs,
} from "./db-migration-helpers.mjs";

function normalizeSql(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

async function createPool(databaseUrl) {
  const target = describeDatabaseTarget(databaseUrl);
  const parsed = new URL(databaseUrl);
  return new Pool({
    host: parsed.hostname,
    port: Number(parsed.port || (target.isLoopback ? 5432 : 5432)),
    user: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "") || ""),
    ssl: target.isLoopback ? false : { rejectUnauthorized: false },
  });
}

async function readSchemaSnapshot(pool) {
  const [tablesResult, columnsResult, indexesResult, constraintsResult, extensionResult] =
    await Promise.all([
      pool.query(`
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
        ORDER BY c.relname
      `),
      pool.query(`
        SELECT
          c.relname AS table_name,
          a.attname AS column_name,
          a.attnum AS ordinal_position,
          pg_catalog.format_type(a.atttypid, a.atttypmod) AS formatted_type,
          NOT a.attnotnull AS is_nullable,
          COALESCE(pg_get_expr(def.adbin, def.adrelid), '') AS default_expr
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_attrdef def ON def.adrelid = a.attrelid AND def.adnum = a.attnum
        WHERE n.nspname = 'public'
          AND c.relkind = 'r'
          AND a.attnum > 0
          AND NOT a.attisdropped
        ORDER BY c.relname, a.attnum
      `),
      pool.query(`
        SELECT
          tablename AS table_name,
          indexname AS index_name,
          indexdef AS index_definition
        FROM pg_indexes
        WHERE schemaname = 'public'
        ORDER BY tablename, indexname
      `),
      pool.query(`
        SELECT
          rel.relname AS table_name,
          con.conname AS constraint_name,
          con.contype AS constraint_type,
          pg_get_constraintdef(con.oid, true) AS constraint_definition
        FROM pg_constraint con
        JOIN pg_class rel ON rel.oid = con.conrelid
        JOIN pg_namespace n ON n.oid = rel.relnamespace
        WHERE n.nspname = 'public'
        ORDER BY rel.relname, con.conname
      `),
      pool.query(`
        SELECT extname
        FROM pg_extension
        ORDER BY extname
      `),
    ]);

  return {
    tables: tablesResult.rows.map((row) => row.table_name),
    columns: columnsResult.rows.map((row) => ({
      tableName: row.table_name,
      columnName: row.column_name,
      ordinalPosition: Number(row.ordinal_position),
      formattedType: normalizeSql(row.formatted_type),
      isNullable: Boolean(row.is_nullable),
      defaultExpr: normalizeSql(row.default_expr),
    })),
    indexes: indexesResult.rows.map((row) => ({
      tableName: row.table_name,
      indexName: row.index_name,
      indexDefinition: normalizeSql(row.index_definition),
    })),
    constraints: constraintsResult.rows.map((row) => ({
      tableName: row.table_name,
      constraintName: row.constraint_name,
      constraintType: row.constraint_type,
      constraintDefinition: normalizeSql(row.constraint_definition),
    })),
    extensions: extensionResult.rows.map((row) => row.extname),
  };
}

function buildMap(rows, keyBuilder) {
  const map = new Map();
  for (const row of rows) {
    map.set(keyBuilder(row), row);
  }
  return map;
}

function diffNamedObjects(leftRows, rightRows, keyBuilder, compareFields) {
  const leftMap = buildMap(leftRows, keyBuilder);
  const rightMap = buildMap(rightRows, keyBuilder);
  const keys = sortedUnique([...leftMap.keys(), ...rightMap.keys()]);
  const onlyLeft = [];
  const onlyRight = [];
  const differing = [];

  for (const key of keys) {
    const left = leftMap.get(key);
    const right = rightMap.get(key);

    if (left && !right) {
      onlyLeft.push(left);
      continue;
    }
    if (!left && right) {
      onlyRight.push(right);
      continue;
    }

    const fieldDiffs = compareFields
      .map(({ label, accessor }) => {
        const leftValue = accessor(left);
        const rightValue = accessor(right);
        return leftValue === rightValue
          ? null
          : {
              label,
              leftValue,
              rightValue,
            };
      })
      .filter(Boolean);

    if (fieldDiffs.length) {
      differing.push({
        key,
        left,
        right,
        fieldDiffs,
      });
    }
  }

  return {
    onlyLeft,
    onlyRight,
    differing,
  };
}

function buildSchemaDiff(leftSnapshot, rightSnapshot) {
  const tableDiff = diffNamedObjects(
    leftSnapshot.tables.map((tableName) => ({ tableName })),
    rightSnapshot.tables.map((tableName) => ({ tableName })),
    (row) => row.tableName,
    []
  );

  const columnDiff = diffNamedObjects(
    leftSnapshot.columns,
    rightSnapshot.columns,
    (row) => `${row.tableName}.${row.columnName}`,
    [
      { label: "type", accessor: (row) => row.formattedType },
      { label: "nullable", accessor: (row) => row.isNullable },
      { label: "default", accessor: (row) => row.defaultExpr },
      { label: "ordinal_position", accessor: (row) => row.ordinalPosition },
    ]
  );

  const indexDiff = diffNamedObjects(
    leftSnapshot.indexes,
    rightSnapshot.indexes,
    (row) => row.indexName,
    [{ label: "definition", accessor: (row) => row.indexDefinition }]
  );

  const constraintDiff = diffNamedObjects(
    leftSnapshot.constraints,
    rightSnapshot.constraints,
    (row) => `${row.tableName}.${row.constraintName}`,
    [
      { label: "type", accessor: (row) => row.constraintType },
      { label: "definition", accessor: (row) => row.constraintDefinition },
    ]
  );

  const leftExtensions = new Set(leftSnapshot.extensions);
  const rightExtensions = new Set(rightSnapshot.extensions);
  const extensionDiff = {
    onlyLeft: leftSnapshot.extensions.filter((ext) => !rightExtensions.has(ext)),
    onlyRight: rightSnapshot.extensions.filter((ext) => !leftExtensions.has(ext)),
  };

  return {
    tables: tableDiff,
    columns: columnDiff,
    indexes: indexDiff,
    constraints: constraintDiff,
    extensions: extensionDiff,
  };
}

function summarizeKeyMigrationPresence(snapshot) {
  const tableSet = new Set(snapshot.tables);
  const columnSet = new Set(snapshot.columns.map((row) => `${row.tableName}.${row.columnName}`));

  return [
    {
      migration: "0020_admin_incident_reports.sql",
      ok: tableSet.has("incident_reports") && tableSet.has("incident_report_items"),
      details: "incident_reports + incident_report_items",
    },
    {
      migration: "0022_incident_report_resolution_actions.sql",
      ok: tableSet.has("incident_report_resolution_actions"),
      details: "incident_report_resolution_actions",
    },
    {
      migration: "0019_product_lot_edit_audits.sql",
      ok: tableSet.has("product_lot_edit_audits"),
      details: "product_lot_edit_audits",
    },
    {
      migration: "0017_product_lot_allowed_unit_levels.sql",
      ok: tableSet.has("product_lot_allowed_unit_levels"),
      details: "product_lot_allowed_unit_levels",
    },
    {
      migration: "0021_product_report_receive_unit_levels.sql",
      ok: columnSet.has("products.report_receive_unit_level_id"),
      details: "products.report_receive_unit_level_id",
    },
  ];
}

function printSummary({ leftLabel, leftTarget, rightLabel, rightTarget, diff, leftPresence, rightPresence }) {
  console.log(`[db:schema:diff] left: ${leftLabel} => ${formatDatabaseTarget(leftTarget)}`);
  console.log(`[db:schema:diff] right: ${rightLabel} => ${formatDatabaseTarget(rightTarget)}`);
  console.log(
    `[db:schema:diff] tables only in ${leftLabel}: ${diff.tables.onlyLeft.length}; only in ${rightLabel}: ${diff.tables.onlyRight.length}; differing shared columns: ${diff.columns.differing.length}; differing shared indexes: ${diff.indexes.differing.length}; differing shared constraints: ${diff.constraints.differing.length}`
  );

  for (const probe of leftPresence) {
    const rightProbe = rightPresence.find((item) => item.migration === probe.migration);
    console.log(
      `[db:schema:diff] ${probe.migration}: ${leftLabel}=${probe.ok ? "present" : "missing"}, ${rightLabel}=${rightProbe?.ok ? "present" : "missing"}`
    );
  }
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const leftProfile = String(args.left || "production-live");
  const rightProfile = String(args.right || "local-sim");

  const leftEnv = loadMigrationEnvironment(leftProfile);
  const rightEnv = loadMigrationEnvironment(rightProfile);

  const [leftPool, rightPool] = await Promise.all([
    createPool(leftEnv.databaseUrl),
    createPool(rightEnv.databaseUrl),
  ]);

  try {
    const [leftSnapshot, rightSnapshot] = await Promise.all([
      readSchemaSnapshot(leftPool),
      readSchemaSnapshot(rightPool),
    ]);

    const diff = buildSchemaDiff(leftSnapshot, rightSnapshot);
    const leftPresence = summarizeKeyMigrationPresence(leftSnapshot);
    const rightPresence = summarizeKeyMigrationPresence(rightSnapshot);

    printSummary({
      leftLabel: leftProfile,
      leftTarget: leftEnv.databaseTarget,
      rightLabel: rightProfile,
      rightTarget: rightEnv.databaseTarget,
      diff,
      leftPresence,
      rightPresence,
    });

    console.log(
      JSON.stringify(
        {
          left: {
            profile: leftProfile,
            target: formatDatabaseTarget(leftEnv.databaseTarget),
            keyMigrationPresence: leftPresence,
          },
          right: {
            profile: rightProfile,
            target: formatDatabaseTarget(rightEnv.databaseTarget),
            keyMigrationPresence: rightPresence,
          },
          diff,
        },
        null,
        2
      )
    );
  } finally {
    await Promise.all([leftPool.end(), rightPool.end()]);
  }
}

main().catch((error) => {
  console.error(`[db:schema:diff] ${error.message}`);
  process.exit(1);
});
