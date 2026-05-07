/**
 * ═══════════════════════════════════════════════════════════════
 *  v2 Heartbeat Scheduler
 *  يُرسل heartbeat FCAF لكل اتصال v2 نشط كل 60 ثانية حتى الجهاز
 *  لا يُغلق الـ socket على اعتباره خامل (idle).
 *  مرجع SDK: page 15 — "Send a heartbeat command at regular intervals
 *  from the server."
 * ═══════════════════════════════════════════════════════════════
 *
 *  Public API:
 *    registerSession(imei, socket) — يُستدعى بعد LOGIN DB-write
 *    unregisterSession(imei)       — يُستدعى من الـ disconnect path
 *    start()                        — يُشغّل الـ interval (مرة وحدة)
 *    stop()                         — للتوقف (مفيد للاختبار)
 *    getSessionCount()              — للإحصائيات
 *
 *  ⚠️ يستهدف اتصالات v2 فقط — الـ legacy IW له handler مستقل.
 */

const builder = require('../../protocol/v2/builder');
const { encode } = require('../../protocol/v2/frameCodec');
const logger = require('../../utils/logger');

const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 60 ثانية

// imei → { socket, lastSeenAt }
const sessions = new Map();

let _intervalHandle = null;

function registerSession(imei, socket) {
  if (!imei || !socket) return;
  const key = String(imei);
  sessions.set(key, { socket, lastSeenAt: Date.now() });
}

function unregisterSession(imei) {
  if (!imei) return;
  sessions.delete(String(imei));
}

function getSessionCount() {
  return sessions.size;
}

function _sendHeartbeat(imei, entry) {
  const { socket } = entry;

  // socket destroyed/not writable → احذفها بصمت
  if (!socket || socket.destroyed || socket.writable === false) {
    sessions.delete(imei);
    return;
  }

  try {
    // builder.down يبني envelope بـ ref='s:down' + ident عشوائي 6 خانات
    // + data.{type, imei, timestamp} + outer timestamp.
    const envelope = builder.down('heartbeat', imei, {});
    const buf = encode(envelope);
    socket.write(buf);
    console.log(`💓 [v2] heartbeat sent imei=${imei}`);
  } catch (err) {
    // فشل الكتابة → الـ socket على الأرجح ميت → احذفها وما تكسر السكدولر
    sessions.delete(imei);
    const msg = err && err.message ? err.message : String(err);
    console.log(`⚠️ [v2] heartbeat failed imei=${imei} err=${msg}`);
    try { logger.warn(`[v2] heartbeat failed imei=${imei}: ${msg}`); } catch (_) { /* ignore */ }
  }
}

function _tick() {
  if (sessions.size === 0) return;
  // snapshot لتجنب تعديل الـ Map أثناء الـ iteration
  const snapshot = Array.from(sessions.entries());
  for (const [imei, entry] of snapshot) {
    try {
      _sendHeartbeat(imei, entry);
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.log(`⚠️ [v2] heartbeat tick error imei=${imei} err=${msg}`);
      sessions.delete(imei);
    }
  }
}

function start() {
  if (_intervalHandle) return;
  _intervalHandle = setInterval(_tick, HEARTBEAT_INTERVAL_MS);
  if (_intervalHandle && typeof _intervalHandle.unref === 'function') {
    _intervalHandle.unref();
  }
  console.log(`💓 [v2] heartbeat scheduler started (every ${HEARTBEAT_INTERVAL_MS / 1000}s)`);
}

function stop() {
  if (_intervalHandle) {
    clearInterval(_intervalHandle);
    _intervalHandle = null;
  }
}

module.exports = {
  registerSession,
  unregisterSession,
  start,
  stop,
  getSessionCount,
};
