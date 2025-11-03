// database.js
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id BIGINT PRIMARY KEY,
        username TEXT,
        balance DECIMAL(20, 2) DEFAULT 0,
        wallet TEXT,
        referred_by BIGINT,
        verified BOOLEAN DEFAULT FALSE,
        registered_at BIGINT NOT NULL,
        last_seen BIGINT NOT NULL,
        message_count INTEGER DEFAULT 0,
        activity_score DECIMAL(10, 4) DEFAULT 0,
        last_bonus_claim BIGINT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS bot_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    console.log("✅ Database initialized successfully");
  } catch (error) {
    console.error("❌ Database initialization error:", error);
  } finally {
    client.release();
  }
}

// ---- id / uid compatible ensureUser ----
async function ensureUser(identifier, username = null, updateActivity = false) {
  const userId =
    typeof identifier === "object"
      ? identifier.id || identifier.uid
      : identifier;

  if (!userId) {
    console.error("❌ ensureUser: invalid identifier");
    return null;
  }

  const now = Date.now();
  const res = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
  const user = res.rows[0];

  if (!user) {
    await pool.query(
      `INSERT INTO users (id, username, registered_at, last_seen)
       VALUES ($1, $2, $3, $3)
       ON CONFLICT (id) DO NOTHING`,
      [userId, username || "", now]
    );
    console.log(`👤 New user added: ${username || "unknown"} (${userId})`);
  } else {
    const updates = { last_seen: now };
    if (username && username !== user.username) updates.username = username;
    if (updateActivity) {
      updates.message_count = (user.message_count || 0) + 1;
      const hours = (now - user.registered_at) / (1000 * 60 * 60);
      updates.activity_score =
        updates.message_count / Math.max(hours, 0.01);
    }
    const fields = Object.keys(updates)
      .map((k, i) => `${k}=$${i + 1}`)
      .join(", ");
    const values = Object.values(updates);
    values.push(userId);
    await pool.query(
      `UPDATE users SET ${fields}, updated_at=CURRENT_TIMESTAMP WHERE id=$${
        values.length
      }`,
      values
    );
  }
  return userId;
}

// ---- Settings helpers ----
async function getSetting(key) {
  const res = await pool.query(
    "SELECT value FROM bot_settings WHERE key = $1",
    [key]
  );
  return res.rows[0]?.value || null;
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO bot_settings (key, value, updated_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP)
     ON CONFLICT (key)
     DO UPDATE SET value=$2, updated_at=CURRENT_TIMESTAMP`,
    [key, String(value)]
  );
}

async function incrementSetting(key, increment = 1) {
  const current = await getSetting(key);
  const newValue = (parseInt(current) || 0) + increment;
  await setSetting(key, newValue);
  return newValue;
}

module.exports = {
  initializeDatabase,
  ensureUser,
  getSetting,
  setSetting,
  incrementSetting,
  pool,
};
