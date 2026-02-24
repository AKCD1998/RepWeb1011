import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

function shouldUseSsl(url) {
  if (!url) return false;
  if (/localhost|127\.0\.0\.1/i.test(url)) return false;
  return true;
}

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
    })
  : null;

export { pool };

export function hasDatabase() {
  return Boolean(pool);
}

export async function query(text, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is not set");
  }
  return pool.query(text, params);
}

export async function getClient() {
  if (!pool) {
    throw new Error("DATABASE_URL is not set");
  }
  return pool.connect();
}

export async function withTransaction(work) {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function healthCheck() {
  if (!pool) {
    return {
      ok: false,
      message: "DATABASE_URL is not set",
    };
  }

  try {
    const result = await pool.query("SELECT NOW() AS now");
    return {
      ok: true,
      now: result.rows[0]?.now ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      message: error.message,
    };
  }
}
