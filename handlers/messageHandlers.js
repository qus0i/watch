const logger = require('../utils/logger');
const db = require('../database/db');
const ProtocolBuilder = require('../protocol/builder');
const config = require('../config');

/**
 * معالجات الرسائل
 * ⭐ نظام الدورات:
 *   - كل دورة (5 دقايق) بتخزن القياسات الصحية بسطر واحد
 *   - أول قياس = INSERT سطر جديد
 *   - باقي القياسات = UPDATE نفس السطر
 *   - نفس الشي للموقع
 */

class MessageHandlers {

  /**
   * معالجة رسالة تسجيل الدخول
   */
  static async handleLogin(data, socket) {
    try {
      console.log(`\n🔐 [LOGIN] تسجيل دخول من IMEI: ${data.imei}`);
      logger.info(`✅ تسجيل دخول ناجح: ${data.imei}`);
      
      // حفظ أو تحديث الجهاز في قاعدة البيانات
      await db.getOrCreateDevice(data.imei);
      
      // حفظ IMEI في الـ socket للاستخدام لاحقاً
      socket.imei = data.imei;
      
      // ⭐ تهيئة متغيرات تتبع الدورة
      socket.currentHealthCycleId = null;
      socket.currentLocationCycleId = null;
      
      // إرسال الرد
      const response = ProtocolBuilder.buildLoginResponse();
      socket.write(response);
      
      console.log(`📤 [LOGIN] رد: ${response}`);
      logger.debug(`📤 رد تسجيل الدخول: ${response}`);
      
      // تعطيل NOT_WEAR sensor فوراً
      setTimeout(() => {
        if (!socket.writable || socket.destroyed) return;
        const journalNo = ProtocolBuilder.generateJournalNo();
        const notWearCmd = `IWBP84,${data.imei},${journalNo},0#`;
        console.log(`👕 [LOGIN] تعطيل NOT_WEAR: ${notWearCmd}`);
        socket.write(notWearCmd);
      }, 2000);

      // ⭐ ضبط أرقام SOS تلقائياً بعد تسجيل الدخول
      setTimeout(() => {
        if (!socket.writable || socket.destroyed) return;
        const journalNo = ProtocolBuilder.generateJournalNo();
        const sosNumber = '+962787840105';
        const sosCmd = `IWBP12,${data.imei},${journalNo},${sosNumber},${sosNumber},${sosNumber}#`;
        console.log(`🆘 [LOGIN] ضبط أرقام SOS: ${sosCmd}`);
        socket.write(sosCmd);
      }, 5000);

      // بدء القياسات الدورية بعد تسجيل الدخول (بعد 10 ثوان)
      setTimeout(() => {
        this.startPeriodicMeasurements(socket);
      }, 10000);
      
    } catch (err) {
      console.error(`❌ [LOGIN] خطأ:`, err.message);
      logger.error('خطأ في معالجة تسجيل الدخول:', err.message);
    }
  }

  /**
   * ⭐ معالجة رسالة الموقع - مع تتبع الدورة
   */
  static async handleLocation(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) {
        console.warn('⚠️ [LOCATION] رسالة موقع بدون IMEI');
        logger.warn('رسالة موقع بدون IMEI محدد');
        return;
      }

      console.log(`\n📍 [LOCATION] موقع GPS من ${data.imei}`);
      console.log(`   GPS Valid: ${data.gpsValid}`);
      console.log(`   Lat: ${data.latitude}, Lng: ${data.longitude}`);
      console.log(`   Battery: ${data.batteryLevel}%`);

      // ⭐ استخدام نظام الدورة
      if (!socket.currentLocationCycleId) {
        // أول موقع بالدورة → INSERT جديد
        const locationId = await db.saveLocationReturningId(data);
        if (locationId) {
          socket.currentLocationCycleId = locationId;
          console.log(`📍 [LOCATION] دورة موقع جديدة - ID: ${locationId}`);
        }
      } else {
        // تحديث الموقع الموجود بالدورة الحالية
        console.log(`📍 [LOCATION] تحديث دورة موقع #${socket.currentLocationCycleId}`);
        await db.updateLocationById(socket.currentLocationCycleId, data.latitude, data.longitude);
      }
      
