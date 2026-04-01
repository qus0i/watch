/**
 * ═══════════════════════════════════════════════════════════════
 *  GPS Watch TCP Server مع القياسات الصحية الدورية
 *  يرسل أمر قياس واحد شامل كل 5 دقائق
 * ═══════════════════════════════════════════════════════════════
 */

const net = require('net');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./database/db');
const ProtocolParser = require('./protocol/parser');
const MessageHandlers = require('./handlers/messageHandlers');
const ProtocolBuilder = require('./protocol/builder');

// ═══════════════════════════════════════════════════════════════
// ⭐ إعدادات القياسات الصحية الدورية
// ═══════════════════════════════════════════════════════════════
const HEALTH_MONITORING_CONFIG = {
  enabled: true,
  intervalMinutes: 5,
  measurementType: 'bloodPressure',  // 'bloodPressure' يرجع النبض والضغط مع بعض
  // خيارات أخرى: 'heartRate', 'temperature', 'bloodOxygen'
};

// تخزين الاتصالات النشطة
const activeSockets = new Map();

/**
 * إنشاء TCP Server
 */
const server = net.createServer((socket) => {
  const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
  
  logger.info(`🔌 اتصال جديد من: ${clientId}`);
  
  activeSockets.set(clientId, socket);
  
  socket.clientId = clientId;
  socket.imei = null;
  socket.connectedAt = new Date();
  
  socket.setKeepAlive(true, config.server.keepAliveInterval);
  socket.setTimeout(180000);
  
  let messageBuffer = '';

  /**
   * استقبال البيانات
   */
  socket.on('data', async (data) => {
    try {
      const rawData = data.toString();
      messageBuffer += rawData;
      
      logger.debug(`📥 بيانات واردة من ${clientId}: ${rawData.substring(0, 100)}...`);
      
      while (messageBuffer.includes('#')) {
        const endIndex = messageBuffer.indexOf('#');
        const message = messageBuffer.substring(0, endIndex + 1);
        messageBuffer = messageBuffer.substring(endIndex + 1);
        
        const parsedData = ProtocolParser.parse(message);
        
        if (parsedData) {
          await MessageHandlers.route(parsedData, socket);
        }
      }
      
      if (messageBuffer.length > 10000) {
        logger.warn(`⚠️ Buffer كبير جداً، سيتم تنظيفه`);
        messageBuffer = '';
      }
      
    } catch (err) {
      logger.error(`خطأ في معالجة البيانات من ${clientId}:`, err.message);
    }
  });

  /**
   * عند قطع الاتصال
   */
  socket.on('end', () => {
    logger.info(`🔌 قطع الاتصال: ${clientId} (IMEI: ${socket.imei || 'غير معروف'})`);
    activeSockets.delete(clientId);
  });

  /**
   * عند حدوث خطأ
   */
  socket.on('error', (err) => {
    logger.error(`❌ خطأ في الاتصال ${clientId}:`, err.message);
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
    }
    activeSockets.delete(clientId);
  });
});

/**
 * ═══════════════════════════════════════════════════════════════
 * دوال القياسات الصحية الدورية
 * ═══════════════════════════════════════════════════════════════
 */

/**
 * دالة إرسال أوامر القياس لجميع الأجهزة المتصلة
 */
async function sendHealthMeasurementCommands() {
  try {
    const connectedDevices = [];
    for (const [clientId, socket] of activeSockets.entries()) {
      if (socket.imei) {
        connectedDevices.push({
          imei: socket.imei,
          socket: socket
        });
      }
    }

    if (connectedDevices.length === 0) {
      logger.debug('لا توجد أجهزة متصلة للقياس');
      return;
    }

    logger.info(`\n🩺 بدء إرسال أوامر القياس لـ ${connectedDevices.length} جهاز`);

    for (const device of connectedDevices) {
      await sendMeasurementCommandToDevice(device.imei, device.socket);
      await delay(1000);
    }

    logger.info('✅ اكتملت جولة القياسات\n');

  } catch (err) {
    logger.error('خطأ في إرسال أوامر القياس:', err.message);
  }
}

/**
 * إرسال أمر قياس واحد لجهاز
 */
