/**
 * ═══════════════════════════════════════════════════════════════
 *  Migrations Runner (idempotent)
 *  يُشغّل ملفات SQL من مجلد migrations/ بترتيب اسم الملف.
 *  يتتبّع الـ migrations المُنفّذة في جدول schema_migrations.
 * ═══════════════════════════════════════════════════════════════
 *
 * الاستخدام:
 *   node database/migrate.js
 *   أو من server-v2.js عبر `await runMigrations(pool)`
 *
 * هذا الملف additive — ما يلمس schema.sql الأصلي ولا init-db.js القديم.
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   VARCHAR(255) PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getApplied(client) {
  const res = await client.query('SELECT filename FROM schema_migrations');
  return new Set(res.rows.map((r) => r.filename));
}

async function applyMigration(client, filename) {
  const fullPath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(fullPath, 'utf8');

  console.log(`📦 [MIGRATE] running ${filename} ...`);
  // نستخدم transaction عشان migration كامل أو ولا واحد
  await client.query('BEGIN');
  try {
    await client.query(sql);
    await client.query(
      'INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
      [filename]
    );
    await client.query('COMMIT');
    console.log(`✅ [MIGRATE] applied ${filename}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`❌ [MIGRATE] failed ${filename}:`, err.message);
    throw err;
  }
}

async function runMigrations(pool) {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    console.log('ℹ️  [MIGRATE] لا يوجد مجلد migrations — تخطي');
    return { applied: [], skipped: [] };
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('ℹ️  [MIGRATE] لا توجد ملفات migrations');
    return { applied: [], skipped: [] };
  }

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const already = await getApplied(client);

    const applied = [];
    const skipped = [];

    for (const file of files) {
      if (already.has(file)) {
        skipped.push(file);
        continue;
      }
      await applyMigration(client, file);
      applied.push(file);
    }

    console.log(
      `✅ [MIGRATE] انتهى — ${applied.length} مُنفّذة, ${skipped.length} مُتخطّاة`
    );
    return { applied, skipped };
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };

// CLI usage: node database/migrate.js
if (require.main === module) {
  const config = require('../config');
  const pool = new Pool(config.database);
  runMigrations(pool)
    .then(() => pool.end().then(() => process.exit(0)))
    .catch((err) => {
      console.error('❌ Migration failed:', err);
      pool.end().then(() => process.exit(1));
    });
}
