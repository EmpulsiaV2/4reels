/**
 * Neon Postgres database layer.
 * Requires DATABASE_URL in .env (Neon connection string).
 * Schema is created automatically on boot if missing.
 */
const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (pool) return pool;
  const connStr = process.env.DATABASE_URL;
  if (!connStr) {
    throw new Error('DATABASE_URL is not set. Add your Neon connection string to .env');
  }
  pool = new Pool({
    connectionString: connStr,
    ssl: { rejectUnauthorized: false }, // required for Neon
  });
  return pool;
}

// ── Schema ────────────────────────────────────────────
async function ensureSchema() {
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS users (
      id             SERIAL PRIMARY KEY,
      username       TEXT UNIQUE NOT NULL,
      email          TEXT,
      password_hash  TEXT NOT NULL,
      role           TEXT NOT NULL DEFAULT 'member',
      display_name   TEXT,
      bio            TEXT,
      avatar_color   TEXT DEFAULT '#2d303d',
      avatar_base64  TEXT,
      badge          TEXT,
      banned         BOOLEAN NOT NULL DEFAULT false,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users (lower(username));`);
  await p.query(`CREATE INDEX IF NOT EXISTS idx_users_email    ON users (lower(email));`);
}

// ── Row → API-shape mapping ─────────────────────────────
function mapRow(row) {
  if (!row) return null;
  return {
    id:            String(row.id),
    username:      row.username,
    email:         row.email || '',
    passwordHash:  row.password_hash,
    role:          row.role,
    displayName:   row.display_name || row.username,
    bio:           row.bio || '',
    avatarColor:   row.avatar_color || '#2d303d',
    avatarBase64:  row.avatar_base64 || null,
    badge:         row.badge || '',
    banned:        row.banned,
    createdAt:     row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

// ── Field mapping for patch updates ────────────────────
const FIELD_MAP = {
  username:     'username',
  email:        'email',
  passwordHash: 'password_hash',
  role:         'role',
  displayName:  'display_name',
  bio:          'bio',
  avatarColor:  'avatar_color',
  avatarBase64: 'avatar_base64',
  badge:        'badge',
  banned:       'banned',
};

module.exports = {
  async getUsers() {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM users ORDER BY created_at ASC');
    return rows.map(mapRow);
  },

  async getUserById(id) {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM users WHERE id = $1', [Number(id)]);
    return mapRow(rows[0]);
  },

  async getUserByUsername(username) {
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
    return mapRow(rows[0]);
  },

  async getUserByEmail(email) {
    if (!email) return null;
    const p = getPool();
    const { rows } = await p.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
    return mapRow(rows[0]);
  },

  async createUser(data) {
    const p = getPool();
    const { rows } = await p.query(
      `INSERT INTO users (username, email, password_hash, role, display_name, avatar_color, badge, banned)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [
        data.username,
        data.email || '',
        data.passwordHash,
        data.role || 'member',
        data.displayName || data.username,
        data.avatarColor || '#2d303d',
        data.badge || '',
        !!data.banned,
      ]
    );
    return mapRow(rows[0]);
  },

  async updateUser(id, patch) {
    const p = getPool();
    const keys = Object.keys(patch).filter(k => FIELD_MAP[k]);
    if (!keys.length) return this.getUserById(id);

    const setClauses = keys.map((k, i) => `${FIELD_MAP[k]} = $${i + 1}`);
    const values = keys.map(k => patch[k]);
    values.push(Number(id));

    const { rows } = await p.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return mapRow(rows[0]);
  },

  async deleteUser(id) {
    const p = getPool();
    await p.query('DELETE FROM users WHERE id = $1', [Number(id)]);
  },

  async seedAdmin() {
    await ensureSchema();
    const adminUser  = process.env.ADMIN_USERNAME;
    const adminPass  = process.env.ADMIN_PASSWORD_HASH;
    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminUser || !adminPass) {
      console.log('[DB] No ADMIN_USERNAME/ADMIN_PASSWORD_HASH set — skipping admin seed.');
      return;
    }
    const existing = await this.getUserByUsername(adminUser);
    if (existing) {
      console.log(`[DB] Admin user "${adminUser}" already exists.`);
      return;
    }
    await this.createUser({
      username:     adminUser,
      email:        adminEmail || '',
      passwordHash: adminPass,
      role:         'admin',
      displayName:  'Admin',
      avatarColor:  '#ff5d4e',
      badge:        '👑 Admin',
    });
    console.log(`[DB] Admin user "${adminUser}" seeded.`);
  },
};
