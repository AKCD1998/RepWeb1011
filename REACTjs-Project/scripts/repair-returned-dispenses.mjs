import { Pool } from "pg";
import {
  describeDatabaseTarget,
  formatDatabaseTarget,
  loadProductionDatabaseEnv,
  parseCliArgs,
} from "./db-migration-helpers.mjs";

function cleanText(value) {
  return String(value ?? "").trim();
}

function toNullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function toBooleanFlag(value) {
  if (value === true) return true;
  const text = cleanText(value).toLowerCase();
  return ["1", "true", "yes", "y"].includes(text);
}

function startOfDayIso(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function endOfDayIso(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: ${value}`);
  }
  date.setHours(23, 59, 59, 999);
  return date.toISOString();
}

function toPositiveNumberOrNull(value) {
  const text = cleanText(value);
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`Invalid positive quantity: ${value}`);
  }
  return numeric;
}

function buildReferenceKey({ explicitReferenceKey, dispenseLineId, returnedQuantity, returnedAt }) {
  if (explicitReferenceKey) return explicitReferenceKey;
  const quantityToken = returnedQuantity ? String(returnedQuantity).replace(/[^0-9.]+/g, "_") : "FULL";
  const dateToken = cleanText(returnedAt || "").replace(/[^0-9TZ:-]+/g, "_") || "AUTO";
  return `RETROACTIVE_REPAIR:${dispenseLineId}:${quantityToken}:${dateToken}`;
}

function formatCandidateRow(row) {
  return {
    dispensedAt: row.dispensedAt,
    branchCode: row.branchCode,
    patientPid: row.patientPid,
    dispenseLineId: row.lineId,
    dispenseHeaderId: row.headerId,
    productCode: row.productCode,
    tradeName: row.tradeName,
    lotNo: row.lotNo || "-",
    dispensedQuantity: row.dispensedQuantity,
    returnedQuantity: row.returnedQuantity,
    remainingQuantity: row.remainingQuantity,
    returnStatus: row.returnStatus,
  };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const apply = toBooleanFlag(args.apply);
  const env = loadProductionDatabaseEnv({ requireDatabase: true });
  const target = env.databaseTarget || describeDatabaseTarget(env.databaseUrl);
  const pool = new Pool({
    connectionString: env.databaseUrl,
    ssl: target?.isLoopback ? false : { rejectUnauthorized: false },
  });

  console.log(`[repair-returned-dispenses] target: ${formatDatabaseTarget(target)}`);
  console.log(`[repair-returned-dispenses] mode: ${apply ? "apply" : "dry-run"}`);

  try {
    const service = await import("../server/controllers/dispenseReturnsService.js");

    if (!apply) {
      const client = await pool.connect();
      try {
        const hasExplicitFilters = [
          args.pid,
          args["branch-code"],
          args["product-code"],
          args["product-name"],
          args["lot-no"],
          args["dispense-line-id"],
          args["dispense-header-id"],
          args["date-from"],
          args["date-to"],
        ].some((value) => cleanText(value));

        const filters = {
          pid: toNullableText(args.pid),
          branchCode: toNullableText(args["branch-code"]),
          productCode: toNullableText(args["product-code"]),
          productName: toNullableText(args["product-name"]),
          lotNo: toNullableText(args["lot-no"]),
          dispenseLineId: toNullableText(args["dispense-line-id"]),
          dispenseHeaderId: toNullableText(args["dispense-header-id"]),
          dateFrom: toNullableText(args["date-from"]) || (!hasExplicitFilters ? startOfDayIso() : null),
          dateTo: toNullableText(args["date-to"]) || (!hasExplicitFilters ? endOfDayIso() : null),
        };

        const rows = await service.listDispenseReturnCandidates(client, filters);
        const candidates = rows
          .filter((row) => Number(row.remainingQuantity || 0) > 0)
          .map(formatCandidateRow);

        if (!candidates.length) {
          console.log("No candidate dispense lines found for retroactive return repair.");
          return;
        }

        console.log(JSON.stringify({ filters, candidates }, null, 2));
        console.log("");
        console.log(
          "Use --apply --dispense-line-id <uuid> [--returned-quantity <n>] [--returned-at <iso>] [--reference-key <key>] to replay one return safely."
        );
        return;
      } finally {
        client.release();
      }
    }

    const dispenseLineId = cleanText(args["dispense-line-id"]);
    if (!dispenseLineId) {
      throw new Error("--dispense-line-id is required when --apply is used");
    }

    const returnedQuantity = toPositiveNumberOrNull(args["returned-quantity"]);
    const returnedAt = toNullableText(args["returned-at"]);
    const referenceKey = buildReferenceKey({
      explicitReferenceKey: toNullableText(args["reference-key"]),
      dispenseLineId,
      returnedQuantity,
      returnedAt,
    });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await service.createDispenseReturn(client, {
        dispenseLineId,
        dispenseHeaderId: toNullableText(args["dispense-header-id"]),
        patientPid: toNullableText(args.pid),
        branchCode: toNullableText(args["branch-code"]),
        productCode: toNullableText(args["product-code"]),
        lotNo: toNullableText(args["lot-no"]),
        returnedQuantity,
        returnedAt,
        reason: toNullableText(args.reason) || "Retroactive repair for prior frontend-only return success",
        noteText:
          toNullableText(args.note) ||
          "Replayed persisted return after historical UI-only success without stock restoration.",
        returnSource: "RETROACTIVE_REPAIR",
        referenceKey,
        returnedByUserId: toNullableText(args["returned-by-user-id"]),
      });
      await client.query("COMMIT");

      console.log(JSON.stringify({ ok: true, referenceKey, result }, null, 2));
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(
    `[repair-returned-dispenses] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exit(1);
});
