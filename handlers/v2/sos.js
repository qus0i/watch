/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 SOS Setup — يضبط أرقام SOS على الساعة بعد LOGIN.
 *  مرجع SDK: page 36 — type 'SOSNumber'.
 *
 *  ⚠️ الرقم مكرّر من handlers/messageHandlers.js (legacy LOGIN handler)
 *  لأن الـ legacy ما يصدّره كـ exported constant ولا يُسمح لنا بتعديله.
 *  لو تغيّر الرقم بـ legacy لازم يُحدّث هنا كمان (TODO: collapse to a
 *  single config/sos.js source once legacy edits are unblocked).
 * ═══════════════════════════════════════════════════════════════
 */

const builder = require('../../protocol/v2/builder');
const { encode } = require('../../protocol/v2/frameCodec');
const logger = require('../../utils/logger');

// مطابق حرفياً لـ handlers/messageHandlers.js:55
const SOS_NUMBER = '+16627056776';

function sendSOSNumberConfig(socket, imei) {
  if (!imei || !socket || socket.destroyed || socket.writable === false) return false;

  const sosNumbers = [
    { sosNumberId: 'sos1', name: 'Emergency', phone: SOS_NUMBER },
    { sosNumberId: 'sos2', name: 'Emergency', phone: SOS_NUMBER },
    { sosNumberId: 'sos3', name: 'Emergency', phone: SOS_NUMBER },
  ];

  const envelope = builder.down('SOSNumber', imei, { sosNumbers });

  try {
    socket.write(encode(envelope));
    console.log(
      `📤 [v2-SOS] Sending SOS config to imei=${imei}, numbers=${sosNumbers.map((s) => s.phone).join(', ')}`
    );
    return true;
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.log(`⚠️ [v2-SOS] send failed imei=${imei} err=${msg}`);
    try { logger.error(`[v2-SOS] send failed imei=${imei}: ${msg}`); } catch (_) { /* ignore */ }
    return false;
  }
}

module.exports = { sendSOSNumberConfig, SOS_NUMBER };
