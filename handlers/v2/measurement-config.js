/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Measurement Config Sender
 *  أوامر السيرفر اللي تُرسل للساعة لتفعيل القياسات الدورية.
 *  بدونها الساعة لا تأخذ قياسات تلقائية ولا ترسل upHeartRate/upBP/...
 * ═══════════════════════════════════════════════════════════════
 *
 *  مرجع SDK: page 30 — deviceMeasuringFrequency + locationInterval
 *
 *  Public API:
 *    sendMeasurementFrequencyConfig(socket, imei)
 *    sendLocationIntervalConfig(socket, imei)
 *
 *  لا يلمس الـ DB، فقط يُغلّف ويرسل frame واحد.
 */

const builder = require('../../protocol/v2/builder');
const { encode } = require('../../protocol/v2/frameCodec');
const logger = require('../../utils/logger');

function _writeEnvelope(socket, envelope, label, imei) {
  if (!socket || socket.destroyed || socket.writable === false) {
    console.log(`⚠️  [v2] ${label} skipped imei=${imei} — socket not writable`);
    return false;
  }
  try {
    const buf = encode(envelope);
    socket.write(buf);
    return true;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.log(`⚠️  [v2] ${label} send failed imei=${imei} err=${msg}`);
    try { logger.error(`[v2] ${label} send failed imei=${imei}: ${msg}`); } catch (_) { /* ignore */ }
    return false;
  }
}

/**
 * deviceMeasuringFrequency — يضبط الفواصل الزمنية لكل قياس.
 * الـ intervals بالدقائق (string) كما هو مطلوب في الـ SDK.
 */
function sendMeasurementFrequencyConfig(socket, imei) {
  if (!imei) return false;

  const envelope = builder.down('deviceMeasuringFrequency', imei, {
    configs: {
      upHeartRate: { interval: '30' },
      upBP:        { interval: '60' },
      upBO:        { interval: '60' },
      upStep:      { interval: '15' },
      upBodyTemperature: { interval: '60', frequency: 5 },
    },
  });

  const ok = _writeEnvelope(socket, envelope, 'deviceMeasuringFrequency', imei);
  if (ok) console.log(`⚙️  [v2] deviceMeasuringFrequency sent imei=${imei}`);
  return ok;
}

/**
 * locationInterval — يضبط فاصل تقارير GPS بالثواني.
 * 300 = كل 5 دقائق.
 */
function sendLocationIntervalConfig(socket, imei) {
  if (!imei) return false;

  const envelope = builder.down('locationInterval', imei, {
    intervalTime: 300,
  });

  const ok = _writeEnvelope(socket, envelope, 'locationInterval', imei);
  if (ok) console.log(`📍 [v2] locationInterval sent imei=${imei} (300s)`);
  return ok;
}

module.exports = {
  sendMeasurementFrequencyConfig,
  sendLocationIntervalConfig,
};
