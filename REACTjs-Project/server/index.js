import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const projectRoot = path.join(__dirname, "..");
dotenv.config({ path: path.join(projectRoot, ".env") });
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.API_KEY;
const dataPath =
  process.env.PATIENTS_CSV_PATH || path.join(projectRoot, "patients_rows.csv");

let patients = [];
let loadError = "";

const loadPatients = () => {
  try {
    if (!fs.existsSync(dataPath)) {
      throw new Error(`CSV not found at ${dataPath}`);
    }
    const csvText = fs.readFileSync(dataPath, "utf8");
    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
    patients = records
      .map((row) => ({
        pid: String(row.pid || row.PID || "").trim(),
        full_name: String(row.full_name || row.FULL_NAME || row.fullName || "").trim(),
      }))
      .filter((row) => row.pid && row.full_name);
    loadError = "";
    console.log(`Loaded ${patients.length} patients from CSV.`);
  } catch (err) {
    loadError = err.message || "Failed to load patients_rows.csv";
    console.error("Failed to load patients_rows.csv:", loadError);
    patients = [];
  }
};

loadPatients();

app.use((req, res, next) => {
  const key = req.header("X-API-KEY");
  if (!API_KEY || key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
});

app.get("/api/patients", (_req, res) => {
  if (loadError) {
    return res.status(500).json({
      error: "Patients CSV not loaded",
      detail: loadError,
      hint: "Set PATIENTS_CSV_PATH or place patients_rows.csv in the project root.",
    });
  }
  res.json(patients);
});

app.listen(PORT, () => {
  if (!API_KEY) {
    console.warn("API_KEY is not set. Requests will be unauthorized.");
  }
  console.log(`Server listening on http://localhost:${PORT}`);
});
