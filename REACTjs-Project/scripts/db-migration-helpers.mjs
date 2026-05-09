import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { Pool } from "pg";
import {
  formatEnvFiles,
  loadSimulationEnv,
  projectRoot,
  referenceOnlyMigrations,
  resolveMigrationFile,
  runPsqlFile,
  serverRoot,
} from "./local-sim-env.mjs";
import {
  defaultManagedMigrationFile,
  getManagedMigrationDefinition,
} from "./db-migration-manifest.mjs";

function fileIfExists(filePath) {
  return fs.existsSync(filePath) ? filePath : "";
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function normalizeDatabaseUrl(rawUrl) {
  const text = cleanText(rawUrl);
  if (!text) return "";
  return new URL(text).toString();
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

function isLoopbackHost(hostname) {
  const normalized = cleanText(hostname).toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function shouldUseSsl(databaseUrl) {
  if (!databaseUrl) return false;
  const target = describeDatabaseTarget(databaseUrl);
  return !target.isLoopback;
}

export function parseCliArgs(argv) {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;

    const trimmed = token.slice(2);
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex >= 0) {
      const key = trimmed.slice(0, equalsIndex);
      const value = trimmed.slice(equalsIndex + 1);
      args[key] = value;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[trimmed] = next;
      index += 1;
      continue;
    }

    args[trimmed] = true;
  }

  return args;
}

export function describeDatabaseTarget(databaseUrl) {
  const parsed = new URL(databaseUrl);
  return {
    host: cleanText(parsed.hostname),
    port: parseInteger(parsed.port, 5432),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "") || ""),
    isLoopback: isLoopbackHost(parsed.hostname),
  };
}

export function formatDatabaseTarget(target) {
  return `${target.host}:${target.port}/${target.database || "(missing-db-name)"} ${
    target.isLoopback ? "[loopback]" : "[remote]"
  }`;
}

export function loadProductionDatabaseEnv({ requireDatabase = true } = {}) {
  const lockedKeys = new Set(Object.keys(process.env));
  const serverEnv = fileIfExists(path.join(serverRoot, ".env"));
  const rootEnv = fileIfExists(path.join(projectRoot, ".env"));
  const envFiles = [];

  if (loadDotenvFile(serverEnv, { lockedKeys })) {
    envFiles.push(serverEnv);
  } else if (loadDotenvFile(rootEnv, { lockedKeys })) {
    envFiles.push(rootEnv);
  }

  const databaseUrl = normalizeDatabaseUrl(
    process.env.RX1011_DATABASE_URL || process.env.DATABASE_URL
  );

  if (requireDatabase && !databaseUrl) {
    throw new Error(
      "RX1011_DATABASE_URL or DATABASE_URL is not configured for production-live checks. Set it in the environment or provide server/.env."
    );
  }

  const target = databaseUrl ? describeDatabaseTarget(databaseUrl) : null;
  const warnings = [];

  if (target?.isLoopback) {
    warnings.push(
      "production-live profile resolved to a loopback PostgreSQL target. This is unusual; verify you are not checking a local database by mistake."
    );
  }

  return {
    profile: "production-live",
    databaseUrl,
    databaseTarget: target,
    envFiles,
    warnings,
  };
}

export function loadMigrationEnvironment(profile = "production-live") {
  if (profile === "local-sim") {
    const env = loadSimulationEnv();
    return {
      profile,
      ...env,
    };
  }

  if (profile === "production-live") {
    return loadProductionDatabaseEnv();
  }

  throw new Error(`Unsupported --profile value: ${profile}`);
}

export function resolveManagedMigrationFile(fileName = defaultManagedMigrationFile) {
  const normalizedFileName = cleanText(fileName) || defaultManagedMigrationFile;

  if (referenceOnlyMigrations.includes(normalizedFileName)) {
    throw new Error(`Refusing reference-only file ${normalizedFileName}; it is not an executable migration.`);
  }

  resolveMigrationFile(normalizedFileName);

  const definition = getManagedMigrationDefinition(normalizedFileName);
  if (!definition) {
    throw new Error(
      `No managed schema probe exists for ${normalizedFileName}. This repo has no migration history table, so status/apply helpers only support explicitly reviewed migrations.`
    );
  }

  return {
    fileName: normalizedFileName,
    definition,
  };
}

export async function probeManagedMigration({ databaseUrl, migrationFile }) {
  const { definition } = resolveManagedMigrationFile(migrationFile);
  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: shouldUseSsl(databaseUrl) ? { rejectUnauthorized: false } : false,
  });

  try {
    const result = await pool.query(definition.probeQuery);
    const row = result.rows[0] || {};
    const interpreted = definition.interpretProbe(row);
    return {
      fileName: migrationFile,
      definition,
      raw: row,
      ...interpreted,
    };
  } finally {
    await pool.end();
  }
}

export async function applyManagedMigration({ databaseUrl, migrationFile }) {
  const { fileName } = resolveManagedMigrationFile(migrationFile);
  await runPsqlFile({ databaseUrl, fileName });
}

export function logMigrationContext({ label, profile, envFiles, databaseTarget, migrationFile, warnings = [] }) {
  console.log(`[${label}] profile: ${profile}`);
  console.log(`[${label}] env files: ${formatEnvFiles(envFiles)}`);
  console.log(`[${label}] target: ${formatDatabaseTarget(databaseTarget)}`);
  console.log(`[${label}] migration: ${migrationFile}`);
  console.log(`[${label}] migration tracking: none in repo; using schema probe for managed migrations`);
  for (const warning of warnings) {
    console.warn(`[${label}] WARNING: ${warning}`);
  }
}
