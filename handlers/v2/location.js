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
  let lat = gps && gps.lat !== undefined ? parseFloat(gps.lat) : null;
  let lon = gps && gps.lon !== undefined ? parseFloat(gps.lon) : null;

  // ─── LBS/WiFi fallback when GPS is absent ──────────────────────────
  // Mirrors legacy `handleMultipleBases` in handlers/messageHandlers.js.
  // HW20 PRO indoors sends valid baseStation + wifi arrays but no gps —
  // resolve them through the same LocationService the legacy stack uses.
  let resolvedFromLBS = false;
  const gpsValid = Number.isFinite(lat) && Number.isFinite(lon)
                   && !(lat === 0 && lon === 0);

  if (!gpsValid) {
    try {
      const baseStation = Array.isArray(data.baseStation) && data.baseStation.length > 0
        ? data.baseStation[0]
        : null;
      const wifiList = Array.isArray(data.wifi) ? data.wifi : [];

      // v2 baseStation field is `ci` (per protocol/v2 docs); legacy uses `cellId`.
      // Accept either to be defensive.
      const cellId = baseStation
        ? parseInt(baseStation.ci ?? baseStation.cellId, 10)
        : NaN;
      const mcc = baseStation ? parseInt(baseStation.mcc, 10) : NaN;
      const mnc = baseStation ? parseInt(baseStation.mnc, 10) : NaN;
      const lac = baseStation ? parseInt(baseStation.lac, 10) : NaN;

      // wifi shape from v2 protocol: { ssid, signal, mac } — already matches
      // what LocationService expects. Filter to entries that actually have a MAC.
      const wifiData = wifiList.filter((w) => w && w.mac);

      if (Number.isFinite(mcc) && Number.isFinite(lac) && Number.isFinite(cellId)) {
        const LocationService = require('../../services/locationService');
        const resolved = await LocationService.resolveLocation(
          mcc, mnc, lac, cellId, wifiData
        );
        if (resolved
            && Number.isFinite(resolved.latitude)
            && Number.isFinite(resolved.longitude)) {
          lat = resolved.latitude;
          lon = resolved.longitude;
          resolvedFromLBS = true;
          console.log(
            `📡 [v2-LBS] resolved imei=${imei} via ${resolved.source} → ` +
            `${lat.toFixed(6)}, ${lon.toFixed(6)} (acc=${resolved.accuracy || '?'}m)`
          );
        } else {
          console.log(
            `⚠️ [v2-LBS] no resolution imei=${imei} ` +
            `mcc=${mcc} mnc=${mnc} lac=${lac} cid=${cellId} wifi=${wifiData.length}`
          );
        }
      } else {
        console.log(
          `⚠️ [v2-LBS] insufficient LBS data imei=${imei} ` +
          `(mcc/lac/cid not all numeric — wifi=${wifiData.length})`
        );
      }
    } catch (err) {
      console.log(`⚠️ [v2-LBS] resolution error imei=${imei}: ${err.message}`);
    }
  }

  if (!ctx.socket.currentLocationCycleId) {
    // أول موقع بالدورة — INSERT (saveLocationV2 يرجع الـ id لجدول locations)
    const newId = await db.saveLocationV2(imei, data, ts);
    if (newId) {
      ctx.socket.currentLocationCycleId = newId;
      console.log(`📍 [v2-SESSION] new location row #${newId} imei=${imei}`);

      // Backfill resolved coords onto the row we just inserted.
      if (resolvedFromLBS) {
        try {
          await db.updateLocationById(newId, lat, lon);
          console.log(
            `📡 [v2-SESSION] row #${newId} updated with LBS-resolved coords ` +
            `lat=${lat.toFixed(6)} lon=${lon.toFixed(6)}`
          );
        } catch (err) {
          console.log(`⚠️ [v2-SESSION] LBS backfill failed row #${newId}: ${err.message}`);
        }
      }
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
