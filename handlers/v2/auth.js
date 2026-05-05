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
