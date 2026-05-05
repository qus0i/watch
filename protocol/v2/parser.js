/**
 * ═══════════════════════════════════════════════════════════════
 *  Health Watch v2 - Payload Parser
 *  تطبيع الـ JSON الوارد + استخراج النوع الفعلي للأمر
 * ═══════════════════════════════════════════════════════════════
 *
 * البروتوكول له envelope:
 *   { type, ident, ref, imei, data: { type, imei, deviceModel, timestamp, ... }, timestamp }
 *
 * الـ inner type في data هو اللي يحدد الأمر (login, heartbeat, upHealthData, ...).
 * الـ ref بيكون: w:update (تحديث من الجهاز) | w:reply (رد الجهاز على أمر سيرفر)
 */

/**
 * @param {object} json — parsed JSON object
 * @returns {{
 *   type: string,
 *   ident: number|null,
 *   ref: string|null,
 *   imei: string|null,
 *   data: object,
 *   timestamp: number|null,
 *   raw: object,
 *   isValid: boolean,
 *   error: string|null
 * }}
 */
function parse(json) {
  if (!json || typeof json !== 'object') {
    return _invalid('payload is not an object', json);
  }

  // النوع الحقيقي مفروض يجي من data.type. نسقط على outer.type كـ fallback.
  const innerType = json.data && typeof json.data === 'object' ? json.data.type : null;
  const outerType = json.type || null;
  const type = innerType || outerType || 'unknown';

  // IMEI: نقرأها من data أولاً (المرجع الأكثر موثوقية لأنها بتنزل بكل نوع)
  const imei = (json.data && json.data.imei) || json.imei || null;

  return {
    type,
    ident: typeof json.ident === 'number' ? json.ident : (json.ident ? Number(json.ident) : null),
    ref: typeof json.ref === 'string' ? json.ref : null,
    imei: imei ? String(imei) : null,
    data: (json.data && typeof json.data === 'object') ? json.data : json,
    timestamp: typeof json.timestamp === 'number' ? json.timestamp : null,
    raw: json,
    isValid: !!type && type !== 'unknown',
    error: null,
  };
}

function _invalid(reason, raw) {
  return {
    type: 'unknown',
    ident: null,
    ref: null,
    imei: null,
    data: {},
    timestamp: null,
    raw,
    isValid: false,
    error: reason,
  };
}

/**
 * تحويل ms timestamp → JS Date آمن.
 * البروتوكول الجديد يستخدم millisecond timestamps.
 */
function tsToDate(msTimestamp) {
  if (msTimestamp === null || msTimestamp === undefined) return new Date();
  const n = Number(msTimestamp);
  if (!Number.isFinite(n) || n <= 0) return new Date();
  // إذا الرقم بثواني (10 أرقام تقريباً) حوّله إلى ms
  if (n < 1e12) return new Date(n * 1000);
  return new Date(n);
}

module.exports = {
  parse,
  tsToDate,
};