      // إرسال الرد
      const response = ProtocolBuilder.buildLocationResponse();
      socket.write(response);
      
    } catch (err) {
      console.error(`❌ [LOCATION] خطأ:`, err.message);
      logger.error('خطأ في معالجة الموقع:', err.message);
    }
  }

  /**
   * ⭐ معالجة رسالة LBS (أبراج الشبكة) - مع تتبع الدورة
   */
  static async handleMultipleBases(data, socket) {
    try {
      console.log(`\n📡 [LBS] رسالة أبراج متعددة`);
      
      // استخراج البيانات من الرسالة
      const message = data.rawMessage;
      const afterCommand = message.substring(6, message.length - 1);
      const parts = afterCommand.split(',');
      
      console.log(`🔍 تحليل رسالة LBS:`);
      console.log(`   📨 الرسالة: ${message}`);
      console.log(`   🔢 عدد الأجزاء: ${parts.length}`);
      
      if (parts.length < 7) {
        console.warn(`⚠️ [LBS] رسالة قصيرة - عدد الأجزاء: ${parts.length}`);
        const response = ProtocolBuilder.buildMultipleBasesResponse();
        socket.write(response);
        return;
      }

      // استخراج بيانات LBS
      const mcc = parseInt(parts[4]);
      const mnc = parseInt(parts[5]);
      const baseInfo = parts[6].split('|');
      const lac = parseInt(baseInfo[0]);
      const cellId = parseInt(baseInfo[1]);
      const signal = parseInt(baseInfo[2]);
      
      console.log(`   🌍 MCC: ${mcc} (${mcc === 416 ? 'الأردن' : 'غير معروف'})`);
      console.log(`   📱 MNC: ${mnc} (${mnc === 3 ? 'أمنية' : mnc === 77 ? 'زين' : mnc === 1 ? 'أورانج' : 'غير معروف'})`);
      console.log(`   📍 LAC: ${lac}`);
      console.log(`   🗼 Cell ID: ${cellId}`);
      console.log(`   📶 Signal: ${signal} dBm`);

      // استخراج WiFi إذا موجود
      let wifiData = [];
      if (parts.length > 7) {
        const wifiCount = parseInt(parts[7]);
        console.log(`   📶 عدد شبكات WiFi: ${wifiCount}`);
        
        if (wifiCount > 0 && parts.length > 8) {
          const wifiStr = parts[8];
          console.log(`   📶 WiFi: ${wifiStr}`);
          
          const networks = wifiStr.split('&');
          wifiData = networks.map(network => {
            const netParts = network.split('|');
            return {
              ssid: netParts[0],
              mac: netParts[1],
              signal: parseInt(netParts[2])
            };
          });
        }
      }

      // ⭐ تحويل LBS إلى إحداثيات عبر APIs
      let latitude = 0;
      let longitude = 0;

      try {
        const LocationService = require('../services/locationService');
        const resolved = await LocationService.resolveLocation(mcc, mnc, lac, cellId, wifiData);
        if (resolved) {
          latitude = resolved.latitude;
          longitude = resolved.longitude;
          console.log(`   ✅ تم تحويل LBS → إحداثيات: ${latitude}, ${longitude}`);
        } else {
          console.log(`   ⚠️ فشل تحويل LBS إلى إحداثيات - حفظ بدون إحداثيات`);
        }
      } catch (locErr) {
        console.error(`   ❌ خطأ في خدمة الموقع: ${locErr.message}`);
      }

      // ⭐ استخدام نظام الدورة
      const locationData = {
        imei: socket.imei,
        timestamp: new Date(),
        latitude: latitude,
        longitude: longitude,
        speed: 0,
        direction: 0,
        gpsValid: false,
        satelliteCount: 0,
        gsmSignal: signal,
        batteryLevel: 0,
        mcc: mcc,
        mnc: mnc,
        lac: lac,
        cellId: cellId,
        wifiData: wifiData,
        fortificationState: 0,
        workingMode: 0
      };

      if (!socket.currentLocationCycleId) {
        // أول موقع بالدورة → INSERT جديد
        const locationId = await db.saveLocationReturningId(locationData);
        if (locationId) {
          socket.currentLocationCycleId = locationId;
          console.log(`📡 [LBS] دورة موقع جديدة - ID: ${locationId}`);
        }
      } else {
        // تحديث الموقع الموجود
        console.log(`📡 [LBS] تحديث دورة موقع #${socket.currentLocationCycleId}`);
        await db.updateLocationById(socket.currentLocationCycleId, latitude, longitude);
      }

      // إرسال الرد
      const response = ProtocolBuilder.buildMultipleBasesResponse();
      socket.write(response);
      
    } catch (err) {
      console.error(`❌ [LBS] خطأ في معالجة:`, err.message);
      console.error(`   Stack:`, err.stack);
      logger.error('خطأ في معالجة أبراج متعددة:', err.message);
    }
  }

  /**
   * معالجة رسالة Heartbeat
   */
  static async handleHeartbeat(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n💓 [HEARTBEAT] من ${data.imei}`);
      console.log(`   Battery: ${data.batteryLevel}%`);
      console.log(`   Steps: ${data.stepCount}`);

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
      console.error(`❌ [HEARTBEAT] خطأ:`, err.message);
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

      console.log(`\n🚨 [ALARM] إنذار من ${data.imei}`);
      console.log(`   النوع: ${data.alertType}`);
      console.log(`   الموقع: ${data.latitude}, ${data.longitude}`);

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
      
      logger.warn(`🚨 إنذار ${data.alertType} من ${data.imei}`);
      
      // إرسال الرد
      const response = ProtocolBuilder.buildAlarmResponse();
      socket.write(response);
      
    } catch (err) {
      console.error(`❌ [ALARM] خطأ:`, err.message);
      logger.error('خطأ في معالجة الإنذار:', err.message);
    }
  }

  /**
   * ⭐ معالجة رسالة قياس النبض - مع تتبع الدورة
   */
  static async handleHeartRate(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n❤️ [HEART_RATE] من ${data.imei}`);
      console.log(`   النبض: ${data.heartRate} bpm`);
      console.log(`   🔄 Cycle ID: ${socket.currentHealthCycleId || 'جديد'}`);

      // تحقق من القيمة
      if (data.heartRate && data.heartRate > 0 && data.heartRate < 200) {
        const cycleId = await db.upsertHealthData({
          imei: data.imei,
          timestamp: new Date(),
          heartRate: data.heartRate,
        }, socket.currentHealthCycleId);

        socket.currentHealthCycleId = cycleId;
        console.log(`✅ تم حفظ قياس النبض: ${data.heartRate} bpm → سطر #${cycleId}`);
      } else {
        console.warn(`⚠️ قياس نبض غير صحيح: ${data.heartRate}`);
      }
      
      const response = ProtocolBuilder.buildHeartRateResponse();
      socket.write(response);
      
    } catch (err) {
      console.error(`❌ [HEART_RATE] خطأ:`, err.message);
      logger.error('خطأ في معالجة النبض:', err.message);
    }
  }

  /**
   * ⭐ معالجة رسالة النبض وضغط الدم - مع تتبع الدورة
   */
  static async handleHeartRateBP(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n💉 [HEART_RATE_BP] من ${data.imei}`);
      console.log(`   النبض: ${data.heartRate} bpm`);
      console.log(`   الضغط: ${data.systolic}/${data.diastolic} mmHg`);
      console.log(`   🔄 Cycle ID: ${socket.currentHealthCycleId || 'جديد'}`);

      // تحقق من القيم
      const validHR = data.heartRate && data.heartRate > 0 && data.heartRate < 200;
      const validBP = data.systolic && data.systolic > 0 && data.systolic < 250;

      if (validHR || validBP) {
        const healthData = {
          imei: data.imei,
          timestamp: new Date(),
        };
        if (validHR) healthData.heartRate = data.heartRate;
        if (validBP) {
          healthData.systolic = data.systolic;
          healthData.diastolic = data.diastolic;
        }

        const cycleId = await db.upsertHealthData(healthData, socket.currentHealthCycleId);
        socket.currentHealthCycleId = cycleId;
        console.log(`✅ تم حفظ قياس النبض والضغط → سطر #${cycleId}`);
      } else {
        console.warn(`⚠️ قياسات غير صحيحة - تم تجاهلها`);
      }
      
      const response = ProtocolBuilder.buildHeartRateBPResponse();
      socket.write(response);
      
    } catch (err) {
      console.error(`❌ [HEART_RATE_BP] خطأ:`, err.message);
      logger.error('خطأ في معالجة النبض والضغط:', err.message);
    }
  }

  /**
   * ⭐ معالجة رسالة القياسات الكاملة - مع تتبع الدورة
   */
  static async handleFullHealth(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n📊 [FULL_HEALTH] من ${data.imei}`);
      console.log(`   النبض: ${data.heartRate} bpm`);
      console.log(`   الضغط: ${data.systolic}/${data.diastolic} mmHg`);
      console.log(`   الأكسجين: ${data.spo2}%`);
      console.log(`   السكر: ${data.bloodSugar} mg/dL`);
      console.log(`   🔄 Cycle ID: ${socket.currentHealthCycleId || 'جديد'}`);

      // تحقق من القيم وحفظ فقط الصحيحة
      const healthData = {
        imei: data.imei,
        timestamp: new Date(),
      };

      if (data.heartRate && data.heartRate > 0 && data.heartRate < 200) {
        healthData.heartRate = data.heartRate;
      }
      if (data.systolic && data.systolic > 0 && data.systolic < 250) {
        healthData.systolic = data.systolic;
        healthData.diastolic = data.diastolic;
      }
      if (data.spo2 && data.spo2 > 0 && data.spo2 <= 100) {
        healthData.spo2 = data.spo2;
      }
      if (data.bloodSugar && data.bloodSugar > 0 && data.bloodSugar < 500) {
        healthData.bloodSugar = data.bloodSugar;
      }

      // احفظ فقط إذا في قيمة واحدة على الأقل صحيحة
      if (Object.keys(healthData).length > 2) { // imei + timestamp + at least 1 value
        const cycleId = await db.upsertHealthData(healthData, socket.currentHealthCycleId);
        socket.currentHealthCycleId = cycleId;
        console.log(`✅ تم حفظ القياسات الكاملة → سطر #${cycleId}`);
      } else {
        console.warn(`⚠️ كل القياسات غير صحيحة - تم تجاهلها`);
      }
      
      const response = ProtocolBuilder.buildFullHealthResponse();
      socket.write(response);
      
    } catch (err) {
      console.error(`❌ [FULL_HEALTH] خطأ:`, err.message);
      logger.error('خطأ في معالجة القياسات الكاملة:', err.message);
    }
  }

  /**
   * ⭐ معالجة رسالة الحرارة - مع تتبع الدورة
   */
  static async handleTemperature(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n🌡️ [TEMPERATURE] من ${data.imei}`);
      console.log(`   الحرارة: ${data.temperature}°C`);
      console.log(`   البطارية: ${data.batteryLevel}%`);
      console.log(`   🔄 Cycle ID: ${socket.currentHealthCycleId || 'جديد'}`);

      // تحقق من القيمة
      if (data.temperature && data.temperature > 30 && data.temperature < 45) {
        const cycleId = await db.upsertHealthData({
          imei: data.imei,
          timestamp: new Date(),
          temperature: data.temperature,
          batteryLevel: data.batteryLevel,
        }, socket.currentHealthCycleId);

        socket.currentHealthCycleId = cycleId;
        console.log(`✅ تم حفظ قياس الحرارة: ${data.temperature}°C → سطر #${cycleId}`);
      } else {
        console.warn(`⚠️ قياس حرارة غير صحيح: ${data.temperature}°C`);
      }
      
      const response = ProtocolBuilder.buildTemperatureResponse();
      socket.write(response);
      
    } catch (err) {
      console.error(`❌ [TEMPERATURE] خطأ:`, err.message);
      logger.error('خطأ في معالجة الحرارة:', err.message);
    }
  }

  /**
   * ⭐ بدء القياسات الدورية - مع نظام الدورات
   * الساعة تحتاج 30-60 ثانية لكل قياس طبي
   * ⚠️ ما نرسل أمر جديد والساعة لسا بتقيس!
   */
  static startPeriodicMeasurements(socket) {
    if (!socket.imei) {
      console.warn(`⚠️ [PERIODIC] لا يمكن بدء القياسات - IMEI غير موجود`);
      return;
    }

    const delaySeconds = config.healthMonitoring.delayBetweenCommands || 60;
    const intervalMinutes = config.healthMonitoring.intervalMinutes || 5;
    
    console.log(`\n🔄 [PERIODIC] بدء القياسات الدورية للجهاز ${socket.imei}`);
    console.log(`   ⏱️ التأخير بين القياسات: ${delaySeconds} ثانية`);
    console.log(`   🔁 الفاصل بين الدورات: ${intervalMinutes} دقائق`);

    /**
     * ⭐ تنفيذ دورة قياسات كاملة بشكل متسلسل
     * كل قياس ينتظر delaySeconds قبل القياس التالي
     * ⚠️ الترتيب مهم: موقع → نبض → ضغط → حرارة → أكسجين
     */
    const measurementCycle = async () => {
      if (!socket.writable || socket.destroyed) {
        console.log(`⚠️ [PERIODIC] الاتصال مقطوع - إيقاف القياسات`);
        if (socket.measurementInterval) {
          clearInterval(socket.measurementInterval);
        }
        return;
      }

      console.log(`\n🔄 [PERIODIC] ═══════════════════════════════════════════════════`);
      console.log(`🔄 [PERIODIC] ═══ دورة قياسات جديدة للجهاز ${socket.imei} ═══`);
      console.log(`🔄 [PERIODIC] ═══════════════════════════════════════════════════`);
      console.log(`   ⏰ الوقت: ${new Date().toISOString()}`);

      // ⭐⭐⭐ إعادة تعيين IDs الدورة = سطر جديد لكل دورة ⭐⭐⭐
      socket.currentHealthCycleId = null;
      socket.currentLocationCycleId = null;
      console.log(`   🆕 تم إعادة تعيين IDs الدورة (سطر جديد للصحة والموقع)`);

      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const delayMs = delaySeconds * 1000;

      try {
        // ═══ 1. طلب موقع أولاً ═══
        if (socket.writable && !socket.destroyed) {
          const journalNo = ProtocolBuilder.generateJournalNo();
          const locationCmd = ProtocolBuilder.buildLocationRequest(socket.imei, journalNo);
          console.log(`\n📍 [PERIODIC] (1/5) طلب موقع: ${locationCmd}`);
          socket.write(locationCmd);
        }

        // ⏳ انتظار حتى الساعة ترد بالموقع
        await delay(delayMs);

        // ═══ 2. قياس النبض ═══
        if (socket.writable && !socket.destroyed) {
          const journalNo = ProtocolBuilder.generateJournalNo();
          const hrCmd = ProtocolBuilder.buildHeartRateTestCommand(socket.imei, journalNo);
          console.log(`\n❤️ [PERIODIC] (2/5) طلب نبض: ${hrCmd}`);
          console.log(`   📋 الدورة الصحية الحالية: ${socket.currentHealthCycleId || 'سيتم إنشاء سطر جديد'}`);
          socket.write(hrCmd);
        }

        // ⏳ انتظار حتى الساعة تكمل قياس النبض
        await delay(delayMs);

        // ═══ 3. قياس الضغط ═══
        if (socket.writable && !socket.destroyed) {
          const journalNo = ProtocolBuilder.generateJournalNo();
          const bpCmd = ProtocolBuilder.buildBloodPressureTestCommand(socket.imei, journalNo);
          console.log(`\n💉 [PERIODIC] (3/5) طلب ضغط: ${bpCmd}`);
          console.log(`   📋 الدورة الصحية الحالية: #${socket.currentHealthCycleId || '?'}`);
          socket.write(bpCmd);
        }

        // ⏳ انتظار حتى الساعة تكمل قياس الضغط
        await delay(delayMs);

        // ═══ 4. قياس الحرارة ═══
        if (socket.writable && !socket.destroyed) {
          const journalNo = ProtocolBuilder.generateJournalNo();
          const tempCmd = ProtocolBuilder.buildTemperatureTestCommand(socket.imei, journalNo);
          console.log(`\n🌡️ [PERIODIC] (4/5) طلب حرارة: ${tempCmd}`);
          console.log(`   📋 الدورة الصحية الحالية: #${socket.currentHealthCycleId || '?'}`);
          socket.write(tempCmd);
        }

        // ⏳ انتظار حتى الساعة تكمل قياس الحرارة
        await delay(delayMs);

        // ═══ 5. قياس الأكسجين ═══
        if (socket.writable && !socket.destroyed) {
          const journalNo = ProtocolBuilder.generateJournalNo();
          const spo2Cmd = ProtocolBuilder.buildOxygenTestCommand(socket.imei, journalNo);
          console.log(`\n🫁 [PERIODIC] (5/5) طلب أكسجين: ${spo2Cmd}`);
          console.log(`   📋 الدورة الصحية الحالية: #${socket.currentHealthCycleId || '?'}`);
          socket.write(spo2Cmd);
        }

        console.log(`\n✅ [PERIODIC] ═══════════════════════════════════════════════════`);
        console.log(`✅ [PERIODIC] ═══ انتهت دورة القياسات للجهاز ${socket.imei} ═══`);
        console.log(`✅ [PERIODIC]    📋 سطر الصحة: #${socket.currentHealthCycleId || 'لم يتم'}`);
        console.log(`✅ [PERIODIC]    📍 سطر الموقع: #${socket.currentLocationCycleId || 'لم يتم'}`);
        console.log(`✅ [PERIODIC] ═══════════════════════════════════════════════════\n`);

      } catch (err) {
        console.error(`❌ [PERIODIC] خطأ في دورة القياسات: ${err.message}`);
      }
    };

    // أول دورة بعد 5 ثوان
    setTimeout(measurementCycle, 5000);

    // دورات متكررة
    const intervalId = setInterval(measurementCycle, intervalMinutes * 60 * 1000);

    // حفظ الـ interval للإلغاء لاحقاً
    socket.measurementInterval = intervalId;

    // إلغاء عند قطع الاتصال
    socket.on('close', () => {
      if (socket.measurementInterval) {
        console.log(`🛑 [PERIODIC] إيقاف القياسات للجهاز ${socket.imei}`);
        clearInterval(socket.measurementInterval);
      }
    });
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
        
        // ⭐ رسائل التأكيد (ACK) - مجرد logging
        case 'LOCATION_REQUEST_ACK':
          console.log(`✅ [ACK] الساعة استلمت طلب الموقع`);
          break;
        case 'HEART_RATE_TEST_ACK':
          console.log(`✅ [ACK] الساعة بدأت قياس النبض`);
          break;
        case 'BLOOD_PRESSURE_TEST_ACK':
          console.log(`✅ [ACK] الساعة بدأت قياس الضغط`);
          break;
        case 'TEMPERATURE_TEST_ACK':
          console.log(`✅ [ACK] الساعة بدأت قياس الحرارة`);
          break;
        case 'OXYGEN_TEST_ACK':
          console.log(`✅ [ACK] الساعة بدأت قياس الأكسجين`);
          break;
        case 'SOS_ACK':
          console.log(`✅ [ACK] الساعة استلمت أمر SOS`);
          break;
        case 'NOT_WEAR_ACK':
          console.log(`✅ [ACK] الساعة استلمت أمر NOT_WEAR`);
          break;
        case 'UNKNOWN':
          console.warn(`⚠️ رسالة غير معروفة: ${parsedData.commandType}`);
          break;
        
        default:
          console.warn(`⚠️ نوع رسالة غير معالج: ${parsedData.type}`);
          logger.warn(`نوع رسالة غير معالج: ${parsedData.type}`);
      }
    } catch (err) {
      console.error(`❌ خطأ في توجيه الرسالة:`, err.message);
      logger.error('خطأ في توجيه الرسالة:', err.message);
    }
  }
}

module.exports = MessageHandlers;
