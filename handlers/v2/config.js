/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Config Handlers — upDeviceConfig, upCustom + send dnDevBindStatus
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../../database/db');
const builder = require('../../protocol/v2/builder');

async function handleUpDeviceConfig(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  const data = req.data || {};
  if (imei) {
    await db.saveDeviceConfigV2(imei, data.configs || {});
  }
  ctx.logger.info(`⚙️  [v2] upDeviceConfig imei=${imei || '-'}`);
  ctx.sendResponse(builder.reply(req));
}

async function handleUpCustom(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  ctx.logger.info(`📦 [v2] upCustom imei=${imei || '-'} ` +
    `(payload size=${JSON.stringify(req.data || {}).length})`);
  // log فقط — TODO: تخصيص حسب احتياج كل عميل
  ctx.sendResponse(builder.reply(req));
}

/**
 * Helper اختياري — مبادرة من السيرفر بإرسال dnDevBindStatus.
 * يمكن استدعاؤه من server-v2.js بعد login إذا أحببنا.
 */
function buildDevBindStatus(imei, status = 1) {
  return builder.devBindStatus(imei, status);
}

module.exports = {
  upDeviceConfig: handleUpDeviceConfig,
  upCustom: handleUpCustom,
  buildDevBindStatus,
};
