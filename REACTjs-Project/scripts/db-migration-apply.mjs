import {
  applyManagedMigration,
  loadMigrationEnvironment,
  logMigrationContext,
  parseCliArgs,
  probeManagedMigration,
  resolveManagedMigrationFile,
} from "./db-migration-helpers.mjs";

function buildReplayCommand({ profile, migrationFile, requireAllowRemote }) {
  return [
    "node scripts/db-migration-apply.mjs",
    `--profile ${profile}`,
    `--migration ${migrationFile}`,
    "--execute",
    requireAllowRemote ? "--allow-remote" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const profile = String(args.profile || "production-live");
  const execute = Boolean(args.execute);
  const allowRemote = Boolean(args["allow-remote"]);
  const { fileName, definition } = resolveManagedMigrationFile(args.migration);
  const env = loadMigrationEnvironment(profile);

  logMigrationContext({
    label: "db:migration:apply",
    profile: env.profile,
    envFiles: env.envFiles,
    databaseTarget: env.databaseTarget,
    migrationFile: fileName,
    warnings: env.warnings,
  });
  console.log(`[db:migration:apply] description: ${definition.description}`);

  const before = await probeManagedMigration({
    databaseUrl: env.databaseUrl,
    migrationFile: fileName,
  });

  for (const detail of before.details) {
    console.log(`[db:migration:apply] ${detail.label}: ${detail.ok ? "present" : "missing"}`);
  }

  if (before.applied) {
    console.log("[db:migration:apply] status: already applied; nothing to do");
    return;
  }

  if (!before.prerequisitesMet) {
    throw new Error(
      "Required prerequisite objects are missing, so this migration is not safe to apply yet."
    );
  }

  const requireAllowRemote = profile === "production-live" && !env.databaseTarget.isLoopback;
  if (!execute) {
    console.log("[db:migration:apply] dry run only; no SQL was executed");
    console.log(
      `[db:migration:apply] re-run intentionally with: ${buildReplayCommand({
        profile,
        migrationFile: fileName,
        requireAllowRemote,
      })}`
    );
    return;
  }

  if (requireAllowRemote && !allowRemote) {
    throw new Error(
      "Refusing to apply to a remote/non-loopback database without --allow-remote. This guard exists so Render/live changes stay explicit."
    );
  }

  console.log("[db:migration:apply] executing migration file with psql");
  await applyManagedMigration({
    databaseUrl: env.databaseUrl,
    migrationFile: fileName,
  });

  const after = await probeManagedMigration({
    databaseUrl: env.databaseUrl,
    migrationFile: fileName,
  });

  if (!after.applied) {
    throw new Error(
      "Migration command completed but the schema probe still reports PENDING. Investigate before deploying dependent code."
    );
  }

  console.log("[db:migration:apply] verification: APPLIED");
}

main().catch((error) => {
  console.error(`[db:migration:apply] ${error.message}`);
  process.exit(1);
});
