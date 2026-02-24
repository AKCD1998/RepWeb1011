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
const envPath = fs.existsSync(serverEnvPath) ? serverEnvPath : rootEnvPath;
dotenv.config({ path: envPath });

const { healthCheck, hasDatabase, query } = await import("./db/pool.js");
const productsRoutes = (await import("./routes/productsRoutes.js")).default;
const inventoryRoutes = (await import("./routes/inventoryRoutes.js")).default;
const dispenseRoutes = (await import("./routes/dispenseRoutes.js")).default;
const reportingRoutes = (await import("./routes/reportingRoutes.js")).default;

const app = express();
const PORT = Number(process.env.PORT || 5050);

const corsOrigins = String(process.env.CORS_ORIGIN || "http://localhost:5173")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (!corsOrigins.length || corsOrigins.includes(origin)) {
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

    const csvPath = process.env.PATIENTS_CSV_PATH || path.join(projectRoot, "patients_rows.csv");
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

app.use("/api/products", productsRoutes);
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
  const dbState = hasDatabase() ? "ready" : "missing DATABASE_URL";
  console.log(`Server listening on http://localhost:${PORT} (${dbState})`);
  console.log(`Loaded env from: ${envPath}`);
});
