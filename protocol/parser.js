const logger = require('../utils/logger');

/**
 * محلل بروتوكول ساعة GPS
 * يفك تشفير جميع أنواع الرسائل القادمة من الساعة
 */

class ProtocolParser {
  
  /**
   * تحليل الرسالة الواردة
   * @param {string} message - الرسالة الكاملة
   * @returns {object|null} - البيانات المستخرجة
   */
  static parse(message) {
    try {
      message = message.trim();
      
      // Debug: طباعة الرسالة الكاملة
      console.log('\n🔍 محاولة تحليل رسالة:');
      console.log(`   الطول: ${message.length}`);
      console.log(`   المحتوى: ${message}`);
      
      // التحقق من البنية الأساسية
      if (!message.startsWith('IW') || !message.endsWith('#')) {
        logger.warn('رسالة غير صحيحة (لا تبدأ بـ IW أو لا تنتهي بـ #)');
        console.log('❌ رسالة غير صحيحة - البنية خاطئة');
        return null;
      }

      // استخراج نوع الأمر
      const commandType = message.substring(2, 6);
      console.log(`   نوع الأمر: ${commandType}`);
      
      // اختيار المحلل المناسب حسب نوع الأمر
      switch (commandType) {
        case 'AP00':
          return this.parseLoginPacket(message);
        case 'AP01':
          return this.parseLocationPacket(message);
        case 'AP02':
          return this.parseMultipleBasesPacket(message);
        case 'AP03':
          return this.parseHeartbeatPacket(message);
        case 'AP10':
          return this.parseAlarmPacket(message);
        case 'AP16':
          return this.parseLocationRequestAck(message);
        case 'AP12':
          return this.parseSOSAck(message);
        case 'AP49':
          return this.parseHeartRatePacket(message);
        case 'APHT':
          return this.parseHeartRateBPPacket(message);
        case 'APHP':
          return this.parseFullHealthPacket(message);
        case 'AP50':
          return this.parseTemperaturePacket(message);
        case 'APXL':
          return this.parseHeartRateAck(message);
        case 'APXY':
          return this.parseBloodPressureAck(message);
        case 'APXT':
          return this.parseTemperatureAck(message);
        case 'APXZ':
          return this.parseOxygenAck(message);
        default:
          logger.warn(`نوع أمر غير معروف: ${commandType}`);
          console.log(`⚠️ نوع أمر غير معروف: ${commandType}`);
          return { type: 'UNKNOWN', commandType, rawMessage: message };
      }

    } catch (err) {
      logger.error('خطأ في تحليل الرسالة:', err.message);
      console.error('❌ خطأ في تحليل الرسالة:', err);
      return null;
    }
  }

  /**
   * تحليل رسالة تسجيل الدخول (AP00)
   * مثال: IWAP00353456789012345#
   */
  static parseLoginPacket(message) {
    const imei = message.substring(6, 21);
    
    logger.info(`📱 رسالة تسجيل دخول من IMEI: ${imei}`);
    console.log(`📱 تسجيل دخول - IMEI: ${imei}`);
    
    return {
      type: 'LOGIN',
      imei,
      timestamp: new Date(),
    };
  }

