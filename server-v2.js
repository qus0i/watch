/**
 * ═══════════════════════════════════════════════════════════════
 *  Health Watch v2 — Connection Module (FCAF JSON Protocol)
 * ═══════════════════════════════════════════════════════════════
 *
 *  ⚠️ هذا الملف ليس entry point مستقل. الـ TCP listener موجود في
 *  server.js على بورت 5088، وهو يفصل الـ legacy عن v2 حسب أول بايت.
 *
 *  الـ exports:
 *    setupV2()                         → يُشغّل migrations الجديدة (مرة وحدة)
 *    handleV2Connection(socket, init)  → setup per-socket للـ v2 protocol
 *    sendV2Command(imei, envelope)     → إرسال أمر لجهاز v2 (حسب IMEI)
 *    getV2Stats()                      → إحصائيات اتصالات v2
 *
 *  Frame format:  [0xFC 0xAF][uint16 BE length][JSON payload]
 */

const config = require('./config');
const logger = require('./utils/logger');
const db = require('./database/db');
const { runMigrations } = require('./database/migrate');
const { encode, FrameAssembler } = require('./protocol/v2/frameCodec');
const v2Parser = require('./protocol/v2/parser');
const v2Router = require('./handlers/v2');

// تخزين الاتصالات النشطة v2
const activeV2Sockets = new Map(); // clientId -> socket
const imeiToSocket = new Map();    // imei -> socket

let _setupPromise = null;

/**
 * Idempotent setup — يُشغَّل مرة وحدة عند بدء السيرفر.
 *  - يُنفّذ migrations مجلد database/migrations/.
 *  - يُسجَّل الـ promise بحيث الاستدعاءات اللاحقة تنتظر نفسه.
 */
function setupV2() {
  if (_setupPromise) return _setupPromise;
  _setupPromise = (async () => {
    if (!config.v2.enabled) {
      console.log('ℹ️  [v2] disabled (V2_ENABLED=false) — skipping setup');
      return;
    }
    console.log('🔧 [v2] running migrations...');
    try {
      await runMigrations(db.pool);
      console.log('✅ [v2] setup complete');
    } catch (err) {
      console.error('❌ [v2] migrations failed:', err.message);
      logger.error(`[v2] migrations failed: ${err.message}`);
      // لا نرمي الخطأ — السيرفر القديم لازم يستمر بالعمل
    }

    // additive: شغّل heartbeat scheduler مرة وحدة (يستهدف اتصالات v2 فقط)
    try {
      require('./handlers/v2/heartbeat').start();
    } catch (err) {
      console.error('⚠️  [v2] heartbeat scheduler start failed:', err.message);
    }
  })();
  return _setupPromise;
}

function _logIncoming(req, ctx) {
  if (config.v2.enableMessageLog) {
    db.logV2Message('IN', req.imei || ctx.socket.imei || null,
                    req.type, req.ident, req.ref, req.raw);
  }
}

function _logOutgoing(envelope, imei) {
  if (config.v2.enableMessageLog) {
    db.logV2Message('OUT', imei || null, envelope.type, envelope.ident, envelope.ref, envelope);
  }
}

function _cleanupSocket(socket) {
  if (socket.clientId) activeV2Sockets.delete(socket.clientId);
  if (socket.imei && imeiToSocket.get(socket.imei) === socket) {
    imeiToSocket.delete(socket.imei);
  }
  // additive: notify heartbeat scheduler so we stop pinging a dead socket
  try {
    if (socket.imei) require('./handlers/v2/heartbeat').unregisterSession(socket.imei);
  } catch (_) { /* ignore */ }
}

/**
 * يستلم socket تم اكتشاف إنه v2 من الـ multiplexer في server.js.
 *
 * @param {net.Socket} socket
 * @param {Buffer}     initialBuffer  — أول بايتات قراها الـ multiplexer
 *                                      (شاملة الـ FCAF header). نُغذّيها للـ
 *                                      FrameAssembler مباشرة.
 */
