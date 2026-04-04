import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(projectRoot, "server", ".env") });
dotenv.config({ path: path.join(projectRoot, ".env") });

const { hasDatabase, pool } = await import("../server/db/pool.js");

if (!hasDatabase()) {
  throw new Error("DATABASE_URL is not configured.");
}

function activePredicate(alias) {
  return `COALESCE((to_jsonb(${alias}) ->> 'is_active')::boolean, true) = true`;
}

const result = await pool.query(`
  WITH primary_levels AS (
    SELECT DISTINCT ON (pul.product_id)
      pul.product_id,
      COALESCE(TRIM(pul.barcode), '') AS primary_barcode,
      COALESCE(TRIM(pul.display_name), '') AS primary_display_name
    FROM product_unit_levels pul
    WHERE ${activePredicate("pul")}
    ORDER BY pul.product_id, pul.is_sellable DESC, pul.is_base DESC, pul.sort_order ASC, pul.created_at ASC
  ),
  level_terms AS (
    SELECT
      p.id AS product_id,
      p.product_code,
      p.trade_name,
      mloc.name AS manufacturer_name,
      level.id AS unit_level_id,
      COALESCE(TRIM(level.display_name), '') AS level_display_name,
      COALESCE(TRIM(level.barcode), '') AS level_barcode,
      level.is_base,
      level.is_sellable,
      pl.primary_barcode,
      pl.primary_display_name,
      x.term_type,
      x.term
    FROM products p
    JOIN product_unit_levels level ON level.product_id = p.id
    LEFT JOIN locations mloc ON mloc.id = p.manufacturer_location_id
    LEFT JOIN primary_levels pl ON pl.product_id = p.id
    CROSS JOIN LATERAL (
      VALUES
        ('barcode', COALESCE(TRIM(level.barcode), '')),
        ('display_name', COALESCE(TRIM(level.display_name), ''))
    ) AS x(term_type, term)
    WHERE p.is_active = true
      AND ${activePredicate("level")}
      AND x.term <> ''
  ),
  search_gap AS (
    SELECT
      lt.*,
      (
        NOT (
          COALESCE(lt.trade_name, '') ILIKE ('%' || lt.term || '%')
          OR COALESCE((SELECT p.generic_name FROM products p WHERE p.id = lt.product_id), '') ILIKE ('%' || lt.term || '%')
          OR COALESCE(lt.product_code, '') ILIKE ('%' || lt.term || '%')
          OR COALESCE(lt.primary_barcode, '') ILIKE ('%' || lt.term || '%')
          OR COALESCE(lt.primary_display_name, '') ILIKE ('%' || lt.term || '%')
          OR COALESCE(lt.manufacturer_name, '') ILIKE ('%' || lt.term || '%')
          OR EXISTS (
            SELECT 1
            FROM product_report_groups prg
            JOIN report_groups rg ON rg.id = prg.report_group_id
            WHERE prg.product_id = lt.product_id
              AND prg.effective_from <= CURRENT_DATE
              AND (prg.effective_to IS NULL OR prg.effective_to > CURRENT_DATE)
              AND rg.code ILIKE ('%' || lt.term || '%')
          )
          OR EXISTS (
            SELECT 1
            FROM product_ingredients pi
            JOIN active_ingredients ai ON ai.id = pi.active_ingredient_id
            WHERE pi.product_id = lt.product_id
              AND (
                ai.name_en ILIKE ('%' || lt.term || '%')
                OR COALESCE(ai.name_th, '') ILIKE ('%' || lt.term || '%')
                OR ai.code ILIKE ('%' || lt.term || '%')
              )
          )
        )
      ) AS old_search_miss
    FROM level_terms lt
  )
  SELECT
    product_code AS "productCode",
    trade_name AS "tradeName",
    json_agg(
      json_build_object(
        'termType', term_type,
        'term', term,
        'displayName', level_display_name,
        'barcode', level_barcode,
        'isBase', is_base,
        'isSellable', is_sellable
      )
      ORDER BY is_sellable DESC, is_base DESC, level_display_name ASC, term_type ASC, term ASC
    ) AS gaps
  FROM search_gap
  WHERE old_search_miss = true
  GROUP BY product_code, trade_name
  ORDER BY product_code ASC
`);

const rows = result.rows || [];
console.log(`audit-receiving-search-gaps: affected_products=${rows.length}`);

for (const row of rows) {
  console.log("------------------------------------------------------------");
  console.log(`${row.productCode || "-"} | ${row.tradeName || "-"}`);
  for (const gap of Array.isArray(row.gaps) ? row.gaps : []) {
    const flags = [
      gap?.isSellable ? "sellable" : "",
      gap?.isBase ? "base" : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(
      `${gap?.termType || "-"} | term=${gap?.term || "-"} | display=${gap?.displayName || "-"} | barcode=${gap?.barcode || "-"}${flags ? ` | ${flags}` : ""}`
    );
  }
}

await pool.end();
