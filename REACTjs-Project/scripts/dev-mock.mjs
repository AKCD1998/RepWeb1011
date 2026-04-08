import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { formatEnvFiles, loadSimulationEnv, projectRoot } from "./local-sim-env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function runChild(command, args, env) {
  return spawn(command, args, {
    cwd: projectRoot,
    env,
    stdio: "inherit",
    shell: false,
  });
}

async function main() {
  const { databaseUrl, envFiles, warnings } = loadSimulationEnv();
  const sharedEnv = {
    ...process.env,
  };

  console.log(`[dev:local-sim] env files: ${formatEnvFiles(envFiles)}`);
  console.log(`[dev:local-sim] database target: ${databaseUrl}`);
  for (const warning of warnings) {
    console.warn(`[dev:local-sim] WARNING: ${warning}`);
  }
  console.log(
    `[dev:local-sim] starting backend on ${sharedEnv.PORT || 5050} and Vite on ${
      sharedEnv.VITE_PORT || 5173
    } (local simulation only)`
  );

  const backend = runChild(process.execPath, [path.join(projectRoot, "server", "index.js")], sharedEnv);
  const viteBin = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");
  const frontend = runChild(process.execPath, [viteBin], sharedEnv);

  let stopping = false;

  function shutdown(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    backend.kill();
    frontend.kill();
    setTimeout(() => process.exit(exitCode), 50);
  }

  backend.on("exit", (code) => shutdown(code || 0));
  frontend.on("exit", (code) => shutdown(code || 0));

  process.on("SIGINT", () => shutdown(0));
  process.on("SIGTERM", () => shutdown(0));
}

main().catch((error) => {
  console.error(`[dev:local-sim] ${error.message}`);
  process.exit(1);
});
