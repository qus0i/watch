/**
 * ═══════════════════════════════════════════════════════════════
 *  GPS Watch TCP Server مع القياسات الصحية الدورية
 *  نسخة محسنة ومختبرة
 * ═══════════════════════════════════════════════════════════════
 */

const net = require('net');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./database/db');
const ProtocolParser = require('./protocol/parser');
const MessageHandlers = require('./handlers/messageHandlers');
const ProtocolBuilder = require('./protocol/builder');

// Debug: تأكيد بدء التشغيل
console.log('🚀 بدء تشغيل server.js...');
console.log('📍 Node Version:', process.version);

// ═══════════════════════════════════════════════════════════════
// ⭐ إعدادات القياسات الصحية الدورية
// ═══════════════════════════════════════════════════════════════
const HEALTH_MONITORING_CONFIG = {
  enabled: true,                     // تفعيل/تعطيل
  intervalMinutes: 5,                // كل كم دقيقة
  measurementType: 'bloodPressure',  // نوع القياس
  debugMode: true,                   // تفعيل الـ debug للتشخيص
};

console.log('⚙️  إعدادات القياسات:', HEALTH_MONITORING_CONFIG);

// تخزين الاتصالات النشطة
const activeSockets = new Map();

// عداد لجولات القياس
let measurementRoundCounter = 0;

/**
 * إنشاء TCP Server
 */
