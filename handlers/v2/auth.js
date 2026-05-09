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
  // canonical source: measurement-session's imei→socket map.
  // heartbeat.sessions can be silently emptied by the keep-alive tick
  // before close fires, so it is NOT reliable for this lookup.
  try {
    const { getSessionSocketByImei, stopMeasurementSession } =
      require('./measurement-session');
    const oldSock = getSessionSocketByImei(imei);
    if (oldSock && oldSock !== ctx.socket) {
      try { stopMeasurementSession(oldSock, 'replaced-by-relogin'); } catch (_) {}
      try { require('./heartbeat').unregisterSession(imei, oldSock); } catch (_) {}
      try { if (!oldSock.destroyed) oldSock.destroy(); } catch (_) {}
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

// ═══════════════════════════════════════════════════════════════
//  Galaxy Watch Ultra — additive handlers (FCAF v2 "flat" dialect)
//  Galaxy frames carry top-level fw/model/value/ts and no inner data
//  envelope. Routed by distinct outer types ('upLogin' / 'upHeartbeat')
//  so they never collide with the Chinese 'login' / 'heartbeat' path.
// ═══════════════════════════════════════════════════════════════

async function handleGalaxyUpLogin(req, ctx) {
  const imei = req.imei;
  if (!imei) {
    ctx.logger.warn('v2-galaxy upLogin: no imei');
    return;
  }

  const r = req.raw || {};
  const deviceModel = r.model || null;
  const fw = r.fw || null;

  try {
    await db.getOrCreateDeviceV2(imei, deviceModel, {
      firmwareV: fw,
      bindStatus: 1,
      watchType: 'galaxy',
    });
    // mark last_heartbeat=NOW() — Galaxy login implies the device is alive.
    await db.updateDeviceHeartbeatV2(imei);
  } catch (err) {
    ctx.logger.error(`v2-galaxy upLogin DB error: ${err.message}`);
  }

  ctx.socket.imei = imei;
  ctx.socket.deviceModel = deviceModel;
  ctx.logger.info(
    `🎉 [v2-galaxy] login imei=${imei} model=${deviceModel || '-'} fw=${fw || '-'}`
  );
  ctx.sendResponse(builder.reply(req));
}

async function handleGalaxyUpHeartbeat(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  if (imei) {
    try {
      await db.updateDeviceHeartbeatV2(imei);
    } catch (err) {
      ctx.logger.error(`v2-galaxy upHeartbeat DB error: ${err.message}`);
    }
  }
  ctx.logger.debug(`💓 [v2-galaxy] heartbeat imei=${imei || '-'}`);
  ctx.sendResponse(builder.reply(req));
}

module.exports = {
  login: handleLogin,
  heartbeat: handleHeartbeat,
  galaxyUpLogin: handleGalaxyUpLogin,
  galaxyUpHeartbeat: handleGalaxyUpHeartbeat,
};
