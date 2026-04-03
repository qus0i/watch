const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

// إنشاء Connection Pool
const pool = new Pool(config.database);

// معالجة الأخطاء
pool.on('error', (err, client) => {
  logger.error('خطأ غير متوقع في قاعدة البيانات:', err);
  console.error('❌ [DB] خطأ في Pool:', err);
});

// معالجة الاتصال
pool.on('connect', () => {
  logger.info('تم الاتصال بقاعدة البيانات بنجاح');
  console.log('✅ [DB] اتصال جديد بقاعدة البيانات');
});

// دالة لاختبار الاتصال
async function testConnection() {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    logger.info('اختبار الاتصال بقاعدة البيانات نجح:', result.rows[0].now);
    console.log('✅ [DB] اختبار الاتصال نجح:', result.rows[0].now);
    client.release();
    return true;
  } catch (err) {
    logger.error('فشل الاتصال بقاعدة البيانات:', err.message);
    console.error('❌ [DB] فشل اختبار الاتصال:', err.message);
    return false;
  }
}

// دالة للحصول على أو إنشاء جهاز
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
    console.log(`✅ [DB] تم تسجيل جهاز جديد: ${imei} - ID: ${result.rows[0].id}`);
    return result.rows[0].id;

  } finally {
    client.release();
  }
}

// دالة لحفظ موقع GPS
async function saveLocation(data) {
  const client = await pool.connect();
  try {
    console.log(`\n💾 [DB] محاولة حفظ موقع للجهاز ${data.imei}`);
    console.log(`   GPS Valid: ${data.gpsValid}`);
    console.log(`   MCC: ${data.mcc}, MNC: ${data.mnc}`);
    console.log(`   LAC: ${data.lac}, CID: ${data.cellId}`);
    
    const deviceId = await getOrCreateDevice(data.imei);
    console.log(`   Device ID: ${deviceId}`);

    const result = await client.query(`
      INSERT INTO locations (
        device_id, imei, timestamp, latitude, longitude, speed, direction,
        gps_valid, satellite_count, gsm_signal, battery_level,
        mcc, mnc, lac, cell_id, wifi_data, 
        fortification_state, working_mode
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      RETURNING id
    `, [
      deviceId, 
      data.imei, 
      data.timestamp, 
      data.latitude || 0, 
      data.longitude || 0,
      data.speed || 0, 
      data.direction || 0, 
      data.gpsValid || false, 
      data.satelliteCount || 0,
      data.gsmSignal || 0, 
      data.batteryLevel || 0, 
      data.mcc || 0, 
      data.mnc || 0, 
      data.lac || 0,
      data.cellId || 0, 
      JSON.stringify(data.wifiData || []), 
      data.fortificationState || 0,
      data.workingMode || 0
    ]);

    const insertedId = result.rows[0].id;
    console.log(`✅ [DB] تم حفظ الموقع بنجاح - ID: ${insertedId}`);
    logger.info(`تم حفظ موقع للجهاز ${data.imei}`);
    return true;

  } catch (err) {
    console.error(`❌ [DB] خطأ في حفظ الموقع:`, err.message);
    console.error(`   Error Code: ${err.code}`);
    console.error(`   Error Detail: ${err.detail}`);
    console.error(`   Stack: ${err.stack}`);
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
    console.log(`\n💾 [DB] محاولة حفظ قياسات صحية للجهاز ${data.imei}`);
    
    const deviceId = await getOrCreateDevice(data.imei);

    const result = await client.query(`
      INSERT INTO health_data (
        device_id, imei, heart_rate, blood_pressure_systolic, 
        blood_pressure_diastolic, spo2, blood_sugar, 
        body_temperature, battery_level
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [
      deviceId, 
      data.imei, 
      data.heartRate || null,
      data.systolic || null,
      data.diastolic || null, 
      data.spo2 || null, 
      data.bloodSugar || null,
      data.temperature || null, 
      data.batteryLevel || null
    ]);

    const insertedId = result.rows[0].id;
    console.log(`✅ [DB] تم حفظ القياسات الصحية بنجاح - ID: ${insertedId}`);
    logger.info(`تم حفظ قياسات صحية للجهاز ${data.imei}`);
    return true;

  } catch (err) {
    console.error(`❌ [DB] خطأ في حفظ القياسات الصحية:`, err.message);
    console.error(`   Error Code: ${err.code}`);
    console.error(`   Stack: ${err.stack}`);
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
    console.log(`\n💾 [DB] محاولة حفظ إنذار للجهاز ${data.imei}`);
    console.log(`   نوع الإنذار: ${data.alertType}`);
    
    const deviceId = await getOrCreateDevice(data.imei);

    const result = await client.query(`
      INSERT INTO alerts (
        device_id, imei, timestamp, alert_type, 
        latitude, longitude
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [
      deviceId, 
      data.imei, 
      data.timestamp, 
      data.alertType,
      data.latitude || 0, 
      data.longitude || 0
    ]);

    const insertedId = result.rows[0].id;
    console.log(`✅ [DB] تم حفظ الإنذار بنجاح - ID: ${insertedId}`);
    logger.warn(`⚠️ إنذار جديد من الجهاز ${data.imei}: ${data.alertType}`);
    return true;

  } catch (err) {
    console.error(`❌ [DB] خطأ في حفظ الإنذار:`, err.message);
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

    console.log(`✅ [DB] تم تحديث الخطوات: ${steps}`);
    return true;

  } catch (err) {
    console.error(`❌ [DB] خطأ في تحديث الخطوات:`, err.message);
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

    console.log(`✅ [DB] تم تسجيل الأمر - ID: ${result.rows[0].id}`);
    return result.rows[0].id;

  } catch (err) {
    console.error(`❌ [DB] خطأ في تسجيل الأمر:`, err.message);
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
