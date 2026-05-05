/**
 * ═══════════════════════════════════════════════════════════════
 *  Health Watch v2 - Response Builder
 *  بناء envelopes ردود السيرفر بصيغة s:reply / s:down
 * ═══════════════════════════════════════════════════════════════
 *
 * Public response body:
 *   {
 *     type: <same as data.type>,
 *     ident: <from request, لازم يطابق طلب الجهاز>,
 *     ref: 's:reply' | 's:down',
 *     imei,
 *     data: { type, imei, timestamp, ...extras },
 *     timestamp
 *   }
 */

function _now() {
  return Date.now();
}

function _genIdent() {
  // 6-digit random — حسب الـ PDF (random 6-digit number)
  return Math.floor(100000 + Math.random() * 900000);
}

/**
 * بناء envelope عام لرد على طلب جاي من الجهاز (s:reply).
 * يحافظ على نفس الـ ident والـ imei والـ type.
 *
 * @param {object} request — الـ parsed payload من parser.parse()
 * @param {object} extra   — حقول إضافية تضاف داخل data
 */
function reply(request, extra = {}) {
  const type = request.type || (request.data && request.data.type) || 'reply';
  const imei = request.imei || (request.data && request.data.imei) || '';
  const ts = _now();

  return {
    type,
    ident: request.ident || _genIdent(),
    ref: 's:reply',
    imei,
    data: {
      type,
      imei,
      timestamp: ts,
      ...extra,
    },
    timestamp: ts,
  };
}

/**
 * بناء envelope لرد على login (يضيف bindStatus).
 * @param {object} request
 * @param {0|1} bindStatus — 0: not bound, 1: bound
 */
function loginReply(request, bindStatus = 1) {
  const deviceModel = (request.data && request.data.deviceModel) || '';
  return reply(request, { bindStatus, deviceModel });
}

/**
 * بناء envelope لرد على heartbeat (acknowledgment فاضي).
 */
function heartbeatReply(request) {
  return reply(request);
}

/**
 * أمر مبادر من السيرفر (s:down) — مثل dnDevBindStatus, dnLocation, dnHeartRate, dnCustom.
 *
 * @param {string} type   — مثلاً 'dnDevBindStatus'
 * @param {string} imei
 * @param {object} data   — حقول data المخصصة للأمر
 * @param {number} [ident] — اختياري، لو ما تعطيها بنولّد واحد
 */
function down(type, imei, data = {}, ident = null) {
  const ts = _now();
  return {
    type,
    ident: ident || _genIdent(),
    ref: 's:down',
    imei: imei || '',
    data: {
      type,
      imei: imei || '',
      timestamp: ts,
      ...data,
    },
    timestamp: ts,
  };
}

/**
 * Helper: dnDevBindStatus
 * @param {string} imei
 * @param {0|1} status
 */
function devBindStatus(imei, status = 1) {
  return down('dnDevBindStatus', imei, { status });
}

module.exports = {
  reply,
  loginReply,
  heartbeatReply,
  down,
  devBindStatus,
  _genIdent,
};
