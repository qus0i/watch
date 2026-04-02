const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

// إنشاء Connection Pool
const pool = new Pool(config.database);

// معالجة الأخطاء
pool.on('error', (err, client) => {
  logger.error('خطأ غير متوقع في قاعدة البيانات:', err);
});

// معالجة الاتصال
pool.on('connect', () => {
  logger.info('تم الاتصال بقاعدة البيانات بنجاح');
});

// دالة لاختبار الاتصال
async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    logger.info('اختبار الاتصال بقاعدة البيانات نجح:', result.rows[0].now);
    client.release();
    return true;
  } catch (err) {
    logger.error('فشل الاتصال بقاعدة البيانات:', err.message);
    return false;
  }
}

// دالة للحصول على أو إنشاء جهاز
async function getOrCreateDevice(imei) {
  const client = await pool.connect();
  try {
    let result = await client.query(
      'SELECT id FROM devices WHERE imei = $1',
      [imei]
    );

    if (result.rows.length > 0) {
      await client.query(
        'UPDATE devices SET last_connection = NOW() WHERE imei = $1',
        [imei]
      );
      return result.rows[0].id;
    }

    result = await client.query(
      'INSERT INTO devices (imei, last_connection) VALUES ($1, NOW()) RETURNING id',
      [imei]
    );
    
    logger.info(`تم تسجيل جهاز جديد: ${imei}`);
    return result.rows[0].id;

  } finally {
    client.release();
  }
}

/**
 * ⭐ دالة محسّنة للحصول على الموقع من OpenCellID
 */
async function getLocationFromOpenCellID(mcc, mnc, lac, cellId) {
  try {
    const { apiToken, apiUrl } = config.locationServices.opencellid;
    
    const url = `${apiUrl}?key=${apiToken}&mcc=${mcc}&mnc=${mnc}&lac=${lac}&cellid=${cellId}&format=json`;
    
    logger.debug(`📡 طلب موقع من OpenCellID: MCC=${mcc}, MNC=${mnc}, LAC=${lac}, CellID=${cellId}`);
    
    const https = require('https');
    
    return new Promise((resolve) => {
      const req = https.get(url, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            if (res.statusCode === 200) {
              const result = JSON.parse(data);

              if (result.lat && result.lon) {
                logger.info(`✅ تم الحصول على موقع من OpenCellID: ${result.lat}, ${result.lon}`);

                resolve({
                  latitude: parseFloat(result.lat),
                  longitude: parseFloat(result.lon),
                  accuracy: result.range || 500,
                  source: 'OpenCellID'
                });
              } else {
                logger.warn(`⚠️ OpenCellID: بيانات غير كاملة - ${data}`);
                resolve(null);
              }
            } else if (res.statusCode === 404) {
              logger.warn(`⚠️ OpenCellID: البرج غير موجود (404) - MCC=${mcc} MNC=${mnc} LAC=${lac} CellID=${cellId}`);
              resolve(null);
            } else if (res.statusCode === 401 || res.statusCode === 403) {
              logger.error(`❌ OpenCellID: رمز API غير صالح أو منتهي الصلاحية (${res.statusCode}) - تحقق من OPENCELLID_TOKEN`);
              resolve(null);
            } else {
              logger.error(`❌ OpenCellID error: ${res.statusCode} - ${data}`);
              resolve(null);
            }
          } catch (err) {
            logger.error('❌ خطأ في تحليل استجابة OpenCellID:', err.message, '- raw:', data);
            resolve(null);
          }
        });
      });

      req.setTimeout(8000, () => {
        req.destroy();
        logger.error('❌ OpenCellID: انتهت مهلة الطلب (8 ثواني)');
        resolve(null);
      });

      req.on('error', (err) => {
        logger.error('❌ خطأ في الاتصال بـ OpenCellID:', err.message);
        resolve(null);
      });
    });
    
  } catch (err) {
    logger.error('❌ خطأ في getLocationFromOpenCellID:', err.message);
    return null;
  }
}

/**
 * ⭐ دالة محسّنة لحفظ الموقع مع دعم OpenCellID
 */
async function saveLocation(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);
    
    let latitude = data.latitude;
    let longitude = data.longitude;
    let locationSource = 'GPS';
    let accuracy = 10;
    
    if (!data.gpsValid || latitude === 0 || longitude === 0) {
      logger.warn(`⚠️ GPS غير متاح من ${data.imei} - استخدام OpenCellID...`);
      
      const lbsLocation = await getLocationFromOpenCellID(
        data.mcc,
        data.mnc,
        data.lac,
        data.cellId
      );
      
      if (lbsLocation) {
        latitude = lbsLocation.latitude;
        longitude = lbsLocation.longitude;
        accuracy = lbsLocation.accuracy;
        locationSource = 'LBS-OpenCellID';
        
        logger.info(`✅ تم الحصول على موقع من OpenCellID: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (دقة: ${accuracy}م)`);
      } else {
        logger.error(`❌ فشل الحصول على الموقع من GPS و OpenCellID`);
        return false;
      }
    }

    await client.query(`
      INSERT INTO locations (
        device_id, imei, timestamp, latitude, longitude, speed, direction,
        gps_valid, satellite_count, gsm_signal, battery_level,
        mcc, mnc, lac, cell_id, wifi_data, 
        fortification_state, working_mode,
        location_source, accuracy
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
    `, [
      deviceId, data.imei, data.timestamp, latitude, longitude,
      data.speed, data.direction, data.gpsValid, data.satelliteCount,
      data.gsmSignal, data.batteryLevel, data.mcc, data.mnc, data.lac,
      data.cellId, JSON.stringify(data.wifiData), data.fortificationState,
      data.workingMode, locationSource, accuracy
    ]);

    logger.info(`📍 تم حفظ موقع للجهاز ${data.imei} (المصدر: ${locationSource})`);
    return true;

  } catch (err) {
    logger.error('خطأ في حفظ الموقع:', err.message);
    return false;
  } finally {
    client.release();
  }
}

