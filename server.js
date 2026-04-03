/**
 * ═══════════════════════════════════════════════════════════════
 *  GPS Watch TCP Server
 *  سيرفر TCP لاستقبال بيانات ساعات GPS الذكية
 * ═══════════════════════════════════════════════════════════════
 */

const net = require('net');
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
    
    console.log('🔵 Starting TCP server...');
    
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
