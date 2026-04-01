import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Read-only rollout audit for lot whitelist data quality.
// This intentionally reports problems but does not mutate any rows.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(projectRoot, "server", ".env") });
dotenv.config({ path: path.join(projectRoot, ".env") });

const { getClient, hasDatabase, pool } = await import("../server/db/pool.js");
const { productUnitLevelsIsActiveCompatExpression } = await import(
  "../server/controllers/helpers.js"
);

const REQUIRED_LOT_WHITELIST_COLUMNS = [
  "product_id",
  "product_lot_id",
  "unit_level_id",
  "is_active",
  "is_default",
];

function parseArgs(argv) {
  return {
    productCode:
      argv.find((arg) => arg.startsWith("--product="))?.slice("--product=".length).trim() || "",
    json: argv.includes("--json"),
    includeAllLots: argv.includes("--all"),
  };
}

function toText(value) {
  return String(value ?? "").trim();
}

function toIssue(code, message, details = {}) {
  return {
    code,
    message,
    ...details,
  };
}

function buildLotIssueList(row) {
  const issues = [];
  const onHandQty = Number(row.onHandQty || 0);
  const activeMappingCount = Number(row.activeMappingCount || 0);
  const missingUnitLevelIds = Array.isArray(row.missingUnitLevelIds) ? row.missingUnitLevelIds : [];
  const inactiveUnitLevelIds = Array.isArray(row.inactiveUnitLevelIds)
    ? row.inactiveUnitLevelIds
    : [];
  const duplicateUnitLevelIds = Array.isArray(row.duplicateUnitLevelIds)
    ? row.duplicateUnitLevelIds
    : [];

  if (onHandQty > 0 && activeMappingCount === 0) {
    issues.push(
      toIssue(
        "EMPTY_ACTIVE_LOT_WHITELIST",
        "active lot has no active whitelist rows",
        { onHandQty }
      )
    );
  }

  if (missingUnitLevelIds.length) {
    issues.push(
      toIssue(
        "WHITELIST_REFERENCES_MISSING_UNIT",
        "lot whitelist references missing product unit levels",
        { unitLevelIds: missingUnitLevelIds }
      )
    );
  }

  if (inactiveUnitLevelIds.length) {
    issues.push(
      toIssue(
        "WHITELIST_REFERENCES_INACTIVE_UNIT",
        "lot whitelist references inactive product unit levels",
        { unitLevelIds: inactiveUnitLevelIds }
      )
    );
  }

  if (duplicateUnitLevelIds.length) {
    issues.push(
      toIssue(
        "DUPLICATE_ACTIVE_WHITELIST_MAPPINGS",
        "lot whitelist has duplicate active mappings for the same unit level",
        { unitLevelIds: duplicateUnitLevelIds }
      )
    );
  }

  return issues;
}

