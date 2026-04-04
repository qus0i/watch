/**
 * ═══════════════════════════════════════════════════════════════
 *  GPS Watch TCP Server
 *  سيرفر TCP لاستقبال بيانات ساعات GPS الذكية
 * ═══════════════════════════════════════════════════════════════
 */

const net = require('net');
const http = require('http');
const url = require('url');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./database/db');
const ProtocolParser = require('./protocol/parser');
const MessageHandlers = require('./handlers/messageHandlers');

// Debug: تأكيد بدء التشغيل
console.log('🚀 بدء تشغيل server.js...');
console.log('📍 Node Version:', process.version);
console.log('📍 Environment:', process.env.NODE_ENV || 'development');

// تخزين الاتصالات النشطة
const activeSockets = new Map();

/**
 * إنشاء TCP Server
 */
const server = net.createServer((socket) => {
  const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
 
  logger.info(`🔌 اتصال جديد من: ${clientId}`);
  console.log(`🔌 اتصال جديد من: ${clientId}`);
 
  // إضافة الاتصال للقائمة النشطة
  activeSockets.set(clientId, socket);
 
  // معلومات الاتصال
  socket.clientId = clientId;
  socket.imei = null; // سيتم تحديده عند تسجيل الدخول
  socket.connectedAt = new Date();
 
  // إعدادات الاتصال
  socket.setKeepAlive(true, config.server.keepAliveInterval);
  socket.setTimeout(180000); // 3 دقائق timeout
 
  // Buffer للرسائل غير المكتملة
  let messageBuffer = '';

  /**
   * استقبال البيانات
   */
  socket.on('data', async (data) => {
    try {
      // تحويل البيانات إلى نص
      const rawData = data.toString();
      messageBuffer += rawData;
     
      // Debug مفصّل
      console.log('\n═══════════════════════════════════════');
      console.log(`📥 [${clientId}] بيانات واردة:`);
      console.log(`📦 الحجم: ${rawData.length} bytes`);
      console.log(`📝 المحتوى الكامل: ${rawData}`);
      console.log('═══════════════════════════════════════\n');
     
      logger.debug(`📥 بيانات واردة من ${clientId}: ${rawData.substring(0, 100)}...`);
     
      // معالجة الرسائل المكتملة (المنتهية بـ #)
      while (messageBuffer.includes('#')) {
        const endIndex = messageBuffer.indexOf('#');
        const message = messageBuffer.substring(0, endIndex + 1);
        messageBuffer = messageBuffer.substring(endIndex + 1);
       
        console.log(`🔄 معالجة رسالة: ${message}`);
       
        // تحليل الرسالة
        const parsedData = ProtocolParser.parse(message);
       
        if (parsedData) {
          console.log(`✅ تم تحليل الرسالة بنجاح - النوع: ${parsedData.type}`);
          // معالجة الرسالة
          await MessageHandlers.route(parsedData, socket);
        } else {
          console.log(`❌ فشل تحليل الرسالة: ${message}`);
        }
      }
     
      // تنظيف الـ buffer إذا كبر كثير
      if (messageBuffer.length > 10000) {
        logger.warn(`⚠️ Buffer كبير جداً، سيتم تنظيفه`);
        messageBuffer = '';
      }
     
    } catch (err) {
      logger.error(`خطأ في معالجة البيانات من ${clientId}:`, err.message);
      console.error(`❌ خطأ في معالجة البيانات:`, err);
    }
  });

  /**
   * عند قطع الاتصال
   */
  socket.on('end', () => {
    logger.info(`🔌 قطع الاتصال: ${clientId} (IMEI: ${socket.imei || 'غير معروف'})`);
    console.log(`🔌 قطع الاتصال: ${clientId}`);
    activeSockets.delete(clientId);
  });

  /**
   * عند حدوث خطأ
   */
  socket.on('error', (err) => {
    logger.error(`❌ خطأ في الاتصال ${clientId}:`, err.message);
    console.error(`❌ خطأ في الاتصال ${clientId}:`, err.message);
  });

  /**
   * عند انتهاء المهلة (Timeout)
   */
  socket.on('timeout', () => {
    logger.warn(`⏱️ انتهت مهلة الاتصال ${clientId}`);
    socket.end();
  });

  /**
   * عند إغلاق الاتصال
   */
  socket.on('close', (hadError) => {
    if (hadError) {
      logger.warn(`⚠️ إغلاق الاتصال مع خطأ: ${clientId}`);
    } else {
      logger.debug(`✓ إغلاق اتصال نظيف: ${clientId}`);
    }
    activeSockets.delete(clientId);
  });
});

