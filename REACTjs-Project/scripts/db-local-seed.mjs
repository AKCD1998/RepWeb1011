import { randomUUID } from "crypto";
import { Pool } from "pg";
import {
  applyMigrationPlan,
  formatEnvFiles,
  loadSimulationEnv,
  postCatalogFixMigrations,
} from "./local-sim-env.mjs";
import {
  adminSqlAuditRows,
  dispenseScenarios,
  lotWhitelistScenarios,
  occurredAtCorrectionScenario,
  preFixMovements,
  productCatalog,
  receiveScenarios,
  simulationLocations,
  simulationPatients,
  simulationUsers,
  transferScenarios,
} from "./local-sim-data.mjs";
import {
  applyStockDelta,
  buildUnitLevelKey,
  convertMovementToSignedBase,
  convertToBase,
  ensureLot,
  resolveProductBaseUnitLevel,
  upsertPatientByPid,
} from "../server/controllers/helpers.js";

const EFFECTIVE_FROM = "2025-01-01";

function cleanText(value) {
  return String(value ?? "").trim();
}

function isoTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return date.toISOString();
}

function toNullable(value) {
  const text = cleanText(value);
  return text || null;
}

async function resetSimulationTables(client) {
  await client.query(`
    TRUNCATE TABLE
      admin_sql_query_audits,
      stock_movement_occurred_at_audits,
      inventory_transfer_requests,
      revoked_tokens,
      stock_movements,
      stock_on_hand,
      dispense_lines,
      dispense_headers,
      product_lot_allowed_unit_levels,
      product_lots,
      product_prices,
      product_unit_conversions,
      product_unit_levels,
      product_report_groups,
      product_ingredients,
      products,
      patients
    RESTART IDENTITY CASCADE
  `);
}

async function upsertLocations(client) {
  const map = new Map();

  for (const location of simulationLocations) {
    const result = await client.query(
      `
        INSERT INTO locations (
          code,
          name,
          location_type,
          is_active,
          updated_at
        )
        VALUES ($1, $2, $3::location_type, true, now())
        ON CONFLICT (code) DO UPDATE
        SET
          name = EXCLUDED.name,
          location_type = EXCLUDED.location_type,
          is_active = EXCLUDED.is_active,
          updated_at = now()
        RETURNING id, code
      `,
      [location.code, location.name, location.locationType]
    );

    map.set(location.code, result.rows[0].id);
  }

  return map;
}

async function upsertUsers(client, locationIdsByCode) {
  const userIdsByUsername = new Map();

  for (const user of simulationUsers) {
    const locationId = user.locationCode ? locationIdsByCode.get(user.locationCode) : null;
    const result = await client.query(
      `
        INSERT INTO users (
          username,
          password_hash,
          full_name,
          role,
          location_id,
          is_active,
          updated_at
        )
        VALUES ($1, $2, $3, $4::user_role, $5, true, now())
        ON CONFLICT (username) DO UPDATE
        SET
          password_hash = EXCLUDED.password_hash,
          full_name = EXCLUDED.full_name,
          role = EXCLUDED.role,
          location_id = EXCLUDED.location_id,
          is_active = EXCLUDED.is_active,
          updated_at = now()
        RETURNING id, username
      `,
      [user.username, user.passwordHash, user.fullName, user.role, locationId]
    );
    userIdsByUsername.set(result.rows[0].username, result.rows[0].id);
  }

  const existingSeedUsers = await client.query(
    `
      SELECT id, username
      FROM users
      WHERE username = ANY($1::text[])
    `,
    [["admin", "staff001", "staff003", "staff004", "staff005", "system"]]
  );

  for (const row of existingSeedUsers.rows) {
    userIdsByUsername.set(row.username, row.id);
  }

  return userIdsByUsername;
}

