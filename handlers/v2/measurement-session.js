/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Measurement Session Cycle
 *  يُحاكي نمط legacy `startPeriodicMeasurements` لكن باستخدام
 *  أوامر FCAF v2 (dnLocation/dnHeartRate/dnBP/dnBodyTemperature/dnBO).
 *
 *  الـ cycle: كل 5 دقائق نُعيد تعيين socket.currentHealthCycleId و
 *  socket.currentLocationCycleId إلى null، ثم نُرسل سلسلة الأوامر بترتيب
 *  Location → HR → BP → Temp → SpO2 مع فاصل 60 ثانية بين كل أمر.
 *  هندلرات الـ up* المقابلة (في handlers/v2/health.js و location.js) تستخدم
 *  هذه الـ IDs لتجميع كل قياسات الدورة في نفس السطر عبر db.upsertHealthData
 *  و db.updateLocationById/saveLocationReturningId.
 *
 *  ⚠️ لا يلمس legacy. يستخدم نفس DB helpers الموجودة في database/db.js.
 * ═══════════════════════════════════════════════════════════════
 */

const builder = require('../../protocol/v2/builder');
const { encode } = require('../../protocol/v2/frameCodec');
const logger = require('../../utils/logger');
const config = require('../../config');

// ─── Configuration (defaults — overridable via config.healthMonitoring) ───
const DEFAULT_CYCLE_INTERVAL_MS = 5 * 60 * 1000;     // 5 دقائق بين الدورات
const DEFAULT_COMMAND_DELAY_MS = 60 * 1000;          // 60 ثانية بين الأوامر
const INITIAL_DELAY_MS = 10 * 1000;                  // 10 ثوان بعد LOGIN

const MEASUREMENTS_ENABLED = {
  location: true,
  heartRate: true,
  bp: true,
  temperature: true,
  bo: true,
};

function _cfg() {
  const hm = (config && config.healthMonitoring) || {};
  const cycleMs = hm.intervalMinutes
    ? Math.max(1, parseInt(hm.intervalMinutes, 10)) * 60 * 1000
    : DEFAULT_CYCLE_INTERVAL_MS;
  const cmdDelayMs = hm.delayBetweenCommands
    ? Math.max(1, parseInt(hm.delayBetweenCommands, 10)) * 1000
    : DEFAULT_COMMAND_DELAY_MS;

  return {
    cycleMs,
    cmdDelayMs,
    enabled: hm.measurements
      ? {
          location: hm.measurements.location !== false,
          heartRate: hm.measurements.bloodPressure !== false, // legacy bundles HR with BP
          bp: hm.measurements.bloodPressure !== false,
          temperature: hm.measurements.temperature !== false,
          bo: hm.measurements.bloodOxygen !== false,
        }
      : MEASUREMENTS_ENABLED,
  };
}

function _delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function _isAlive(socket) {
  return socket && !socket.destroyed && socket.writable;
}

function _sendDownCommand(socket, type, imei) {
  if (!_isAlive(socket)) return false;
  try {
    const envelope = builder.down(type, imei, {});
    socket.write(encode(envelope));
    return true;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.log(`⚠️ [v2-SESSION] ${type} send failed imei=${imei} err=${msg}`);
    try { logger.warn(`[v2-SESSION] ${type} send failed: ${msg}`); } catch (_) { /* ignore */ }
    return false;
  }
}

function _stopCycle(socket, imei, reason) {
  if (socket && socket._v2SessionInterval) {
    try { clearInterval(socket._v2SessionInterval); } catch (_) { /* ignore */ }
    socket._v2SessionInterval = null;
  }
  if (socket && socket._v2SessionStarted) {
    socket._v2SessionStarted = false;
    console.log(`⚠️ [v2-SESSION] Stopped imei=${imei || '-'} reason=${reason}`);
  }
}

/**
 * يبدأ دورة القياسات لـ socket v2.
 * idempotent — لو نُودي عليها مرتين بنفس الـ socket، الثانية تنحجب.
 *
 * @param {net.Socket} socket
 * @param {string}     imei
 */