async function sendMeasurementCommandToDevice(imei, socket) {
  try {
    const measurementType = HEALTH_MONITORING_CONFIG.measurementType;
    let cmd;
    let measurementName;

    // اختيار نوع القياس
    switch (measurementType) {
      case 'heartRate':
        cmd = ProtocolBuilder.buildHeartRateTestCommand(imei);
        measurementName = 'النبض';
        break;
      
      case 'bloodPressure':
        cmd = ProtocolBuilder.buildBloodPressureTestCommand(imei);
        measurementName = 'الضغط والنبض';
        break;
      
      case 'temperature':
        cmd = ProtocolBuilder.buildTemperatureTestCommand(imei);
        measurementName = 'الحرارة';
        break;
      
      case 'bloodOxygen':
        cmd = ProtocolBuilder.buildOxygenTestCommand(imei);
        measurementName = 'الأكسجين';
        break;
      
      default:
        cmd = ProtocolBuilder.buildBloodPressureTestCommand(imei);
        measurementName = 'الضغط والنبض';
    }

    logger.debug(`📤 إرسال أمر ${measurementName} لـ ${imei}`);
    socket.write(cmd);
    logger.info(`✓ تم إرسال أمر ${measurementName} لـ ${imei}`);

  } catch (err) {
    logger.error(`خطأ في إرسال الأوامر لـ ${imei}:`, err.message);
  }
}

/**
 * دالة مساعدة للتأخير
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * ═══════════════════════════════════════════════════════════════
 * معالجة أخطاء السيرفر
 * ═══════════════════════════════════════════════════════════════
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
 */
function sendCommandToDevice(imei, command) {
  for (const [clientId, socket] of activeSockets.entries()) {
    if (socket.imei === imei) {
      logger.info(`📤 إرسال أمر للجهاز ${imei}: ${command}`);
      socket.write(command);
      return true;
    }
  }
  
  logger.warn(`⚠️ الجهاز ${imei} غير متصل حالياً`);
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
 * ═══════════════════════════════════════════════════════════════
 * بدء تشغيل السيرفر
 * ═══════════════════════════════════════════════════════════════
 */
async function startServer() {
  try {
    logger.info('🔍 اختبار الاتصال بقاعدة البيانات...');
    
    const dbConnected = await db.testConnection();
    
    if (!dbConnected) {
      logger.error('❌ فشل الاتصال بقاعدة البيانات. تحقق من الإعدادات.');
      process.exit(1);
    }
    
    server.listen(config.server.port, config.server.host, () => {
      logger.info('═══════════════════════════════════════════════════════');
      logger.info(`✅ السيرفر يعمل على ${config.server.host}:${config.server.port}`);
      logger.info(`📊 المنطقة الزمنية: UTC+${config.system.timezone}`);
      logger.info('═══════════════════════════════════════════════════════');
      
      // ⭐ بدء نظام القياسات الدورية
      if (HEALTH_MONITORING_CONFIG.enabled) {
        const intervalMs = HEALTH_MONITORING_CONFIG.intervalMinutes * 60 * 1000;
        const measurementNames = {
          heartRate: 'النبض',
          bloodPressure: 'الضغط والنبض',
          temperature: 'الحرارة',
          bloodOxygen: 'الأكسجين'
        };
        
        logger.info(`\n🩺 تفعيل القياسات الدورية (كل ${HEALTH_MONITORING_CONFIG.intervalMinutes} دقيقة)`);
        logger.info(`   📊 نوع القياس: ${measurementNames[HEALTH_MONITORING_CONFIG.measurementType]}\n`);
        
        // تشغيل فوري بعد 5 ثواني
        setTimeout(() => sendHealthMeasurementCommands(), 5000);
        
        // تشغيل دوري
        setInterval(() => {
          sendHealthMeasurementCommands();
        }, intervalMs);
      }
    });
    
    // إحصائيات دورية (كل 5 دقائق)
    setInterval(() => {
      const stats = getServerStats();
      logger.info(`📊 إحصائيات: ${stats.totalConnections} اتصال نشط`);
      
      if (config.system.enableDebug && stats.devices.length > 0) {
        logger.debug('الأجهزة المتصلة:', stats.devices);
      }
    }, 300000);
    
  } catch (err) {
    logger.error('❌ فشل بدء السيرفر:', err.message);
    process.exit(1);
  }
}

/**
 * إيقاف تشغيل آمن
 */
function gracefulShutdown() {
  logger.info('🛑 جاري إغلاق الاتصالات...');
  
  for (const [clientId, socket] of activeSockets.entries()) {
    socket.end();
  }
  
  server.close(() => {
    logger.info('✅ تم إيقاف السيرفر بنجاح');
    
    db.pool.end(() => {
      logger.info('✅ تم إغلاق قاعدة البيانات');
      process.exit(0);
    });
  });
  
  setTimeout(() => {
    logger.error('⚠️ فشل الإغلاق النظيف، إغلاق قسري');
    process.exit(1);
  }, 10000);
}

/**
 * معالجة إشارات الإيقاف
 */
process.on('SIGTERM', () => {
  logger.info('⚠️ استلام إشارة SIGTERM');
  gracefulShutdown();
});

process.on('SIGINT', () => {
  logger.info('⚠️ استلام إشارة SIGINT');
  gracefulShutdown();
});

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
  startServer();
}