async function buildReferenceMaps(client) {
  const [
    unitTypes,
    dosageForms,
    reportGroups,
    priceTiers,
    productCategories,
    locations,
    users,
  ] = await Promise.all([
    client.query(`SELECT id, code FROM unit_types`),
    client.query(`SELECT id, code FROM dosage_forms`),
    client.query(`SELECT id, code FROM report_groups WHERE is_active = true`),
    client.query(`SELECT id, code FROM price_tiers WHERE is_active = true`),
    client.query(`SELECT id, code FROM product_categories WHERE is_active = true`),
    client.query(`SELECT id, code FROM locations`),
    client.query(`SELECT id, username FROM users`),
  ]);

  return {
    unitTypeIdsByCode: new Map(unitTypes.rows.map((row) => [row.code, row.id])),
    dosageFormIdsByCode: new Map(dosageForms.rows.map((row) => [row.code, row.id])),
    reportGroupIdsByCode: new Map(reportGroups.rows.map((row) => [row.code, row.id])),
    priceTierIdsByCode: new Map(priceTiers.rows.map((row) => [row.code, row.id])),
    productCategoryIdsByCode: new Map(productCategories.rows.map((row) => [row.code, row.id])),
    locationIdsByCode: new Map(locations.rows.map((row) => [row.code, row.id])),
    userIdsByUsername: new Map(users.rows.map((row) => [row.username, row.id])),
  };
}

async function ensureActiveIngredient(client, ingredientRow, unitTypeIdsByCode) {
  const result = await client.query(
    `
      INSERT INTO active_ingredients (
        code,
        name_en,
        name_th,
        is_active
      )
      VALUES ($1, $2, $3, true)
      ON CONFLICT (code) DO UPDATE
      SET
        name_en = EXCLUDED.name_en,
        name_th = EXCLUDED.name_th,
        is_active = EXCLUDED.is_active
      RETURNING id
    `,
    [ingredientRow.code, ingredientRow.nameEn, ingredientRow.nameTh]
  );

  return {
    activeIngredientId: result.rows[0].id,
    numeratorUnitId: unitTypeIdsByCode.get(ingredientRow.numeratorUnitCode),
    denominatorUnitId: ingredientRow.denominatorUnitCode
      ? unitTypeIdsByCode.get(ingredientRow.denominatorUnitCode)
      : null,
  };
}

