import { Pool } from "pg";
import {
  createAdminDatabaseUrl,
  formatEnvFiles,
  loadSimulationEnv,
  quoteIdentifier,
} from "./local-sim-env.mjs";

async function main() {
  const { databaseUrl, envFiles, warnings } = loadSimulationEnv();
  const parsed = new URL(databaseUrl);
  const targetDatabaseName = decodeURIComponent(parsed.pathname.replace(/^\//, "") || "");
  if (!targetDatabaseName) {
    throw new Error("DATABASE_URL must include a database name");
  }

  const adminDatabaseUrl = createAdminDatabaseUrl(databaseUrl);
  const adminPool = new Pool({ connectionString: adminDatabaseUrl });

  try {
    const existsResult = await adminPool.query(
      `
        SELECT 1
        FROM pg_database
        WHERE datname = $1
        LIMIT 1
      `,
      [targetDatabaseName]
    );

    if (existsResult.rows[0]) {
      console.log(`[db:local-sim:init] database already exists: ${targetDatabaseName}`);
    } else {
      console.log(`[db:local-sim:init] creating database: ${targetDatabaseName}`);
      await adminPool.query(`CREATE DATABASE ${quoteIdentifier(targetDatabaseName)}`);
    }

    console.log(`[db:local-sim:init] env files: ${formatEnvFiles(envFiles)}`);
    console.log(`[db:local-sim:init] connection: ${databaseUrl}`);
    for (const warning of warnings) {
      console.warn(`[db:local-sim:init] WARNING: ${warning}`);
    }
  } finally {
    await adminPool.end();
  }
}

main().catch((error) => {
  console.error(`[db:local-sim:init] ${error.message}`);
  process.exit(1);
});
