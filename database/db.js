const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

const pool = new Pool(config.database);

pool.on('error', (err, client) => {
  logger.error('خطأ غير متوقع في قاعدة البيانات:', err);
});

pool.on('connect', () => {
  logger.info('تم الاتصال بقاعدة البيانات بنجاح');
});

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
    console.log(`✅ تم تسجيل جهاز جديد في قاعدة البيانات: ${imei}`);
    return result.rows[0].id;

  } finally {
    client.release();
  }
}

async function saveLocation(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);

    await client.query(`
      INSERT INTO locations (
        device_id, imei, timestamp, latitude, longitude, speed, direction,
        gps_valid, satellite_count, gsm_signal, battery_level,
        mcc, mnc, lac, cell_id, wifi_data, 
        fortification_state, working_mode
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
    `, [
      deviceId, data.imei, data.timestamp, data.latitude, data.longitude,
      data.speed, data.direction, data.gpsValid, data.satelliteCount,
      data.gsmSignal, data.batteryLevel, data.mcc, data.mnc, data.lac,
      data.cellId, JSON.stringify(data.wifiData), data.fortificationState,
      data.workingMode
    ]);

    logger.info(`📍 تم حفظ موقع للجهاز ${data.imei}`);
    console.log(`📍 تم حفظ موقع: ${data.latitude}, ${data.longitude} - ${data.imei}`);
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
 * ⭐ دالة محدثة لحفظ القياسات الصحية
 * إذا في قياس خلال آخر 2 دقيقة، يعمل UPDATE
 * وإلا يعمل INSERT جديد
 */
async function saveHealthData(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);

    // البحث عن قياس حديث (خلال آخر 2 دقيقة)
    const recentMeasurement = await client.query(`
      SELECT id, timestamp FROM health_data
      WHERE device_id = $1
      AND timestamp > NOW() - INTERVAL '2 minutes'
      ORDER BY timestamp DESC
      LIMIT 1
    `, [deviceId]);

    if (recentMeasurement.rows.length > 0) {
      // ✅ يوجد قياس حديث - نعمل UPDATE
      const measurementId = recentMeasurement.rows[0].id;
      const existingTime = recentMeasurement.rows[0].timestamp;
      
      await client.query(`
        UPDATE health_data SET
          heart_rate = COALESCE($1, heart_rate),
          blood_pressure_systolic = COALESCE($2, blood_pressure_systolic),
          blood_pressure_diastolic = COALESCE($3, blood_pressure_diastolic),
          spo2 = COALESCE($4, spo2),
          blood_sugar = COALESCE($5, blood_sugar),
          body_temperature = COALESCE($6, body_temperature),
          battery_level = COALESCE($7, battery_level)
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

      logger.info(`📝 تم تحديث القياسات للجهاز ${data.imei} (ID: ${measurementId})`);
      console.log(`📝 UPDATE: تم تحديث قياسات موجودة (ID: ${measurementId}, Time: ${existingTime})`);
      console.log(`   البيانات الجديدة: نبض=${data.heartRate}, ضغط=${data.systolic}/${data.diastolic}, حرارة=${data.temperature}, أكسجين=${data.spo2}`);
      
    } else {
      // ✅ لا يوجد قياس حديث - نعمل INSERT جديد
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
      const newTime = result.rows[0].timestamp;

      logger.info(`✅ تم حفظ قياسات جديدة للجهاز ${data.imei} (ID: ${newId})`);
      console.log(`✅ INSERT: تم حفظ قياسات جديدة (ID: ${newId}, Time: ${newTime})`);
      console.log(`   البيانات: نبض=${data.heartRate}, ضغط=${data.systolic}/${data.diastolic}, حرارة=${data.temperature}, أكسجين=${data.spo2}`);
    }

    return true;

  } catch (err) {
    logger.error('خطأ في حفظ القياسات الصحية:', err.message);
    console.error('❌ خطأ في حفظ القياسات الصحية:', err);
    console.error('Stack:', err.stack);
    return false;
  } finally {
    client.release();
  }
}

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
    return false;
  } finally {
    client.release();
  }
}

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
