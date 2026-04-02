const logger = require('./logger');
const config = require('../config');
const ProtocolBuilder = require('../protocol/builder');

/**
 * نظام جدولة القياسات الصحية الدورية
 * يرسل أوامر القياس لجميع الساعات المتصلة حسب الفترة المحددة
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
   * @param {Function} sendCommandCallback - دالة إرسال الأمر للجهاز
   * @param {Function} getConnectedDevicesCallback - دالة الحصول على الأجهزة المتصلة
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
    
    logger.info(`🩺 بدء نظام القياسات الصحية الدورية (كل ${config.healthMonitoring.intervalMinutes} دقيقة)`);
    logger.info(`   📊 القياسات المفعلة:`);
    if (config.healthMonitoring.measurements.location) logger.info('      📍 الموقع (GPS)');
    if (config.healthMonitoring.measurements.heartRate) logger.info('      ❤️  النبض');
    if (config.healthMonitoring.measurements.bloodPressure) logger.info('      💉 ضغط الدم');
    if (config.healthMonitoring.measurements.temperature) logger.info('      🌡️  الحرارة');
    if (config.healthMonitoring.measurements.bloodOxygen) logger.info('      🫁 الأكسجين');

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
   * تنفيذ القياسات على جميع الأجهزة المتصلة
   */
  async runMeasurements() {
    try {
      const devices = this.getConnectedDevicesCallback();
      
      if (!devices || devices.length === 0) {
        logger.debug('لا توجد أجهزة متصلة حالياً للقياس');
        return;
      }

      this.lastRunTime = new Date();
      this.measurementCount++;

      logger.info(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
      logger.info(`🩺 بدء جولة القياسات #${this.measurementCount}`);
      logger.info(`   📱 عدد الأجهزة: ${devices.length}`);
      logger.info(`   ⏰ الوقت: ${this.lastRunTime.toLocaleString('ar-JO')}`);
      logger.info(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

      // إرسال الأوامر لكل جهاز
      for (const device of devices) {
        if (!device.imei) continue;
        
        await this.sendMeasurementCommands(device.imei);
        
        // تأخير قصير بين الأجهزة لتجنب الازدحام
        await this.delay(1000);
      }

      logger.info(`✅ اكتملت جولة القياسات #${this.measurementCount}\n`);

    } catch (err) {
      logger.error('خطأ في تنفيذ القياسات الدورية:', err.message);
    }
  }

  /**
   * إرسال أوامر القياس لجهاز معين
   * @param {string} imei - رقم IMEI للجهاز
   */
  async sendMeasurementCommands(imei) {
    try {
      logger.debug(`📤 إرسال أوامر القياس للجهاز: ${imei}`);
      
      const measurements = config.healthMonitoring.measurements;
      const delay = config.healthMonitoring.delayBetweenCommands * 1000;
      let sentCount = 0;

      // طلب الموقع (أولاً - أهم قياس!)
      if (measurements.location) {
        const command = ProtocolBuilder.buildLocationRequest(imei);
        const success = this.sendCommandCallback(imei, command);
        if (success) {
          logger.debug(`   📍 أمر الموقع: ${command.substring(0, 30)}...`);
          sentCount++;
          await this.delay(delay);
        }
      }

      // قياس النبض
      if (measurements.heartRate) {
        const command = ProtocolBuilder.buildHeartRateTestCommand(imei);
        const success = this.sendCommandCallback(imei, command);
        if (success) {
          logger.debug(`   ❤️  أمر النبض: ${command.substring(0, 30)}...`);
          sentCount++;
          await this.delay(delay);
        }
      }

      // قياس ضغط الدم
      if (measurements.bloodPressure) {
        const command = ProtocolBuilder.buildBloodPressureTestCommand(imei);
        const success = this.sendCommandCallback(imei, command);
        if (success) {
          logger.debug(`   💉 أمر الضغط: ${command.substring(0, 30)}...`);
          sentCount++;
          await this.delay(delay);
        }
      }

      // قياس الحرارة
      if (measurements.temperature) {
        const command = ProtocolBuilder.buildTemperatureTestCommand(imei);
        const success = this.sendCommandCallback(imei, command);
        if (success) {
          logger.debug(`   🌡️  أمر الحرارة: ${command.substring(0, 30)}...`);
          sentCount++;
          await this.delay(delay);
        }
      }

      // قياس الأكسجين
      if (measurements.bloodOxygen) {
        const command = ProtocolBuilder.buildOxygenTestCommand(imei);
        const success = this.sendCommandCallback(imei, command);
        if (success) {
          logger.debug(`   🫁 أمر الأكسجين: ${command.substring(0, 30)}...`);
          sentCount++;
          await this.delay(delay);
        }
      }

      if (sentCount > 0) {
        logger.info(`✓ تم إرسال ${sentCount} أمر قياس للجهاز ${imei}`);
      }

    } catch (err) {
      logger.error(`خطأ في إرسال أوامر القياس للجهاز ${imei}:`, err.message);
    }
  }

  /**
   * دالة مساعدة للتأخير
   * @param {number} ms - المدة بالميلي ثانية
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
    };
  }

  /**
   * إعادة تشغيل النظام (للتطبيق الفوري للإعدادات الجديدة)
   */
  restart(sendCommandCallback, getConnectedDevicesCallback) {
    logger.info('🔄 إعادة تشغيل نظام القياسات الدورية...');
    this.stop();
    this.start(sendCommandCallback, getConnectedDevicesCallback);
  }
}

// تصدير مثيل واحد (Singleton)
module.exports = new HealthScheduler();
