import express from "express";
import cors from "cors";
import morgan from "morgan";
import dotenv from "dotenv";
import { pool } from "./db.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

app.get("/health", async (req, res) => {
  const r = await pool.query("SELECT now() as server_time");
  res.json({ ok: true, ...r.rows[0] });
});

//1 lookup สินค้าดด้วย barcode (เก็บเป็น string)
app.get("/api/products", async (req, res) => {
  const barcode = (req.query.barcode || "").trim();
  if (!barcode) {
    return res.status(400).json({ error: "barcode is required" });
  }

  const r = await pool.query("SELECT * FROM products WHERE barcode = $1 LIMIT 1", 
    [barcode]
  );
  res.json(r.rows[0] || null);
});

// list products for db edit table
app.get("/api/products/list", async (req, res) => {
  const r = await pool.query(
    `SELECT id, brand_name, product_code, price_baht
     FROM products
     ORDER BY id DESC`
  );
  res.json(r.rows);
});

//2 list pack size for drop down
app.get("/api/pack-sized", async (req, res) => {
  const r = await pool.query(
    "SELECT id, label FROM pack_sizes WHERE status <> 'disabled' ORDER BY label"
  );
  res.json(r.rows);
});
  
function normPackLabel(s) {
  return s.toLowerCase().replace(/\s+/g, '').replace(/x/g, "x");
}

const NAME_LOOKUP_TABLES = new Set([
  "dosage_forms",
  "manufacturers",
  "purchase_limits",
  "routes",
  "reports",
]);

function normalizeIdArray(value) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isInteger) : [];
}

function normalizeOptionalId(value, label) {
  if (value === null || value === undefined) {
    return null;
  }
  const id = Number(value);
  if (!Number.isInteger(id)) {
    throw new Error(`${label} must be integer`);
  }
  return id;
}

function normalizeNameArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  const names = value
    .map((item) => (item === null || item === undefined ? "" : String(item).trim()))
    .filter(Boolean);
  return [...new Set(names)];
}

async function getOrCreateByName(client, table, name) {
  if (!NAME_LOOKUP_TABLES.has(table)) {
    throw new Error(`unsupported lookup table: ${table}`);
  }
  const cleaned = name === null || name === undefined ? "" : String(name).trim();
  if (!cleaned) {
    return null;
  }

  const existing = await client.query(
    `SELECT id FROM ${table} WHERE name = $1 LIMIT 1`,
    [cleaned]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }

  const created = await client.query(
    `INSERT INTO ${table} (name) VALUES ($1) RETURNING id`,
    [cleaned]
  );
  return created.rows[0].id;
}

async function getOrCreatePackSize(client, label) {
  const cleaned = label === null || label === undefined ? "" : String(label).trim();
  if (!cleaned) {
    return null;
  }
  const norm = normPackLabel(cleaned);
  const existing = await client.query(
    "SELECT id FROM pack_sizes WHERE norm_label = $1 LIMIT 1",
    [norm]
  );
  if (existing.rows[0]) {
    return existing.rows[0].id;
  }
  const created = await client.query(
    `INSERT INTO pack_sizes (label, norm_label, status)
     VALUES ($1, $2, 'pending')
     RETURNING id`,
    [cleaned, norm]
  );
  return created.rows[0].id;
}

async function replaceProductLinks(client, table, column, productId, ids) {
  await client.query(`DELETE FROM ${table} WHERE product_id = $1`, [productId]);
  if (!ids.length) {
    return 0;
  }
  const r = await client.query(
    `INSERT INTO ${table} (product_id, ${column})
     SELECT $1, UNNEST($2::bigint[])`,
    [productId, ids]
  );
  return r.rowCount;
}

// 3 create pack size ถ้ายังไม่เคยมีมาก่อน
app.post("/api/pack-sized", async (req, res) => {
  const label = (req.body.label || "").trim();
  const createdBy = (req.body.createdBy || null);

  if (!label) {
    return res.status(400).json({ error: "label is required" });
  }

  const norm = normPackLabel(label);

  const r = await pool.query(
    `INSERT INTO pack_sizes (label, norm_label, status, created_by)
     VALUES ($1, $2, 'pending', $3)
     ON CONFLICT (norm_label)
     DO UPDATE SET label = EXCLUDED.label
     RETURNING id, label, status`,
    [label, norm, createdBy]
  );
  res.json(r.rows[0]);
});

