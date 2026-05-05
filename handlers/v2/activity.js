/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Activity Handlers — upRun, upWalk, upRide, upSleep, upTodayActivity
 * ═══════════════════════════════════════════════════════════════
 */

const db = require('../../database/db');
const builder = require('../../protocol/v2/builder');

const RUN_TYPES = new Set([
  'upRun', 'upWalk', 'upRide', 'upFree', 'upRope', 'upBadminton',
  'upTable', 'upTennis', 'upClimb', 'upBasketball', 'upVolleyball',
  'upDance', 'upSpinningBike', 'upYoga', 'upJumpingJack', 'upSitUps',
  'upFootball', 'upWushu', 'upATaekwondo', 'upTaijiquanJumping', 'upHulaHoop',
]);

async function handleRunLike(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  const data = req.data || {};
  const t = data.type || req.type;
  if (imei) {
    await db.saveActivityV2(imei, t, data);
  }
  ctx.logger.info(`🏃 [v2] ${t} imei=${imei || '-'} duration=${data.exerciseTime || '-'}s`);
  ctx.sendResponse(builder.reply(req));
}

async function handleUpSleep(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  const data = req.data || {};
  if (imei) {
    await db.saveActivityV2(imei, 'upSleep', data);
  }
  ctx.logger.info(`😴 [v2] upSleep imei=${imei || '-'} segments=${(data.dateTime || []).length}`);
  ctx.sendResponse(builder.reply(req));
}

async function handleUpTodayActivity(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  const data = req.data || {};
  if (imei) {
    await db.saveActivityV2(imei, 'upTodayActivity', data);
    // برضو حدّث daily_steps الموجود (إذا وُجد step)
    if (data.step !== undefined) {
      try {
        await db.updateDailySteps(imei, data.step, 0);
      } catch (_) { /* ignore */ }
    }
  }
  ctx.sendResponse(builder.reply(req));
}

module.exports = {
  upSleep: handleUpSleep,
  upTodayActivity: handleUpTodayActivity,
  // نصدّر handler عام لكل أنواع upRun الـ exercise
  isRunLike: (type) => RUN_TYPES.has(type),
  runLike: handleRunLike,
};
