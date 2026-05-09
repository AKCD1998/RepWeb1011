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
  };

  for (const arg of argv) {
    if (arg.startsWith("--product=")) {
      result.productCode = arg.slice("--product=".length).trim();
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
  const productFilterSql = args.productCode
    ? `AND p.product_code = $${params.push(args.productCode)}`
    : "";

  const corruptedCountResult = await client.query(
    `
      SELECT COUNT(*)::int AS "corruptedCount"
      FROM product_unit_levels pul
      JOIN products p ON p.id = pul.product_id
      WHERE (
        pul.display_name LIKE '%?%'
        OR pul.display_name LIKE '%' || U&'\\FFFD' || '%'
      )
      ${productFilterSql}
    `,
    params
  );

  const repairPreviewResult = await client.query(
    `
      WITH corrupted_rows AS (
        SELECT
          pul.id AS "unitLevelId",
          pul.product_id AS "productId",
          p.product_code AS "productCode",
          p.trade_name AS "tradeName",
          pul.code,
          pul.display_name AS "corruptedDisplayName",
          pul.unit_key AS "unitKey",
          ut.name_th AS "unitNameTh",
          NULLIF((regexp_match(COALESCE(pul.unit_key, ''), 'parent=([0-9]+)'))[1], '')::int AS "parentLevel",
          NULLIF((regexp_match(COALESCE(pul.unit_key, ''), 'qpp=([0-9]+(?:\\.[0-9]+)?)'))[1], '')::numeric AS "quantityPerParent"
        FROM product_unit_levels pul
        JOIN products p ON p.id = pul.product_id
        LEFT JOIN unit_types ut ON ut.id = pul.unit_type_id
        WHERE (
          pul.display_name LIKE '%?%'
          OR pul.display_name LIKE '%' || U&'\\FFFD' || '%'
        )
        ${productFilterSql}
      ),
      resolved_parent AS (
        SELECT
          row.*,
          parent_unit.id AS "parentUnitLevelId",
          parent_unit.display_name AS "parentDisplayName"
        FROM corrupted_rows row
        LEFT JOIN LATERAL (
          SELECT
            parent_pul.id,
            parent_pul.display_name
          FROM product_unit_levels parent_pul
          WHERE parent_pul.product_id = row."productId"
            AND NULLIF((regexp_match(COALESCE(parent_pul.unit_key, ''), 'lvl=([0-9]+)'))[1], '')::int = row."parentLevel"
          ORDER BY
            parent_pul.is_base DESC,
            parent_pul.is_sellable DESC,
            parent_pul.sort_order ASC,
            parent_pul.created_at ASC
          LIMIT 1
        ) parent_unit ON true
      )
      SELECT
        "productCode",
        "tradeName",
        "unitLevelId",
        code,
        "corruptedDisplayName",
        "parentDisplayName",
        format(
          '1 %s x %s %s',
          "unitNameTh",
          CASE
            WHEN "quantityPerParent" = trunc("quantityPerParent") THEN trunc("quantityPerParent")::text
            ELSE trim(trailing '.' FROM trim(trailing '0' FROM "quantityPerParent"::text))
          END,
          regexp_replace(btrim("parentDisplayName"), '^1[[:space:]]+', '')
        ) AS "repairedDisplayName"
      FROM resolved_parent
      WHERE COALESCE("unitNameTh", '') <> ''
        AND COALESCE("parentDisplayName", '') <> ''
        AND "parentLevel" IS NOT NULL
        AND "parentLevel" > 0
        AND "quantityPerParent" IS NOT NULL
        AND "unitNameTh" NOT LIKE '%?%'
        AND "parentDisplayName" NOT LIKE '%?%'
        AND "parentDisplayName" NOT LIKE '%' || U&'\\FFFD' || '%'
      ORDER BY "productCode", code
    `,
    params
  );

  const corruptedCount = corruptedCountResult.rows[0]?.corruptedCount ?? 0;
  const repairRows = repairPreviewResult.rows;

  console.log(
    `audit-corrupted-packaging-labels: corrupted=${corruptedCount} repairable=${repairRows.length}`
  );

  if (!repairRows.length) {
    console.log("No repairable corrupted packaging labels found for the selected scope.");
    process.exit(0);
  }

  for (const row of repairRows) {
    console.log("------------------------------------------------------------");
    console.log(`${row.productCode} | ${row.tradeName || "-"}`);
    console.log(`unitLevelId=${row.unitLevelId}`);
    console.log(`code=${row.code}`);
    console.log(`corruptedDisplayName=${row.corruptedDisplayName}`);
    console.log(`parentDisplayName=${row.parentDisplayName}`);
    console.log(`repairedDisplayName=${row.repairedDisplayName}`);
  }
} finally {
  client.release();
  await pool?.end?.();
}
