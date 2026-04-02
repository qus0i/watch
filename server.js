/**
 * ═══════════════════════════════════════════════════════════════
 *  GPS Watch TCP Server - نظام القياسات بالتناوب
 *  كل 5 دقائق: قياس واحد (ضغط → حرارة → أكسجين)
 *  كل 15 دقيقة: دورة كاملة في row واحد
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
// ⭐ إعدادات القياسات الصحية بالتناوب
// ═══════════════════════════════════════════════════════════════
const HEALTH_MONITORING_CONFIG = {
  enabled: true,
  intervalMinutes: 5,
  debugMode: true,
};

console.log('⚙️  إعدادات القياسات:', HEALTH_MONITORING_CONFIG);

const activeSockets = new Map();
let measurementRoundCounter = 0;
let currentMeasurementType = 0; // 0=ضغط, 1=حرارة, 2=أكسجين

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
 * دوال القياسات الصحية بالتناوب
 * ═══════════════════════════════════════════════════════════════
 */

async function sendHealthMeasurementCommands() {
  try {
    measurementRoundCounter++;
    
    const measurementTypes = ['💉 ضغط + نبض', '🌡️ حرارة', '🫁 أكسجين'];
    const cycleNumber = Math.ceil(measurementRoundCounter / 3);
    const positionInCycle = ((measurementRoundCounter - 1) % 3) + 1;
    
    console.log('\n═══════════════════════════════════════════════════════');
    console.log(`🩺 جولة قياس #${measurementRoundCounter} - ${new Date().toLocaleString('ar-JO')}`);
    console.log(`🔄 الدورة #${cycleNumber} - القياس ${positionInCycle}/3`);
    console.log(`📊 نوع القياس: ${measurementTypes[currentMeasurementType]}`);
    console.log('═══════════════════════════════════════════════════════');
    
    const connectedDevices = [];
    for (const [clientId, socket] of activeSockets.entries()) {
      if (socket.imei) {
        connectedDevices.push({
          imei: socket.imei,
          socket: socket,
          clientId: clientId
        });
      }
    }

    console.log(`📱 أجهزة جاهزة للقياس: ${connectedDevices.length}\n`);

    if (connectedDevices.length === 0) {
      console.log('⚠️ لا توجد أجهزة متصلة للقياس');
      return;
    }

    for (const device of connectedDevices) {
      console.log(`📤 إرسال قياس لـ: ${device.imei}`);
      await sendMeasurementCommandToDevice(device.imei, device.socket);
    }

    console.log('\n✅ اكتملت الجولة');
    console.log(`⏰ الجولة القادمة بعد ${HEALTH_MONITORING_CONFIG.intervalMinutes} دقيقة`);
    
    if (positionInCycle === 3) {
      console.log(`🎉 اكتملت الدورة #${cycleNumber} - تم حفظ جميع القياسات في row واحد!\n`);
    } else {
      console.log(`📝 القياس ${positionInCycle}/3 - باقي ${3 - positionInCycle} قياس لإتمام الدورة\n`);
    }

  } catch (err) {
    logger.error('❌ خطأ في إرسال أوامر القياس:', err.message);
    console.error('❌ خطأ في إرسال أوامر القياس:', err);
  }
}

/**
 * ⭐ إرسال أمر قياس واحد حسب الدور
 */
async function sendMeasurementCommandToDevice(imei, socket) {
  try {
    let cmd;
    let commandName;
    
    if (currentMeasurementType === 0) {
      // جولة ضغط + نبض
      cmd = ProtocolBuilder.buildBloodPressureTestCommand(imei);
      commandName = '💉 ضغط + نبض';
      console.log(`   ${commandName}`);
      console.log(`   📤 ${cmd}`);
      currentMeasurementType = 1; // التالي: حرارة
      
    } else if (currentMeasurementType === 1) {
      // جولة حرارة
      cmd = ProtocolBuilder.buildTemperatureTestCommand(imei);
      commandName = '🌡️ حرارة';
      console.log(`   ${commandName}`);
      console.log(`   📤 ${cmd}`);
      currentMeasurementType = 2; // التالي: أكسجين
      
    } else {
      // جولة أكسجين
      cmd = ProtocolBuilder.buildOxygenTestCommand(imei);
      commandName = '🫁 أكسجين';
      console.log(`   ${commandName}`);
      console.log(`   📤 ${cmd}`);
      currentMeasurementType = 0; // التالي: رجوع للضغط (دورة جديدة)
    }
    
    socket.write(cmd);
    console.log(`   ✅ تم الإرسال - النتائج خلال 30 ثانية\n`);

    logger.info(`✓ تم إرسال ${commandName} لـ ${imei}`);

  } catch (err) {
    logger.error(`❌ خطأ في إرسال الأمر لـ ${imei}:`, err.message);
    console.error(`❌ خطأ في إرسال الأمر لـ ${imei}:`, err);
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
    
    if (!dbConnected) {
      logger.error('❌ فشل الاتصال بقاعدة البيانات');
      console.error('❌ فشل الاتصال بقاعدة البيانات');
      process.exit(1);
    }
    
    server.listen(config.server.port, config.server.host, () => {
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
        
        console.log(`\n🩺 تفعيل نظام القياسات بالتناوب`);
        console.log(`   ⏰ الفترة: كل ${HEALTH_MONITORING_CONFIG.intervalMinutes} دقيقة`);
        console.log(`   🔄 النظام: قياس واحد كل جولة (ضغط → حرارة → أكسجين)`);
        console.log(`   📦 التخزين: كل 3 جولات (15 دقيقة) = row واحد`);
        console.log(`   🐛 Debug Mode: ${HEALTH_MONITORING_CONFIG.debugMode}\n`);
        
        logger.info(`🩺 تفعيل القياسات بالتناوب (كل ${HEALTH_MONITORING_CONFIG.intervalMinutes} دقيقة)`);
        
        console.log('⏰ سيتم إرسال أول قياس بعد 10 ثواني...\n');
        setTimeout(() => {
          console.log('🔔 حان وقت الجولة الأولى!');
          sendHealthMeasurementCommands();
        }, 10000);
        
        setInterval(() => {
          console.log('🔔 حان وقت جولة قياس جديدة!');
          sendHealthMeasurementCommands();
        }, intervalMs);
      }
    });
    
    setInterval(() => {
      const stats = getServerStats();
      const cycleNumber = Math.ceil(measurementRoundCounter / 3);
      const positionInCycle = measurementRoundCounter % 3 || 3;
      
      console.log(`\n📊 [إحصائيات] اتصالات نشطة: ${stats.totalConnections}`);
      console.log(`🔄 الدورة الحالية: #${cycleNumber} - القياس ${positionInCycle}/3`);
      console.log(`📈 إجمالي الجولات: ${measurementRoundCounter}\n`);
      
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
    logger.error('⚠️ فشل الإغلاق النظيف، إغلاق قسري');
    console.error('⚠️ فشل الإغلاق النظيف، إغلاق قسري');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

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
