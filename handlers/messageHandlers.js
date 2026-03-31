const logger = require('../utils/logger');
const db = require('../database/db');
const ProtocolBuilder = require('../protocol/builder');

/**
 * معالجات الرسائل
 * كل معالج يستقبل البيانات المحللة ويعالجها
 */

class MessageHandlers {

  /**
   * معالجة رسالة تسجيل الدخول
   */
  static async handleLogin(data, socket) {
    try {
      logger.info(`✅ تسجيل دخول ناجح: ${data.imei}`);
      
      // حفظ أو تحديث الجهاز في قاعدة البيانات
      await db.getOrCreateDevice(data.imei);
      
      // حفظ IMEI في الـ socket للاستخدام لاحقاً
      socket.imei = data.imei;
      
      // إرسال الرد
      const response = ProtocolBuilder.buildLoginResponse();
      socket.write(response);
      
      logger.debug(`📤 رد تسجيل الدخول: ${response}`);
      
    } catch (err) {
      logger.error('خطأ في معالجة تسجيل الدخول:', err.message);
    }
  }

  /**
   * معالجة رسالة الموقع
   */
  static async handleLocation(data, socket) {
    try {
      // إضافة IMEI من السياق
      data.imei = socket.imei;
      
      if (!data.imei) {
        logger.warn('رسالة موقع بدون IMEI محدد');
        return;
      }

      // حفظ في قاعدة البيانات
      await db.saveLocation(data);
      
      // إرسال الرد
      const response = ProtocolBuilder.buildLocationResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة الموقع:', err.message);
    }
  }

  /**
   * معالجة رسالة Heartbeat
   */
  static async handleHeartbeat(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      // تحديث آخر اتصال
      await db.getOrCreateDevice(data.imei);
      
      // تحديث الخطوات اليومية
      if (data.stepCount) {
        await db.updateDailySteps(data.imei, data.stepCount, data.rollFrequency);
      }
      
      // إرسال الرد
      const response = ProtocolBuilder.buildHeartbeatResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة Heartbeat:', err.message);
    }
  }

  /**
   * معالجة رسالة إنذار
   */
  static async handleAlarm(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      // حفظ الموقع
      await db.saveLocation(data);
      
      // حفظ الإنذار
      await db.saveAlert({
        imei: data.imei,
        timestamp: data.timestamp,
        alertType: data.alertType,
        latitude: data.latitude,
        longitude: data.longitude,
      });
      
      // TODO: إرسال إشعار للمستخدم (Push Notification / SMS / Email)
      logger.warn(`🚨 إنذار ${data.alertType} من ${data.imei}`);
      
      // إرسال الرد
      const response = ProtocolBuilder.buildAlarmResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة الإنذار:', err.message);
    }
  }

  /**
   * معالجة رسالة قياس النبض
   */
  static async handleHeartRate(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      await db.saveHealthData({
        imei: data.imei,
        heartRate: data.heartRate,
      });
      
      const response = ProtocolBuilder.buildHeartRateResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة النبض:', err.message);
    }
  }

  /**
   * معالجة رسالة النبض وضغط الدم
   */
  static async handleHeartRateBP(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      await db.saveHealthData({
        imei: data.imei,
        heartRate: data.heartRate,
        systolic: data.systolic,
        diastolic: data.diastolic,
      });
      
      const response = ProtocolBuilder.buildHeartRateBPResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة النبض والضغط:', err.message);
    }
  }

  /**
   * معالجة رسالة القياسات الكاملة
   */
  static async handleFullHealth(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      await db.saveHealthData({
        imei: data.imei,
        heartRate: data.heartRate,
        systolic: data.systolic,
        diastolic: data.diastolic,
        spo2: data.spo2,
        bloodSugar: data.bloodSugar,
      });
      
      const response = ProtocolBuilder.buildFullHealthResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة القياسات الكاملة:', err.message);
    }
  }

  /**
   * معالجة رسالة الحرارة
   */
  static async handleTemperature(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      await db.saveHealthData({
        imei: data.imei,
        temperature: data.temperature,
        batteryLevel: data.batteryLevel,
      });
      
      const response = ProtocolBuilder.buildTemperatureResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة الحرارة:', err.message);
    }
  }

  /**
   * معالجة رسالة أبراج متعددة
   */
  static async handleMultipleBases(data, socket) {
    try {
      // مجرد رد بسيط
      const response = ProtocolBuilder.buildMultipleBasesResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة أبراج متعددة:', err.message);
    }
  }

  /**
   * توجيه الرسالة للمعالج المناسب
   */
  static async route(parsedData, socket) {
    if (!parsedData) return;

    try {
      switch (parsedData.type) {
        case 'LOGIN':
          await this.handleLogin(parsedData, socket);
          break;
        case 'LOCATION':
          await this.handleLocation(parsedData, socket);
          break;
        case 'HEARTBEAT':
          await this.handleHeartbeat(parsedData, socket);
          break;
        case 'ALARM':
          await this.handleAlarm(parsedData, socket);
          break;
        case 'HEART_RATE':
          await this.handleHeartRate(parsedData, socket);
          break;
        case 'HEART_RATE_BP':
          await this.handleHeartRateBP(parsedData, socket);
          break;
        case 'FULL_HEALTH':
          await this.handleFullHealth(parsedData, socket);
          break;
        case 'TEMPERATURE':
          await this.handleTemperature(parsedData, socket);
          break;
        case 'MULTIPLE_BASES':
          await this.handleMultipleBases(parsedData, socket);
          break;
        default:
          logger.warn(`نوع رسالة غير معالج: ${parsedData.type}`);
      }
    } catch (err) {
      logger.error('خطأ في توجيه الرسالة:', err.message);
    }
  }
}

module.exports = MessageHandlers;