  /**
   * تحليل رسالة الموقع (AP01)
   * مثال: IWAP01080524A2232.9806N11404.9355E000.1061830323.8706000908000102,460,0,9520,3671,Home|74-DE-2B-44-88-8C|97#
   */
  static parseLocationPacket(message) {
    try {
      console.log('📍 تحليل رسالة موقع GPS...');
      
      // إزالة البادئة والنهاية
      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');

      console.log(`   عدد الأجزاء: ${parts.length}`);
      console.log(`   الجزء الأول (GPS): ${parts[0]}`);

      // استخراج التاريخ والوقت والموقع
      const dateTimeGps = parts[0];
      const date = dateTimeGps.substring(0, 6); // DDMMYY
      const gpsValid = dateTimeGps.charAt(6) === 'A';
      
      console.log(`   GPS صحيح: ${gpsValid}`);
      
      // استخراج الإحداثيات
      const latitudeStr = dateTimeGps.substring(7, 17);
      const latitudeDir = dateTimeGps.charAt(17);
      const longitudeStr = dateTimeGps.substring(18, 29);
      const longitudeDir = dateTimeGps.charAt(29);
      const speed = parseFloat(dateTimeGps.substring(30, 35));
      const time = dateTimeGps.substring(35, 41); // HHMMSS
      const direction = parseFloat(dateTimeGps.substring(41, 47));
      
      console.log(`   خط العرض: ${latitudeStr}${latitudeDir}`);
      console.log(`   خط الطول: ${longitudeStr}${longitudeDir}`);
      
      // تحويل الإحداثيات
      const latitude = this.convertCoordinate(latitudeStr, latitudeDir);
      const longitude = this.convertCoordinate(longitudeStr, longitudeDir);

      console.log(`   الإحداثيات المحولة: ${latitude}, ${longitude}`);

      // استخراج معلومات الحالة
      const statusInfo = dateTimeGps.substring(47);
      const gsmSignal = parseInt(statusInfo.substring(0, 3));
      const satelliteCount = parseInt(statusInfo.substring(3, 6));
      const batteryLevel = parseInt(statusInfo.substring(6, 9));
      const fortificationState = parseInt(statusInfo.substring(10, 12));
      const workingMode = parseInt(statusInfo.substring(12, 14));

      console.log(`   البطارية: ${batteryLevel}%`);
      console.log(`   الأقمار الصناعية: ${satelliteCount}`);

      // بيانات LBS
      const mcc = parseInt(parts[1]);
      const mnc = parseInt(parts[2]);
      const lac = parseInt(parts[3]);
      const cellId = parseInt(parts[4]);

      // بيانات WIFI (إذا وُجِدت)
      let wifiData = [];
      if (parts.length > 5) {
        const wifiStr = parts.slice(5).join(',');
        wifiData = this.parseWifiData(wifiStr);
      }

      // تركيب timestamp كامل
      const year = 2000 + parseInt(date.substring(4, 6));
      const month = parseInt(date.substring(2, 4));
      const day = parseInt(date.substring(0, 2));
      const hour = parseInt(time.substring(0, 2));
      const minute = parseInt(time.substring(2, 4));
      const second = parseInt(time.substring(4, 6));
      const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

      logger.info(`📍 موقع GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} | بطارية: ${batteryLevel}%`);
      console.log(`✅ تم تحليل الموقع بنجاح`);

      return {
        type: 'LOCATION',
        imei: null, // سيتم تحديده من السياق
        timestamp,
        latitude,
        longitude,
        speed,
        direction,
        gpsValid,
        satelliteCount,
        gsmSignal,
        batteryLevel,
        mcc,
        mnc,
        lac,
        cellId,
        wifiData,
        fortificationState,
        workingMode,
      };

    } catch (err) {
      logger.error('خطأ في تحليل رسالة الموقع:', err.message);
      console.error('❌ خطأ في تحليل رسالة الموقع:', err);
      return null;
    }
  }

