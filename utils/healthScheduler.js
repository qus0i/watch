const logger = require('./logger');
const config = require('../config');
const ProtocolBuilder = require('../protocol/builder');

/**
 * نظام القياسات الصحية الدورية المبسّط
 * كل 5 دقائق: Location + ضغط + حرارة + أكسجين
 * التخزين: فوري (كل قياس يتحفظ مباشرة)
 */

class HealthScheduler {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.lastRunTime = null;
    this.measurementCount = 0;
  }

  /**
   * بدء نظام الجدولة
   */
  start(sendCommandCallback, getConnectedDevicesCallback) {
    if (this.isRunning) {
      logger.warn('نظام القياسات الدورية يعمل بالفعل');
      return;
    }

    if (!config.healthMonitoring.enabled) {
      logger.info('نظام القياسات الدورية معطل في الإعدادات');
      return;
    }

    const intervalMs = config.healthMonitoring.intervalMinutes * 60 * 1000;
    
    logger.info(`\n═══════════════════════════════════════════════════════`);
    logger.info(`🩺 بدء نظام القياسات الصحية الدورية`);
    logger.info(`   ⏰ الفترة: كل ${config.healthMonitoring.intervalMinutes} دقيقة`);
    logger.info(`   📊 القياسات المفعلة:`);
    if (config.healthMonitoring.measurements.location) logger.info('      📍 الموقع (GPS)');
    if (config.healthMonitoring.measurements.bloodPressure) logger.info('      💉 ضغط الدم + النبض');
    if (config.healthMonitoring.measurements.temperature) logger.info('      🌡️  حرارة الجسم');
    if (config.healthMonitoring.measurements.bloodOxygen) logger.info('      🫁 الأكسجين (SPO2)');
    logger.info(`   💾 التخزين: فوري (كل قياس يُحفظ مباشرة)`);
    logger.info(`   ⏱️  التأخير بين القياسات: ${config.healthMonitoring.delayBetweenCommands} ثانية`);
    logger.info(`═══════════════════════════════════════════════════════\n`);

    this.sendCommandCallback = sendCommandCallback;
    this.getConnectedDevicesCallback = getConnectedDevicesCallback;
    
    // تشغيل فوري ثم دوري
    this.runMeasurements();
    
    this.intervalId = setInterval(() => {
      this.runMeasurements();
    }, intervalMs);
    
    this.isRunning = true;
  }

  /**
   * إيقاف نظام الجدولة
   */
  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.isRunning = false;
      logger.info('⏹️  تم إيقاف نظام القياسات الدورية');
    }
  }

  /**
   * تنفيذ جولة قياسات كاملة
   */
  async runMeasurements() {
    try {
      const devices = this.getConnectedDevicesCallback();
      
      if (!devices || devices.length === 0) {
        logger.debug('⚠️ لا توجد أجهزة متصلة للقياس');
        return;
      }

      this.lastRunTime = new Date();
      this.measurementCount++;

      logger.info(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logger.info(`🩺 جولة قياسات #${this.measurementCount} - ${this.lastRunTime.toLocaleString('ar-JO')}`);
      logger.info(`   📱 عدد الأجهزة المتصلة: ${devices.length}`);
      logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      // إرسال الأوامر لكل جهاز
      for (const device of devices) {
        if (!device.imei) continue;
        
        logger.info(`📤 بدء القياسات للجهاز: ${device.imei}`);
        await this.sendAllMeasurements(device.imei);
        
        // تأخير بين الأجهزة (لو في أكثر من جهاز)
        if (devices.length > 1) {
          await this.delay(5000);
        }
      }

      logger.info(`\n✅ اكتملت جولة القياسات #${this.measurementCount}\n`);

    } catch (err) {
      logger.error('❌ خطأ في تنفيذ القياسات الدورية:', err.message);
    }
  }

  /**
   * إرسال جميع القياسات لجهاز واحد
   */
  async sendAllMeasurements(imei) {
    try {
      const measurements = config.healthMonitoring.measurements;
      const delay = config.healthMonitoring.delayBetweenCommands * 1000;
      let sentCount = 0;

      // 1️⃣ طلب الموقع (أول شي!)
      if (measurements.location) {
        const command = ProtocolBuilder.buildLocationRequest(imei);
        const success = this.sendCommandCallback(imei, command);
        if (success) {
          logger.info(`   📍 أمر الموقع: IWBP16 → انتظار ${config.healthMonitoring.delayBetweenCommands}ث`);
          sentCount++;
          await this.delay(delay);
        }
      }

      // 2️⃣ قياس ضغط الدم + النبض
      if (measurements.bloodPressure) {
        const command = ProtocolBuilder.buildBloodPressureTestCommand(imei);
        const success = this.sendCommandCallback(imei, command);
        if (success) {
          logger.info(`   💉 أمر ضغط الدم: IWBPXY → انتظار ${config.healthMonitoring.delayBetweenCommands}ث`);
          sentCount++;
          await this.delay(delay);
        }
      }

      // 3️⃣ قياس حرارة الجسم
      if (measurements.temperature) {
        const command = ProtocolBuilder.buildTemperatureTestCommand(imei);
        const success = this.sendCommandCallback(imei, command);
        if (success) {
          logger.info(`   🌡️  أمر الحرارة: IWBPXT → انتظار ${config.healthMonitoring.delayBetweenCommands}ث`);
          sentCount++;
          await this.delay(delay);
        }
      }

      // 4️⃣ قياس الأكسجين
      if (measurements.bloodOxygen) {
        const command = ProtocolBuilder.buildOxygenTestCommand(imei);
        const success = this.sendCommandCallback(imei, command);
        if (success) {
          logger.info(`   🫁 أمر الأكسجين: IWBPXZ → انتظار ${config.healthMonitoring.delayBetweenCommands}ث`);
          sentCount++;
          await this.delay(delay);
        }
      }

      if (sentCount > 0) {
        logger.info(`   ✅ تم إرسال ${sentCount} أمر قياس`);
        logger.info(`   ⏰ وقت الانتظار الكلي: ${(sentCount * config.healthMonitoring.delayBetweenCommands) / 60} دقيقة\n`);
      } else {
        logger.warn(`   ⚠️ لم يتم إرسال أي أوامر للجهاز ${imei}`);
      }

    } catch (err) {
      logger.error(`❌ خطأ في إرسال القياسات للجهاز ${imei}:`, err.message);
    }
  }

  /**
   * دالة مساعدة للتأخير
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * الحصول على حالة النظام
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      enabled: config.healthMonitoring.enabled,
      intervalMinutes: config.healthMonitoring.intervalMinutes,
      lastRunTime: this.lastRunTime,
      measurementCount: this.measurementCount,
      measurements: config.healthMonitoring.measurements,
      delayBetweenCommands: config.healthMonitoring.delayBetweenCommands,
    };
  }

  /**
   * إعادة تشغيل النظام
   */
  restart(sendCommandCallback, getConnectedDevicesCallback) {
    logger.info('🔄 إعادة تشغيل نظام القياسات الدورية...');
    this.stop();
    this.start(sendCommandCallback, getConnectedDevicesCallback);
  }
}

// تصدير مثيل واحد (Singleton)
module.exports = new HealthScheduler();
