/**
 * ═══════════════════════════════════════════════════════════════
 *  Health Watch v2 — Test TCP Client
 *  يُحاكي ساعة جديدة: login → heartbeat → upHealthData → upLocation
 * ═══════════════════════════════════════════════════════════════
 *
 * Usage:
 *   node tests/v2-client.js                # يتصل localhost:5089 افتراضياً
 *   V2_HOST=1.2.3.4 V2_PORT=5089 node tests/v2-client.js
 *   IMEI=865028000099999 node tests/v2-client.js
 */

const net = require('net');
const { encode, FrameAssembler } = require('../protocol/v2/frameCodec');

// السيرفر يدعم البروتوكولين على نفس البورت (multiplexed). افتراضي = legacy port (5088).
const HOST = process.env.V2_HOST || process.env.SERVER_HOST || '127.0.0.1';
const PORT = parseInt(process.env.V2_PORT || process.env.SERVER_PORT || '5088', 10);
const IMEI = process.env.IMEI || '865028000000306';
const DEVICE_MODEL = process.env.DEVICE_MODEL || 'TestWatch-v2';

let identCounter = 100000;
function nextIdent() {
  identCounter += 1;
  return identCounter;
}

function envelope(type, data, ref = 'w:update') {
  const ts = Date.now();
  return {
    type,
    ident: nextIdent(),
    ref,
    imei: IMEI,
    data: { type, imei: IMEI, deviceModel: DEVICE_MODEL, timestamp: ts, ...data },
    timestamp: ts,
  };
}

function send(socket, env, label = '') {
  const buf = encode(env);
  const tag = label || env.type;
  console.log(`\n📤 [${tag}] ident=${env.ident} ref=${env.ref}`);
  console.log(`   payload: ${JSON.stringify(env).substring(0, 300)}${JSON.stringify(env).length > 300 ? '...' : ''}`);
  console.log(`   frame size: ${buf.length} bytes`);
  socket.write(buf);
}

function waitFrames(assembler, count, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const collected = [];
    const check = () => {
      // assembler accumulates externally; we just resolve when count reached
      if (collected.length >= count) return resolve(collected);
      if (Date.now() - start > timeoutMs) return reject(new Error(`timeout waiting for ${count} frames`));
      setTimeout(check, 50);
    };
    check();
    return collected;
  });
}

async function run() {
  console.log('═══════════════════════════════════════════════════════');
  console.log(`🧪 v2 test client → ${HOST}:${PORT}`);
  console.log(`   IMEI: ${IMEI}`);
  console.log(`   Model: ${DEVICE_MODEL}`);
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
        console.log(`\n📥 RESPONSE #${receivedCount}: type=${f.json.type} ident=${f.json.ident} ref=${f.json.ref}`);
        if (f.json.data) {
          const d = f.json.data;
          const extras = Object.keys(d).filter((k) => !['type', 'imei', 'timestamp'].includes(k));
          if (extras.length > 0) {
            console.log(`   data extras: ${JSON.stringify(Object.fromEntries(extras.map((k) => [k, d[k]])))}`);
          }
        }
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

  // helper بسيط للانتظار
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1) Login
  send(socket, envelope('login', {
    platform: 'ASR',
    Version: '1.2.42',
    batteryLevel: 87,
    iccId: '89860121801575995911',
  }), 'LOGIN');

  await sleep(800);

  // 2) Heartbeat
  send(socket, envelope('heartbeat', {
    batteryLevel: 86,
    batteryState: 1,
  }), 'HEARTBEAT');

  await sleep(800);

  // 3) upHealthData (heart rate)
  send(socket, envelope('upHealthData', {
    type: 'upHeartRate',          // inner type يحدد القياس
    data: '72',
    testType: 0,
    dataStartTime: Date.now(),
    dataStatus: 0,
    block: 0,
  }), 'upHealthData[upHeartRate]');

  await sleep(500);

  // 4) upHealthData (blood pressure)
  send(socket, envelope('upHealthData', {
    type: 'upBP',
    data: '120/80/72',
  }), 'upHealthData[upBP]');

  await sleep(500);

  // 5) upHealthData (SpO2)
  send(socket, envelope('upHealthData', {
    type: 'upBO',
    data: '97',
  }), 'upHealthData[upBO]');

  await sleep(500);

  // 6) upHealthData (temperature)
  send(socket, envelope('upHealthData', {
    type: 'upBodyTemperature',
    data: '36.7/30.5/25.0',
  }), 'upHealthData[upBodyTemperature]');

  await sleep(500);

  // 7) upLocation
  send(socket, envelope('upLocation', {
    baseStationType: 0,
    positionDataType: '1',
    gps: {
      lon: '35.910278',
      lat: '31.954500',
      height: 800,
      satelliteNum: 8,
      GSM: 90,
      Type: 0,
    },
    wifi: [
      { ssid: 'home-wifi', signal: '-65', mac: 'aa:bb:cc:dd:ee:ff' },
    ],
    baseStation: [
      { mcc: 416, mnc: 1, lac: 12345, ci: 67890, rxlev: 60 },
    ],
  }), 'upLocation');

  await sleep(500);

  // 8) upBatch (heart rate batch)
  const now = Date.now();
  send(socket, envelope('upBatch', {
    dataType: 'upHeartRate',
    data: '70,72,74,73',
    dataTime: `${now - 30000},${now - 20000},${now - 10000},${now}`,
    testType: 0,
  }), 'upBatch[upHeartRate]');

  await sleep(500);

  // 9) upRun
  send(socket, envelope('upRun', {
    startTime: now - 3600 * 1000,
    endTime: now,
    exerciseTime: 3600,
    consumed: 245,
    mileage: '2.8',
    Steps: { stepNumber: 5180, avgStrideFrequency: 74, avgStride: 71 },
  }), 'upRun');

  await sleep(500);

  // 10) upDeviceConfig
  send(socket, envelope('upDeviceConfig', {
    configs: {
      upHeartRate: { interval: '60' },
      upBP: { interval: '60' },
      upBodyTemperature: { interval: '60' },
    },
  }), 'upDeviceConfig');

  await sleep(1500);

  console.log('\n═══════════════════════════════════════════════════════');
  console.log(`✅ test sequence completed — received ${receivedCount} responses`);
  console.log('═══════════════════════════════════════════════════════');

  socket.end();
}

run().catch((err) => {
  console.error('❌ test failed:', err);
  process.exit(1);
});
