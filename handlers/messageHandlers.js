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
      console.log(`✅ تم تسجيل IMEI: ${data.imei} للاتصال ${socket.clientId}`);
      
      // حفظ أو تحديث الجهاز في قاعدة البيانات
      await db.getOrCreateDevice(data.imei);
      
      // حفظ IMEI في الـ socket للاستخدام لاحقاً
      socket.imei = data.imei;
      
      // إرسال الرد
      const response = ProtocolBuilder.buildLoginResponse();
      socket.write(response);
      
      logger.debug(`📤 رد تسجيل الدخول: ${response}`);
      console.log(`📤 رد تسجيل الدخول: ${response}`);
      
      // طلب موقع فوري بعد تسجيل الدخول
      setTimeout(() => {
        const locationRequest = ProtocolBuilder.buildLocationRequest(data.imei);
        socket.write(locationRequest);
        logger.info(`📍 طلب موقع فوري من ${data.imei}: ${locationRequest}`);
        console.log(`📍 طلب موقع فوري من ${data.imei}`);
      }, 2000); // بعد ثانيتين
      
    } catch (err) {
      logger.error('خطأ في معالجة تسجيل الدخول:', err.message);
      console.error('❌ خطأ في معالجة تسجيل الدخول:', err);
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
        console.log('⚠️ رسالة موقع بدون IMEI');
        return;
      }

      console.log(`\n💾 حفظ موقع للجهاز ${data.imei}:`);
      console.log(`   الإحداثيات: ${data.latitude}, ${data.longitude}`);
      console.log(`   GPS صحيح: ${data.gpsValid}`);
      console.log(`   البطارية: ${data.batteryLevel}%`);

      // حفظ في قاعدة البيانات
      const saved = await db.saveLocation(data);
      
      if (saved) {
        console.log(`✅ تم حفظ الموقع بنجاح في قاعدة البيانات`);
      } else {
        console.log(`❌ فشل حفظ الموقع في قاعدة البيانات`);
      }
      
      // إرسال الرد
      const response = ProtocolBuilder.buildLocationResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة الموقع:', err.message);
      console.error('❌ خطأ في معالجة الموقع:', err);
    }
  }

  /**
   * معالجة رسالة Heartbeat
   */
  static async handleHeartbeat(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`💓 Heartbeat من ${data.imei} - بطارية: ${data.batteryLevel}%`);

      // تحديث آخر اتصال
      await db.getOrCreateDevice(data.imei);
      
      // تحديث الخطوات اليومية
      if (data.stepCount) {
        await db.updateDailySteps(data.imei, data.stepCount, data.rollFrequency);
        console.log(`   الخطوات: ${data.stepCount}`);
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

      console.log(`🚨 إنذار من ${data.imei} - النوع: ${data.alertType}`);

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

      console.log(`\n❤️ استقبال نبض القلب:`);
      console.log(`   IMEI: ${data.imei}`);
      console.log(`   النبض: ${data.heartRate} bpm`);

      const saved = await db.saveHealthData({
        imei: data.imei,
        heartRate: data.heartRate,
      });
      
      if (saved) {
        console.log(`✅ تم حفظ نبض القلب بنجاح`);
      } else {
        console.log(`❌ فشل حفظ نبض القلب`);
      }
      
      const response = ProtocolBuilder.buildHeartRateResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة النبض:', err.message);
      console.error('❌ خطأ في معالجة النبض:', err);
    }
  }

  /**
   * معالجة رسالة النبض وضغط الدم
   */
  static async handleHeartRateBP(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n💉 استقبال بيانات ضغط ونبض:`);
      console.log(`   IMEI: ${data.imei}`);
      console.log(`   نبض: ${data.heartRate} bpm`);
      console.log(`   ضغط: ${data.systolic}/${data.diastolic} mmHg`);

      const saved = await db.saveHealthData({
        imei: data.imei,
        heartRate: data.heartRate,
        systolic: data.systolic,
        diastolic: data.diastolic,
      });
      
      if (saved) {
        console.log(`✅ تم حفظ الضغط والنبض بنجاح`);
      } else {
        console.log(`❌ فشل حفظ الضغط والنبض`);
      }
      
      const response = ProtocolBuilder.buildHeartRateBPResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة النبض والضغط:', err.message);
      console.error('❌ خطأ في معالجة النبض والضغط:', err);
    }
  }

  /**
   * معالجة رسالة القياسات الكاملة
   */
  static async handleFullHealth(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n📊 استقبال قياسات كاملة:`);
      console.log(`   IMEI: ${data.imei}`);
      console.log(`   نبض: ${data.heartRate} bpm`);
      console.log(`   ضغط: ${data.systolic}/${data.diastolic} mmHg`);
      console.log(`   أكسجين: ${data.spo2}%`);
      console.log(`   سكر: ${data.bloodSugar}`);

      const saved = await db.saveHealthData({
        imei: data.imei,
        heartRate: data.heartRate,
        systolic: data.systolic,
        diastolic: data.diastolic,
        spo2: data.spo2,
        bloodSugar: data.bloodSugar,
      });
      
      if (saved) {
        console.log(`✅ تم حفظ القياسات الكاملة بنجاح`);
      } else {
        console.log(`❌ فشل حفظ القياسات الكاملة`);
      }
      
      const response = ProtocolBuilder.buildFullHealthResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة القياسات الكاملة:', err.message);
      console.error('❌ خطأ في معالجة القياسات الكاملة:', err);
    }
  }

  /**
   * معالجة رسالة الحرارة
   */
  static async handleTemperature(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n🌡️ استقبال حرارة الجسم:`);
      console.log(`   IMEI: ${data.imei}`);
      console.log(`   الحرارة: ${data.temperature}°C`);
      console.log(`   البطارية: ${data.batteryLevel}%`);

      const saved = await db.saveHealthData({
        imei: data.imei,
        temperature: data.temperature,
        batteryLevel: data.batteryLevel,
      });
      
      if (saved) {
        console.log(`✅ تم حفظ الحرارة بنجاح`);
      } else {
        console.log(`❌ فشل حفظ الحرارة`);
      }
      
      const response = ProtocolBuilder.buildTemperatureResponse();
      socket.write(response);
      
    } catch (err) {
      logger.error('خطأ في معالجة الحرارة:', err.message);
      console.error('❌ خطأ في معالجة الحرارة:', err);
    }
  }

  /**
   * معالجة رسالة أبراج متعددة
   */
  static async handleMultipleBases(data, socket) {
  try {
    data.imei = socket.imei;
    
    if (!data.imei) return;

    console.log(`📡 استقبال بيانات LBS من ${data.imei}`);
    console.log(`   (موقع تقريبي من أبراج الشبكة)`);
    
    // حفظ بيانات LBS كموقع تقريبي
    // TODO: يمكن تحويل LAC+CID إلى إحداثيات باستخدام OpenCellID API
    
    // إرسال الرد
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
        case 'LOCATION_REQUEST_ACK':
        case 'SOS_ACK':
        case 'HEART_RATE_TEST_ACK':
        case 'BLOOD_PRESSURE_TEST_ACK':
        case 'TEMPERATURE_TEST_ACK':
        case 'OXYGEN_TEST_ACK':
          // مجرد تأكيدات، لا حاجة لحفظها
          console.log(`✅ تأكيد استلام: ${parsedData.type}`);
          break;
        default:
          logger.warn(`نوع رسالة غير معالج: ${parsedData.type}`);
          console.log(`⚠️ نوع رسالة غير معالج: ${parsedData.type}`);
      }
    } catch (err) {
      logger.error('خطأ في توجيه الرسالة:', err.message);
      console.error('❌ خطأ في توجيه الرسالة:', err);
    }
  }
}

module.exports = MessageHandlers;
