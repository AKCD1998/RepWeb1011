import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.join(__dirname, "..");

const serverEnvPath = path.join(__dirname, ".env");
const rootEnvPath = path.join(projectRoot, ".env");
const explicitEnvPath = process.env.RX1011_SERVER_ENV_FILE
  ? path.resolve(projectRoot, process.env.RX1011_SERVER_ENV_FILE)
  : "";
const envPath =
  (explicitEnvPath && fs.existsSync(explicitEnvPath) && explicitEnvPath) ||
  (fs.existsSync(serverEnvPath) ? serverEnvPath : rootEnvPath);
dotenv.config({ path: envPath });

const { healthCheck, hasDatabase, query } = await import("./db/pool.js");
const authRoutes = (await import("./routes/authRoutes.js")).default;
const adminRoutes = (await import("./routes/adminRoutes.js")).default;
const productsRoutes = (await import("./routes/productsRoutes.js")).default;
const activeIngredientsRoutes = (await import("./routes/activeIngredientsRoutes.js")).default;
const inventoryRoutes = (await import("./routes/inventoryRoutes.js")).default;
const dispenseRoutes = (await import("./routes/dispenseRoutes.js")).default;
const reportingRoutes = (await import("./routes/reportingRoutes.js")).default;

const app = express();
const PORT = Number(process.env.PORT || 5050);

const corsOrigins = String(
  process.env.RX1011_CORS_ORIGIN || process.env.CORS_ORIGIN || "http://localhost:5173"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function normalizeOrigin(origin) {
  const text = String(origin || "").trim();
  if (!text) return "";

  try {
    const url = new URL(text);
    const protocol = url.protocol.toLowerCase();
    const hostname = url.hostname.toLowerCase();
    const port =
      url.port || (protocol === "https:" ? "443" : protocol === "http:" ? "80" : "");
    return `${protocol}//${hostname}:${port}`;
  } catch {
    return text.replace(/\/+$/, "").toLowerCase();
  }
}

function isLoopbackHost(hostname) {
  const value = String(hostname || "").trim().toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function isLoopbackOrigin(origin) {
  try {
    const url = new URL(String(origin || "").trim());
    return url.protocol === "http:" && isLoopbackHost(url.hostname);
  } catch {
    return false;
  }
}

function buildAllowedOrigins(origins) {
  const allowed = new Set();

  origins.forEach((origin) => {
    const normalized = normalizeOrigin(origin);
    if (!normalized) return;
    allowed.add(normalized);

    try {
      const url = new URL(origin);
      const protocol = url.protocol.toLowerCase();
      const port =
        url.port || (protocol === "https:" ? "443" : protocol === "http:" ? "80" : "");

      if (isLoopbackHost(url.hostname)) {
        ["localhost", "127.0.0.1", "::1"].forEach((host) => {
          allowed.add(`${protocol}//${host.toLowerCase()}:${port}`);
        });
      }
    } catch {
      // Ignore malformed origin entries; they simply won't get loopback aliases.
    }
  });

  return allowed;
}

const allowedCorsOrigins = buildAllowedOrigins(corsOrigins);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (
        !allowedCorsOrigins.size ||
        allowedCorsOrigins.has(normalizeOrigin(origin)) ||
        isLoopbackOrigin(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error(`CORS blocked origin: ${origin}`));
    },
  })
);
app.use(express.json({ limit: "2mb" }));

app.get("/api/health", async (_req, res) => {
  const db = await healthCheck();
  res.status(db.ok ? 200 : 503).json({
    ok: db.ok,
    envPathUsed: envPath,
    database: db,
  });
});

app.get("/api/patients", async (_req, res, next) => {
  try {
    if (hasDatabase()) {
      const result = await query(
        `
          SELECT
            pid,
            full_name
          FROM patients
          ORDER BY full_name
          LIMIT 5000
        `
      );
      return res.json(result.rows);
    }

    const csvPath =
      process.env.RX1011_PATIENTS_CSV_PATH ||
      process.env.PATIENTS_CSV_PATH ||
      path.join(projectRoot, "patients_rows.csv");
    if (!fs.existsSync(csvPath)) {
      return res.status(500).json({
        error: "Patients source not available",
        detail: "No database connection and CSV file not found",
      });
    }

    const csvText = fs.readFileSync(csvPath, "utf8");
    const rows = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    })
      .map((row) => ({
        pid: String(row.pid || row.PID || "").trim(),
        full_name: String(row.full_name || row.FULL_NAME || row.fullName || "").trim(),
      }))
      .filter((row) => row.pid && row.full_name);
    return res.json(rows);
  } catch (error) {
    return next(error);
  }
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/products", productsRoutes);
app.use("/api", activeIngredientsRoutes);
app.use("/api/inventory", inventoryRoutes);
app.use("/api/dispense", dispenseRoutes);
app.use("/api", reportingRoutes);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((error, _req, res, _next) => {
  const status = Number(error?.status || 500);
  const response = {
    error: error?.message || "Internal Server Error",
  };
  if (error?.details !== undefined) {
    response.details = error.details;
  }
  if (status >= 500) {
    console.error(error);
  }
  res.status(status).json(response);
});

app.listen(PORT, () => {
  const dbState = hasDatabase() ? "ready" : "missing RX1011_DATABASE_URL or DATABASE_URL";
  console.log(`Server listening on http://localhost:${PORT} (${dbState})`);
  console.log(`Loaded env from: ${envPath}`);
});
