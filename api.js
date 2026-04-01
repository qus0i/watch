const http = require('http');
const { Pool } = require('pg');
const url = require('url');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function send(res, data, status = 200) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows;
  } finally {
    client.release();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;

  try {
    // GET /api/devices
    if (req.method === 'GET' && path === '/api/devices') {
      const rows = await query(`
        SELECT
          d.id, d.imei, d.user_name, d.user_phone, d.sim_number,
          d.last_connection, d.is_active, d.notes,
          h.heart_rate,
          h.blood_pressure_systolic AS sbp,
          h.blood_pressure_diastolic AS dbp,
          h.spo2, h.blood_sugar,
          h.body_temperature AS temp,
          h.timestamp AS last_health_at,
          h.battery_level,
          l.latitude, l.longitude,
          l.timestamp AS last_location_at
        FROM devices d
        LEFT JOIN LATERAL (
          SELECT * FROM health_data
          WHERE device_id = d.id
          ORDER BY timestamp DESC LIMIT 1
        ) h ON true
        LEFT JOIN LATERAL (
          SELECT * FROM locations
          WHERE device_id = d.id
          ORDER BY timestamp DESC LIMIT 1
        ) l ON true
        ORDER BY d.last_connection DESC NULLS LAST
      `);
      return send(res, rows);
    }

    // GET /api/alerts
    if (req.method === 'GET' && path === '/api/alerts') {
      const rows = await query(`
        SELECT a.*, d.user_name, d.user_phone
        FROM alerts a
        JOIN devices d ON a.device_id = d.id
        ORDER BY a.created_at DESC
        LIMIT 50
      `);
      return send(res, rows);
    }

    // GET /api/health/history?imei=xxx
    if (req.method === 'GET' && path === '/api/health/history') {
      const imei = parsed.query.imei;
      const rows = await query(`
        SELECT heart_rate,
               blood_pressure_systolic AS sbp,
               blood_pressure_diastolic AS dbp,
               spo2, body_temperature AS temp, timestamp
        FROM health_data
        WHERE imei = $1
        ORDER BY timestamp DESC
        LIMIT 50
      `, [imei]);
      return send(res, rows);
    }

    // GET /api/stats
    if (req.method === 'GET' && path === '/api/stats') {
      const [total] = await query('SELECT COUNT(*) AS total FROM devices');
      const [active] = await query(`
        SELECT COUNT(*) AS active FROM devices
        WHERE last_connection > NOW() - INTERVAL '10 minutes'
      `);
      const [unhandled] = await query(
        "SELECT COUNT(*) AS unhandled FROM alerts WHERE is_handled = false"
      );
      return send(res, {
        total: parseInt(total.total),
        active: parseInt(active.active),
        unhandled: parseInt(unhandled.unhandled),
      });
    }

    // POST /api/devices/register
    if (req.method === 'POST' && path === '/api/devices/register') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const d = JSON.parse(body);
        const rows = await query(`
          INSERT INTO devices (imei, user_name, user_phone, sim_number, notes)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (imei) DO UPDATE SET
            user_name = EXCLUDED.user_name,
            user_phone = EXCLUDED.user_phone,
            sim_number = EXCLUDED.sim_number,
            notes = EXCLUDED.notes
          RETURNING id
        `, [d.imei, d.user_name, d.user_phone, d.sim_number, d.notes]);
        send(res, { ok: true, id: rows[0].id });
      });
      return;
    }

    // POST /api/alerts/handle
    if (req.method === 'POST' && path === '/api/alerts/handle') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', async () => {
        const { id, handled_by } = JSON.parse(body);
        await query(`
          UPDATE alerts
          SET is_handled = true, handled_at = NOW(), handled_by = $1
          WHERE id = $2
        `, [handled_by || 'dashboard', id]);
        send(res, { ok: true });
      });
      return;
    }

    send(res, { error: 'Not found' }, 404);

  } catch (err) {
    console.error('API error:', err.message);
    send(res, { error: err.message }, 500);
  }
});

const PORT = process.env.API_PORT || 5088;
server.listen(PORT, () => {
  console.log(`Dashboard API running on port ${PORT}`);
});