  /**
   * تحليل رسالة نبض القلب (Heartbeat - AP03)
   * مثال: IWAP03,06000908000102,5555,30#
   */
  static parseHeartbeatPacket(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');

      const statusInfo = parts[0];
      const gsmSignal = parseInt(statusInfo.substring(0, 3));
      const satelliteCount = parseInt(statusInfo.substring(3, 6));
      const batteryLevel = parseInt(statusInfo.substring(6, 9));
      const fortificationState = parseInt(statusInfo.substring(10, 12));
      const workingMode = parseInt(statusInfo.substring(12, 14));

      const stepCount = parseInt(parts[1] || 0);
      const rollFrequency = parseInt(parts[2] || 0);

      logger.debug(`💓 نبضة قلب: بطارية ${batteryLevel}% | خطوات ${stepCount}`);
      console.log(`💓 Heartbeat - بطارية: ${batteryLevel}%`);

      return {
        type: 'HEARTBEAT',
        imei: null,
        timestamp: new Date(),
        gsmSignal,
        satelliteCount,
        batteryLevel,
        fortificationState,
        workingMode,
        stepCount,
        rollFrequency,
      };

    } catch (err) {
      logger.error('خطأ في تحليل رسالة Heartbeat:', err.message);
      return null;
    }
  }

  /**
   * تحليل رسالة الإنذار (AP10)
   * مثال: IWAP10...00,zh-cn,00,WIFI_DATA#
   */
  static parseAlarmPacket(message) {
    try {
      // مشابه لـ AP01 مع معلومات إنذار إضافية
      const locationData = this.parseLocationPacket('IWAP01' + message.substring(6));
      if (!locationData) return null;

      // استخراج نوع الإنذار
      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');
      
      // نوع الإنذار في الجزء الأخير قبل اللغة
      let alertType = 'UNKNOWN';
      for (let i = parts.length - 4; i < parts.length; i++) {
        if (parts[i] === '01') alertType = 'SOS';
        else if (parts[i] === '03') alertType = 'NOT_WEAR';
        else if (parts[i] === '05' || parts[i] === '06') alertType = 'FALL_DOWN';
      }

      logger.warn(`⚠️ إنذار: ${alertType}`);
      console.log(`🚨 إنذار - النوع: ${alertType}`);

      return {
        ...locationData,
        type: 'ALARM',
        alertType,
      };

    } catch (err) {
      logger.error('خطأ في تحليل رسالة الإنذار:', err.message);
      return null;
    }
  }

  /**
   * تحليل رسالة قياس النبض (AP49)
   * مثال: IWAP49,68#
   */
  static parseHeartRatePacket(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const heartRate = parseInt(data.split(',')[1] || data);

      logger.info(`❤️ نبض القلب: ${heartRate} bpm`);
      console.log(`❤️ نبض القلب: ${heartRate} bpm`);

      return {
        type: 'HEART_RATE',
        imei: null,
        timestamp: new Date(),
        heartRate,
      };

    } catch (err) {
      logger.error('خطأ في تحليل قياس النبض:', err.message);
      return null;
    }
  }

  /**
   * تحليل رسالة النبض وضغط الدم (APHT)
   * مثال: IWAPHT,60,130,85#
   */
  static parseHeartRateBPPacket(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');

      const heartRate = parseInt(parts[1]);
      const systolic = parseInt(parts[2]);
      const diastolic = parseInt(parts[3]);

      logger.info(`💉 نبض وضغط: ${heartRate} bpm | ${systolic}/${diastolic} mmHg`);
      console.log(`💉 نبض وضغط: ${heartRate} bpm | ${systolic}/${diastolic} mmHg`);

      return {
        type: 'HEART_RATE_BP',
        imei: null,
        timestamp: new Date(),
        heartRate,
        systolic,
        diastolic,
      };

    } catch (err) {
      logger.error('خطأ في تحليل النبض والضغط:', err.message);
      return null;
    }
  }

  /**
   * تحليل رسالة القياسات الكاملة (APHP)
   * مثال: IWAPHP,60,130,85,95,90,,,,,,,,#
   */
  static parseFullHealthPacket(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');

      const heartRate = parts[1] ? parseInt(parts[1]) : null;
      const systolic = parts[2] ? parseInt(parts[2]) : null;
      const diastolic = parts[3] ? parseInt(parts[3]) : null;
      const spo2 = parts[4] ? parseInt(parts[4]) : null;
      const bloodSugar = parts[5] ? parseInt(parts[5]) : null;

      logger.info(`📊 قياسات كاملة: نبض ${heartRate} | ضغط ${systolic}/${diastolic} | أكسجين ${spo2}%`);
      console.log(`📊 قياسات كاملة: نبض ${heartRate} | ضغط ${systolic}/${diastolic}`);

      return {
        type: 'FULL_HEALTH',
        imei: null,
        timestamp: new Date(),
        heartRate,
        systolic,
        diastolic,
        spo2,
        bloodSugar,
      };

    } catch (err) {
      logger.error('خطأ في تحليل القياسات الكاملة:', err.message);
      return null;
    }
  }

  /**
   * تحليل رسالة الحرارة (AP50)
   * مثال: IWAP50,36.7,90#
   */
  static parseTemperaturePacket(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');

      const temperature = parseFloat(parts[1]);
      const batteryLevel = parseInt(parts[2]);

      logger.info(`🌡️ حرارة الجسم: ${temperature}°C | بطارية: ${batteryLevel}%`);
      console.log(`🌡️ حرارة الجسم: ${temperature}°C`);

      return {
        type: 'TEMPERATURE',
        imei: null,
        timestamp: new Date(),
        temperature,
        batteryLevel,
      };

    } catch (err) {
      logger.error('خطأ في تحليل الحرارة:', err.message);
      return null;
    }
  }

  /**
   * تحليل رسالة أبراج متعددة (AP02)
   */
  static parseMultipleBasesPacket(message) {
    try {
      logger.debug('📡 رسالة أبراج متعددة (AP02)');
      return {
        type: 'MULTIPLE_BASES',
        imei: null,
        timestamp: new Date(),
        rawMessage: message,
      };
    } catch (err) {
      logger.error('خطأ في تحليل أبراج متعددة:', err.message);
      return null;
    }
  }

  /**
   * تحليل رد على طلب موقع (AP16)
   * مثال: IWAP16,080835#
   */
  static parseLocationRequestAck(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const journalNo = data.split(',')[1] || data;

      console.log(`✅ الساعة استلمت طلب الموقع - Journal: ${journalNo}`);
      logger.info(`✅ تأكيد طلب موقع - Journal: ${journalNo}`);

      return {
        type: 'LOCATION_REQUEST_ACK',
        imei: null,
        timestamp: new Date(),
        journalNo,
      };
    } catch (err) {
      logger.error('خطأ في تحليل رد طلب الموقع:', err.message);
      return null;
    }
  }

  /**
   * تحليل رد ضبط SOS (AP12)
   */
  static parseSOSAck(message) {
    try {
      console.log(`✅ الساعة استلمت أمر SOS`);
      return {
        type: 'SOS_ACK',
        imei: null,
        timestamp: new Date(),
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * تحليل رد على طلب قياس نبض (APXL)
   */
  static parseHeartRateAck(message) {
    try {
      console.log(`✅ الساعة بدأت قياس النبض`);
      return {
        type: 'HEART_RATE_TEST_ACK',
        imei: null,
        timestamp: new Date(),
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * تحليل رد على طلب قياس ضغط (APXY)
   */
  static parseBloodPressureAck(message) {
    try {
      console.log(`✅ الساعة بدأت قياس الضغط`);
      return {
        type: 'BLOOD_PRESSURE_TEST_ACK',
        imei: null,
        timestamp: new Date(),
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * تحليل رد على طلب قياس حرارة (APXT)
   */
  static parseTemperatureAck(message) {
    try {
      console.log(`✅ الساعة بدأت قياس الحرارة`);
      return {
        type: 'TEMPERATURE_TEST_ACK',
        imei: null,
        timestamp: new Date(),
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * تحليل رد على طلب قياس أكسجين (APXZ)
   */
  static parseOxygenAck(message) {
    try {
      console.log(`✅ الساعة بدأت قياس الأكسجين`);
      return {
        type: 'OXYGEN_TEST_ACK',
        imei: null,
        timestamp: new Date(),
      };
    } catch (err) {
      return null;
    }
  }

  /**
   * دوال مساعدة
   */

  // تحويل إحداثيات GPS من صيغة NMEA إلى Decimal
  static convertCoordinate(coord, direction) {
    try {
      const degrees = parseInt(coord.substring(0, coord.indexOf('.') - 2));
      const minutes = parseFloat(coord.substring(coord.indexOf('.') - 2));
      let decimal = degrees + (minutes / 60);
      
      if (direction === 'S' || direction === 'W') {
        decimal = -decimal;
      }
      
      return decimal;
    } catch {
      return 0;
    }
  }

  // تحليل بيانات WIFI
  static parseWifiData(wifiStr) {
    try {
      if (!wifiStr || wifiStr.trim() === '') return [];
      
      const networks = wifiStr.split('&');
      return networks.map(network => {
        const parts = network.split('|');
        return {
          ssid: parts[0],
          mac: parts[1],
          signal: parseInt(parts[2]),
        };
      });
    } catch {
      return [];
    }
  }
}

module.exports = ProtocolParser;
