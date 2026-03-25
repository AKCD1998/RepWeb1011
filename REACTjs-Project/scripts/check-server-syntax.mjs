import { readdir } from "fs/promises";
import path from "path";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const serverRoot = path.join(projectRoot, "server");

async function collectJsFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && /\.(js|mjs)$/i.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

function checkSyntax(filePath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--check", filePath], {
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Syntax check failed for ${filePath}`));
    });
  });
}

async function main() {
  const files = (await collectJsFiles(serverRoot)).sort((left, right) => left.localeCompare(right));

  for (const filePath of files) {
    await checkSyntax(filePath);
  }

  console.log(`Checked server syntax: ${files.length} files`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
