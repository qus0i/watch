/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Router — يوجّه الرسائل المُحلَّلة للهاندلر المناسب
 * ═══════════════════════════════════════════════════════════════
 *
 * كل handler يستقبل (req, ctx) حيث:
 *   req = parser.parse(json)   // { type, ident, ref, imei, data, timestamp, ... }
 *   ctx = { socket, sendResponse, logger }
 *
 * لو وصل type غير مدعوم — نسجّله ونرسل acknowledgment generic
 * عشان ما نكسر الاتصال.
 */

const auth = require('./auth');
const health = require('./health');
const location = require('./location');
const activity = require('./activity');
const config = require('./config');
const weather = require('./weather');
const builder = require('../../protocol/v2/builder');

const HANDLERS = {
  // Auth
  login: auth.login,
  heartbeat: auth.heartbeat,

  // Health
  upHealthData: health.upHealthData,
  upBatch: health.upBatch,
  upHeartRate: health.upHeartRate,
  upBP: health.upBP,
  upBO: health.upBO,
  upBodyTemperature: health.upBodyTemperature,
  upBS: health.upBS,

  // Location
  upLocation: location.upLocation,
  upGPS: location.upGPS,
  upBattery: location.upBattery,

  // Activity
  upSleep: activity.upSleep,
  upTodayActivity: activity.upTodayActivity,

  // Config / custom
  upDeviceConfig: config.upDeviceConfig,
  upCustom: config.upCustom,

  // Weather (mock dnWeather reply — TODO: real API)
  upWeather: weather.upWeather,
};

/**
 * @param {object} req — parsed payload
 * @param {object} ctx — { socket, sendResponse, logger }
 */
async function route(req, ctx) {
  const type = req.type;

  // أولوية 1: handler صريح مسجّل
  if (HANDLERS[type]) {
    try {
      await HANDLERS[type](req, ctx);
    } catch (err) {
      ctx.logger.error(`v2 handler error for ${type}: ${err.message}`);
      // لازم نرد حتى لو فشل — وإلا الجهاز يعتبر الإرسال failed
      ctx.sendResponse(builder.reply(req));
    }
    return;
  }

  // أولوية 2: أنواع upXxx الـ exercise
  if (activity.isRunLike(type)) {
    try {
      await activity.runLike(req, ctx);
    } catch (err) {
      ctx.logger.error(`v2 activity handler error for ${type}: ${err.message}`);
      ctx.sendResponse(builder.reply(req));
    }
    return;
  }

  // أولوية 3: ردود الجهاز على أوامر السيرفر (ref = w:reply)
  if (req.ref === 'w:reply') {
    ctx.logger.debug(`[v2] device reply ident=${req.ident} type=${type}`);
    // markPendingV2Responded اختياري — لا حاجة لإرسال رد على رد
    return;
  }

  // أولوية 4 — TODO stubs: نسجل ونرد acknowledgment فاضي
  ctx.logger.warn(`[v2] unhandled type=${type} ref=${req.ref || '-'} — sending generic ack`);
  ctx.sendResponse(builder.reply(req));
}

module.exports = {
  route,
  HANDLERS,
};
