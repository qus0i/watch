/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Health Handlers — upHealthData, upBatch, upHeartRate, upBP, upBO,
 *                       upBodyTemperature, upBS, upECG ...
 * ═══════════════════════════════════════════════════════════════
 *
 * البروتوكول الجديد يستخدم نوع داخلي (data.type) لتمييز نوع القياس:
 *   upHeartRate → "data": "100"        نبض
 *   upBP        → "data": "120/80/88"  ضغط/ضغط/نبض  (أو 120/80)
 *   upBO        → "data": "96"         أكسجين
 *   upBodyTemperature → "data": "36.8/31.6/28.2"  (جسم/سطح/بيئة)
 *   upBS        → "data": "9.6"        سكر
 *
 * upBatch: نفس الفكرة بس "data" CSV لقيم متعددة و "dataTime" CSV للتوقيتات.
 */

const db = require('../../database/db');
const parser = require('../../protocol/v2/parser');
const builder = require('../../protocol/v2/builder');

function _firstNum(s) {
  if (s === null || s === undefined) return null;
  const m = String(s).match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/**
 * Parse "data" string بناءً على نوع القياس.
 * يرجّع object بالحقول العامة (heartRate/systolic/diastolic/spo2/temperature/bloodSugar)
 */
function parseMeasurement(measurementType, dataStr) {
  const out = {};
  if (dataStr === undefined || dataStr === null) return out;
  const s = String(dataStr).trim();
  if (!s) return out;

  switch (measurementType) {
    case 'upHeartRate':
      out.heartRate = _firstNum(s);
      break;
    case 'upBP': {
      // 120/80 أو 120/80/88
      const parts = s.split('/').map((p) => parseInt(p, 10));
      if (parts[0]) out.systolic = parts[0];
      if (parts[1]) out.diastolic = parts[1];
      if (parts[2]) out.heartRate = parts[2];
      break;
    }
    case 'upBO':
      out.spo2 = _firstNum(s) !== null ? Math.round(_firstNum(s)) : null;
      break;
    case 'upBodyTemperature': {
      // 36.8/31.6/28.2 — الأول هو حرارة الجسم
      const parts = s.split('/').map((p) => parseFloat(p));
      if (Number.isFinite(parts[0])) out.temperature = parts[0];
      break;
    }
    case 'upBS':
      out.bloodSugar = _firstNum(s);
      break;
    default:
      // upECG / upHRV / upPPG / upRR / upKcal / upBF / upUA — لا نخزّنها بـ health_data
      // (تتطلّب جدول مخصص للـ waveforms — TODO)
      break;
  }
  return out;
}

async function handleUpHealthData(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  const data = req.data || {};
  const ts = parser.tsToDate(data.timestamp || req.timestamp);

  // upHealthData هو wrapper. حقل النوع داخل data.type.
  const measurementType = data.type;
  const fields = parseMeasurement(measurementType, data.data || data.date);

  // batteryLevel مش جزء من upHealthData عادة، بس نضيفها لو وجدت
  if (data.batteryLevel !== undefined) fields.batteryLevel = data.batteryLevel;

  const hasAny = Object.values(fields).some((v) => v !== null && v !== undefined);
  if (imei && hasAny) {
    await db.saveHealthDataV2(imei, fields, ts);
  } else {
    ctx.logger.debug(`[v2] upHealthData ignored — type=${measurementType} data=${data.data || data.date}`);
  }

  ctx.sendResponse(builder.reply(req));
}

async function handleUpBatch(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  const data = req.data || {};
  const measurementType = data.dataType;
  const valuesCsv = data.data || '';
  const timesCsv = data.dataTime || '';

  const values = String(valuesCsv).split(',').map((v) => v.trim()).filter(Boolean);
  const times = String(timesCsv).split(',').map((v) => v.trim());

  let saved = 0;
  if (imei && values.length > 0) {
    for (let i = 0; i < values.length; i++) {
      const fields = parseMeasurement(measurementType, values[i]);
      if (Object.values(fields).every((v) => v === null || v === undefined)) continue;
      const tMs = times[i] ? Number(times[i]) : null;
      const ts = tMs ? parser.tsToDate(tMs) : new Date();
      const id = await db.saveHealthDataV2(imei, fields, ts);
      if (id) saved++;
    }
  }

  ctx.logger.info(`📊 [v2] upBatch type=${measurementType} count=${values.length} saved=${saved}`);
  ctx.sendResponse(builder.reply(req));
}

/**
 * أنواع upXxx صحية مفردة (upHeartRate, upBP, upBO, ...) قد تأتي مباشرة في data.type
 * بدون wrapper upHealthData. نتعامل معها بنفس مَنطق upHealthData.
 */
async function handleUpDirectMeasurement(req, ctx) {
  const imei = req.imei || ctx.socket.imei;
  const data = req.data || {};
  const ts = parser.tsToDate(data.timestamp || req.timestamp);
  const measurementType = data.type || req.type;

  const fields = parseMeasurement(measurementType, data.data || data.date);
  const hasAny = Object.values(fields).some((v) => v !== null && v !== undefined);

  if (imei && hasAny) {
    await db.saveHealthDataV2(imei, fields, ts);
  } else {
    ctx.logger.debug(`[v2] direct measurement ignored — ${measurementType}`);
  }

  ctx.sendResponse(builder.reply(req));
}

module.exports = {
  upHealthData: handleUpHealthData,
  upBatch: handleUpBatch,
  upHeartRate: handleUpDirectMeasurement,
  upBP: handleUpDirectMeasurement,
  upBO: handleUpDirectMeasurement,
  upBodyTemperature: handleUpDirectMeasurement,
  upBS: handleUpDirectMeasurement,
};
