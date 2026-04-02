/**
 * ═══════════════════════════════════════════════════════════════
 *  GPS Watch TCP Server - النسخة النهائية
 *  يرسل 3 أوامر قياس مع تأخير 20 ثانية لكل البيانات
 * ═══════════════════════════════════════════════════════════════
 */

const net = require('net');
const config = require('./config');
const logger = require('./utils/logger');
const db = require('./database/db');
const ProtocolParser = require('./protocol/parser');
const MessageHandlers = require('./handlers/messageHandlers');
const ProtocolBuilder = require('./protocol/builder');

console.log('🚀 بدء تشغيل server.js...');
console.log('📍 Node Version:', process.version);

// ═══════════════════════════════════════════════════════════════
// ⭐ إعدادات القياسات الصحية الدورية
// ═══════════════════════════════════════════════════════════════
const HEALTH_MONITORING_CONFIG = {
  enabled: true,
  intervalMinutes: 5,
  debugMode: true,
};

console.log('⚙️  إعدادات القياسات:', HEALTH_MONITORING_CONFIG);

const activeSockets = new Map();
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

async function sendHealthMeasurementCommands() {
  try {
    measurementRoundCounter++;
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`🩺 جولة قياس #${measurementRoundCounter} - ${new Date().toLocaleString('ar-JO')}`);
    console.log('═══════════════════════════════════════════════════════');
    
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
      console.log('⚠️ لا توجد أجهزة متصلة للقياس');
      logger.debug('لا توجد أجهزة متصلة للقياس');
      return;
    }

    logger.info(`🩺 بدء إرسال أوامر القياس لـ ${connectedDevices.length} جهاز`);

    for (const device of connectedDevices) {
      console.log(`\n📤 معالجة الجهاز: ${device.imei}`);
      await sendMeasurementCommandsToDevice(device.imei, device.socket);
      await delay(5000); // تأخير 5 ثواني بين الأجهزة
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
 * ⭐ إرسال 3 أوامر قياس مع تأخير 20 ثانية
 * عشان نحصل على كل البيانات: نبض + ضغط + حرارة + أكسجين
 */
async function sendMeasurementCommandsToDevice(imei, socket) {
  try {
    console.log(`📤 إرسال أوامر القياس الشاملة لـ ${imei}`);
    console.log(`⏰ المدة المتوقعة: ~60 ثانية للحصول على جميع البيانات\n`);

    // 1️⃣ قياس الضغط والنبض (BPXY)
    console.log(`   1/3 💉 إرسال أمر: ضغط + نبض`);
    const cmdBP = ProtocolBuilder.buildBloodPressureTestCommand(imei);
    socket.write(cmdBP);
    console.log(`       📤 ${cmdBP}`);
    console.log(`       ⏳ انتظار 20 ثانية للساعة تكمل القياس...\n`);
    await delay(20000); // 20 ثانية

    // 2️⃣ قياس الحرارة (BPXT)
    console.log(`   2/3 🌡️  إرسال أمر: حرارة`);
    const cmdTemp = ProtocolBuilder.buildTemperatureTestCommand(imei);
    socket.write(cmdTemp);
    console.log(`       📤 ${cmdTemp}`);
    console.log(`       ⏳ انتظار 20 ثانية للساعة تكمل القياس...\n`);
    await delay(20000); // 20 ثانية

    // 3️⃣ قياس الأكسجين (BPXZ)
    console.log(`   3/3 🫁 إرسال أمر: أكسجين`);
    const cmdOxy = ProtocolBuilder.buildOxygenTestCommand(imei);
    socket.write(cmdOxy);
    console.log(`       📤 ${cmdOxy}`);
    console.log(`       ⏳ انتظار النتائج...\n`);

    logger.info(`✓ تم إرسال 3 أوامر قياس لـ ${imei}`);
    console.log(`   ✅ تم إرسال جميع الأوامر بنجاح`);
    console.log(`   📊 النتائج ستظهر في قاعدة البيانات خلال 1-2 دقيقة\n`);

  } catch (err) {
    logger.error(`❌ خطأ في إرسال الأوامر لـ ${imei}:`, err.message);
    console.error(`❌ خطأ في إرسال الأوامر لـ ${imei}:`, err);
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function startServer() {
  try {
    console.log('🔵 startServer() called');
    
    logger.info('🔍 اختبار الاتصال بقاعدة البيانات...');
    console.log('🔵 اختبار الاتصال بقاعدة البيانات...');
    
    const dbConnected = await db.testConnection();
    console.log('🔵 نتيجة الاتصال بقاعدة البيانات:', dbConnected);
    
    if (!dbConnected) {
      logger.error('❌ فشل الاتصال بقاعدة البيانات');
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
      
      if (HEALTH_MONITORING_CONFIG.enabled) {
        const intervalMs = HEALTH_MONITORING_CONFIG.intervalMinutes * 60 * 1000;
        
        console.log(`\n🩺 تفعيل القياسات الدورية`);
        console.log(`   ⏰ الفترة: كل ${HEALTH_MONITORING_CONFIG.intervalMinutes} دقيقة`);
        console.log(`   📊 القياسات: ضغط + نبض + حرارة + أكسجين (3 أوامر)`);
        console.log(`   ⏱️  التأخير بين الأوامر: 20 ثانية`);
        console.log(`   🐛 Debug Mode: ${HEALTH_MONITORING_CONFIG.debugMode}\n`);
        
        logger.info(`🩺 تفعيل القياسات الدورية (كل ${HEALTH_MONITORING_CONFIG.intervalMinutes} دقيقة)`);
        
        console.log('⏰ سيتم إرسال أول جولة قياسات بعد 10 ثواني...\n');
        setTimeout(() => {
          console.log('🔔 حان وقت الجولة الأولى!');
          sendHealthMeasurementCommands();
        }, 10000);
        
        setInterval(() => {
          console.log('🔔 حان وقت جولة قياسات جديدة!');
          sendHealthMeasurementCommands();
        }, intervalMs);
      }
    });
    
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
    }, 120000);
    
  } catch (err) {
    logger.error('❌ فشل بدء السيرفر:', err.message);
    console.error('❌❌ Fatal error in startServer:', err);
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
    logger.error('⚠️ فشل الإغلاق النظيح، إغلاق قسري');
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
    process.exit(1);
  });
}
