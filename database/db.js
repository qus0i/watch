const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

// إنشاء Connection Pool
const pool = new Pool(config.database);

// معالجة الأخطاء
pool.on('error', (err, client) => {
  logger.error('خطأ غير متوقع في قاعدة البيانات:', err);
  console.error('❌ خطأ غير متوقع في قاعدة البيانات:', err);
});

// معالجة الاتصال
pool.on('connect', () => {
  logger.info('تم الاتصال بقاعدة البيانات بنجاح');
  console.log('✅ تم الاتصال بقاعدة البيانات بنجاح');
});

/**
 * اختبار الاتصال بقاعدة البيانات
 */
async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    logger.info('اختبار الاتصال بقاعدة البيانات نجح:', result.rows[0].now);
    console.log('✅ اختبار قاعدة البيانات نجح:', result.rows[0].now);
    client.release();
    return true;
  } catch (err) {
    logger.error('فشل الاتصال بقاعدة البيانات:', err.message);
    console.error('❌ فشل الاتصال بقاعدة البيانات:', err.message);
    return false;
  }
}

/**
 * الحصول على أو إنشاء جهاز
 */
async function getOrCreateDevice(imei) {
  const client = await pool.connect();
  try {
    // البحث عن الجهاز
    let result = await client.query(
      'SELECT id FROM devices WHERE imei = $1',
      [imei]
    );

    if (result.rows.length > 0) {
      // تحديث آخر اتصال
      await client.query(
        'UPDATE devices SET last_connection = NOW() WHERE imei = $1',
        [imei]
      );
      return result.rows[0].id;
    }

    // إنشاء جهاز جديد
    result = await client.query(
      'INSERT INTO devices (imei, last_connection) VALUES ($1, NOW()) RETURNING id',
      [imei]
    );
    
    logger.info(`تم تسجيل جهاز جديد: ${imei}`);
    console.log(`✅ تم تسجيل جهاز جديد في قاعدة البيانات: ${imei}`);
    return result.rows[0].id;

  } finally {
    client.release();
  }
}

/**
 * حفظ موقع GPS مع فحص صحة الإحداثيات
 */
async function saveLocation(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);

    // ⭐ فحص صحة الإحداثيات قبل الحفظ
    const lat = parseFloat(data.latitude);
    const lng = parseFloat(data.longitude);
    
    // إذا الإحداثيات غير صحيحة أو = 0, 0
    if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) {
      logger.warn(`⚠️ إحداثيات غير صحيحة من ${data.imei}: lat=${data.latitude}, lng=${data.longitude}`);
      console.log(`⚠️ تم تجاهل موقع غير صحيح من ${data.imei} (GPS غير متاح - الساعة داخل مبنى أو GPS معطل)`);
      return false;
    }

    await client.query(`
      INSERT INTO locations (
        device_id, imei, timestamp, latitude, longitude, speed, direction,
        gps_valid, satellite_count, gsm_signal, battery_level,
        mcc, mnc, lac, cell_id, wifi_data, 
        fortification_state, working_mode
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `, [
      deviceId, data.imei, data.timestamp, lat, lng,
      data.speed, data.direction, data.gpsValid, data.satelliteCount,
      data.gsmSignal, data.batteryLevel, data.mcc, data.mnc, data.lac,
      data.cellId, JSON.stringify(data.wifiData), data.fortificationState,
      data.workingMode
    ]);

    logger.info(`📍 تم حفظ موقع للجهاز ${data.imei}`);
    console.log(`📍 تم حفظ موقع: ${lat.toFixed(6)}, ${lng.toFixed(6)} - ${data.imei}`);
    return true;

  } catch (err) {
    logger.error('خطأ في حفظ الموقع:', err.message);
    console.error('❌ خطأ في حفظ الموقع:', err);
    return false;
  } finally {
    client.release();
  }
}

/**
 * ⭐ حفظ القياسات الصحية مع نظام UPDATE/INSERT الذكي
 * - إذا في قياس خلال آخر 12 دقيقة → UPDATE (نفس الدورة)
 * - إذا ما في → INSERT (دورة جديدة)
 */
