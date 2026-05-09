/**
 * ═══════════════════════════════════════════════════════════════
 *  Health Watch v2 — Galaxy Watch Ultra Test TCP Client
 *  Exercises the FCAF v2 "flat" dialect: top-level value/ts/gps with
 *  no inner data envelope. Mirrors what the Wear OS app sends on real
 *  hardware (IMEI prefix `9`).
 * ═══════════════════════════════════════════════════════════════
 *
 * Usage:
 *   node tests/v2-galaxy-client.js
 *   V2_HOST=1.2.3.4 V2_PORT=5088 node tests/v2-galaxy-client.js
 *   IMEI=907000000099999 node tests/v2-galaxy-client.js
 *
 * What it sends (all flat, no `data` envelope):
 *   1. upLogin       (model, fw)
 *   2. upHeartbeat
 *   3. upLocation    (with GPS fix)
 *   4. upLocation    (empty gps:{} — no fix)
 *   5. upHeartRate   (value:78, ts seconds)
 *   6. upBodyTemperature (value:36.7)
 *   7. upBO          (value:97 — defensive; today disabled in Stream 2)
 */

const net = require('net');
const { encode, FrameAssembler } = require('../protocol/v2/frameCodec');

const HOST = process.env.V2_HOST || process.env.SERVER_HOST || '127.0.0.1';
const PORT = parseInt(process.env.V2_PORT || process.env.SERVER_PORT || '5088', 10);
const IMEI = process.env.IMEI || '907018745470571';
const DEVICE_MODEL = process.env.DEVICE_MODEL || 'GalaxyWatchUltra';
const FW = process.env.FW || '1.0.0';

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/**
 * Galaxy "flat" envelope — outer type, ref, imei + top-level fields.
 * No inner `data:{...}` block, and (per CONTRACTS.md) NO `ident`.
 * Server's builder.reply() generates one for the response if request.ident
 * is absent.
 */
function flat(type, ref, extras = {}) {
  return {
    type,
    imei: IMEI,
    ...extras,
    ref,
  };
}

function send(socket, env, label = '') {
  const buf = encode(env);
  const tag = label || env.type;
  console.log(`\n📤 [${tag}] ref=${env.ref}`);
  console.log(`   payload: ${JSON.stringify(env)}`);
  console.log(`   frame size: ${buf.length} bytes`);
  socket.write(buf);
}

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(`🧪 v2-galaxy test client → ${HOST}:${PORT}`);
  console.log(`   IMEI:  ${IMEI}`);
  console.log(`   Model: ${DEVICE_MODEL}`);
  console.log(`   FW:    ${FW}`);
  console.log('═══════════════════════════════════════════════════════');

  const socket = net.connect({ host: HOST, port: PORT }, () => {
    console.log(`\n✅ connected to ${HOST}:${PORT}`);
  });

  const assembler = new FrameAssembler();
  let receivedCount = 0;

  socket.on('data', (chunk) => {
    const frames = assembler.push(chunk);
    for (const f of frames) {
      receivedCount += 1;
      if (f.json) {
        console.log(
          `\n📥 RESPONSE #${receivedCount}: type=${f.json.type} ` +
          `ident=${f.json.ident} ref=${f.json.ref}`
        );
      } else {
        console.log(`\n⚠️  invalid JSON in response`);
      }
    }
  });

  socket.on('error', (err) => {
    console.error(`❌ socket error: ${err.message}`);
  });

  socket.on('close', () => {
    console.log('\n🔌 connection closed');
    process.exit(0);
  });

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1) upLogin
  send(socket, flat('upLogin', 'w:login', {
    model: DEVICE_MODEL,
    fw: FW,
  }), 'upLogin');
  await sleep(800);

  // 2) upHeartbeat
  send(socket, flat('upHeartbeat', 'w:hb'), 'upHeartbeat');
  await sleep(500);

  // 3) upLocation with GPS fix
  send(socket, flat('upLocation', 'w:loc', {
    gps: { lat: 31.954500, lon: 35.910278, acc: 5.2, speed: 0 },
    ts: nowSec(),
  }), 'upLocation[fix]');
  await sleep(500);

  // 4) upLocation with empty gps (no fix) — should still ack and write a no-gps row
  send(socket, flat('upLocation', 'w:loc', {
    gps: {},
    ts: nowSec(),
  }), 'upLocation[empty]');
  await sleep(500);

  // 5) upHeartRate
  send(socket, flat('upHeartRate', 'w:hr', {
    value: 78,
    ts: nowSec(),
  }), 'upHeartRate');
  await sleep(500);

  // 6) upBodyTemperature
  send(socket, flat('upBodyTemperature', 'w:temp', {
    value: 36.7,
    ts: nowSec(),
  }), 'upBodyTemperature');
  await sleep(500);

  // 7) upBO (defensive — Stream 2 may re-enable later)
  send(socket, flat('upBO', 'w:bo', {
    value: 97,
    ts: nowSec(),
  }), 'upBO');
  await sleep(1500);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`✅ test sequence completed — received ${receivedCount} responses`);
  console.log('   expected: 7 (one s:reply per uplink)');
  console.log('═══════════════════════════════════════════════════════');

  socket.end();
}

run().catch((err) => {
  console.error('❌ test failed:', err);
  process.exit(1);
});