function handleV2Connection(socket, initialBuffer) {
  // إذا v2 معطّل — اقفل الاتصال
  if (!config.v2.enabled) {
    logger.warn('[v2] received connection but V2_ENABLED=false — closing');
    try { socket.destroy(); } catch (_) { /* ignore */ }
    return;
  }

  if (!socket.clientId) {
    socket.clientId = `${socket.remoteAddress}:${socket.remotePort}`;
  }
  const clientId = socket.clientId;

  logger.info(`🔌 [v2] connection from ${clientId}`);
  console.log(`🔌 [v2] connection ${clientId}`);

  socket.imei = null;
  socket.deviceModel = null;
  socket.connectedAt = new Date();

  socket.setKeepAlive(true, config.v2.keepAliveIntervalMs);
  socket.setTimeout(config.v2.socketTimeoutMs);

  activeV2Sockets.set(clientId, socket);

  const assembler = new FrameAssembler();

  function sendResponse(envelope) {
    if (!envelope) return;
    try {
      const buf = encode(envelope);
      socket.write(buf);
      _logOutgoing(envelope, envelope.imei || socket.imei);
    } catch (err) {
      logger.error(`[v2] sendResponse error: ${err.message}`);
      console.error(`[v2] sendResponse error:`, err.message);
    }
  }

  const ctx = { socket, sendResponse, logger };

  async function processChunk(chunk) {
    try {
      const frames = assembler.push(chunk);
      if (frames.length === 0) return;

      console.log(`📥 [v2] ${clientId} got ${frames.length} frame(s) (pending=${assembler.pendingBytes}b)`);

      for (const frame of frames) {
        if (!frame.json) {
          logger.warn(`[v2] invalid JSON frame from ${clientId} (size=${frame.payload.length})`);
          console.log(`⚠️  [v2] invalid JSON: ${frame.payload.toString('utf8').substring(0, 200)}`);
          continue;
        }

        const req = v2Parser.parse(frame.json);

        if (req.imei && !socket.imei) {
          socket.imei = req.imei;
          imeiToSocket.set(req.imei, socket);
        } else if (req.imei && socket.imei && req.imei !== socket.imei) {
          imeiToSocket.delete(socket.imei);
          socket.imei = req.imei;
          imeiToSocket.set(req.imei, socket);
        }

        _logIncoming(req, ctx);

        if (!req.isValid) {
          logger.warn(`[v2] invalid payload type=${req.type}: ${req.error || 'no type'}`);
          continue;
        }

        await v2Router.route(req, ctx);
      }
    } catch (err) {
      logger.error(`[v2] data handler error from ${clientId}: ${err.message}`);
      console.error(`[v2] handler error:`, err);
    }
  }

  // 1) عالج البايتات الأولية اللي الـ multiplexer مرّرها لنا
  if (initialBuffer && initialBuffer.length > 0) {
    // غير-blocking — لو ما اكتمل frame راح ينتظر التالي
    processChunk(initialBuffer);
  }

  // 2) سجّل listeners للبيانات اللاحقة
  socket.on('data', processChunk);

  socket.on('end', () => {
    logger.info(`🔌 [v2] disconnected ${clientId} imei=${socket.imei || '-'}`);
    _cleanupSocket(socket);
  });

  socket.on('error', (err) => {
    logger.error(`[v2] socket error ${clientId}: ${err.message}`);
    _cleanupSocket(socket);
  });

  socket.on('timeout', () => {
    logger.warn(`[v2] timeout ${clientId} imei=${socket.imei || '-'}`);
    socket.end();
  });

  socket.on('close', () => {
    _cleanupSocket(socket);
  });
}

/**
 * إرسال أمر لجهاز v2 معيّن (حسب IMEI). يستخدمه الكود الخارجي.
 */
function sendV2Command(imei, envelope) {
  const socket = imeiToSocket.get(imei);
  if (!socket || socket.destroyed) return false;
  try {
    const buf = encode(envelope);
    socket.write(buf);
    _logOutgoing(envelope, imei);
    return true;
  } catch (err) {
    logger.error(`[v2] sendV2Command error: ${err.message}`);
    return false;
  }
}

function getV2Stats() {
  return {
    totalConnections: activeV2Sockets.size,
    boundDevices: imeiToSocket.size,
    devices: Array.from(activeV2Sockets.values()).map((s) => ({
      clientId: s.clientId,
      imei: s.imei || '-',
      deviceModel: s.deviceModel || '-',
      connectedAt: s.connectedAt,
      uptimeMs: Date.now() - s.connectedAt.getTime(),
    })),
  };
}

module.exports = {
  setupV2,
  handleV2Connection,
  sendV2Command,
  getV2Stats,
};
