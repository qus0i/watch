const logger = require('../utils/logger');
const db = require('../database/db');
const ProtocolBuilder = require('../protocol/builder');
const config = require('../config');

/**
 * معالجات الرسائل
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
   * معالجة رسالة الموقع
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

      // حفظ في قاعدة البيانات
      await db.saveLocation(data);
      
      // إرسال الرد
      const response = ProtocolBuilder.buildLocationResponse();
      socket.write(response);
      
    } catch (err) {
      console.error(`❌ [LOCATION] خطأ:`, err.message);
      logger.error('خطأ في معالجة الموقع:', err.message);
    }
  }

  /**
   * معالجة رسالة LBS (أبراج الشبكة) مع تحويل الإحداثيات عبر OpenCellID
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

      // ⭐ تحويل LBS إلى إحداثيات عبر OpenCellID
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

      // حفظ الموقع
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

      const saved = await db.saveLocation(locationData);
      
      if (saved) {
        console.log(`✅ تم حفظ موقع LBS بنجاح (lat: ${latitude}, lng: ${longitude})`);
      } else {
        console.error(`❌ فشل حفظ موقع LBS`);
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
   * معالجة رسالة قياس النبض
   */
  static async handleHeartRate(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n❤️ [HEART_RATE] من ${data.imei}`);
      console.log(`   النبض: ${data.heartRate} bpm`);

      // تحقق من القيمة
      if (data.heartRate && data.heartRate > 0 && data.heartRate < 200) {
        // ⭐ إذا في دورة نشطة — حدّث نفس السطر
        if (socket.currentHealthRowId) {
          await db.updateHealthCycleRow(socket.currentHealthRowId, {
            heartRate: data.heartRate,
          });
          console.log(`✅ تم تحديث النبض في السطر ${socket.currentHealthRowId}: ${data.heartRate} bpm`);
        } else {
          // خارج الدورة — أنشئ سطر جديد
          await db.saveHealthData({
            imei: data.imei,
            timestamp: new Date(),
            heartRate: data.heartRate,
          });
          console.log(`✅ تم حفظ قياس النبض (خارج الدورة): ${data.heartRate} bpm`);
        }
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
   * معالجة رسالة النبض وضغط الدم
   */
  static async handleHeartRateBP(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n💉 [HEART_RATE_BP] من ${data.imei}`);
      console.log(`   النبض: ${data.heartRate} bpm`);
      console.log(`   الضغط: ${data.systolic}/${data.diastolic} mmHg`);

      // تحقق من القيم
      const validHR = data.heartRate && data.heartRate > 0 && data.heartRate < 200;
      const validBP = data.systolic && data.systolic > 0 && data.systolic < 250;

      if (validHR || validBP) {
        const updateData = {};
        if (validHR) updateData.heartRate = data.heartRate;
        if (validBP) {
          updateData.systolic = data.systolic;
          updateData.diastolic = data.diastolic;
        }

        // ⭐ إذا في دورة نشطة — حدّث نفس السطر
        if (socket.currentHealthRowId) {
          await db.updateHealthCycleRow(socket.currentHealthRowId, updateData);
          console.log(`✅ تم تحديث النبض والضغط في السطر ${socket.currentHealthRowId}`);
        } else {
          await db.saveHealthData({
            imei: data.imei,
            timestamp: new Date(),
            ...updateData,
          });
          console.log(`✅ تم حفظ قياس النبض والضغط (خارج الدورة)`);
        }
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
   * معالجة رسالة القياسات الكاملة
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
        await db.saveHealthData(healthData);
        console.log(`✅ تم حفظ القياسات الكاملة`);
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
   * معالجة رسالة الحرارة
   */
  static async handleTemperature(data, socket) {
    try {
      data.imei = socket.imei;
      
      if (!data.imei) return;

      console.log(`\n🌡️ [TEMPERATURE] من ${data.imei}`);
      console.log(`   الحرارة: ${data.temperature}°C`);
      console.log(`   البطارية: ${data.batteryLevel}%`);

      // تحقق من القيمة
      if (data.temperature && data.temperature > 30 && data.temperature < 45) {
        // ⭐ إذا في دورة نشطة — حدّث نفس السطر
        if (socket.currentHealthRowId) {
          await db.updateHealthCycleRow(socket.currentHealthRowId, {
            temperature: data.temperature,
            batteryLevel: data.batteryLevel,
          });
          console.log(`✅ تم تحديث الحرارة في السطر ${socket.currentHealthRowId}: ${data.temperature}°C`);
        } else {
          await db.saveHealthData({
            imei: data.imei,
            timestamp: new Date(),
            temperature: data.temperature,
            batteryLevel: data.batteryLevel,
          });
          console.log(`✅ تم حفظ قياس الحرارة (خارج الدورة): ${data.temperature}°C`);
        }
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
   * ⭐ بدء القياسات الدورية - مُصلح: سطر واحد لكل دورة + تحديث last_health_check
   * كل دورة: إنشاء سطر → تحديثه مع كل قياس → تحديث last_health_check عند الانتهاء
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
     * تنفيذ دورة قياسات كاملة:
     * 1. إنشاء سطر جديد في health_data
     * 2. إرسال أوامر القياس (كل قياس يحدّث نفس السطر)
     * 3. عند الانتهاء — تحديث last_health_check
     */
    const measurementCycle = async () => {
      if (!socket.writable || socket.destroyed) {
        console.log(`⚠️ [PERIODIC] الاتصال مقطوع - إيقاف القياسات`);
        if (socket.measurementInterval) {
          clearInterval(socket.measurementInterval);
        }
        return;
      }

      console.log(`\n🔄 [PERIODIC] ═══ دورة قياسات جديدة للجهاز ${socket.imei} ═══`);
      console.log(`   ⏰ الوقت: ${new Date().toISOString()}`);

      const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      const delayMs = delaySeconds * 1000;

      try {
        // ⭐ إنشاء سطر صحي جديد لهذه الدورة
        const healthRowId = await db.createHealthCycleRow(socket.imei);
        if (healthRowId) {
          socket.currentHealthRowId = healthRowId;
          console.log(`📋 [PERIODIC] سطر صحي جديد ID: ${healthRowId}`);
        }

        // 1. طلب موقع أولاً
        if (socket.writable && !socket.destroyed) {
          const journalNo = ProtocolBuilder.generateJournalNo();
          const locationCmd = ProtocolBuilder.buildLocationRequest(socket.imei, journalNo);
          console.log(`📍 [PERIODIC] (1/5) طلب موقع: ${locationCmd}`);
          socket.write(locationCmd);
        }

        await delay(delayMs);

        // 2. قياس النبض
        if (socket.writable && !socket.destroyed) {
          const journalNo = ProtocolBuilder.generateJournalNo();
          const hrCmd = ProtocolBuilder.buildHeartRateTestCommand(socket.imei, journalNo);
          console.log(`❤️ [PERIODIC] (2/5) طلب نبض: ${hrCmd}`);
          socket.write(hrCmd);
        }

        await delay(delayMs);

        // 3. قياس الضغط
        if (socket.writable && !socket.destroyed) {
          const journalNo = ProtocolBuilder.generateJournalNo();
          const bpCmd = ProtocolBuilder.buildBloodPressureTestCommand(socket.imei, journalNo);
          console.log(`💉 [PERIODIC] (3/5) طلب ضغط: ${bpCmd}`);
          socket.write(bpCmd);
        }

        await delay(delayMs);

        // 4. قياس الحرارة
        if (socket.writable && !socket.destroyed) {
          const journalNo = ProtocolBuilder.generateJournalNo();
          const tempCmd = ProtocolBuilder.buildTemperatureTestCommand(socket.imei, journalNo);
          console.log(`🌡️ [PERIODIC] (4/5) طلب حرارة: ${tempCmd}`);
          socket.write(tempCmd);
        }

        await delay(delayMs);

        // 5. قياس الأكسجين
        if (socket.writable && !socket.destroyed) {
          const journalNo = ProtocolBuilder.generateJournalNo();
          const spo2Cmd = ProtocolBuilder.buildOxygenTestCommand(socket.imei, journalNo);
          console.log(`🫁 [PERIODIC] (5/5) طلب أكسجين: ${spo2Cmd}`);
          socket.write(spo2Cmd);
        }

        // ⭐ انتظار إضافي للأكسجين ثم تحديث last_health_check
        await delay(delayMs);

        if (healthRowId) {
          await db.finalizeHealthCycle(socket.imei, healthRowId);
          console.log(`✅ [PERIODIC] تم تحديث last_health_check من السطر ${healthRowId}`);
        }

        // مسح الـ currentHealthRowId لأن الدورة انتهت
        socket.currentHealthRowId = null;

        console.log(`✅ [PERIODIC] ═══ انتهت دورة القياسات للجهاز ${socket.imei} ═══\n`);

      } catch (err) {
        console.error(`❌ [PERIODIC] خطأ في دورة القياسات: ${err.message}`);
        socket.currentHealthRowId = null;
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
