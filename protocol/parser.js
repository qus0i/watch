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
      
      // التحقق من البنية الأساسية
      if (!message.startsWith('IW') || !message.endsWith('#')) {
        logger.warn('رسالة غير صحيحة (لا تبدأ بـ IW أو لا تنتهي بـ #)');
        return null;
      }

      // استخراج نوع الأمر
      const commandType = message.substring(2, 6);
      
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
        case 'AP49':
          return this.parseHeartRatePacket(message);
        case 'APHT':
          return this.parseHeartRateBPPacket(message);
        case 'APHP':
          return this.parseFullHealthPacket(message);
        case 'AP50':
          return this.parseTemperaturePacket(message);
        default:
          logger.warn(`نوع أمر غير معروف: ${commandType}`);
          return { type: 'UNKNOWN', commandType, rawMessage: message };
      }

    } catch (err) {
      logger.error('خطأ في تحليل الرسالة:', err.message);
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
    
    return {
      type: 'LOGIN',
      imei,
      timestamp: new Date(),
    };
  }

  /**
   * تحليل رسالة الموقع (AP01)
   */
  static parseLocationPacket(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');

      const dateTimeGps = parts[0];
      const date = dateTimeGps.substring(0, 6);
      const gpsValid = dateTimeGps.charAt(6) === 'A';
      
      const latitudeStr = dateTimeGps.substring(7, 17);
      const latitudeDir = dateTimeGps.charAt(17);
      const longitudeStr = dateTimeGps.substring(18, 29);
      const longitudeDir = dateTimeGps.charAt(29);
      const speed = parseFloat(dateTimeGps.substring(30, 35));
      const time = dateTimeGps.substring(35, 41);
      const direction = parseFloat(dateTimeGps.substring(41, 47));
      
      const latitude = this.convertCoordinate(latitudeStr, latitudeDir);
      const longitude = this.convertCoordinate(longitudeStr, longitudeDir);

      const statusInfo = dateTimeGps.substring(47);
      const gsmSignal = parseInt(statusInfo.substring(0, 3));
      const satelliteCount = parseInt(statusInfo.substring(3, 6));
      const batteryLevel = parseInt(statusInfo.substring(6, 9));
      const fortificationState = parseInt(statusInfo.substring(10, 12));
      const workingMode = parseInt(statusInfo.substring(12, 14));

      const mcc = parseInt(parts[1]);
      const mnc = parseInt(parts[2]);
      const lac = parseInt(parts[3]);
      const cellId = parseInt(parts[4]);

      let wifiData = [];
      if (parts.length > 5) {
        const wifiStr = parts.slice(5).join(',');
        wifiData = this.parseWifiData(wifiStr);
      }

      const year = 2000 + parseInt(date.substring(4, 6));
      const month = parseInt(date.substring(2, 4));
      const day = parseInt(date.substring(0, 2));
      const hour = parseInt(time.substring(0, 2));
      const minute = parseInt(time.substring(2, 4));
      const second = parseInt(time.substring(4, 6));
      const timestamp = new Date(Date.UTC(year, month - 1, day, hour, minute, second));

      logger.info(`📍 موقع GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} | بطارية: ${batteryLevel}%`);

      return {
        type: 'LOCATION',
        imei: null,
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
      return null;
    }
  }

  /**
   * ⭐ تحليل رسالة أبراج متعددة (AP02) - للدقة العالية!
   * مثال: IWAP02,zh_cn,0,7,460,0,9520│3671│13,9520│3672│12,...
   */
  static parseMultipleBasesPacket(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');
      
      const language = parts[0];
      const replyFlag = parts[1];
      const basesCount = parseInt(parts[2]);
      const mcc = parseInt(parts[3]);
      const mnc = parseInt(parts[4]);
      
      // استخراج الأبراج المتعددة
      const cellTowers = [];
      for (let i = 0; i < basesCount && i + 5 < parts.length; i++) {
        const towerData = parts[5 + i].split('│');
        if (towerData.length >= 3) {
          cellTowers.push({
            lac: parseInt(towerData[0]),
            cellId: parseInt(towerData[1]),
            signalStrength: parseInt(towerData[2])
          });
        }
      }
      
      // استخراج شبكات WiFi
      const wifiStartIndex = 5 + basesCount;
      const wifiCount = parseInt(parts[wifiStartIndex] || 0);
      const wifiNetworks = [];
      
      if (wifiCount > 0 && wifiStartIndex + 1 < parts.length) {
        const wifiDataParts = parts.slice(wifiStartIndex + 1);
        for (const wifiStr of wifiDataParts) {
          const networks = wifiStr.split('&');
          for (const network of networks) {
            if (network && network.trim()) {
              const wifiParts = network.split('│');
              if (wifiParts.length >= 3) {
                wifiNetworks.push({
                  ssid: wifiParts[0],
                  mac: wifiParts[1],
                  signalStrength: parseInt(wifiParts[2])
                });
              }
            }
          }
        }
      }

      logger.info(`📡 رسالة أبراج متعددة: ${basesCount} أبراج, ${wifiNetworks.length} شبكات WiFi`);
      console.log(`📡 رسالة أبراج متعددة:`);
      console.log(`   📡 ${cellTowers.length} أبراج`);
      console.log(`   📶 ${wifiNetworks.length} شبكات WiFi`);

      return {
        type: 'MULTIPLE_BASES',
        imei: null,
        timestamp: new Date(),
        mcc,
        mnc,
        cellTowers,
        wifiNetworks,
        language
      };

    } catch (err) {
      logger.error('خطأ في تحليل أبراج متعددة:', err.message);
      console.error('❌ خطأ في تحليل أبراج متعددة:', err);
      return null;
    }
  }

  /**
   * تحليل رسالة نبض القلب (Heartbeat - AP03)
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
   */
  static parseAlarmPacket(message) {
    try {
      const locationData = this.parseLocationPacket('IWAP01' + message.substring(6));
      if (!locationData) return null;

      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');
      
      let alertType = 'UNKNOWN';
      for (let i = parts.length - 4; i < parts.length; i++) {
        if (parts[i] === '01') alertType = 'SOS';
        else if (parts[i] === '03') alertType = 'NOT_WEAR';
        else if (parts[i] === '05' || parts[i] === '06') alertType = 'FALL_DOWN';
      }

      logger.warn(`⚠️ إنذار: ${alertType}`);

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
   */
  static parseHeartRatePacket(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const heartRate = parseInt(data.split(',')[1] || data);

      logger.info(`❤️ نبض القلب: ${heartRate} bpm`);

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
   */
  static parseHeartRateBPPacket(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');

      const heartRate = parseInt(parts[1]);
      const systolic = parseInt(parts[2]);
      const diastolic = parseInt(parts[3]);

      logger.info(`💉 نبض وضغط: ${heartRate} bpm | ${systolic}/${diastolic} mmHg`);

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
   */
  static parseTemperaturePacket(message) {
    try {
      const data = message.substring(6, message.length - 1);
      const parts = data.split(',');

      const temperature = parseFloat(parts[1]);
      const batteryLevel = parseInt(parts[2]);

      logger.info(`🌡️ حرارة الجسم: ${temperature}°C | بطارية: ${batteryLevel}%`);

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
        const parts = network.split('│');
        return {
          ssid: parts[0],
          mac: parts[1],
          signal: parseInt(parts[2]),
        };
      }).filter(n => n.ssid && n.mac);
    } catch {
      return [];
    }
  }
}

module.exports = ProtocolParser;
