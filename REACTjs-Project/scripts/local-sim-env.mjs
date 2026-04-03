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
];

export const postCatalogFixMigrations = [
  "0008_fix_movement_unit_level_refs.sql",
  "0011_fix_ic003358_prednisolone_unit_levels.sql",
  "0014_fix_batch_blister_base_unit_levels.sql",
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

export function quoteIdentifier(identifier) {
  return `"${String(identifier ?? "").replace(/"/g, '""')}"`;
}

export function loadSimulationEnv({ requireDatabase = true } = {}) {
  const lockedKeys = new Set(Object.keys(process.env));
  const rootEnv = fileIfExists(path.join(projectRoot, ".env"));
  const serverEnv = fileIfExists(path.join(serverRoot, ".env"));
  const rootSimEnv = fileIfExists(path.join(projectRoot, ".env.local-simulation"));
  const serverSimEnv = fileIfExists(path.join(serverRoot, ".env.local-simulation"));

  const loadedFiles = [];
  if (loadDotenvFile(rootEnv, { lockedKeys })) loadedFiles.push(rootEnv);
  if (loadDotenvFile(serverEnv, { override: true, lockedKeys })) loadedFiles.push(serverEnv);
  if (loadDotenvFile(rootSimEnv, { override: true, lockedKeys })) loadedFiles.push(rootSimEnv);
  if (loadDotenvFile(serverSimEnv, { override: true, lockedKeys })) loadedFiles.push(serverSimEnv);

  const pgHost = cleanText(process.env.PGHOST || "localhost");
  const pgPort = parseInteger(process.env.PGPORT, 5432);
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

  if (requireDatabase && !databaseUrl) {
    throw new Error(
      "DATABASE_URL is not configured. Copy server/.env.local-simulation.example or server/.env.example and set local PostgreSQL connection values first."
    );
  }

  return {
    databaseUrl,
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
    console.log(`[db:local:migrate] ${label}: ${fileName}`);
    await runPsqlFile({ databaseUrl, fileName });
  }
}

export function formatEnvFiles(envFiles) {
  return envFiles.length ? envFiles.map((filePath) => path.relative(projectRoot, filePath)).join(", ") : "(no env file found)";
}
