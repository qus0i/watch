/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Auth Handlers — login + heartbeat
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../../database/db');
const builder = require('../../protocol/v2/builder');

/**
 * @param {object} req — parsed payload (parser.parse output)
 * @param {object} ctx — { socket, sendResponse, logger }
 */
async function handleLogin(req, ctx) {
  const imei = req.imei;
  if (!imei) {
    ctx.logger.warn('v2 login: no imei');
    return;
  }

  // ─── Pre-empt prior socket for same IMEI (reconnect leak fix) ──────
  // لو الجهاز فقد الاتصال وعاد على socket جديد قبل ما النواة تكتشف موت
  // الـ socket القديم، الـ heartbeat sessions Map ولسة فيها الـ socket
  // القديم مع interval قياسات نشط. لازم نوقفه قبل ما نسجّل الجديد.
  try {
    const heartbeat = require('./heartbeat');
    const prior = heartbeat.getSession(imei);
    if (prior && prior.socket && prior.socket !== ctx.socket) {
      const oldSock = prior.socket;
      try {
        const { stopMeasurementSession } = require('./measurement-session');
        stopMeasurementSession(oldSock, 'replaced-by-relogin');
      } catch (_) { /* ignore */ }
      // احذف heartbeat entry للسوكت القديم (socket-aware حتى ما نمسح
      // entry الجديد لو registerSession نفّذ قبل هذا الكود في race).
      try { heartbeat.unregisterSession(imei, oldSock); } catch (_) { /* ignore */ }
      // اقفل السوكت القديم لو لسة حي — يضمن إن أي in-flight runCycle
      // يتوقف عند _isAlive check ويُحرّر الـ TCP fd.
      try {
        if (oldSock && !oldSock.destroyed) oldSock.destroy();
      } catch (_) { /* ignore */ }
      ctx.logger.info(`♻️ [v2] LOGIN preempted prior socket imei=${imei}`);
    }
  } catch (err) {
    ctx.logger.warn(`[v2] LOGIN preempt check failed imei=${imei}: ${err.message}`);
  }

  const data = req.data || {};
  const deviceModel = data.deviceModel || null;

  try {
    await db.getOrCreateDeviceV2(imei, deviceModel, {
      firmwareV: data.Version || data.firmware_v || null,
      batteryLevel: data.batteryLevel,
      bindStatus: 1, // اعتبر الجهاز bound افتراضياً عند تسجيل الدخول
    });
  } catch (err) {
    ctx.logger.error(`v2 login DB error: ${err.message}`);
  }

  ctx.socket.imei = imei;
  ctx.socket.deviceModel = deviceModel;
  ctx.logger.info(`📱 [v2] LOGIN imei=${imei} model=${deviceModel || '-'}`);

  // رد بـ bindStatus=1 (bound) حتى الجهاز يستمر بالعمل
  const reply = builder.loginReply(req, 1);
  ctx.sendResponse(reply);

  // ─── POST-LOGIN HOOKS (additive — لا يعدّل أي شيء أعلاه) ───────────
  // 1) سجّل الـ socket في heartbeat scheduler حتى لا يصير idle ويُغلق.
  // 2) بعد 1.5s ابعث deviceMeasuringFrequency + locationInterval حتى
  //    الساعة تبدأ تأخذ قياسات تلقائية وترسلها (upHeartRate/upBP/upBO/...).
  try {
    const { registerSession } = require('./heartbeat');
    registerSession(imei, ctx.socket);
  } catch (err) {
    ctx.logger.warn(`[v2] heartbeat registerSession failed: ${err.message}`);
  }

  setTimeout(() => {
    try {
      // re-check إن الـ socket لسا حي قبل الإرسال
      if (!ctx.socket || ctx.socket.destroyed) return;
      const cfg = require('./measurement-config');
      cfg.sendMeasurementFrequencyConfig(ctx.socket, imei);
      cfg.sendLocationIntervalConfig(ctx.socket, imei);
    } catch (err) {
      ctx.logger.warn(`[v2] post-login config push failed: ${err.message}`);
    }
  }, 1500);

  // SOS setup at +5s — يطابق توقيت legacy IWBP12 setTimeout.
  // مرجع SDK page 36 (type: 'SOSNumber'). لو فشل الإرسال أو السوكت مات
  // قبل التوقيت، نسجل warning ولا نكسر تدفق LOGIN.
  setTimeout(() => {
    try {
      if (!ctx.socket || ctx.socket.destroyed) return;
      const { sendSOSNumberConfig } = require('./sos');
      sendSOSNumberConfig(ctx.socket, imei);
    } catch (err) {
      ctx.logger.warn(`[v2-SOS] post-login send failed: ${err.message}`);
    }
  }, 5000);

  // 3) شغّل دورة القياسات الـ server-driven (Location→HR→BP→Temp→SpO2).
  //    داخلها 10s initial delay، لذا تبدأ بعد ما يستقر الـ login + config flush.
  try {
    const { startMeasurementSession } = require('./measurement-session');
    startMeasurementSession(ctx.socket, imei);
  } catch (err) {
    ctx.logger.warn(`[v2] startMeasurementSession failed: ${err.message}`);
  }
}

async function handleHeartbeat(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  const data = req.data || {};

  if (imei) {
    try {
      await db.updateDeviceHeartbeatV2(imei, data.batteryLevel, data.batteryState);
    } catch (err) {
      ctx.logger.error(`v2 heartbeat DB error: ${err.message}`);
    }
  }

  ctx.logger.debug(`💓 [v2] HEARTBEAT imei=${imei || '-'} bat=${data.batteryLevel ?? '-'}`);
  ctx.sendResponse(builder.heartbeatReply(req));
}

module.exports = {
  login: handleLogin,
  heartbeat: handleHeartbeat,
};