/**
 * معالجة أخطاء السيرفر
 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`❌ البورت ${config.server.port} مستخدم بالفعل!`);
    process.exit(1);
  } else {
    logger.error('❌ خطأ في السيرفر:', err.message);
  }
});

/**
 * دالة لإرسال أمر لجهاز معين
 * @param {string} imei - رقم IMEI
 * @param {string} command - الأمر المُراد إرساله
 */
function sendCommandToDevice(imei, command) {
  // البحث عن الـ socket بناءً على IMEI
  for (const [clientId, socket] of activeSockets.entries()) {
    if (socket.imei === imei) {
      logger.info(`📤 إرسال أمر للجهاز ${imei}: ${command}`);
      console.log(`📤 إرسال أمر للجهاز ${imei}: ${command}`);
      socket.write(command);
      return true;
    }
  }
 
  logger.warn(`⚠️ الجهاز ${imei} غير متصل حالياً`);
  console.log(`⚠️ الجهاز ${imei} غير متصل حالياً`);
  return false;
}

/**
 * دالة لإحصائيات الاتصالات
 */
function getServerStats() {
  const stats = {
    totalConnections: activeSockets.size,
    devices: [],
  };
 
  for (const [clientId, socket] of activeSockets.entries()) {
    stats.devices.push({
      clientId,
      imei: socket.imei || 'غير معروف',
      connectedAt: socket.connectedAt,
      uptime: Date.now() - socket.connectedAt.getTime(),
    });
  }
 
  return stats;
}

/**
 * بدء تشغيل السيرفر
 */
async function startServer() {
  try {
    console.log('🔵 startServer() called');
   
    // اختبار الاتصال بقاعدة البيانات
    logger.info('🔍 اختبار الاتصال بقاعدة البيانات...');
    console.log('🔵 Testing database connection...');
   
    const dbConnected = await db.testConnection();
    console.log('🔵 Database connection result:', dbConnected);
   
    if (!dbConnected) {
      logger.error('❌ فشل الاتصال بقاعدة البيانات. تحقق من الإعدادات.');
      console.error('❌ Database connection failed');
      process.exit(1);
    }
   
    // ⭐ تهيئة قاعدة البيانات (إنشاء الجداول إذا لم تكن موجودة)
    console.log('🔵 Initializing database schema...');
    await db.initializeDatabase();
   
    console.log('🔵 Starting TCP server...');
   
    // Start HTTP API Server on port 5088
    const apiPort = process.env.API_PORT || 5088;
    const apiServer = http.createServer(async (req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        return res.end();
      }

      const parsed = url.parse(req.url, true);
      const path = parsed.pathname;

      try {
        // GET /api/devices
        if (req.method === 'GET' && path === '/api/devices') {
          const rows = await db.query(`
            SELECT
              d.id, d.imei, d.user_name, d.user_phone, d.sim_number,
              d.last_connection, d.is_active, d.notes,
              h.heart_rate,
              h.blood_pressure_systolic AS sbp,
              h.blood_pressure_diastolic AS dbp,
              h.spo2, h.blood_sugar,
              h.body_temperature AS temp,
              h.battery_level,
              l.latitude, l.longitude
            FROM devices d
            LEFT JOIN LATERAL (
              SELECT * FROM health_data
              WHERE device_id = d.id
              ORDER BY timestamp DESC LIMIT 1
            ) h ON true
            LEFT JOIN LATERAL (
              SELECT * FROM locations
              WHERE device_id = d.id
              ORDER BY timestamp DESC LIMIT 1
            ) l ON true
            ORDER BY d.last_connection DESC NULLS LAST
          `);
          const body = JSON.stringify(rows);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': Buffer.byteLength(body),
          });
          return res.end(body);
        }

        // GET /api/alerts
        if (req.method === 'GET' && path === '/api/alerts') {
          const rows = await db.query(`
            SELECT a.*, d.user_name, d.user_phone
            FROM alerts a
            JOIN devices d ON a.device_id = d.id
            WHERE a.is_handled = false
            ORDER BY a.created_at DESC
            LIMIT 50
          `);
          const body = JSON.stringify(rows);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': Buffer.byteLength(body),
          });
          return res.end(body);
        }

        // GET /api/stats
        if (req.method === 'GET' && path === '/api/stats') {
          const total = await db.query('SELECT COUNT(*) AS total FROM devices');
          const active = await db.query(`
            SELECT COUNT(*) AS active FROM devices
            WHERE last_connection > NOW() - INTERVAL '10 minutes'
          `);
          const unhandled = await db.query(
            'SELECT COUNT(*) AS unhandled FROM alerts WHERE is_handled = false'
          );
          const stats = {
            total: parseInt(total[0]?.total || 0),
            active: parseInt(active[0]?.active || 0),
            unhandled: parseInt(unhandled[0]?.unhandled || 0),
          };
          const body = JSON.stringify(stats);
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Content-Length': Buffer.byteLength(body),
          });
          return res.end(body);
        }

        // 404
        res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: 'Not found' }));
      } catch (err) {
        logger.error('API Error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    apiServer.listen(apiPort, '0.0.0.0', () => {
      logger.info(`✅ HTTP API Server running on port ${apiPort}`);
      console.log(`✅ HTTP API Server running on port ${apiPort}`);
    });
   
    // بدء الاستماع
    server.listen(config.server.port, config.server.host, () => {
      console.log('🔵 TCP server listening callback fired');
      logger.info('═══════════════════════════════════════════════════════');
      logger.info(`✅ السيرفر يعمل على ${config.server.host}:${config.server.port}`);
      logger.info(`📊 المنطقة الزمنية: UTC+${config.system.timezone}`);
      logger.info('═══════════════════════════════════════════════════════');
     
      console.log('═══════════════════════════════════════════════════════');
      console.log(`✅ السيرفر يعمل على ${config.server.host}:${config.server.port}`);
      console.log(`📊 المنطقة الزمنية: UTC+${config.system.timezone}`);
      console.log('═══════════════════════════════════════════════════════');
    });
   
    // إحصائيات دورية (كل 5 دقائق)
    setInterval(() => {
      const stats = getServerStats();
      logger.info(`📊 إحصائيات: ${stats.totalConnections} اتصال نشط`);
      console.log(`📊 إحصائيات: ${stats.totalConnections} اتصال نشط`);
     
      if (config.system.enableDebug && stats.devices.length > 0) {
        logger.debug('الأجهزة المتصلة:', stats.devices);
        console.log('الأجهزة المتصلة:', stats.devices);
      }
    }, 300000); // 5 دقائق
   
  } catch (err) {
    logger.error('❌ فشل بدء السيرفر:', err.message);
    process.exit(1);
  }
}