const server = net.createServer((socket) => {
  const clientId = `${socket.remoteAddress}:${socket.remotePort}`;
  
  logger.info(`🔌 اتصال جديد من: ${clientId}`);
  console.log(`🔌 اتصال جديد من: ${clientId}`);
  
  activeSockets.set(clientId, socket);
  
  socket.clientId = clientId;
  socket.imei = null;
  socket.connectedAt = new Date();
  
  socket.setKeepAlive(true, config.server.keepAliveInterval);
  socket.setTimeout(180000);
  
  let messageBuffer = '';

  socket.on('data', async (data) => {
    try {
      const rawData = data.toString();
      messageBuffer += rawData;
      
      if (HEALTH_MONITORING_CONFIG.debugMode) {
        console.log(`📥 [${clientId}] بيانات واردة: ${rawData.substring(0, 100)}...`);
      }
      
      logger.debug(`📥 بيانات واردة من ${clientId}: ${rawData.substring(0, 100)}...`);
      
      while (messageBuffer.includes('#')) {
        const endIndex = messageBuffer.indexOf('#');
        const message = messageBuffer.substring(0, endIndex + 1);
        messageBuffer = messageBuffer.substring(endIndex + 1);
        
        const parsedData = ProtocolParser.parse(message);
        
        if (parsedData) {
          // ⭐ حفظ IMEI عند تسجيل الدخول
          if (parsedData.type === 'LOGIN' && parsedData.imei) {
            socket.imei = parsedData.imei;
            console.log(`✅ تم تسجيل IMEI: ${socket.imei} للاتصال ${clientId}`);
          }
          
          await MessageHandlers.route(parsedData, socket);
        }
      }
      
      if (messageBuffer.length > 10000) {
        logger.warn(`⚠️ Buffer كبير جداً، سيتم تنظيفه`);
        messageBuffer = '';
      }
      
    } catch (err) {
      logger.error(`خطأ في معالجة البيانات من ${clientId}:`, err.message);
      console.error(`❌ خطأ في معالجة البيانات من ${clientId}:`, err.message);
    }
  });

  socket.on('end', () => {
    logger.info(`🔌 قطع الاتصال: ${clientId} (IMEI: ${socket.imei || 'غير معروف'})`);
    console.log(`🔌 قطع الاتصال: ${clientId} (IMEI: ${socket.imei || 'غير معروف'})`);
    activeSockets.delete(clientId);
  });

  socket.on('error', (err) => {
    logger.error(`❌ خطأ في الاتصال ${clientId}:`, err.message);
    console.error(`❌ خطأ في الاتصال ${clientId}:`, err.message);
  });

  socket.on('timeout', () => {
    logger.warn(`⏱️ انتهت مهلة الاتصال ${clientId}`);
    socket.end();
  });

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
    measurementRoundCounter++;
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`🩺 جولة قياس #${measurementRoundCounter} - ${new Date().toLocaleString('ar-JO')}`);
    console.log('═══════════════════════════════════════════════════════');
    
    // جمع الأجهزة المتصلة
    const connectedDevices = [];
    for (const [clientId, socket] of activeSockets.entries()) {
      console.log(`🔍 فحص ${clientId}: IMEI = ${socket.imei || 'لا يوجد'}`);
      
      if (socket.imei) {
        connectedDevices.push({
          imei: socket.imei,
          socket: socket,
          clientId: clientId
        });
        console.log(`   ✅ تمت إضافة ${socket.imei}`);
      } else {
        console.log(`   ⚠️ تم تجاهله (لا يوجد IMEI)`);
      }
    }

    console.log(`\n📱 إجمالي الأجهزة المتصلة: ${activeSockets.size}`);
    console.log(`✅ الأجهزة الجاهزة للقياس: ${connectedDevices.length}\n`);

    if (connectedDevices.length === 0) {
      console.log('⚠️ لا توجد أجهزة متصلة للقياس (تأكد من تسجيل دخول الساعات)');
      logger.debug('لا توجد أجهزة متصلة للقياس');
      return;
    }

    logger.info(`🩺 بدء إرسال أوامر القياس لـ ${connectedDevices.length} جهاز`);

    // إرسال الأوامر لكل جهاز
    for (const device of connectedDevices) {
      console.log(`\n📤 معالجة الجهاز: ${device.imei}`);
      await sendMeasurementCommandToDevice(device.imei, device.socket);
      await delay(2000); // تأخير 2 ثانية بين الأجهزة
    }

    console.log('\n✅ اكتملت جولة القياسات');
    console.log(`⏰ الجولة القادمة بعد ${HEALTH_MONITORING_CONFIG.intervalMinutes} دقيقة\n`);
    
    logger.info('✅ اكتملت جولة القياسات');

  } catch (err) {
    logger.error('❌ خطأ في إرسال أوامر القياس:', err.message);
    console.error('❌ خطأ في إرسال أوامر القياس:', err);
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

    // التأكد من وجود ProtocolBuilder
    if (!ProtocolBuilder) {
      throw new Error('ProtocolBuilder غير موجود');
    }

    // اختيار نوع القياس
    switch (measurementType) {
      case 'heartRate':
        if (!ProtocolBuilder.buildHeartRateTestCommand) {
          throw new Error('buildHeartRateTestCommand غير موجودة في ProtocolBuilder');
        }
        cmd = ProtocolBuilder.buildHeartRateTestCommand(imei);
        measurementName = 'النبض';
        break;
      
      case 'bloodPressure':
        if (!ProtocolBuilder.buildBloodPressureTestCommand) {
          throw new Error('buildBloodPressureTestCommand غير موجودة في ProtocolBuilder');
        }
        cmd = ProtocolBuilder.buildBloodPressureTestCommand(imei);
        measurementName = 'الضغط والنبض';
        break;
      
      case 'temperature':
        if (!ProtocolBuilder.buildTemperatureTestCommand) {
          throw new Error('buildTemperatureTestCommand غير موجودة في ProtocolBuilder');
        }
        cmd = ProtocolBuilder.buildTemperatureTestCommand(imei);
        measurementName = 'الحرارة';
        break;
      
      case 'bloodOxygen':
        if (!ProtocolBuilder.buildOxygenTestCommand) {
          throw new Error('buildOxygenTestCommand غير موجودة في ProtocolBuilder');
        }
        cmd = ProtocolBuilder.buildOxygenTestCommand(imei);
        measurementName = 'الأكسجين';
        break;
      
      default:
        cmd = ProtocolBuilder.buildBloodPressureTestCommand(imei);
        measurementName = 'الضغط والنبض';
    }

    console.log(`   📊 نوع القياس: ${measurementName}`);
    console.log(`   📤 الأمر: ${cmd}`);
    
    // إرسال الأمر
    socket.write(cmd);
    
    console.log(`   ✅ تم الإرسال بنجاح`);
    logger.info(`✓ تم إرسال أمر ${measurementName} لـ ${imei}`);

  } catch (err) {
    logger.error(`❌ خطأ في إرسال الأوامر لـ ${imei}:`, err.message);
    console.error(`❌ خطأ في إرسال الأوامر لـ ${imei}:`, err);
    console.error('Stack:', err.stack);
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
    console.error(`❌ البورت ${config.server.port} مستخدم بالفعل!`);
    process.exit(1);
  } else {
    logger.error('❌ خطأ في السيرفر:', err.message);
    console.error('❌ خطأ في السيرفر:', err);
  }
});

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
    console.log('🔵 startServer() called');
    
    logger.info('🔍 اختبار الاتصال بقاعدة البيانات...');
    console.log('🔵 اختبار الاتصال بقاعدة البيانات...');
    
    const dbConnected = await db.testConnection();
    console.log('🔵 نتيجة الاتصال بقاعدة البيانات:', dbConnected);
    
    if (!dbConnected) {
      logger.error('❌ فشل الاتصال بقاعدة البيانات. تحقق من الإعدادات.');
      console.error('❌ فشل الاتصال بقاعدة البيانات');
      process.exit(1);
    }
    
    console.log('🔵 بدء TCP server...');
    
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
      
      // ⭐ بدء نظام القياسات الدورية
      if (HEALTH_MONITORING_CONFIG.enabled) {
        const intervalMs = HEALTH_MONITORING_CONFIG.intervalMinutes * 60 * 1000;
        const measurementNames = {
          heartRate: 'النبض',
          bloodPressure: 'الضغط والنبض',
          temperature: 'الحرارة',
          bloodOxygen: 'الأكسجين'
        };
        
        console.log(`\n🩺 تفعيل القياسات الدورية`);
        console.log(`   ⏰ الفترة: كل ${HEALTH_MONITORING_CONFIG.intervalMinutes} دقيقة (${intervalMs}ms)`);
        console.log(`   📊 نوع القياس: ${measurementNames[HEALTH_MONITORING_CONFIG.measurementType]}`);
        console.log(`   🐛 Debug Mode: ${HEALTH_MONITORING_CONFIG.debugMode}\n`);
        
        logger.info(`🩺 تفعيل القياسات الدورية (كل ${HEALTH_MONITORING_CONFIG.intervalMinutes} دقيقة)`);
        logger.info(`   📊 نوع القياس: ${measurementNames[HEALTH_MONITORING_CONFIG.measurementType]}`);
        
        // ⭐ تشغيل فوري بعد 10 ثواني (للتأكد من اتصال الساعات)
        console.log('⏰ سيتم إرسال أول جولة قياسات بعد 10 ثواني...\n');
        setTimeout(() => {
          console.log('🔔 حان وقت الجولة الأولى!');
          sendHealthMeasurementCommands();
        }, 10000);
        
        // ⭐ تشغيل دوري
        const intervalId = setInterval(() => {
          console.log('🔔 حان وقت جولة قياسات جديدة!');
          sendHealthMeasurementCommands();
        }, intervalMs);
        
        console.log(`✅ تم ضبط الـ interval: كل ${intervalMs}ms`);
        console.log(`📍 Interval ID: ${intervalId}\n`);
        
        // التأكد من أن الـ interval شغال
        if (intervalId) {
          console.log('✅ الـ Interval تم إنشاؤه بنجاح');
        } else {
          console.error('❌ فشل في إنشاء الـ Interval!');
        }
      } else {
        console.log('\n⚠️ نظام القياسات الدورية معطل في الإعدادات\n');
      }
    });
    
    // إحصائيات دورية (كل 2 دقيقة للتشخيص)
    setInterval(() => {
      const stats = getServerStats();
      console.log(`\n📊 [إحصائيات] اتصالات نشطة: ${stats.totalConnections}`);
      
      if (stats.devices.length > 0) {
        console.log('📱 الأجهزة المتصلة:');
        stats.devices.forEach(device => {
          console.log(`   - ${device.imei} (${device.clientId})`);
        });
      }
      
      console.log(`🔄 جولات القياس المكتملة: ${measurementRoundCounter}\n`);
      
      logger.info(`📊 إحصائيات: ${stats.totalConnections} اتصال نشط`);
      
      if (config.system.enableDebug && stats.devices.length > 0) {
        logger.debug('الأجهزة المتصلة:', stats.devices);
      }
    }, 120000); // كل 2 دقيقة
    
  } catch (err) {
    logger.error('❌ فشل بدء السيرفر:', err.message);
    console.error('❌❌ Fatal error in startServer:', err);
    console.error('Stack:', err.stack);
    process.exit(1);
  }
}

