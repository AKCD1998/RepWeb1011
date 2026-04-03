import {
  applyMigrationPlan,
  formatEnvFiles,
  loadSimulationEnv,
  postCatalogFixMigrations,
  preSeedMigrations,
  referenceOnlyMigrations,
} from "./local-sim-env.mjs";

async function main() {
  const args = new Set(process.argv.slice(2));
  const includePostCatalogFixes = args.has("--include-post-catalog-fixes");
  const { databaseUrl, envFiles } = loadSimulationEnv();

  console.log(`[db:local:migrate] env files: ${formatEnvFiles(envFiles)}`);
  console.log(
    `[db:local:migrate] skipped reference-only files: ${referenceOnlyMigrations.join(", ")}`
  );

  await applyMigrationPlan({
    databaseUrl,
    fileNames: preSeedMigrations,
    label: "pre-seed",
  });

  if (includePostCatalogFixes) {
    await applyMigrationPlan({
      databaseUrl,
      fileNames: postCatalogFixMigrations,
      label: "post-catalog-fix",
    });
  } else {
    console.log(
      `[db:local:migrate] deferred data-fix migrations until seed: ${postCatalogFixMigrations.join(
        ", "
      )}`
    );
  }
}

main().catch((error) => {
  console.error(`[db:local:migrate] ${error.message}`);
  process.exit(1);
});