function startMeasurementSession(socket, imei) {
  if (!socket || !imei) return;
  if (socket._v2SessionStarted) {
    // مايصير شي — تجنب bug مزدوج لو نُودي على hook مرتين
    return;
  }
  socket._v2SessionStarted = true;

  const { cycleMs, cmdDelayMs, enabled } = _cfg();

  // اضمن إن الـ cycle IDs فاضية كبداية
  socket.currentHealthCycleId = null;
  socket.currentLocationCycleId = null;

  console.log(`🔄 [v2-SESSION] started imei=${imei} cycle=${cycleMs / 1000}s gap=${cmdDelayMs / 1000}s`);

  const runCycle = async () => {
    if (!_isAlive(socket)) {
      _stopCycle(socket, imei, 'socket-not-writable');
      return;
    }

    // ⭐ سطر جديد لكل دورة — مطابق لمنطق legacy
    socket.currentHealthCycleId = null;
    socket.currentLocationCycleId = null;

    console.log(`🔄 [v2-SESSION] === New cycle for imei=${imei} @ ${new Date().toISOString()}`);

    try {
      // (1/5) Location
      if (enabled.location && _isAlive(socket)) {
        if (_sendDownCommand(socket, 'dnLocation', imei)) {
          console.log(`📍 [v2-SESSION] (1/5) Location requested imei=${imei}`);
        }
      }
      await _delay(cmdDelayMs);

      // (2/5) HeartRate
      if (enabled.heartRate && _isAlive(socket)) {
        if (_sendDownCommand(socket, 'dnHeartRate', imei)) {
          console.log(`❤️ [v2-SESSION] (2/5) Heart rate requested imei=${imei} cycle=${socket.currentHealthCycleId || 'new'}`);
        }
      }
      await _delay(cmdDelayMs);

      // (3/5) BP
      if (enabled.bp && _isAlive(socket)) {
        if (_sendDownCommand(socket, 'dnBP', imei)) {
          console.log(`💉 [v2-SESSION] (3/5) BP requested imei=${imei} cycle=${socket.currentHealthCycleId || 'new'}`);
        }
      }
      await _delay(cmdDelayMs);

      // (4/5) Temperature
      if (enabled.temperature && _isAlive(socket)) {
        if (_sendDownCommand(socket, 'dnBodyTemperature', imei)) {
          console.log(`🌡️ [v2-SESSION] (4/5) Temp requested imei=${imei} cycle=${socket.currentHealthCycleId || 'new'}`);
        }
      }
      await _delay(cmdDelayMs);

      // (5/5) SpO2
      if (enabled.bo && _isAlive(socket)) {
        if (_sendDownCommand(socket, 'dnBO', imei)) {
          console.log(`🫁 [v2-SESSION] (5/5) SpO2 requested imei=${imei} cycle=${socket.currentHealthCycleId || 'new'}`);
        }
      }

      console.log(
        `✅ [v2-SESSION] Cycle complete — health_row=#${socket.currentHealthCycleId || 'none'}, ` +
        `location_row=#${socket.currentLocationCycleId || 'none'} imei=${imei}`
      );
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.log(`⚠️ [v2-SESSION] cycle error imei=${imei} err=${msg}`);
      _stopCycle(socket, imei, `cycle-error:${msg}`);
    }
  };

  // أول دورة بعد INITIAL_DELAY_MS عشان نسمح للـ login + heartbeat-register
  // + measurement-config flush بالتسوية أولاً.
  setTimeout(() => {
    if (!_isAlive(socket)) {
      _stopCycle(socket, imei, 'socket-died-before-first-cycle');
      return;
    }
    runCycle();
  }, INITIAL_DELAY_MS);

  // دورات متكررة
  const intervalId = setInterval(runCycle, cycleMs);
  socket._v2SessionInterval = intervalId;

  // تنظيف على close (ما يحتاج تعديل في server-v2.js)
  const onClose = () => _stopCycle(socket, imei, 'socket-close');
  const onError = () => _stopCycle(socket, imei, 'socket-error');
  socket.once('close', onClose);
  socket.once('error', onError);
}

// public stop helper — يستخدمه LOGIN handler عشان يقطع دورة سوكت قديم
// قبل ما يبدأ دورة على سوكت جديد لنفس الـ IMEI.
function stopMeasurementSession(socket, reason) {
  _stopCycle(socket, socket && socket.imei, reason || 'manual-stop');
}

module.exports = {
  startMeasurementSession,
  stopMeasurementSession,
};