// 4 create product from modal (match PG column names)
app.post("/api/products", async (req, res) => {
  const {
    productCode,      // -> product_code  (required)
    brandName,        // -> brand_name    (required)
    genericName,      // -> generic_name
    strengthValue,    // -> strength_value
    strengthUnit,     // -> strength_unit
    dosageFormId,     // -> dosage_form_id
    dosageForm,       // -> dosage_form_id (lookup by name)
    manufacturerId,   // -> manufacturer_id
    manufacturer,     // -> manufacturer_id (lookup by name)
    priceBaht,        // -> price_baht    (required)
    purchaseLimitId,  // -> purchase_limit_id
    purchaseLimit,    // -> purchase_limit_id (lookup by name)
    barcode,          // -> barcode
    packSizeIds,      // -> product_pack_sizes
    packSizes,        // -> product_pack_sizes (lookup by label)
    routeIds,         // -> product_routes
    routes,           // -> product_routes (lookup by name)
    reportIds,        // -> product_reports
    reports,          // -> product_reports (lookup by name)
  } = req.body || {};

  if (!productCode || !brandName || priceBaht === undefined || priceBaht === null) {
    return res
      .status(400)
      .json({ error: "productCode, brandName, priceBaht are required" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const resolvedDosageFormId =
      dosageFormId === null || dosageFormId === undefined
        ? await getOrCreateByName(client, "dosage_forms", dosageForm)
        : normalizeOptionalId(dosageFormId, "dosageFormId");
    const resolvedManufacturerId =
      manufacturerId === null || manufacturerId === undefined
        ? await getOrCreateByName(client, "manufacturers", manufacturer)
        : normalizeOptionalId(manufacturerId, "manufacturerId");
    const resolvedPurchaseLimitId =
      purchaseLimitId === null || purchaseLimitId === undefined
        ? await getOrCreateByName(client, "purchase_limits", purchaseLimit)
        : normalizeOptionalId(purchaseLimitId, "purchaseLimitId");

    const r = await client.query(
      `INSERT INTO products (
        product_code,
        brand_name,
        generic_name,
        strength_value,
        strength_unit,
        dosage_form_id,
        manufacturer_id,
        price_baht,
        purchase_limit_id,
        barcode
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
      )
      RETURNING id`,
      [
        String(productCode).trim(),
        String(brandName).trim(),
        genericName ? String(genericName).trim() : null,
        strengthValue === null || strengthValue === undefined ? null : Number(strengthValue),
        strengthUnit ? String(strengthUnit).trim() : null,
        resolvedDosageFormId === null || resolvedDosageFormId === undefined
          ? null
          : Number(resolvedDosageFormId),
        resolvedManufacturerId === null || resolvedManufacturerId === undefined
          ? null
          : Number(resolvedManufacturerId),
        Number(priceBaht),
        resolvedPurchaseLimitId === null || resolvedPurchaseLimitId === undefined
          ? null
          : Number(resolvedPurchaseLimitId),
        barcode ? String(barcode).trim() : null,
      ]
    );

    const productId = r.rows[0].id;

    const packSizeIdList = normalizeIdArray(packSizeIds);
    if (Array.isArray(packSizeIds) && packSizeIds.length && !packSizeIdList.length) {
      throw new Error("packSizeIds must be integers");
    }
    const resolvedPackSizeIds = packSizeIdList.length
      ? packSizeIdList
      : await Promise.all(
          normalizeNameArray(packSizes).map((label) => getOrCreatePackSize(client, label))
        );
    const packSizeIdsFinal = resolvedPackSizeIds
      .filter((id) => id !== null && id !== undefined)
      .map((id) => Number(id))
      .filter(Number.isInteger);

    const routeIdList = normalizeIdArray(routeIds);
    if (Array.isArray(routeIds) && routeIds.length && !routeIdList.length) {
      throw new Error("routeIds must be integers");
    }
    const resolvedRouteIds = routeIdList.length
      ? routeIdList
      : await Promise.all(
          normalizeNameArray(routes).map((name) => getOrCreateByName(client, "routes", name))
        );
    const routeIdsFinal = resolvedRouteIds
      .filter((id) => id !== null && id !== undefined)
      .map((id) => Number(id))
      .filter(Number.isInteger);

    const reportIdList = normalizeIdArray(reportIds);
    if (Array.isArray(reportIds) && reportIds.length && !reportIdList.length) {
      throw new Error("reportIds must be integers");
    }
    const resolvedReportIds = reportIdList.length
      ? reportIdList
      : await Promise.all(
          normalizeNameArray(reports).map((name) => getOrCreateByName(client, "reports", name))
        );
    const reportIdsFinal = resolvedReportIds
      .filter((id) => id !== null && id !== undefined)
      .map((id) => Number(id))
      .filter(Number.isInteger);

    if (packSizeIdsFinal.length || Array.isArray(packSizes)) {
      await replaceProductLinks(
        client,
        "product_pack_sizes",
        "pack_size_id",
        productId,
        packSizeIdsFinal
      );
    }
    if (routeIdsFinal.length || Array.isArray(routes)) {
      await replaceProductLinks(
        client,
        "product_routes",
        "route_id",
        productId,
        routeIdsFinal
      );
    }
    if (reportIdsFinal.length || Array.isArray(reports)) {
      await replaceProductLinks(
        client,
        "product_reports",
        "report_id",
        productId,
        reportIdsFinal
      );
    }

    await client.query("COMMIT");
    res.json({ id: productId });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    if (err.message && err.message.includes("must be integer")) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "failed to create product" });
  } finally {
    client.release();
  }
});