async function saveHealthData(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);

    // ⭐ البحث عن قياس في آخر 12 دقيقة (دورة واحدة = 15 دقيقة)
    // إذا وجدنا قياس → UPDATE (نفس الدورة)
    // إذا ما وجدنا → INSERT (دورة جديدة)
    const recentMeasurement = await client.query(`
      SELECT id, timestamp,
             heart_rate, blood_pressure_systolic, blood_pressure_diastolic,
             spo2, body_temperature
      FROM health_data
      WHERE device_id = $1
      AND timestamp > NOW() - INTERVAL '12 minutes'
      ORDER BY timestamp DESC
      LIMIT 1
    `, [deviceId]);

    if (recentMeasurement.rows.length > 0) {
      // ✅ UPDATE: تحديث نفس الـ row
      const measurementId = recentMeasurement.rows[0].id;
      const existing = recentMeasurement.rows[0];
      
      await client.query(`
        UPDATE health_data SET
          heart_rate = COALESCE($1, heart_rate),
          blood_pressure_systolic = COALESCE($2, blood_pressure_systolic),
          blood_pressure_diastolic = COALESCE($3, blood_pressure_diastolic),
          spo2 = COALESCE($4, spo2),
          blood_sugar = COALESCE($5, blood_sugar),
          body_temperature = COALESCE($6, body_temperature),
          battery_level = COALESCE($7, battery_level),
          timestamp = CASE 
            WHEN $1 IS NOT NULL OR $2 IS NOT NULL THEN NOW()
            ELSE timestamp
          END
        WHERE id = $8
      `, [
        data.heartRate,
        data.systolic,
        data.diastolic,
        data.spo2,
        data.bloodSugar,
        data.temperature,
        data.batteryLevel,
        measurementId
      ]);

      // عرض البيانات المحدثة
      const updated = await client.query(
        'SELECT heart_rate, blood_pressure_systolic, blood_pressure_diastolic, spo2, body_temperature FROM health_data WHERE id = $1',
        [measurementId]
      );
      const row = updated.rows[0];

      logger.info(`📝 تم تحديث القياسات للجهاز ${data.imei} (ID: ${measurementId})`);
      console.log(`📝 UPDATE: تحديث Row #${measurementId} - نفس الدورة`);
      console.log(`   البيانات الحالية:`);
      console.log(`     نبض=${row.heart_rate || 'منتظر'}, ضغط=${row.blood_pressure_systolic || '-'}/${row.blood_pressure_diastolic || '-'}, حرارة=${row.body_temperature || 'منتظر'}, أكسجين=${row.spo2 || 'منتظر'}`);
      
    } else {
      // ✅ INSERT: دورة جديدة
      const result = await client.query(`
        INSERT INTO health_data (
          device_id, imei, heart_rate, blood_pressure_systolic, 
          blood_pressure_diastolic, spo2, blood_sugar, 
          body_temperature, battery_level
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, timestamp
      `, [
        deviceId,
        data.imei,
        data.heartRate,
        data.systolic,
        data.diastolic,
        data.spo2,
        data.bloodSugar,
        data.temperature,
        data.batteryLevel
      ]);

      const newId = result.rows[0].id;

      logger.info(`✅ تم حفظ قياسات جديدة للجهاز ${data.imei} (ID: ${newId})`);
      console.log(`✅ INSERT: Row جديد #${newId} - دورة جديدة`);
      console.log(`   البيانات: نبض=${data.heartRate || '-'}, ضغط=${data.systolic || '-'}/${data.diastolic || '-'}, حرارة=${data.temperature || '-'}, أكسجين=${data.spo2 || '-'}`);
    }

    return true;

  } catch (err) {
    logger.error('خطأ في حفظ القياسات الصحية:', err.message);
    console.error('❌ خطأ في حفظ القياسات الصحية:', err);
    return false;
  } finally {
    client.release();
  }
}

/**
 * حفظ إنذار
 */
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
    console.log(`🚨 إنذار ${data.alertType} من ${data.imei}`);
    return true;

  } catch (err) {
    logger.error('خطأ في حفظ الإنذار:', err.message);
    console.error('❌ خطأ في حفظ الإنذار:', err);
    return false;
  } finally {
    client.release();
  }
}

/**
 * تحديث الخطوات اليومية
 */
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

    logger.debug(`تم تحديث الخطوات للجهاز ${imei}: ${steps} خطوة`);
    return true;

  } catch (err) {
    logger.error('خطأ في تحديث الخطوات:', err.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * تسجيل أمر مُرسل
 */
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

module.exports = {
  pool,
  testConnection,
  getOrCreateDevice,
  saveLocation,
  saveHealthData,
  saveAlert,
  updateDailySteps,
  logCommand,
};
