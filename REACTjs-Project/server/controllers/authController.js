import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { query } from "../db/pool.js";
import { httpError } from "../utils/httpError.js";

function getJwtSecret() {
  const secret = String(process.env.JWT_SECRET || process.env.AUTH_JWT_SECRET || "").trim();
  if (!secret) {
    throw httpError(500, "JWT_SECRET is not configured");
  }
  return secret;
}

export async function login(req, res) {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");

  if (!username || !password) {
    throw httpError(400, "username and password are required");
  }

  const result = await query(
    `
      SELECT
        id,
        username,
        password_hash,
        role::text AS role,
        location_id,
        is_active
      FROM users
      WHERE lower(username) = lower($1)
      LIMIT 1
    `,
    [username]
  );

  const user = result.rows[0];
  if (!user) {
    throw httpError(401, "Invalid username or password");
  }

  if (!user.is_active) {
    throw httpError(403, "User account is inactive");
  }

  const isPasswordValid = await bcrypt.compare(password, user.password_hash);
  if (!isPasswordValid) {
    throw httpError(401, "Invalid username or password");
  }

  const token = jwt.sign(
    {
      id: user.id,
      role: user.role,
      location_id: user.location_id,
    },
    getJwtSecret(),
    { expiresIn: "8h" }
  );

  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      location_id: user.location_id,
    },
  });
}