async function main() {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const args = parseArgs(process.argv.slice(2));
  const client = await getClient();

  try {
    const hasWhitelistTableResult = await client.query(
      `
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'product_lot_allowed_unit_levels'
        LIMIT 1
      `
    );

    if (!hasWhitelistTableResult.rows[0]) {
      throw new Error(
        "Missing table product_lot_allowed_unit_levels. Apply migration 0017_product_lot_allowed_unit_levels.sql first."
      );
    }

    const columnResult = await client.query(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'product_lot_allowed_unit_levels'
          AND column_name = ANY($1::text[])
      `,
      [REQUIRED_LOT_WHITELIST_COLUMNS]
    );
    const presentColumns = new Set(
      columnResult.rows.map((row) => String(row.column_name || "").trim())
    );
    const missingColumns = REQUIRED_LOT_WHITELIST_COLUMNS.filter(
      (columnName) => !presentColumns.has(columnName)
    );
    if (missingColumns.length) {
      throw new Error(
        `Incomplete table product_lot_allowed_unit_levels. Missing required columns: ${missingColumns.join(
          ", "
        )}. Re-apply migration 0017_product_lot_allowed_unit_levels.sql before running this audit.`
      );
    }

    const params = [];
    const where = [];
    if (args.productCode) {
      params.push(args.productCode);
      where.push(`p.product_code = $${params.length}`);
    }

    const activeUnitPredicate = `${productUnitLevelsIsActiveCompatExpression("pul")} = true`;
    const result = await client.query(
      `
      WITH lot_activity AS (
        SELECT
          soh.lot_id AS "productLotId",
          SUM(
            CASE
              WHEN soh.quantity_on_hand > 0 THEN soh.quantity_on_hand
              ELSE 0
            END
          )::numeric AS "onHandQty"
        FROM stock_on_hand soh
        WHERE soh.lot_id IS NOT NULL
        GROUP BY soh.lot_id
      ),
      active_mapping_counts AS (
        SELECT
          plaul.product_lot_id AS "productLotId",
          COUNT(*)::int AS "activeMappingCount"
        FROM product_lot_allowed_unit_levels plaul
        WHERE plaul.is_active = true
        GROUP BY plaul.product_lot_id
      ),
      duplicate_active_mapping_rows AS (
        SELECT
          plaul.product_lot_id AS "productLotId",
          plaul.unit_level_id::text AS "unitLevelId"
        FROM product_lot_allowed_unit_levels plaul
        WHERE plaul.is_active = true
        GROUP BY plaul.product_lot_id, plaul.unit_level_id
        HAVING COUNT(*) > 1
      ),
      duplicate_active_mapping_agg AS (
        SELECT
          "productLotId",
          ARRAY_AGG("unitLevelId" ORDER BY "unitLevelId") AS "duplicateUnitLevelIds"
        FROM duplicate_active_mapping_rows
        GROUP BY "productLotId"
      ),
      whitelist_reference_agg AS (
        SELECT
          plaul.product_lot_id AS "productLotId",
          ARRAY_REMOVE(
            ARRAY_AGG(DISTINCT CASE WHEN pul.id IS NULL THEN plaul.unit_level_id::text END),
            NULL
          ) AS "missingUnitLevelIds",
          ARRAY_REMOVE(
            ARRAY_AGG(
              DISTINCT CASE
                WHEN pul.id IS NOT NULL AND NOT (${activeUnitPredicate})
                THEN plaul.unit_level_id::text
              END
            ),
            NULL
          ) AS "inactiveUnitLevelIds"
        FROM product_lot_allowed_unit_levels plaul
        LEFT JOIN product_unit_levels pul
          ON pul.id = plaul.unit_level_id
         AND pul.product_id = plaul.product_id
        WHERE plaul.is_active = true
        GROUP BY plaul.product_lot_id
      )
      SELECT
        p.id::text AS "productId",
        COALESCE(p.product_code, '') AS "productCode",
        p.trade_name AS "tradeName",
        pl.id::text AS "lotId",
        pl.lot_no AS "lotNo",
        pl.exp_date::text AS "expDate",
        COALESCE(la."onHandQty", 0)::numeric AS "onHandQty",
        COALESCE(amc."activeMappingCount", 0)::int AS "activeMappingCount",
        COALESCE(dam."duplicateUnitLevelIds", ARRAY[]::text[]) AS "duplicateUnitLevelIds",
        COALESCE(wra."missingUnitLevelIds", ARRAY[]::text[]) AS "missingUnitLevelIds",
        COALESCE(wra."inactiveUnitLevelIds", ARRAY[]::text[]) AS "inactiveUnitLevelIds"
      FROM product_lots pl
      JOIN products p ON p.id = pl.product_id
      LEFT JOIN lot_activity la ON la."productLotId" = pl.id
      LEFT JOIN active_mapping_counts amc ON amc."productLotId" = pl.id
      LEFT JOIN duplicate_active_mapping_agg dam ON dam."productLotId" = pl.id
      LEFT JOIN whitelist_reference_agg wra ON wra."productLotId" = pl.id
      ${
        where.length
          ? `WHERE ${where.join(" AND ")}`
          : ""
      }
      ORDER BY p.product_code ASC NULLS LAST, p.trade_name ASC, pl.exp_date DESC, pl.lot_no ASC
    `,
      params
    );

    const scopedRows = result.rows.filter((row) => {
      if (args.includeAllLots) return true;

      const onHandQty = Number(row.onHandQty || 0);
      const activeMappingCount = Number(row.activeMappingCount || 0);
      const hasPotentialProblemArea =
        onHandQty > 0 ||
        activeMappingCount > 0 ||
        (Array.isArray(row.missingUnitLevelIds) && row.missingUnitLevelIds.length > 0) ||
        (Array.isArray(row.inactiveUnitLevelIds) && row.inactiveUnitLevelIds.length > 0) ||
        (Array.isArray(row.duplicateUnitLevelIds) && row.duplicateUnitLevelIds.length > 0);

      return hasPotentialProblemArea;
    });

    const issues = scopedRows
      .map((row) => ({
        productId: toText(row.productId),
        productCode: toText(row.productCode),
        tradeName: toText(row.tradeName),
        lotId: toText(row.lotId),
        lotNo: toText(row.lotNo),
        expDate: toText(row.expDate),
        onHandQty: Number(row.onHandQty || 0),
        activeMappingCount: Number(row.activeMappingCount || 0),
        issues: buildLotIssueList(row),
      }))
      .filter((row) => row.issues.length > 0);

    const payload = {
      summary: {
        productFilter: args.productCode || null,
        includeAllLots: args.includeAllLots,
        lotsScanned: scopedRows.length,
        problematicLots: issues.length,
      },
      lots: issues,
    };

    if (args.json) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(
        `audit-lot-whitelists: scanned=${payload.summary.lotsScanned}, problematic=${payload.summary.problematicLots}`
      );

      if (!issues.length) {
        console.log("No lot whitelist issues found for the selected scope.");
      } else {
        for (const row of issues) {
          console.log("------------------------------------------------------------");
          console.log(
            `${row.productCode || row.productId} | ${row.tradeName || "-"} | lot=${row.lotNo || "-"} | exp=${row.expDate || "-"}`
          );
          console.log(
            `lotId=${row.lotId} onHandQty=${row.onHandQty} activeMappingCount=${row.activeMappingCount}`
          );
          for (const issue of row.issues) {
            console.log(`- ${issue.code}: ${issue.message}`);
            if (Array.isArray(issue.unitLevelIds) && issue.unitLevelIds.length) {
              console.log(`  unitLevelIds=${issue.unitLevelIds.join(",")}`);
            }
          }
        }
      }
    }

    process.exitCode = issues.length ? 1 : 0;
  } finally {
    client.release();
    await pool?.end?.();
  }
}

try {
  await main();
} catch (error) {
  console.error(`audit-lot-whitelists: ${error.message}`);
  process.exitCode = 1;
}
