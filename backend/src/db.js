import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const connectionString = process.env.DATABASE_URL;
const useSsl =
  process.env.DATABASE_SSL === "true" ||
  process.env.DATABASE_SSL === "1" ||
  process.env.NODE_ENV === "production";

export const pool = new pg.Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});