// 5 add pack sizes to a product
app.post("/api/products/:id/pack-sizes", async (req, res) => {
  const productId = Number(req.params.id);
  const packSizeIds = Array.isArray(req.body.packSizeIds) ? req.body.packSizeIds : [];

  if (!Number.isInteger(productId)) {
    return res.status(400).json({ error: "invalid product id" });
  }

  const ids = packSizeIds.map(Number).filter(Number.isInteger);
  if (packSizeIds.length && !ids.length) {
    return res.status(400).json({ error: "packSizeIds must be integers" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM product_pack_sizes WHERE product_id = $1",
      [productId]
    );

    let inserted = 0;
    if (ids.length) {
      const r = await client.query(
        `INSERT INTO product_pack_sizes (product_id, pack_size_id)
         SELECT $1, UNNEST($2::bigint[])`,
        [productId, ids]
      );
      inserted = r.rowCount;
    }

    await client.query("COMMIT");
    res.json({ inserted });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "failed to update pack sizes" });
  } finally {
    client.release();
  }
});

// 6 add routes to a product
app.post("/api/products/:id/routes", async (req, res) => {
  const productId = Number(req.params.id);
  const routeIds = Array.isArray(req.body.routeIds) ? req.body.routeIds : [];

  if (!Number.isInteger(productId)) {
    return res.status(400).json({ error: "invalid product id" });
  }

  const ids = routeIds.map(Number).filter(Number.isInteger);
  if (routeIds.length && !ids.length) {
    return res.status(400).json({ error: "routeIds must be integers" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM product_routes WHERE product_id = $1",
      [productId]
    );

    let inserted = 0;
    if (ids.length) {
      const r = await client.query(
        `INSERT INTO product_routes (product_id, route_id)
         SELECT $1, UNNEST($2::bigint[])`,
        [productId, ids]
      );
      inserted = r.rowCount;
    }

    await client.query("COMMIT");
    res.json({ inserted });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "failed to update routes" });
  } finally {
    client.release();
  }
});

// 7 add reports to a product
app.post("/api/products/:id/reports", async (req, res) => {
  const productId = Number(req.params.id);
  const reportIds = Array.isArray(req.body.reportIds) ? req.body.reportIds : [];

  if (!Number.isInteger(productId)) {
    return res.status(400).json({ error: "invalid product id" });
  }

  const ids = reportIds.map(Number).filter(Number.isInteger);
  if (reportIds.length && !ids.length) {
    return res.status(400).json({ error: "reportIds must be integers" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "DELETE FROM product_reports WHERE product_id = $1",
      [productId]
    );

    let inserted = 0;
    if (ids.length) {
      const r = await client.query(
        `INSERT INTO product_reports (product_id, report_id)
         SELECT $1, UNNEST($2::bigint[])`,
        [productId, ids]
      );
      inserted = r.rowCount;
    }

    await client.query("COMMIT");
    res.json({ inserted });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ error: "failed to update reports" });
  } finally {
    client.release();
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
