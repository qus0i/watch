const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

// إنشاء Connection Pool
const pool = new Pool(config.database);

// معالجة الأخطاء
pool.on('error', (err, client) => {
  logger.error('خطأ غير متوقع في قاعدة البيانات:', err);
  console.error('❌ [DB] خطأ في Pool:', err.message);
});

// معالجة الاتصال
pool.on('connect', () => {
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

/**
 * ⭐ تهيئة قاعدة البيانات - إنشاء الجداول إذا لم تكن موجودة
 */
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    console.log('🔧 [DB] جاري تهيئة قاعدة البيانات...');

    const fs = require('fs');
    const path = require('path');
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    try {
      await client.query(schema);
      console.log('✅ [DB] تم تهيئة قاعدة البيانات بنجاح');
    } catch (queryErr) {
      if (queryErr.message && queryErr.message.includes('already exists')) {
        console.log('ℹ️ [DB] الجداول موجودة مسبقاً');
      } else {
        throw queryErr;
      }
    }
  } catch (err) {
    console.error('❌ [DB] خطأ في تهيئة قاعدة البيانات:', err.message);
    // لا نرمي الخطأ - نسمح للسيرفر بالاستمرار
    logger.error('خطأ في تهيئة قاعدة البيانات:', err.message);
  } finally {
    client.release();
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

// دالة لحفظ موقع GPS + تحديث last_location
async function saveLocation(data) {
  const client = await pool.connect();
  try {
    console.log(`\n💾 [DB] حفظ موقع للجهاز ${data.imei}`);
    console.log(`   GPS Valid: ${data.gpsValid}, Lat: ${data.latitude}, Lng: ${data.longitude}`);
    console.log(`   MCC: ${data.mcc}, MNC: ${data.mnc}, LAC: ${data.lac}, CID: ${data.cellId}`);
    
    const deviceId = await getOrCreateDevice(data.imei);

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
      data.timestamp || new Date(), 
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
    console.log(`✅ [DB] تم حفظ الموقع - ID: ${insertedId}`);
    logger.info(`تم حفظ موقع للجهاز ${data.imei} (GPS: ${data.gpsValid}, Lat: ${data.latitude}, Lng: ${data.longitude})`);

    // ⭐ تحديث last_location
    await client.query(`
      INSERT INTO last_location (device_id, imei, latitude, longitude, gps_valid, mcc, mnc, lac, cell_id, battery_level, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (imei) DO UPDATE SET
        latitude = $3, longitude = $4, gps_valid = $5,
        mcc = $6, mnc = $7, lac = $8, cell_id = $9,
        battery_level = $10, updated_at = NOW()
    `, [
      deviceId, data.imei,
      data.latitude || 0, data.longitude || 0, data.gpsValid || false,
      data.mcc || 0, data.mnc || 0, data.lac || 0, data.cellId || 0,
      data.batteryLevel || 0
    ]);
    console.log(`✅ [DB] تم تحديث last_location`);

    return true;

  } catch (err) {
    console.error(`❌ [DB] خطأ في حفظ الموقع:`, err.message);
    logger.error('خطأ في حفظ الموقع:', err.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * ⭐ إنشاء سطر جديد لدورة صحية (يُستدعى في بداية كل دورة)
 * يرجع الـ ID الجديد لنستخدمه في التحديثات اللاحقة
 */
async function createHealthCycleRow(imei) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(imei);
    const result = await client.query(`
      INSERT INTO health_data (
        device_id, imei, timestamp,
        heart_rate, blood_pressure_systolic, 
        blood_pressure_diastolic, spo2, blood_sugar, 
        body_temperature, battery_level
      ) VALUES ($1, $2, NOW(), NULL, NULL, NULL, NULL, NULL, NULL, NULL)
      RETURNING id
    `, [deviceId, imei]);

    const rowId = result.rows[0].id;
    console.log(`✅ [DB] تم إنشاء سطر صحي جديد - ID: ${rowId}`);
    return rowId;
  } catch (err) {
    console.error(`❌ [DB] خطأ في إنشاء سطر صحي:`, err.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * ⭐ تحديث سطر صحي موجود (يُستدعى عند وصول كل قياس)
 */
async function updateHealthCycleRow(rowId, data) {
  const client = await pool.connect();
  try {
    const setClauses = [];
    const values = [];
    let paramIndex = 1;

    if (data.heartRate !== undefined && data.heartRate !== null) {
      setClauses.push(`heart_rate = $${paramIndex++}`);
      values.push(data.heartRate);
    }
    if (data.systolic !== undefined && data.systolic !== null) {
      setClauses.push(`blood_pressure_systolic = $${paramIndex++}`);
      values.push(data.systolic);
    }
    if (data.diastolic !== undefined && data.diastolic !== null) {
      setClauses.push(`blood_pressure_diastolic = $${paramIndex++}`);
      values.push(data.diastolic);
    }
    if (data.spo2 !== undefined && data.spo2 !== null) {
      setClauses.push(`spo2 = $${paramIndex++}`);
      values.push(data.spo2);
    }
    if (data.temperature !== undefined && data.temperature !== null) {
      setClauses.push(`body_temperature = $${paramIndex++}`);
      values.push(data.temperature);
    }
    if (data.batteryLevel !== undefined && data.batteryLevel !== null) {
      setClauses.push(`battery_level = $${paramIndex++}`);
      values.push(data.batteryLevel);
    }

    if (setClauses.length === 0) {
      console.warn(`⚠️ [DB] لا توجد قيم لتحديث السطر ${rowId}`);
      return false;
    }

    values.push(rowId);
    const query = `UPDATE health_data SET ${setClauses.join(', ')} WHERE id = $${paramIndex}`;
    
    console.log(`\n💾 [DB] تحديث سطر صحي ID: ${rowId}`);
    console.log(`   HR: ${data.heartRate || '-'}, BP: ${data.systolic || '-'}/${data.diastolic || '-'}, SpO2: ${data.spo2 || '-'}, Temp: ${data.temperature || '-'}`);
    
    await client.query(query, values);
    console.log(`✅ [DB] تم تحديث السطر الصحي - ID: ${rowId}`);
    return true;

  } catch (err) {
    console.error(`❌ [DB] خطأ في تحديث السطر الصحي:`, err.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * ⭐ تحديث last_health_check عند انتهاء الدورة
 */
async function finalizeHealthCycle(imei, rowId) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(imei);
    
    // قراءة بيانات السطر المكتمل
    const healthRow = await client.query('SELECT * FROM health_data WHERE id = $1', [rowId]);
    if (healthRow.rows.length === 0) {
      console.warn(`⚠️ [DB] السطر ${rowId} غير موجود`);
      return false;
    }
    
    const row = healthRow.rows[0];
    
    // UPSERT في last_health_check
    await client.query(`
      INSERT INTO last_health_check (
        device_id, imei, heart_rate, blood_pressure_systolic,
        blood_pressure_diastolic, spo2, body_temperature, 
        battery_level, cycle_health_id, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      ON CONFLICT (imei) DO UPDATE SET
        heart_rate = COALESCE($3, last_health_check.heart_rate),
        blood_pressure_systolic = COALESCE($4, last_health_check.blood_pressure_systolic),
        blood_pressure_diastolic = COALESCE($5, last_health_check.blood_pressure_diastolic),
        spo2 = COALESCE($6, last_health_check.spo2),
        body_temperature = COALESCE($7, last_health_check.body_temperature),
        battery_level = COALESCE($8, last_health_check.battery_level),
        cycle_health_id = $9,
        updated_at = NOW()
    `, [
      deviceId, imei,
      row.heart_rate, row.blood_pressure_systolic,
      row.blood_pressure_diastolic, row.spo2, row.body_temperature,
      row.battery_level, rowId
    ]);

    console.log(`✅ [DB] تم تحديث last_health_check للجهاز ${imei}`);
    console.log(`   HR: ${row.heart_rate || '-'}, BP: ${row.blood_pressure_systolic || '-'}/${row.blood_pressure_diastolic || '-'}, SpO2: ${row.spo2 || '-'}, Temp: ${row.body_temperature || '-'}`);
    return true;

  } catch (err) {
    console.error(`❌ [DB] خطأ في تحديث last_health_check:`, err.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * ⭐ حفظ القياسات الصحية - للاستخدام خارج الدورات (fallback)
 */
async function saveHealthData(data) {
  const client = await pool.connect();
  try {
    console.log(`\n💾 [DB] حفظ قياسات صحية للجهاز ${data.imei}`);
    console.log(`   HR: ${data.heartRate || '-'}, BP: ${data.systolic || '-'}/${data.diastolic || '-'}, SpO2: ${data.spo2 || '-'}, Temp: ${data.temperature || '-'}`);
    
    const deviceId = await getOrCreateDevice(data.imei);

    const result = await client.query(`
      INSERT INTO health_data (
        device_id, imei, timestamp,
        heart_rate, blood_pressure_systolic, 
        blood_pressure_diastolic, spo2, blood_sugar, 
        body_temperature, battery_level
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id
    `, [
      deviceId, 
      data.imei, 
      data.timestamp || new Date(),
      data.heartRate || null,
      data.systolic || null,
      data.diastolic || null, 
      data.spo2 || null, 
      data.bloodSugar || null,
      data.temperature || null, 
      data.batteryLevel || null
    ]);

    const insertedId = result.rows[0].id;
    console.log(`✅ [DB] تم حفظ القياسات الصحية - ID: ${insertedId}`);
    return insertedId;

  } catch (err) {
    console.error(`❌ [DB] خطأ في حفظ القياسات الصحية:`, err.message);
    return null;
  } finally {
    client.release();
  }
}

// دالة لحفظ إنذار
async function saveAlert(data) {
  const client = await pool.connect();
  try {
    console.log(`\n💾 [DB] حفظ إنذار للجهاز ${data.imei} - نوع: ${data.alertType}`);
    
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
    console.log(`✅ [DB] تم حفظ الإنذار - ID: ${insertedId}`);
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

module.exports = {
  pool,
  testConnection,
  initializeDatabase,
  getOrCreateDevice,
  saveLocation,
  saveHealthData,
  createHealthCycleRow,
  updateHealthCycleRow,
  finalizeHealthCycle,
  saveAlert,
  updateDailySteps,
};