function gracefulShutdown() {
  logger.info('🛑 جاري إغلاق الاتصالات...');
  console.log('🛑 جاري إغلاق الاتصالات...');
  
  for (const [clientId, socket] of activeSockets.entries()) {
    socket.end();
  }
  
  server.close(() => {
    logger.info('✅ تم إيقاف السيرفر بنجاح');
    console.log('✅ تم إيقاف السيرفر بنجاح');
    
    db.pool.end(() => {
      logger.info('✅ تم إغلاق قاعدة البيانات');
      console.log('✅ تم إغلاق قاعدة البيانات');
      process.exit(0);
    });
  });
  
  setTimeout(() => {
    logger.error('⚠️ فشل الإغلاق النظيف، إغلاق قسري');
    console.error('⚠️ فشل الإغلاق النظيف، إغلاق قسري');
    process.exit(1);
  }, 10000);
}

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
  console.error('❌❌ خطأ غير متوقع:', err);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('❌ Promise غير معالج:', reason);
  console.error('❌ Promise غير معالج:', reason);
});

module.exports = {
  startServer,
  sendCommandToDevice,
  getServerStats,
};

if (require.main === module) {
  console.log('🔵 Module is main, calling startServer()');
  startServer().catch(err => {
    console.error('❌❌ Fatal error:', err);
    console.error('Stack:', err.stack);
    process.exit(1);
  });
}