/**
 * معالجة إشارات إيقاف التشغيل
 */
process.on('SIGTERM', () => {
  logger.info('⚠️ استلام إشارة SIGTERM، إيقاف السيرفر...');
  gracefulShutdown();
});

process.on('SIGINT', () => {
  logger.info('⚠️ استلام إشارة SIGINT، إيقاف السيرفر...');
  gracefulShutdown();
});

/**
 * إيقاف تشغيل آمن
 */
function gracefulShutdown() {
  logger.info('🛑 جاري إغلاق الاتصالات...');
 
  // إغلاق جميع الاتصالات النشطة
  for (const [clientId, socket] of activeSockets.entries()) {
    socket.end();
  }
 
  // إغلاق السيرفر
  server.close(() => {
    logger.info('✅ تم إيقاف السيرفر بنجاح');
   
    // إغلاق قاعدة البيانات
    db.pool.end(() => {
      logger.info('✅ تم إغلاق قاعدة البيانات');
      process.exit(0);
    });
  });
 
  // إجبار الإغلاق بعد 10 ثواني
  setTimeout(() => {
    logger.error('⚠️ فشل الإغلاق النظيف، إغلاق قسري');
    process.exit(1);
  }, 10000);
}

/**
 * معالجة الأخطاء غير المُتوقعة
 */
process.on('uncaughtException', (err) => {
  logger.error('❌❌ خطأ غير متوقع:', err);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Promise غير معالج:', reason);
});

// تصدير الدوال للاستخدام الخارجي
module.exports = {
  startServer,
  sendCommandToDevice,
  getServerStats,
};

// بدء التشغيل إذا تم تشغيل الملف مباشرة
if (require.main === module) {
  console.log('🔵 Module is main, calling startServer()');
  startServer().catch(err => {
    console.error('❌❌ Fatal error in startServer:', err);
    console.error('Stack:', err.stack);
    process.exit(1);
  });
}
