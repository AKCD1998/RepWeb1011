import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(projectRoot, "server", ".env") });
dotenv.config({ path: path.join(projectRoot, ".env") });

const { getClient, hasDatabase, pool } = await import("../server/db/pool.js");
const { ensureProductUnitLevel, buildUnitLevelKey } = await import("../server/controllers/helpers.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function legacySanitize(label) {
  return String(label || "")
    .trim()
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

async function resolveDosageFormId(client, code = "TABLET") {
  const result = await client.query(
    `
      SELECT id
      FROM dosage_forms
      WHERE code = $1
      LIMIT 1
    `,
    [code]
  );
  if (!result.rows[0]) {
    throw new Error(`Dosage form not found: ${code}`);
  }
  return result.rows[0].id;
}

async function ensureUnitKeyColumn(client) {
  const result = await client.query(
    `
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'product_unit_levels'
        AND column_name = 'unit_key'
      LIMIT 1
    `
  );
  if (!result.rows[0]) {
    throw new Error("Missing column product_unit_levels.unit_key. Run migration 0007 first.");
  }
}

if (!hasDatabase()) {
  throw new Error("DATABASE_URL is not configured.");
}

const client = await getClient();
try {
  await client.query("BEGIN");
  await ensureUnitKeyColumn(client);

  const dosageFormId = await resolveDosageFormId(client, "TABLET");
  const productCode = `TMP-ULKEY-${Date.now()}`;
  const productResult = await client.query(
    `
      INSERT INTO products (
        product_code,
        trade_name,
        generic_name,
        dosage_form_id,
        is_active,
        updated_at
      )
      VALUES ($1, $2, $3, $4, true, now())
      RETURNING id
    `,
    [productCode, "TMP UNIT LEVEL STABILITY", "TMP", dosageFormId]
  );
  const productId = productResult.rows[0].id;

  const labelA = "1 แผง = 10 เม็ด";
  const labelB = "1 กล่อง = 10 แผง";
  const labelBroken = "1 ??? = 10 ????";

  assert(
    legacySanitize(labelA) === legacySanitize(labelB),
    "Legacy sanitize did not produce expected collision for test labels."
  );

  const ulA1 = await ensureProductUnitLevel(client, productId, labelA, {
    level: 1,
    parentLevel: 0,
    quantityPerParentUnit: 10,
    quantityPerBaseUnit: 10,
    baseUnitCode: "TABLET",
    unitTypeCode: "BLISTER",
  });
  const ulA2 = await ensureProductUnitLevel(client, productId, labelA, {
    level: 1,
    parentLevel: 0,
    quantityPerParentUnit: 10,
    quantityPerBaseUnit: 10,
    baseUnitCode: "TABLET",
    unitTypeCode: "BLISTER",
  });
  assert(ulA1.id === ulA2.id, "Same structural input should reuse the same unit level row.");

  const ulB = await ensureProductUnitLevel(client, productId, labelB, {
    level: 2,
    parentLevel: 1,
    quantityPerParentUnit: 10,
    quantityPerBaseUnit: 100,
    baseUnitCode: "TABLET",
    unitTypeCode: "BOX",
  });
  assert(ulB.id !== ulA1.id, "Different structural input must not collide with existing unit level.");

  const ulBroken = await ensureProductUnitLevel(client, productId, labelBroken, {
    level: 3,
    parentLevel: 2,
    quantityPerParentUnit: 10,
    quantityPerBaseUnit: 1000,
    baseUnitCode: "TABLET",
    unitTypeCode: "PACKAGE",
  });

  const unitLevelsResult = await client.query(
    `
      SELECT id, code, unit_key, display_name, sort_order
      FROM product_unit_levels
      WHERE product_id = $1
      ORDER BY sort_order ASC, id ASC
    `,
    [productId]
  );
  const unitLevels = unitLevelsResult.rows;

  assert(unitLevels.length >= 3, "Expected at least 3 unit levels created during test.");
  assert(
    unitLevels.every((row) => String(row.unit_key || "").trim()),
    "All created unit levels must have non-empty unit_key."
  );
  assert(
    new Set(unitLevels.map((row) => row.unit_key)).size === unitLevels.length,
    "unit_key must be unique per product."
  );
  assert(
    unitLevels.every((row) => !String(row.display_name || "").includes("?")),
    "display_name should never contain '?' after insert/update."
  );
  assert(
    !String(ulBroken.display_name || "").includes("?"),
    "Corrupted label input should be normalized to a safe fallback display_name."
  );

  const expectedBKey = buildUnitLevelKey({
    productCode,
    level: 2,
    parentLevel: 1,
    quantityPerParentUnit: 10,
    quantityPerBaseUnit: 100,
    baseUnitCode: "TABLET",
    unitTypeCode: "BOX",
  });
  assert(
    String(ulB.unit_key || "") === expectedBKey,
    "buildUnitLevelKey must be deterministic and match persisted unit_key."
  );

  console.log("verify-unit-level-stability: PASS");
  console.log(`product_id=${productId}`);
  console.log(`created_levels=${unitLevels.length}`);
  await client.query("ROLLBACK");
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // ignore rollback error
  }
  throw error;
} finally {
  client.release();
  await pool?.end?.();
}
