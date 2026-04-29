import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const projectRoot = path.resolve(__dirname, "..");
export const serverRoot = path.join(projectRoot, "server");
export const migrationsRoot = path.join(projectRoot, "migrations");
export const defaultLocalDatabaseName = "rx1011_local";
export const standardLocalSimulationHost = "localhost";
export const standardLocalSimulationPort = 55433;

export const referenceOnlyMigrations = ["0003_ky1011_example_queries.sql"];

export const preSeedMigrations = [
  "0001_ky1011_schema.sql",
  "0002_ky1011_seed_reference.sql",
  "0004_ky1011_report_groups.sql",
  "0005_auth_fields.sql",
  "0006_auth_revoked_tokens.sql",
  "0007_unit_level_code_stability.sql",
  "0009_stock_movements_quantity_base_ssot.sql",
  "0010_active_ingredients_name_en_uppercase_guard.sql",
  "0010_seed_login_usernames_refresh.sql",
  "0012_stock_movement_occurred_at_corrections.sql",
  "0013_backfill_stock_movement_occurred_at_from_created_at.sql",
  "0015_pending_transfer_requests.sql",
  "0016_product_unit_levels_is_active.sql",
  "0017_product_lot_allowed_unit_levels.sql",
  "0018_admin_sql_query_audits.sql",
  "0019_product_lot_edit_audits.sql",
  "0020_admin_incident_reports.sql",
  "0021_product_report_receive_unit_levels.sql",
  "0022_incident_report_resolution_actions.sql",
  "0023_stock_movement_delete_audits.sql",
  "0024_incident_report_admin_audits.sql",
  "0025_product_lot_normalization_audits.sql",
];

export const postCatalogFixMigrations = [
  "0008_fix_movement_unit_level_refs.sql",
  "0011_fix_ic003358_prednisolone_unit_levels.sql",
  "0014_fix_batch_blister_base_unit_levels.sql",
  "0021_repair_corrupted_packaging_display_names.sql",
];

function fileIfExists(filePath) {
  return fs.existsSync(filePath) ? filePath : "";
}

function loadDotenvFile(filePath, { override = false, lockedKeys = new Set() } = {}) {
  if (!filePath || !fs.existsSync(filePath)) return false;
  const parsed = dotenv.parse(fs.readFileSync(filePath));
  for (const [key, value] of Object.entries(parsed)) {
    if (lockedKeys.has(key)) continue;
    if (!override && process.env[key] !== undefined) continue;
    process.env[key] = value;
  }
  return true;
}

function parseInteger(value, fallback) {
  const numeric = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function buildDatabaseUrlFromParts({
  host,
  port,
  user,
  password,
  database,
  sslmode = "",
}) {
  const url = new URL("postgresql://localhost");
  url.hostname = host || "localhost";
  url.port = port ? String(port) : "";
  url.username = user || "";
  url.password = password || "";
  url.pathname = `/${database || defaultLocalDatabaseName}`;
  if (sslmode) {
    url.searchParams.set("sslmode", sslmode);
  }
  return url.toString();
}

function normalizeDatabaseUrl(rawUrl) {
  const text = cleanText(rawUrl);
  if (!text) return "";
  return new URL(text).toString();
}

function isLoopbackHost(hostname) {
  const normalized = cleanText(hostname).toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function parseDatabaseTarget(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const host = cleanText(parsed.hostname);
  return {
    host,
    port: parseInteger(parsed.port, 5432),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "") || ""),
    isLoopback: isLoopbackHost(host),
  };
}

function assertLocalSimulationDatabaseUrl(databaseUrl) {
  const target = parseDatabaseTarget(databaseUrl);
  if (!isLoopbackHost(target.host)) {
    throw new Error(
      `Local simulation scripts only support a loopback PostgreSQL target. Refusing DATABASE_URL host "${target.host}" because Render/live databases are not allowed here.`
    );
  }
  return target;
}