async function insertProduct(client, product, refs) {
  const dosageFormId = refs.dosageFormIdsByCode.get(product.dosageFormCode);
  const manufacturerLocationId = refs.locationIdsByCode.get(product.manufacturerCode);
  const productCategoryId = product.productCategoryCode
    ? refs.productCategoryIdsByCode.get(product.productCategoryCode)
    : null;

  if (!dosageFormId) {
    throw new Error(`Missing dosage form for ${product.productCode}: ${product.dosageFormCode}`);
  }
  if (product.manufacturerCode && !manufacturerLocationId) {
    throw new Error(
      `Missing manufacturer location for ${product.productCode}: ${product.manufacturerCode}`
    );
  }

  const productResult = await client.query(
    `
      INSERT INTO products (
        product_code,
        trade_name,
        generic_name,
        dosage_form_id,
        product_category_id,
        manufacturer_location_id,
        is_controlled,
        is_active,
        note_text,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, now())
      RETURNING id
    `,
    [
      product.productCode,
      product.tradeName,
      product.genericName,
      dosageFormId,
      productCategoryId,
      manufacturerLocationId,
      Boolean(product.productCategoryCode),
      product.noteText || null,
    ]
  );
  const productId = productResult.rows[0].id;

  let ingredientSortOrder = 1;
  for (const ingredientRow of product.ingredients) {
    const resolved = await ensureActiveIngredient(client, ingredientRow, refs.unitTypeIdsByCode);
    await client.query(
      `
        INSERT INTO product_ingredients (
          product_id,
          active_ingredient_id,
          strength_numerator,
          numerator_unit_id,
          strength_denominator,
          denominator_unit_id,
          sort_order
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        productId,
        resolved.activeIngredientId,
        ingredientRow.strengthNumerator,
        resolved.numeratorUnitId,
        ingredientRow.strengthDenominator,
        resolved.denominatorUnitId,
        ingredientSortOrder,
      ]
    );
    ingredientSortOrder += 1;
  }

  const unitLevelIdsByCode = new Map();
  for (const unitLevel of product.unitLevels) {
    const unitTypeId = refs.unitTypeIdsByCode.get(unitLevel.unitTypeCode);
    if (!unitTypeId) {
      throw new Error(
        `Missing unit type for ${product.productCode}/${unitLevel.code}: ${unitLevel.unitTypeCode}`
      );
    }

    const inserted = await client.query(
      `
        INSERT INTO product_unit_levels (
          product_id,
          code,
          display_name,
          unit_type_id,
          unit_key,
          is_base,
          is_sellable,
          is_active,
          sort_order,
          barcode
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id
      `,
      [
        productId,
        unitLevel.code,
        unitLevel.displayName,
        unitTypeId,
        buildUnitLevelKey({
          productCode: product.productCode,
          level: unitLevel.sortOrder,
          parentLevel: unitLevel.parentLevel ?? (unitLevel.isBase ? 0 : 1),
          quantityPerParentUnit: unitLevel.quantityPerParentUnit,
          quantityPerBaseUnit: unitLevel.quantityPerBaseUnit,
          baseUnitCode: unitLevel.baseUnitCode || unitLevel.unitTypeCode,
          unitTypeCode: unitLevel.unitTypeCode,
        }),
        unitLevel.isBase,
        unitLevel.isSellable,
        unitLevel.isActive !== false,
        unitLevel.sortOrder,
        toNullable(unitLevel.barcode),
      ]
    );

    unitLevelIdsByCode.set(unitLevel.code, inserted.rows[0].id);
  }

  for (const conversion of product.conversions) {
    await client.query(
      `
        INSERT INTO product_unit_conversions (
          product_id,
          parent_unit_level_id,
          child_unit_level_id,
          multiplier
        )
        VALUES ($1, $2, $3, $4)
      `,
      [
        productId,
        unitLevelIdsByCode.get(conversion.parentCode),
        unitLevelIdsByCode.get(conversion.childCode),
        conversion.multiplier,
      ]
    );
  }

  for (const reportGroupCode of product.reportGroupCodes) {
    const reportGroupId = refs.reportGroupIdsByCode.get(reportGroupCode);
    if (!reportGroupId) {
      throw new Error(`Missing report group ${reportGroupCode} for ${product.productCode}`);
    }

    await client.query(
      `
        INSERT INTO product_report_groups (
          product_id,
          report_group_id,
          effective_from
        )
        VALUES ($1, $2, $3::date)
      `,
      [productId, reportGroupId, EFFECTIVE_FROM]
    );
  }

  for (const price of product.prices) {
    const priceTierId = refs.priceTierIdsByCode.get(price.tierCode);
    const unitLevelId = unitLevelIdsByCode.get(price.unitCode);
    if (!priceTierId) {
      throw new Error(`Missing price tier ${price.tierCode} for ${product.productCode}`);
    }
    if (!unitLevelId) {
      throw new Error(
        `Missing unit level ${price.unitCode} for product price ${product.productCode}`
      );
    }

    await client.query(
      `
        INSERT INTO product_prices (
          product_id,
          unit_level_id,
          price_tier_id,
          price,
          effective_from
        )
        VALUES ($1, $2, $3, $4, $5::date)
      `,
      [productId, unitLevelId, priceTierId, price.price, EFFECTIVE_FROM]
    );
  }
}

async function insertProductCatalog(client, refs) {
  for (const product of productCatalog) {
    await insertProduct(client, product, refs);
  }
}

async function buildProductContext(client) {
  const productsResult = await client.query(
    `
      SELECT id, product_code
      FROM products
      WHERE product_code IS NOT NULL
    `
  );
  const productIdsByCode = new Map(productsResult.rows.map((row) => [row.product_code, row.id]));

  const unitLevelsResult = await client.query(
    `
      SELECT
        p.product_code AS "productCode",
        pul.id,
        pul.code
      FROM product_unit_levels pul
      JOIN products p ON p.id = pul.product_id
      WHERE p.product_code IS NOT NULL
    `
  );

  const unitLevelIdsByProductCode = new Map();
  for (const row of unitLevelsResult.rows) {
    const productCode = row.productCode;
    if (!unitLevelIdsByProductCode.has(productCode)) {
      unitLevelIdsByProductCode.set(productCode, new Map());
    }
    unitLevelIdsByProductCode.get(productCode).set(row.code, row.id);
  }

  const lotRows = await client.query(
    `
      SELECT
        p.product_code AS "productCode",
        pl.id,
        pl.lot_no AS "lotNo"
      FROM product_lots pl
      JOIN products p ON p.id = pl.product_id
      WHERE p.product_code IS NOT NULL
    `
  );

  const lotIdsByProductAndLotNo = new Map();
  for (const row of lotRows.rows) {
    lotIdsByProductAndLotNo.set(`${row.productCode}|${row.lotNo}`, row.id);
  }

  return {
    productIdsByCode,
    unitLevelIdsByProductCode,
    lotIdsByProductAndLotNo,
  };
}

async function seedPreFixMovement(client, refs, productContext) {
  for (const movement of preFixMovements) {
    const productId = productContext.productIdsByCode.get(movement.productCode);
    const unitLevelId = productContext.unitLevelIdsByProductCode
      .get(movement.productCode)
      ?.get(movement.unitCode);
    const branchId = refs.locationIdsByCode.get(movement.branchCode);
    const actorUserId = refs.userIdsByUsername.get(movement.createdByUsername);

    if (!productId || !unitLevelId || !branchId || !actorUserId) {
      throw new Error(`Pre-fix movement is missing lookup data for ${movement.productCode}`);
    }

    const lotId = await ensureLot(client, {
      productId,
      lotNo: movement.lotNo,
      mfgDate: movement.mfgDate,
      expDate: movement.expDate,
      manufacturer: movement.manufacturerName,
    });
    const unitLevelRow = await client.query(
      `
        SELECT id, unit_key, display_name, code
        FROM product_unit_levels
        WHERE id = $1
      `,
      [unitLevelId]
    );
    const baseUnitLevel = await resolveProductBaseUnitLevel(client, productId);
    const quantityBase = convertToBase(movement.quantity, unitLevelRow.rows[0]);
    const occurredAt = isoTimestamp(movement.occurredAt);

    await client.query(
      `
        INSERT INTO stock_movements (
          movement_type,
          from_location_id,
          to_location_id,
          product_id,
          lot_id,
          quantity,
          quantity_base,
          unit_level_id,
          occurred_at,
          created_by,
          note_text,
          created_at
        )
        VALUES (
          'RECEIVE',
          NULL,
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7::timestamptz,
          $8,
          $9,
          $7::timestamptz
        )
      `,
      [
        branchId,
        productId,
        lotId,
        movement.quantity,
        convertMovementToSignedBase(movement.quantity, "RECEIVE", unitLevelRow.rows[0]),
        unitLevelId,
        occurredAt,
        actorUserId,
        movement.noteText,
      ]
    );

    await applyStockDelta(client, {
      branchId,
      productId,
      lotId,
      baseUnitLevelId: baseUnitLevel.id,
      deltaQtyBase: quantityBase,
    });
  }
}

async function insertReceiveScenario(client, refs, productContext, scenario) {
  const productId = productContext.productIdsByCode.get(scenario.productCode);
  const unitLevelId = productContext.unitLevelIdsByProductCode
    .get(scenario.productCode)
    ?.get(scenario.unitCode);
  const branchId = refs.locationIdsByCode.get(scenario.branchCode);
  const actorUserId = refs.userIdsByUsername.get(scenario.createdByUsername);

  if (!productId || !unitLevelId || !branchId || !actorUserId) {
    throw new Error(`Receive scenario is missing lookup data for ${scenario.productCode}`);
  }

  const lotId = await ensureLot(client, {
    productId,
    lotNo: scenario.lotNo,
    mfgDate: scenario.mfgDate,
    expDate: scenario.expDate,
    manufacturer: scenario.manufacturerName,
  });
  const unitLevelRow = await client.query(
    `
      SELECT id, unit_key, display_name, code
      FROM product_unit_levels
      WHERE id = $1
    `,
    [unitLevelId]
  );
  const unitLevel = unitLevelRow.rows[0];
  const baseUnitLevel = await resolveProductBaseUnitLevel(client, productId);
  const quantityBase = convertToBase(scenario.quantity, unitLevel);
  const occurredAt = isoTimestamp(scenario.occurredAt);

  const inserted = await client.query(
    `
      INSERT INTO stock_movements (
        movement_type,
        from_location_id,
        to_location_id,
        product_id,
        lot_id,
        quantity,
        quantity_base,
        unit_level_id,
        occurred_at,
        created_by,
        note_text,
        created_at
      )
      VALUES (
        'RECEIVE',
        NULL,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7::timestamptz,
        $8,
        $9,
        $7::timestamptz
      )
      RETURNING id
    `,
    [
      branchId,
      productId,
      lotId,
      scenario.quantity,
      convertMovementToSignedBase(scenario.quantity, "RECEIVE", unitLevel),
      unitLevelId,
      occurredAt,
      actorUserId,
      scenario.noteText,
    ]
  );

  await applyStockDelta(client, {
    branchId,
    productId,
    lotId,
    baseUnitLevelId: baseUnitLevel.id,
    deltaQtyBase: quantityBase,
  });

  return {
    movementId: inserted.rows[0].id,
    lotId,
  };
}

async function applyOccurredAtCorrection(client, refs, movementId, scenario) {
  const editorUserId = refs.userIdsByUsername.get(scenario.editedByUsername);
  const nextOccurredAt = isoTimestamp(scenario.newOccurredAt);
  const movementResult = await client.query(
    `
      SELECT occurred_at
      FROM stock_movements
      WHERE id = $1
      LIMIT 1
    `,
    [movementId]
  );

  const originalOccurredAt = movementResult.rows[0]?.occurred_at;
  if (!originalOccurredAt) {
    throw new Error(`Movement not found for occurred_at correction: ${movementId}`);
  }

  await client.query(
    `
      UPDATE stock_movements
      SET corrected_occurred_at = $2::timestamptz
      WHERE id = $1
    `,
    [movementId, nextOccurredAt]
  );

  await client.query(
    `
      INSERT INTO stock_movement_occurred_at_audits (
        movement_id,
        original_occurred_at,
        previous_corrected_occurred_at,
        previous_effective_occurred_at,
        new_corrected_occurred_at,
        new_effective_occurred_at,
        reason_text,
        edited_by,
        edited_at
      )
      VALUES (
        $1,
        $2::timestamptz,
        NULL,
        $2::timestamptz,
        $3::timestamptz,
        $3::timestamptz,
        $4,
        $5,
        now()
      )
    `,
    [
      movementId,
      new Date(originalOccurredAt).toISOString(),
      nextOccurredAt,
      scenario.reasonText,
      editorUserId,
    ]
  );
}

async function insertTransferScenario(client, refs, productContext, scenario) {
  const productId = productContext.productIdsByCode.get(scenario.productCode);
  const unitLevelId = productContext.unitLevelIdsByProductCode
    .get(scenario.productCode)
    ?.get(scenario.unitCode);
  const lotId = productContext.lotIdsByProductAndLotNo.get(
    `${scenario.productCode}|${scenario.lotNo}`
  );
  const fromLocationId = refs.locationIdsByCode.get(scenario.fromBranchCode);
  const toLocationId = refs.locationIdsByCode.get(scenario.toBranchCode);
  const requestedBy = refs.userIdsByUsername.get(scenario.requestedByUsername);
  const decidedBy = scenario.decidedByUsername
    ? refs.userIdsByUsername.get(scenario.decidedByUsername)
    : null;

  if (!productId || !unitLevelId || !lotId || !fromLocationId || !toLocationId || !requestedBy) {
    throw new Error(`Transfer scenario is missing lookup data for ${scenario.productCode}`);
  }

  const unitLevelRow = await client.query(
    `
      SELECT id, unit_key, display_name, code
      FROM product_unit_levels
      WHERE id = $1
    `,
    [unitLevelId]
  );
  const unitLevel = unitLevelRow.rows[0];
  const baseUnitLevel = await resolveProductBaseUnitLevel(client, productId);
  const quantityBase = convertToBase(scenario.quantity, unitLevel);
  const requestId = randomUUID();
  const requestedAt = isoTimestamp(scenario.requestedAt);

  await applyStockDelta(client, {
    branchId: fromLocationId,
    productId,
    lotId,
    baseUnitLevelId: baseUnitLevel.id,
    deltaQtyBase: -quantityBase,
  });

  const transferOut = await client.query(
    `
      INSERT INTO stock_movements (
        movement_type,
        from_location_id,
        to_location_id,
        product_id,
        lot_id,
        quantity,
        quantity_base,
        unit_level_id,
        source_ref_type,
        source_ref_id,
        occurred_at,
        created_by,
        note_text,
        created_at
      )
      VALUES (
        'TRANSFER_OUT',
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        'TRANSFER_REQUEST',
        $8::uuid,
        $9::timestamptz,
        $10,
        $11,
        $9::timestamptz
      )
      RETURNING id
    `,
    [
      fromLocationId,
      toLocationId,
      productId,
      lotId,
      scenario.quantity,
      convertMovementToSignedBase(scenario.quantity, "TRANSFER_OUT", unitLevel),
      unitLevelId,
      requestId,
      requestedAt,
      requestedBy,
      scenario.noteText,
    ]
  );

  let transferInMovementId = null;
  let returnMovementId = null;

  if (scenario.status === "ACCEPTED") {
    const decisionAt = isoTimestamp(scenario.decisionAt);
    await applyStockDelta(client, {
      branchId: toLocationId,
      productId,
      lotId,
      baseUnitLevelId: baseUnitLevel.id,
      deltaQtyBase: quantityBase,
    });

    const transferIn = await client.query(
      `
        INSERT INTO stock_movements (
          movement_type,
          from_location_id,
          to_location_id,
          product_id,
          lot_id,
          quantity,
          quantity_base,
          unit_level_id,
          source_ref_type,
          source_ref_id,
          occurred_at,
          created_by,
          note_text,
          created_at
        )
        VALUES (
          'TRANSFER_IN',
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          'TRANSFER_REQUEST',
          $8::uuid,
          $9::timestamptz,
          $10,
          $11,
          $9::timestamptz
        )
        RETURNING id
      `,
      [
        fromLocationId,
        toLocationId,
        productId,
        lotId,
        scenario.quantity,
        quantityBase,
        unitLevelId,
        requestId,
        decisionAt,
        decidedBy,
        scenario.decisionNote || scenario.noteText,
      ]
    );
    transferInMovementId = transferIn.rows[0].id;
  }

  if (scenario.status === "REJECTED") {
    const decisionAt = isoTimestamp(scenario.decisionAt);
    await applyStockDelta(client, {
      branchId: fromLocationId,
      productId,
      lotId,
      baseUnitLevelId: baseUnitLevel.id,
      deltaQtyBase: quantityBase,
    });

    const returned = await client.query(
      `
        INSERT INTO stock_movements (
          movement_type,
          from_location_id,
          to_location_id,
          product_id,
          lot_id,
          quantity,
          quantity_base,
          unit_level_id,
          source_ref_type,
          source_ref_id,
          occurred_at,
          created_by,
          note_text,
          created_at
        )
        VALUES (
          'TRANSFER_IN',
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          'TRANSFER_REQUEST',
          $8::uuid,
          $9::timestamptz,
          $10,
          $11,
          $9::timestamptz
        )
        RETURNING id
      `,
      [
        toLocationId,
        fromLocationId,
        productId,
        lotId,
        scenario.quantity,
        quantityBase,
        unitLevelId,
        requestId,
        decisionAt,
        decidedBy,
        scenario.decisionNote || scenario.noteText,
      ]
    );
    returnMovementId = returned.rows[0].id;
  }

  await client.query(
    `
      INSERT INTO inventory_transfer_requests (
        id,
        from_location_id,
        to_location_id,
        product_id,
        lot_id,
        unit_level_id,
        base_unit_level_id,
        quantity,
        quantity_base,
        note_text,
        status,
        requested_by,
        requested_at,
        decided_by,
        decided_at,
        decision_note,
        transfer_out_movement_id,
        transfer_in_movement_id,
        return_movement_id
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
        $11::transfer_request_status,
        $12,
        $13::timestamptz,
        $14,
        $15::timestamptz,
        $16,
        $17,
        $18,
        $19
      )
    `,
    [
      requestId,
      fromLocationId,
      toLocationId,
      productId,
      lotId,
      unitLevelId,
      baseUnitLevel.id,
      scenario.quantity,
      quantityBase,
      scenario.noteText,
      scenario.status,
      requestedBy,
      requestedAt,
      decidedBy,
      scenario.decisionAt ? isoTimestamp(scenario.decisionAt) : null,
      scenario.decisionNote || null,
      transferOut.rows[0].id,
      transferInMovementId,
      returnMovementId,
    ]
  );
}

async function insertDispenseScenario(client, refs, productContext, scenario) {
  const branchId = refs.locationIdsByCode.get(scenario.branchCode);
  const pharmacistUserId = refs.userIdsByUsername.get(scenario.pharmacistUsername);
  const dispensedAt = isoTimestamp(scenario.dispensedAt);
  const patient = simulationPatients.find((row) => row.pid === scenario.patientPid);

  if (!branchId || !pharmacistUserId || !patient) {
    throw new Error(`Dispense scenario is missing lookup data for patient ${scenario.patientPid}`);
  }

  const patientId = await upsertPatientByPid(client, patient);
  const header = await client.query(
    `
      INSERT INTO dispense_headers (
        branch_id,
        patient_id,
        pharmacist_user_id,
        dispensed_at,
        note_text,
        created_by,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4::timestamptz, $5, $3, $4::timestamptz, $4::timestamptz)
      RETURNING id
    `,
    [branchId, patientId, pharmacistUserId, dispensedAt, scenario.noteText]
  );

  let lineNo = 1;
  for (const line of scenario.lines) {
    const productId = productContext.productIdsByCode.get(line.productCode);
    const unitLevelId = productContext.unitLevelIdsByProductCode
      .get(line.productCode)
      ?.get(line.unitCode);
    const lotId = productContext.lotIdsByProductAndLotNo.get(`${line.productCode}|${line.lotNo}`);

    if (!productId || !unitLevelId || !lotId) {
      throw new Error(`Dispense line is missing lookup data for ${line.productCode}`);
    }

    const unitLevelRow = await client.query(
      `
        SELECT id, unit_key, display_name, code
        FROM product_unit_levels
        WHERE id = $1
      `,
      [unitLevelId]
    );
    const unitLevel = unitLevelRow.rows[0];
    const baseUnitLevel = await resolveProductBaseUnitLevel(client, productId);
    const quantityBase = convertToBase(line.quantity, unitLevel);

    const dispenseLine = await client.query(
      `
        INSERT INTO dispense_lines (
          header_id,
          line_no,
          product_id,
          lot_id,
          unit_level_id,
          quantity,
          note_text,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamptz)
        RETURNING id
      `,
      [header.rows[0].id, lineNo, productId, lotId, unitLevelId, line.quantity, line.lineNote, dispensedAt]
    );

    await client.query(
      `
        INSERT INTO stock_movements (
          movement_type,
          from_location_id,
          to_location_id,
          product_id,
          lot_id,
          quantity,
          quantity_base,
          unit_level_id,
          dispense_line_id,
          source_ref_type,
          source_ref_id,
          occurred_at,
          created_by,
          note_text,
          created_at
        )
        VALUES (
          'DISPENSE',
          $1,
          NULL,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          'DISPENSE_HEADER',
          $8,
          $9::timestamptz,
          $10,
          $11,
          $9::timestamptz
        )
      `,
      [
        branchId,
        productId,
        lotId,
        line.quantity,
        convertMovementToSignedBase(line.quantity, "DISPENSE", unitLevel),
        unitLevelId,
        dispenseLine.rows[0].id,
        header.rows[0].id,
        dispensedAt,
        pharmacistUserId,
        scenario.noteText,
      ]
    );

    await applyStockDelta(client, {
      branchId,
      productId,
      lotId,
      baseUnitLevelId: baseUnitLevel.id,
      deltaQtyBase: -quantityBase,
    });

    lineNo += 1;
  }
}

async function seedLotWhitelists(client, productContext) {
  for (const scenario of lotWhitelistScenarios) {
    const productId = productContext.productIdsByCode.get(scenario.productCode);
    const lotId = productContext.lotIdsByProductAndLotNo.get(
      `${scenario.productCode}|${scenario.lotNo}`
    );

    if (!productId || !lotId) {
      throw new Error(`Lot whitelist is missing lookup data for ${scenario.productCode}`);
    }

    await client.query(
      `
        UPDATE product_lot_allowed_unit_levels
        SET is_active = false,
            is_default = false,
            updated_at = now()
        WHERE product_lot_id = $1
      `,
      [lotId]
    );

    for (const unitCode of scenario.allowedUnitCodes) {
      const unitLevelId = productContext.unitLevelIdsByProductCode
        .get(scenario.productCode)
        ?.get(unitCode);
      if (!unitLevelId) {
        throw new Error(
          `Missing unit ${unitCode} for lot whitelist product ${scenario.productCode}`
        );
      }

      await client.query(
        `
          INSERT INTO product_lot_allowed_unit_levels (
            product_id,
            product_lot_id,
            unit_level_id,
            is_default,
            is_active,
            source_type,
            note_text,
            updated_at
          )
          VALUES ($1, $2, $3, $4, true, 'SIMULATION_SEED', $5, now())
          ON CONFLICT (product_lot_id, unit_level_id) DO UPDATE
          SET
            is_default = EXCLUDED.is_default,
            is_active = true,
            source_type = EXCLUDED.source_type,
            note_text = EXCLUDED.note_text,
            updated_at = now()
        `,
        [
          productId,
          lotId,
          unitLevelId,
          scenario.defaultUnitCode === unitCode,
          scenario.noteText,
        ]
      );
    }
  }
}

async function seedPatients(client) {
  for (const patient of simulationPatients) {
    await upsertPatientByPid(client, patient);
  }
}

async function seedAdminAudits(client, refs) {
  for (const row of adminSqlAuditRows) {
    const executedBy = refs.userIdsByUsername.get(row.username);
    await client.query(
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
          error_message,
          created_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          now()
        )
      `,
      [
        executedBy,
        row.statementType,
        row.sqlText,
        row.succeeded,
        row.resultRowCount,
        row.wasTruncated,
        row.executionMs,
        row.statementTimeoutMs,
        row.rowCap,
        row.clientIp,
        row.errorMessage,
      ]
    );
  }
}

async function main() {
  const { databaseUrl, envFiles, warnings } = loadSimulationEnv();
  console.log(`[db:local-sim:seed] env files: ${formatEnvFiles(envFiles)}`);
  console.log(`[db:local-sim:seed] connection: ${databaseUrl}`);
  for (const warning of warnings) {
    console.warn(`[db:local-sim:seed] WARNING: ${warning}`);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await resetSimulationTables(client);
      const locationIdsByCode = await upsertLocations(client);
      const userIdsByUsername = await upsertUsers(client, locationIdsByCode);
      const refs = await buildReferenceMaps(client);
      refs.locationIdsByCode = new Map([...refs.locationIdsByCode, ...locationIdsByCode]);
      refs.userIdsByUsername = new Map([...refs.userIdsByUsername, ...userIdsByUsername]);

      await insertProductCatalog(client, refs);
      const preFixContext = await buildProductContext(client);
      await seedPreFixMovement(client, refs, preFixContext);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    await applyMigrationPlan({
      databaseUrl,
      fileNames: postCatalogFixMigrations,
      label: "post-catalog-fix",
    });

    const clientAfterFix = await pool.connect();
    try {
      await clientAfterFix.query("BEGIN");
      const refs = await buildReferenceMaps(clientAfterFix);
      await seedPatients(clientAfterFix);
      const productContext = await buildProductContext(clientAfterFix);

      const receiveResults = new Map();
      for (const scenario of receiveScenarios) {
        const result = await insertReceiveScenario(clientAfterFix, refs, productContext, scenario);
        receiveResults.set(`${scenario.productCode}|${scenario.lotNo}`, result);
      }

      const correctedMovement = receiveResults.get(
        `${occurredAtCorrectionScenario.productCode}|${occurredAtCorrectionScenario.lotNo}`
      );
      if (correctedMovement?.movementId) {
        await applyOccurredAtCorrection(
          clientAfterFix,
          refs,
          correctedMovement.movementId,
          occurredAtCorrectionScenario
        );
      }

      const freshProductContext = await buildProductContext(clientAfterFix);
      for (const scenario of transferScenarios) {
        await insertTransferScenario(clientAfterFix, refs, freshProductContext, scenario);
      }

      const postTransferContext = await buildProductContext(clientAfterFix);
      for (const scenario of dispenseScenarios) {
        await insertDispenseScenario(clientAfterFix, refs, postTransferContext, scenario);
      }

      const finalProductContext = await buildProductContext(clientAfterFix);
      await seedLotWhitelists(clientAfterFix, finalProductContext);
      await seedAdminAudits(clientAfterFix, refs);
      await clientAfterFix.query("COMMIT");
    } catch (error) {
      await clientAfterFix.query("ROLLBACK");
      throw error;
    } finally {
      clientAfterFix.release();
    }

    const summary = await pool.query(
      `
        SELECT
          (SELECT COUNT(*) FROM products) AS products,
          (SELECT COUNT(*) FROM product_lots) AS lots,
          (SELECT COUNT(*) FROM stock_movements) AS stock_movements,
          (SELECT COUNT(*) FROM inventory_transfer_requests) AS transfer_requests,
          (SELECT COUNT(*) FROM dispense_headers) AS dispense_headers,
          (SELECT COUNT(*) FROM patients) AS patients
      `
    );
    const row = summary.rows[0] || {};
    console.log(
      `[db:local-sim:seed] completed: products=${row.products || 0}, lots=${row.lots || 0}, stockMovements=${row.stock_movements || 0}, transfers=${row.transfer_requests || 0}, dispenses=${row.dispense_headers || 0}, patients=${row.patients || 0}`
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`[db:local-sim:seed] ${error.message}`);
  process.exit(1);
});
