import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(projectRoot, "server", ".env") });
dotenv.config({ path: path.join(projectRoot, ".env") });

const { getClient, hasDatabase, pool } = await import("../server/db/pool.js");

function parseArgs(argv) {
  const result = {
    productCode: "",
    includeHealthy: false,
  };

  for (const arg of argv) {
    if (arg.startsWith("--product=")) {
      result.productCode = arg.slice("--product=".length).trim();
      continue;
    }
    if (arg === "--all") {
      result.includeHealthy = true;
    }
  }

  return result;
}

if (!hasDatabase()) {
  throw new Error("RX1011_DATABASE_URL or DATABASE_URL is not configured.");
}

const args = parseArgs(process.argv.slice(2));
const client = await getClient();

try {
  const params = [];
  const where = [];
  if (args.productCode) {
    params.push(args.productCode);
    where.push(`p.product_code = $${params.length}`);
  }

  const result = await client.query(
    `
      WITH base_pick AS (
        SELECT DISTINCT ON (pul.product_id)
          pul.product_id,
          pul.id AS base_unit_level_id
        FROM product_unit_levels pul
        ORDER BY pul.product_id, pul.is_base DESC, pul.sort_order ASC, pul.created_at ASC
      ),
      sellable_pick AS (
        SELECT DISTINCT ON (pul.product_id)
          pul.product_id,
          pul.id AS sellable_unit_level_id
        FROM product_unit_levels pul
        ORDER BY pul.product_id, pul.is_sellable DESC, pul.is_base DESC, pul.sort_order ASC, pul.created_at ASC
      ),
      unit_rows AS (
        SELECT
          p.id AS product_id,
          pul.id AS unit_level_id,
          pul.is_base,
          pul.is_sellable,
          COALESCE(
            NULLIF((regexp_match(COALESCE(pul.unit_key, ''), 'qpb=([0-9]+(?:\\.[0-9]+)?)'))[1], '')::numeric,
            NULL
          ) AS qpb,
          COALESCE(mv.movement_count, 0)::int AS movement_count
        FROM products p
        LEFT JOIN product_unit_levels pul
          ON pul.product_id = p.id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS movement_count
          FROM stock_movements sm
          WHERE sm.unit_level_id = pul.id
        ) mv ON true
      )
      SELECT
        p.id AS "productId",
        p.product_code AS "productCode",
        p.trade_name AS "tradeName",
        bp.base_unit_level_id AS "baseUnitLevelId",
        sp.sellable_unit_level_id AS "sellableUnitLevelId",
        COUNT(ur.unit_level_id)::int AS "unitLevelCount",
        COUNT(ur.unit_level_id) FILTER (WHERE ur.is_base)::int AS "baseCount",
        COUNT(ur.unit_level_id) FILTER (WHERE ur.is_sellable)::int AS "sellableCount",
        COALESCE(
          ARRAY_REMOVE(
            ARRAY_AGG(ur.unit_level_id::text) FILTER (WHERE ur.unit_level_id IS NOT NULL AND ur.qpb IS NULL),
            NULL
          ),
          ARRAY[]::text[]
        ) AS "missingQpbUnitLevelIds",
        COALESCE(
          ARRAY_REMOVE(
            ARRAY_AGG(ur.unit_level_id::text) FILTER (
              WHERE ur.unit_level_id IS NOT NULL
                AND ur.unit_level_id IS DISTINCT FROM bp.base_unit_level_id
                AND ur.unit_level_id IS DISTINCT FROM sp.sellable_unit_level_id
            ),
            NULL
          ),
          ARRAY[]::text[]
        ) AS "legacyUnitLevelIds",
        COALESCE(
          ARRAY_REMOVE(
            ARRAY_AGG(ur.unit_level_id::text) FILTER (
              WHERE ur.unit_level_id IS NOT NULL
                AND ur.unit_level_id IS DISTINCT FROM bp.base_unit_level_id
                AND ur.unit_level_id IS DISTINCT FROM sp.sellable_unit_level_id
                AND ur.movement_count > 0
            ),
            NULL
          ),
          ARRAY[]::text[]
        ) AS "legacyUnitLevelIdsWithMovements"
      FROM products p
      LEFT JOIN unit_rows ur ON ur.product_id = p.id
      LEFT JOIN base_pick bp ON bp.product_id = p.id
      LEFT JOIN sellable_pick sp ON sp.product_id = p.id
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY
        p.id,
        p.product_code,
        p.trade_name,
        bp.base_unit_level_id,
        sp.sellable_unit_level_id
      ORDER BY p.product_code ASC
    `,
    params
  );

  const rows = result.rows.map((row) => {
    const anomalies = [];
    if (row.baseCount !== 1) anomalies.push(`baseCount=${row.baseCount}`);
    if (row.sellableCount !== 1) anomalies.push(`sellableCount=${row.sellableCount}`);
    if (row.missingQpbUnitLevelIds.length) {
      anomalies.push(`missingQpb=${row.missingQpbUnitLevelIds.length}`);
    }
    if (row.legacyUnitLevelIds.length) {
      anomalies.push(`legacy=${row.legacyUnitLevelIds.length}`);
    }

    return {
      ...row,
      anomalies,
      isHealthy: anomalies.length === 0,
    };
  });

  const scopedRows = args.includeHealthy ? rows : rows.filter((row) => !row.isHealthy);

  console.log(
    `audit-unit-levels: products=${rows.length}, flagged=${rows.filter((row) => !row.isHealthy).length}`
  );
  if (!scopedRows.length) {
    console.log("No issues found for the selected scope.");
    process.exit(0);
  }

  for (const row of scopedRows) {
    console.log("------------------------------------------------------------");
    console.log(`${row.productCode || row.productId} | ${row.tradeName || "-"}`);
    console.log(`baseUnitLevelId=${row.baseUnitLevelId || "-"} sellableUnitLevelId=${row.sellableUnitLevelId || "-"}`);
    console.log(`unitLevels=${row.unitLevelCount} baseCount=${row.baseCount} sellableCount=${row.sellableCount}`);
    console.log(`anomalies=${row.anomalies.join(", ") || "-"}`);
    if (row.missingQpbUnitLevelIds.length) {
      console.log(`missingQpbUnitLevelIds=${row.missingQpbUnitLevelIds.join(",")}`);
    }
    if (row.legacyUnitLevelIds.length) {
      console.log(`legacyUnitLevelIds=${row.legacyUnitLevelIds.join(",")}`);
    }
    if (row.legacyUnitLevelIdsWithMovements.length) {
      console.log(`legacyUnitLevelIdsWithMovements=${row.legacyUnitLevelIdsWithMovements.join(",")}`);
    }
  }
} finally {
  client.release();
  await pool?.end?.();
}