function collectSimulationWarnings(target) {
  const warnings = [];

  if (target.port !== standardLocalSimulationPort) {
    warnings.push(
      `Non-standard local PostgreSQL port detected (${target.host}:${target.port}). The repo standard local-simulation endpoint is ${standardLocalSimulationHost}:${standardLocalSimulationPort}; localhost:5433 is legacy-local-5433 and the older Docker port localhost:55432 is not part of the default workflow.`
    );
  }

  if (target.database && target.database !== defaultLocalDatabaseName) {
    warnings.push(
      `Non-standard local database name detected (${target.database}). The repo standard for local simulation is ${defaultLocalDatabaseName}.`
    );
  }

  return warnings;
}

export function quoteIdentifier(identifier) {
  return `"${String(identifier ?? "").replace(/"/g, '""')}"`;
}

export function loadSimulationEnv({ requireDatabase = true } = {}) {
  const rootSimEnv = fileIfExists(path.join(projectRoot, ".env.local-simulation"));
  const serverSimEnv = fileIfExists(path.join(serverRoot, ".env.local-simulation"));

  const loadedFiles = [];
  if (loadDotenvFile(rootSimEnv, { override: true })) loadedFiles.push(rootSimEnv);
  if (loadDotenvFile(serverSimEnv, { override: true })) loadedFiles.push(serverSimEnv);

  const pgHost = cleanText(process.env.PGHOST || standardLocalSimulationHost);
  const pgPort = parseInteger(process.env.PGPORT, standardLocalSimulationPort);
  const pgUser = cleanText(process.env.PGUSER || "");
  const pgPassword = String(process.env.PGPASSWORD ?? "");
  const pgDatabase = cleanText(process.env.PGDATABASE || defaultLocalDatabaseName);
  const sslmode = cleanText(process.env.PGSSLMODE || "");

  const databaseUrl =
    normalizeDatabaseUrl(process.env.DATABASE_URL) ||
    buildDatabaseUrlFromParts({
      host: pgHost,
      port: pgPort,
      user: pgUser,
      password: pgPassword,
      database: pgDatabase,
      sslmode,
    });

  process.env.DATABASE_URL = databaseUrl;
  process.env.PGHOST = pgHost;
  process.env.PGPORT = String(pgPort);
  process.env.PGUSER = pgUser;
  process.env.PGPASSWORD = pgPassword;
  process.env.PGDATABASE = pgDatabase;
  process.env.RX1011_ENV_PROFILE = "local-simulation";
  if (serverSimEnv || rootSimEnv) {
    process.env.RX1011_SERVER_ENV_FILE = serverSimEnv || rootSimEnv;
  }

  if (requireDatabase && !databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Copy server/.env.local-simulation.example and set local PostgreSQL connection values first."
    );
  }

  const target = databaseUrl ? assertLocalSimulationDatabaseUrl(databaseUrl) : null;
  const warnings = target ? collectSimulationWarnings(target) : [];

  return {
    databaseUrl,
    databaseTarget: target,
    pgConfig: {
      host: pgHost,
      port: pgPort,
      user: pgUser,
      password: pgPassword,
      database: pgDatabase,
      sslmode,
    },
    envFiles: loadedFiles,
    simulationOverrideFiles: [rootSimEnv, serverSimEnv].filter(Boolean),
    warnings,
  };
}

export function createAdminDatabaseUrl(databaseUrl, adminDatabaseName = "postgres") {
  const parsed = new URL(databaseUrl);
  parsed.pathname = `/${adminDatabaseName}`;
  return parsed.toString();
}

export function resolveMigrationFile(fileName) {
  const filePath = path.join(migrationsRoot, fileName);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Migration file not found: ${fileName}`);
  }
  return filePath;
}

export async function runCommand(command, args, options = {}) {
  const { env = process.env, cwd = projectRoot, stdio = "inherit" } = options;

  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio,
      shell: false,
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

export async function runPsqlFile({ databaseUrl, fileName }) {
  const filePath = resolveMigrationFile(fileName);
  await runCommand("psql", ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--dbname", databaseUrl, "--file", filePath]);
}

export async function applyMigrationPlan({ databaseUrl, fileNames, label }) {
  for (const fileName of fileNames) {
    console.log(`[db:local-sim:migrate] ${label}: ${fileName}`);
    await runPsqlFile({ databaseUrl, fileName });
  }
}

export function formatEnvFiles(envFiles) {
  return envFiles.length ? envFiles.map((filePath) => path.relative(projectRoot, filePath)).join(", ") : "(no env file found)";
}
