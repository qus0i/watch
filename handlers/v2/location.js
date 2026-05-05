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

  if (imei) {
    await db.saveLocationV2(imei, data, ts);
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
