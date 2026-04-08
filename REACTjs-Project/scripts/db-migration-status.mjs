import {
  loadMigrationEnvironment,
  logMigrationContext,
  parseCliArgs,
  probeManagedMigration,
  resolveManagedMigrationFile,
} from "./db-migration-helpers.mjs";

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const profile = String(args.profile || "production-live");
  const { fileName, definition } = resolveManagedMigrationFile(args.migration);
  const env = loadMigrationEnvironment(profile);

  logMigrationContext({
    label: "db:migration:status",
    profile: env.profile,
    envFiles: env.envFiles,
    databaseTarget: env.databaseTarget,
    migrationFile: fileName,
    warnings: env.warnings,
  });
  console.log(`[db:migration:status] description: ${definition.description}`);

  const state = await probeManagedMigration({
    databaseUrl: env.databaseUrl,
    migrationFile: fileName,
  });

  for (const detail of state.details) {
    console.log(`[db:migration:status] ${detail.label}: ${detail.ok ? "present" : "missing"}`);
  }

  if (!state.prerequisitesMet) {
    console.log(
      "[db:migration:status] prerequisite status: NOT READY (required dependency objects are missing)"
    );
  }

  console.log(`[db:migration:status] status: ${state.applied ? "APPLIED" : "PENDING"}`);
}

main().catch((error) => {
  console.error(`[db:migration:status] ${error.message}`);
  process.exit(1);
});
