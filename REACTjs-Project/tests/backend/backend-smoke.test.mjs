import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jest } from "@jest/globals";
import request from "supertest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");
const serverEntry = path.join(projectRoot, "server", "index.js");

jest.setTimeout(30000);

process.env.DATABASE_URL = "";
process.env.RX1011_DATABASE_URL = "";
process.env.JWT_SECRET = "test-only-secret";
process.env.RX1011_JWT_SECRET = "";
process.env.AUTH_JWT_SECRET = "";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function waitForServer(child, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    let output = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Timed out waiting for backend to start. Output:\n${output}`));
    }, timeoutMs);

    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(output);
    }

    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      if (output.includes("Server listening on")) {
        finish();
      }
    });

    child.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    child.on("error", finish);
    child.on("exit", (code) => {
      if (!settled) {
        finish(new Error(`Backend exited before startup with code ${code}. Output:\n${output}`));
      }
    });
  });
}

function stopServer(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }

    const fallback = setTimeout(() => {
      resolve();
    }, 3000);

    child.once("exit", () => {
      clearTimeout(fallback);
      resolve();
    });

    child.kill();
  });
}

describe("backend module smoke imports", () => {
  test("database connection layer imports safely without a database URL", async () => {
    const db = await import("../../server/db/pool.js");

    expect(db.pool).toBeNull();
    expect(db.hasDatabase()).toBe(false);
    expect(typeof db.query).toBe("function");
    expect(typeof db.getClient).toBe("function");
    expect(typeof db.withTransaction).toBe("function");
    expect(typeof db.healthCheck).toBe("function");
  });

  test.each([
    ["auth controller", "../../server/controllers/authController.js"],
    ["admin controller", "../../server/controllers/adminController.js"],
    ["admin dispense corrections controller", "../../server/controllers/adminDispenseCorrectionsController.js"],
    ["admin incidents controller", "../../server/controllers/adminIncidentsController.js"],
    ["admin patients controller", "../../server/controllers/adminPatientsController.js"],
    ["dispense controller", "../../server/controllers/dispenseController.js"],
    ["inventory controller", "../../server/controllers/inventoryController.js"],
    ["organic reports controller", "../../server/controllers/organicReportsController.js"],
    ["products controller", "../../server/controllers/productsController.js"],
    ["controller helpers", "../../server/controllers/helpers.js"],
    ["incident resolution helpers", "../../server/controllers/incidentResolutionHelpers.js"],
    ["auth routes", "../../server/routes/authRoutes.js"],
    ["admin routes", "../../server/routes/adminRoutes.js"],
    ["products routes", "../../server/routes/productsRoutes.js"],
    ["inventory routes", "../../server/routes/inventoryRoutes.js"],
    ["dispense routes", "../../server/routes/dispenseRoutes.js"],
    ["reporting routes", "../../server/routes/reportingRoutes.js"],
    ["active ingredients routes", "../../server/routes/activeIngredientsRoutes.js"],
    ["auth middleware", "../../server/middleware/authMiddleware.js"],
  ])("%s imports safely", async (_label, modulePath) => {
    const module = await import(modulePath);

    expect(module).toBeTruthy();
  });
});

describe("backend HTTP baseline", () => {
  let child;
  let api;

  beforeAll(async () => {
    const port = await getFreePort();
    child = spawn(process.execPath, [serverEntry], {
      cwd: projectRoot,
      env: {
        ...process.env,
        DATABASE_URL: "",
        RX1011_DATABASE_URL: "",
        JWT_SECRET: "test-only-secret",
        RX1011_JWT_SECRET: "",
        AUTH_JWT_SECRET: "",
        PORT: String(port),
        RX1011_CORS_ORIGIN: "http://localhost:5173",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await waitForServer(child);
    api = request(`http://127.0.0.1:${port}`);
  });

  afterAll(async () => {
    await stopServer(child);
  });

  test("server process starts and returns JSON 404 for unknown routes", async () => {
    const response = await api.get("/api/not-a-real-route");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Not found" });
  });

  test("health endpoint reports missing database URL without crashing", async () => {
    const response = await api.get("/api/health");

    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({
      ok: false,
      database: {
        ok: false,
        message: "RX1011_DATABASE_URL or DATABASE_URL is not set",
      },
    });
  });

  test("patients CSV fallback responds without a database", async () => {
    const response = await api.get("/api/patients");

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
  });

  test.each([
    ["POST", "/api/auth/login", {}, 400],
    ["POST", "/api/auth/logout", {}, 401],
    ["GET", "/api/admin/patients", null, 401],
    ["GET", "/api/admin/dispense-lines/00000000-0000-4000-8000-000000000000", null, 401],
    ["PATCH", "/api/admin/dispense-lines/00000000-0000-4000-8000-000000000000/correct-lot", { newLotId: "00000000-0000-4000-8000-000000000001", reason: "test" }, 401],
    ["POST", "/api/inventory/receive", {}, 401],
    ["GET", "/api/dispense/history", null, 401],
    ["GET", "/api/stock/on-hand", null, 401],
    ["GET", "/api/products", null, 500],
    ["GET", "/api/products/version", null, 500],
    ["GET", "/api/active-ingredients", null, 500],
  ])("%s %s returns the current expected baseline status", async (method, route, body, status) => {
    const response =
      method === "POST"
        ? await api.post(route).send(body || {})
        : method === "PATCH"
        ? await api.patch(route).send(body || {})
        : await api.get(route);

    expect(response.status).toBe(status);
    expect(response.type).toMatch(/json/);
  });
});
