/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Location Handler — upLocation (and upGPS alias)
 * ═══════════════════════════════════════════════════════════════
 *
 * payload data structure:
 *   {
 *     type: "upLocation",
 *     imei,
 *     gps: { lat, lon, height, satelliteNum, GSM, Type },
 *     wifi: [ { ssid, signal, mac } ],
 *     baseStation: [ { mcc, mnc, lac, ci, rxlev } ],
 *     baseStationType: 0|1,
 *     positionDataType: "0"|"1",
 *     timestamp: ms
 *   }
 */

const db = require('../../database/db');
const parser = require('../../protocol/v2/parser');
const builder = require('../../protocol/v2/builder');

async function handleUpLocation(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  const data = req.data || {};
  const ts = parser.tsToDate(data.timestamp || req.timestamp);

  if (!imei) {
    ctx.sendResponse(builder.reply(req));
    return;
  }

  // ⭐ Cycle-aware: أول upLocation للدورة → INSERT جديد عبر saveLocationV2
  // (يحفظ الـ payload الكامل: gps, baseStation, wifi, mcc/mnc/lac/ci, gsm, sat).
  // upLocation اللاحقة بنفس الدورة → UPDATE الإحداثيات فقط على نفس الـ row.
  const gps = data.gps || null;
  const lat = gps && gps.lat !== undefined ? parseFloat(gps.lat) : null;
  const lon = gps && gps.lon !== undefined ? parseFloat(gps.lon) : null;

  if (!ctx.socket.currentLocationCycleId) {
    // أول موقع بالدورة — INSERT (saveLocationV2 يرجع الـ id لجدول locations)
    const newId = await db.saveLocationV2(imei, data, ts);
    if (newId) {
      ctx.socket.currentLocationCycleId = newId;
      console.log(`📍 [v2-SESSION] new location row #${newId} imei=${imei}`);
    }
  } else if (Number.isFinite(lat) && Number.isFinite(lon)) {
    // موقع لاحق بنفس الدورة — UPDATE الإحداثيات فقط
    await db.updateLocationById(ctx.socket.currentLocationCycleId, lat, lon);
    console.log(
      `📍 [v2-SESSION] updated location row #${ctx.socket.currentLocationCycleId} imei=${imei} ` +
      `lat=${lat.toFixed(6)} lon=${lon.toFixed(6)}`
    );
  } else {
    console.log(
      `📍 [v2-SESSION] location row #${ctx.socket.currentLocationCycleId} kept (no GPS this time)`
    );
  }

  ctx.sendResponse(builder.reply(req));
}

async function handleUpBattery(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  const data = req.data || {};
  if (imei) {
    await db.updateDeviceHeartbeatV2(imei, data.batteryLevel, data.batteryState);
  }
  ctx.sendResponse(builder.reply(req));
}

module.exports = {
  upLocation: handleUpLocation,
  upGPS: handleUpLocation, // alias حسب طلب البريف
  upBattery: handleUpBattery,
};