// دالة لحفظ القياسات الصحية
async function saveHealthData(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);

    await client.query(`
      INSERT INTO health_data (
        device_id, imei, heart_rate, blood_pressure_systolic, 
        blood_pressure_diastolic, spo2, blood_sugar, 
        body_temperature, battery_level
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      deviceId, data.imei, data.heartRate, data.systolic,
      data.diastolic, data.spo2, data.bloodSugar,
      data.temperature, data.batteryLevel
    ]);

    logger.info(`تم حفظ قياسات صحية للجهاز ${data.imei}`);
    return true;

  } catch (err) {
    logger.error('خطأ في حفظ القياسات الصحية:', err.message);
    return false;
  } finally {
    client.release();
  }
}

// دالة لحفظ إنذار
async function saveAlert(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);

    await client.query(`
      INSERT INTO alerts (
        device_id, imei, timestamp, alert_type, 
        latitude, longitude
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      deviceId, data.imei, data.timestamp, data.alertType,
      data.latitude, data.longitude
    ]);

    logger.warn(`⚠️ إنذار جديد من الجهاز ${data.imei}: ${data.alertType}`);
    return true;

  } catch (err) {
    logger.error('خطأ في حفظ الإنذار:', err.message);
    return false;
  } finally {
    client.release();
  }
}

// دالة لحفظ الخطوات اليومية
async function updateDailySteps(imei, steps, rollFrequency) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(imei);
    const today = new Date().toISOString().split('T')[0];

    await client.query(`
      INSERT INTO daily_steps (device_id, date, step_count, roll_frequency)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (device_id, date) 
      DO UPDATE SET step_count = $3, roll_frequency = $4
    `, [deviceId, today, steps, rollFrequency]);

    return true;

  } catch (err) {
    logger.error('خطأ في تحديث الخطوات:', err.message);
    return false;
  } finally {
    client.release();
  }
}

// دالة لتسجيل أمر مُرسل
async function logCommand(imei, commandType, commandData, journalNo) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(imei);

    const result = await client.query(`
      INSERT INTO commands_log (device_id, imei, command_type, command_data, journal_no)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
    `, [deviceId, imei, commandType, commandData, journalNo]);

    return result.rows[0].id;

  } catch (err) {
    logger.error('خطأ في تسجيل الأمر:', err.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * ⭐ حفظ موقع من AP02 (أبراج متعددة + WiFi)
 */
async function saveMultipleBasesLocation(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);
    
    if (data.cellTowers && data.cellTowers.length > 0) {
      const firstTower = data.cellTowers[0];
      
      logger.info(`🔍 محاولة تحديد الموقع من ${data.cellTowers.length} أبراج + ${data.wifiNetworks ? data.wifiNetworks.length : 0} WiFi`);
      
      const lbsLocation = await getLocationFromOpenCellID(
        data.mcc,
        data.mnc,
        firstTower.lac,
        firstTower.cellId
      );
      
      if (lbsLocation) {
        await client.query(`
          INSERT INTO locations (
            device_id, imei, timestamp, latitude, longitude, speed, direction,
            gps_valid, satellite_count, gsm_signal, battery_level,
            mcc, mnc, lac, cell_id,
            fortification_state, working_mode,
            location_source, accuracy
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
        `, [
          deviceId, data.imei, data.timestamp, 
          lbsLocation.latitude, lbsLocation.longitude,
          0, 0,
          false, 0, 0, 0,
          data.mcc, data.mnc, firstTower.lac, firstTower.cellId,
          0, 0,
          'LBS-OpenCellID-AP02', lbsLocation.accuracy
        ]);

        logger.info(`✅ تم حفظ موقع من AP02 (المصدر: LBS-OpenCellID-AP02)`);
        return true;
      } else {
        logger.warn(`⚠️ فشل الحصول على موقع من AP02`);
        return false;
      }
    } else {
      logger.warn(`⚠️ AP02 بدون أبراج`);
      return false;
    }

  } catch (err) {
    logger.error('خطأ في حفظ موقع AP02:', err.message);
    return false;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  testConnection,
  getOrCreateDevice,
  saveLocation,
  saveHealthData,
  saveAlert,
  updateDailySteps,
  logCommand,
  getLocationFromOpenCellID, // ⭐ دالة جديدة
  saveMultipleBasesLocation, // ⭐ دالة جديدة لـ AP02
};
