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

// دالة لحفظ موقع GPS
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
 * ⭐ حفظ القياسات الصحية - مُصلح مع timestamp صريح
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
    logger.info(`تم حفظ قياسات صحية للجهاز ${data.imei} (HR: ${data.heartRate || '-'}, BP: ${data.systolic || '-'}/${data.diastolic || '-'})`);
    return true;

  } catch (err) {
    console.error(`❌ [DB] خطأ في حفظ القياسات الصحية:`, err.message);
    console.error(`   Error Code: ${err.code}`);
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

/**
 * ⭐ Upsert صحي - دورة القياسات
 * إذا cycleId = null → INSERT سطر جديد وإرجاع الـ ID
 * إذا cycleId موجود → UPDATE السطر نفسه بالقيم الجديدة فقط (بدون مسح القديمة)
 */
async function upsertHealthData(data, cycleId = null) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);

    if (!cycleId) {
      // ═══ INSERT سطر جديد (أول قياس بالدورة) ═══
      console.log(`\n💾 [DB] ═══ دورة صحية جديدة للجهاز ${data.imei} ═══`);
      console.log(`   INSERT: HR=${data.heartRate || '-'}, BP=${data.systolic || '-'}/${data.diastolic || '-'}, SpO2=${data.spo2 || '-'}, Temp=${data.temperature || '-'}`);

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

      const newId = result.rows[0].id;
      console.log(`✅ [DB] سطر صحي جديد - ID: ${newId}`);
      logger.info(`دورة صحية جديدة للجهاز ${data.imei} - ID: ${newId}`);
      return newId;

    } else {
      // ═══ UPDATE السطر الموجود (قياسات إضافية بنفس الدورة) ═══
      console.log(`\n💾 [DB] تحديث سطر صحي #${cycleId} للجهاز ${data.imei}`);
      
      // بناء UPDATE ديناميكي - فقط الحقول اللي فيها قيم
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (data.heartRate !== undefined && data.heartRate !== null) {
        updates.push(`heart_rate = $${paramIndex++}`);
        values.push(data.heartRate);
      }
      if (data.systolic !== undefined && data.systolic !== null) {
        updates.push(`blood_pressure_systolic = $${paramIndex++}`);
        values.push(data.systolic);
      }
      if (data.diastolic !== undefined && data.diastolic !== null) {
        updates.push(`blood_pressure_diastolic = $${paramIndex++}`);
        values.push(data.diastolic);
      }
      if (data.spo2 !== undefined && data.spo2 !== null) {
        updates.push(`spo2 = $${paramIndex++}`);
        values.push(data.spo2);
      }
      if (data.bloodSugar !== undefined && data.bloodSugar !== null) {
        updates.push(`blood_sugar = $${paramIndex++}`);
        values.push(data.bloodSugar);
      }
      if (data.temperature !== undefined && data.temperature !== null) {
        updates.push(`body_temperature = $${paramIndex++}`);
        values.push(data.temperature);
      }
      if (data.batteryLevel !== undefined && data.batteryLevel !== null) {
        updates.push(`battery_level = $${paramIndex++}`);
        values.push(data.batteryLevel);
      }

      if (updates.length === 0) {
        console.log(`⚠️ [DB] لا يوجد قيم لتحديثها بالسطر #${cycleId}`);
        return cycleId;
      }

      values.push(cycleId);
      const query = `UPDATE health_data SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
      
      console.log(`   UPDATE fields: ${updates.join(', ')}`);
      await client.query(query, values);
      
      console.log(`✅ [DB] تم تحديث السطر الصحي #${cycleId}`);
      logger.info(`تحديث دورة صحية #${cycleId} للجهاز ${data.imei}`);
      return cycleId;
    }

  } catch (err) {
    console.error(`❌ [DB] خطأ في upsertHealthData:`, err.message);
    console.error(`   Error Code: ${err.code}`);
    logger.error('خطأ في upsertHealthData:', err.message);
    return cycleId; // إرجاع الـ cycleId الحالي حتى لو فشل
  } finally {
    client.release();
  }
}

/**
 * ⭐ تحديث موقع موجود بالإحداثيات (لدورة الموقع)
 */
async function updateLocationById(locationId, latitude, longitude) {
  const client = await pool.connect();
  try {
    console.log(`\n💾 [DB] تحديث موقع #${locationId} → lat=${latitude}, lng=${longitude}`);
    
    await client.query(
      `UPDATE locations SET latitude = $1, longitude = $2 WHERE id = $3`,
      [latitude, longitude, locationId]
    );
    
    console.log(`✅ [DB] تم تحديث الموقع #${locationId}`);
    return true;
  } catch (err) {
    console.error(`❌ [DB] خطأ في تحديث الموقع #${locationId}:`, err.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * ⭐ حفظ موقع جديد وإرجاع الـ ID
 */
async function saveLocationReturningId(data) {
  const client = await pool.connect();
  try {
    console.log(`\n💾 [DB] حفظ موقع جديد للجهاز ${data.imei}`);
    console.log(`   GPS Valid: ${data.gpsValid}, Lat: ${data.latitude}, Lng: ${data.longitude}`);
    
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
    logger.info(`تم حفظ موقع للجهاز ${data.imei} - ID: ${insertedId}`);
    return insertedId;

  } catch (err) {
    console.error(`❌ [DB] خطأ في حفظ الموقع:`, err.message);
    logger.error('خطأ في حفظ الموقع:', err.message);
    return null;
  } finally {
    client.release();
  }
}

// ═══════════════════════════════════════════════════════════════
// v2 helpers (Health Watch JSON/TCP) — additive only.
// ما تلمس الدوال القديمة فوق — هذي دوال موازية تستخدم نفس الجداول
// مع watch_type='health_v2'.
// ═══════════════════════════════════════════════════════════════

/**
 * Get or create a v2 device. سيوسم بـ watch_type='health_v2'.
 * إذا الـ IMEI موجود مسبقاً (سواء قديم أو جديد)، نُحدّث آخر اتصال
 * ولا نُغيّر الـ watch_type لو كان iw_legacy → health_v2 (ما نخرّب أجهزة قائمة).
 */
async function getOrCreateDeviceV2(imei, deviceModel = null, extras = {}) {
  const client = await pool.connect();
  try {
    let result = await client.query(
      'SELECT id, watch_type FROM devices WHERE imei = $1',
      [imei]
    );

    if (result.rows.length > 0) {
      const id = result.rows[0].id;
      const currentType = result.rows[0].watch_type;

      // حدّث المعلومات الأساسية والمتاحة فقط
      const sets = ['last_connection = NOW()'];
      const values = [];
      let i = 1;

      // إذا الجهاز جديد (مفيش watch_type أو 'iw_legacy' افتراضي وما لُقي بقاعدة قديمة)،
      // نوسمه health_v2 فقط لو كان NULL أو ما تعيّن صراحة.
      if (!currentType || currentType === 'iw_legacy') {
        // خلّي iw_legacy على حالها لو كانت الساعة قديمة فعلاً.
        // لكن لو سجّلت دخول عبر v2 protocol فالغالب هي v2 — نحدّثها.
        sets.push(`watch_type = $${i++}`);
        values.push('health_v2');
      }
      if (deviceModel) {
        sets.push(`device_model = $${i++}`);
        values.push(deviceModel);
      }
      if (extras.firmwareV !== undefined) {
        sets.push(`firmware_v = $${i++}`);
        values.push(extras.firmwareV);
      }
      if (extras.batteryLevel !== undefined && extras.batteryLevel !== null) {
        sets.push(`battery_level = $${i++}`);
        values.push(extras.batteryLevel);
      }
      if (extras.batteryState !== undefined && extras.batteryState !== null) {
        sets.push(`battery_state = $${i++}`);
        values.push(extras.batteryState);
      }
      if (extras.bindStatus !== undefined && extras.bindStatus !== null) {
        sets.push(`bind_status = $${i++}`);
        values.push(extras.bindStatus);
      }

      values.push(imei);
      await client.query(
        `UPDATE devices SET ${sets.join(', ')} WHERE imei = $${i}`,
        values
      );
      return id;
    }

    // إنشاء جهاز جديد بـ watch_type='health_v2'
    const insertCols = ['imei', 'last_connection', 'watch_type'];
    const insertVals = ['$1', 'NOW()', '$2'];
    const params = [imei, 'health_v2'];
    let p = 3;

    if (deviceModel) {
      insertCols.push('device_model'); insertVals.push(`$${p++}`); params.push(deviceModel);
    }
    if (extras.firmwareV !== undefined) {
      insertCols.push('firmware_v'); insertVals.push(`$${p++}`); params.push(extras.firmwareV);
    }
    if (extras.batteryLevel !== undefined && extras.batteryLevel !== null) {
      insertCols.push('battery_level'); insertVals.push(`$${p++}`); params.push(extras.batteryLevel);
    }
    if (extras.batteryState !== undefined && extras.batteryState !== null) {
      insertCols.push('battery_state'); insertVals.push(`$${p++}`); params.push(extras.batteryState);
    }
    if (extras.bindStatus !== undefined && extras.bindStatus !== null) {
      insertCols.push('bind_status'); insertVals.push(`$${p++}`); params.push(extras.bindStatus);
    }

    const insertSql = `INSERT INTO devices (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')}) RETURNING id`;
    const inserted = await client.query(insertSql, params);

    const newId = inserted.rows[0].id;
    console.log(`✅ [DB-v2] جهاز جديد (health_v2) imei=${imei} id=${newId}`);
    logger.info(`v2 device registered imei=${imei} id=${newId}`);
    return newId;
  } finally {
    client.release();
  }
}

/**
 * تحديث heartbeat fields على الجهاز.
 */
async function updateDeviceHeartbeatV2(imei, batteryLevel, batteryState) {
  const client = await pool.connect();
  try {
    const sets = ['last_heartbeat = NOW()', 'last_connection = NOW()'];
    const values = [];
    let i = 1;
    if (batteryLevel !== undefined && batteryLevel !== null) {
      sets.push(`battery_level = $${i++}`); values.push(batteryLevel);
    }
    if (batteryState !== undefined && batteryState !== null) {
      sets.push(`battery_state = $${i++}`); values.push(batteryState);
    }
    values.push(imei);
    await client.query(
      `UPDATE devices SET ${sets.join(', ')} WHERE imei = $${i}`,
      values
    );
    return true;
  } catch (err) {
    console.error('❌ [DB-v2] updateDeviceHeartbeatV2:', err.message);
    return false;
  } finally {
    client.release();
  }
}

/**
 * حفظ قياسة صحية v2 — تستخدم نفس جدول health_data القديم.
 *
 * @param {string} imei
 * @param {object} fields — heartRate, systolic, diastolic, spo2, bloodSugar, temperature, batteryLevel
 * @param {Date}   [timestamp]
 */
async function saveHealthDataV2(imei, fields, timestamp = null) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDeviceV2(imei);
    const result = await client.query(
      `INSERT INTO health_data (
         device_id, imei, timestamp,
         heart_rate, blood_pressure_systolic,
         blood_pressure_diastolic, spo2, blood_sugar,
         body_temperature, battery_level
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        deviceId,
        imei,
        timestamp || new Date(),
        fields.heartRate ?? null,
        fields.systolic ?? null,
        fields.diastolic ?? null,
        fields.spo2 ?? null,
        fields.bloodSugar ?? null,
        fields.temperature ?? null,
        fields.batteryLevel ?? null,
      ]
    );
    const id = result.rows[0].id;
    console.log(
      `💾 [DB-v2] health_data #${id} imei=${imei} ` +
      `HR=${fields.heartRate ?? '-'} BP=${fields.systolic ?? '-'}/${fields.diastolic ?? '-'} ` +
      `SpO2=${fields.spo2 ?? '-'} T=${fields.temperature ?? '-'}`
    );
    return id;
  } catch (err) {
    console.error('❌ [DB-v2] saveHealthDataV2:', err.message);
    logger.error('v2 saveHealthData error:', err.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * حفظ موقع v2 — تستخدم نفس جدول locations القديم.
 *
 * @param {string} imei
 * @param {object} payload — gps:{lat,lon,height,satelliteNum,GSM}, baseStation:[...], wifi:[...]
 * @param {Date}   [timestamp]
 */
async function saveLocationV2(imei, payload, timestamp = null) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDeviceV2(imei);

    const gps = payload.gps || null;
    const lat = gps && gps.lat !== undefined ? parseFloat(gps.lat) : 0;
    const lon = gps && gps.lon !== undefined ? parseFloat(gps.lon) : 0;
    const satCount = gps && gps.satelliteNum !== undefined ? parseInt(gps.satelliteNum, 10) : 0;
    const gsm = gps && gps.GSM !== undefined ? parseInt(gps.GSM, 10) : 0;
    const gpsValid = !!(gps && Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0));

    // أول base station لو موجود
    let mcc = 0, mnc = 0, lac = 0, cellId = 0;
    if (Array.isArray(payload.baseStation) && payload.baseStation.length > 0) {
      const bs = payload.baseStation[0];
      mcc = bs.mcc ?? 0;
      mnc = bs.mnc ?? 0;
      lac = bs.lac ?? 0;
      cellId = bs.ci ?? bs.cellId ?? 0;
    }

    const result = await client.query(
      `INSERT INTO locations (
         device_id, imei, timestamp, latitude, longitude, speed, direction,
         gps_valid, satellite_count, gsm_signal, battery_level,
         mcc, mnc, lac, cell_id, wifi_data,
         fortification_state, working_mode
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        deviceId,
        imei,
        timestamp || new Date(),
        Number.isFinite(lat) ? lat : 0,
        Number.isFinite(lon) ? lon : 0,
        0, // speed (not provided in upLocation envelope)
        0, // direction
        gpsValid,
        satCount,
        gsm,
        payload.batteryLevel ?? 0,
        mcc, mnc, lac, cellId,
        JSON.stringify(payload.wifi || payload.Wifi || []),
        0, // fortificationState
        0, // workingMode
      ]
    );
    const id = result.rows[0].id;
    console.log(
      `💾 [DB-v2] location #${id} imei=${imei} ${gpsValid ? `${lat.toFixed(6)},${lon.toFixed(6)}` : 'no-gps'}`
    );
    return id;
  } catch (err) {
    console.error('❌ [DB-v2] saveLocationV2:', err.message);
    logger.error('v2 saveLocation error:', err.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * حفظ activity (run/walk/sleep/...) — في جدول v2_activity الجديد.
 */
async function saveActivityV2(imei, activityType, payload) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDeviceV2(imei);

    const startMs = payload.startTime ? Number(payload.startTime) : null;
    const endMs = payload.endTime ? Number(payload.endTime) : null;
    const startTs = startMs ? new Date(startMs) : null;
    const endTs = endMs ? new Date(endMs) : null;

    const duration = payload.exerciseTime ? parseInt(payload.exerciseTime, 10) : null;
    const consumed = payload.consumed ? parseInt(payload.consumed, 10) : null;
    const mileage = payload.mileage ? parseFloat(payload.mileage) : null;
    const stepCount = payload.Steps && payload.Steps.stepNumber
      ? parseInt(payload.Steps.stepNumber, 10)
      : (payload.step ? parseInt(payload.step, 10) : null);

    const result = await client.query(
      `INSERT INTO v2_activity (
         device_id, imei, activity_type,
         start_time, end_time, duration_seconds,
         consumed_kcal, mileage_km, step_count, payload
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        deviceId, imei, activityType,
        startTs, endTs, duration,
        consumed, mileage, stepCount,
        JSON.stringify(payload),
      ]
    );
    const id = result.rows[0].id;
    console.log(`💾 [DB-v2] activity #${id} type=${activityType} imei=${imei}`);
    return id;
  } catch (err) {
    console.error('❌ [DB-v2] saveActivityV2:', err.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * حفظ device config (upDeviceConfig).
 */
async function saveDeviceConfigV2(imei, configs) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDeviceV2(imei);
    const result = await client.query(
      `INSERT INTO v2_device_configs (device_id, imei, configs)
       VALUES ($1, $2, $3) RETURNING id`,
      [deviceId, imei, JSON.stringify(configs || {})]
    );
    return result.rows[0].id;
  } catch (err) {
    console.error('❌ [DB-v2] saveDeviceConfigV2:', err.message);
    return null;
  } finally {
    client.release();
  }
}

/**
 * Log raw v2 message (in/out) للتشخيص.
 */
async function logV2Message(direction, imei, msgType, ident, ref, payload) {
  // Fire-and-forget — ما نوقف على فشله
  pool
    .query(
      `INSERT INTO v2_message_log (direction, imei, msg_type, ident, ref, payload)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [direction, imei || null, msgType || null, ident || null, ref || null, JSON.stringify(payload || {})]
    )
    .catch((err) => {
      // في حال الجدول لسى ما اتعمل، اسكت بدل ما نزعج اللوقز
      if (!String(err.message).includes('relation "v2_message_log"')) {
        console.error('⚠️ [DB-v2] logV2Message:', err.message);
      }
    });
}

/**
 * Track pending request (sent from server) للـ ident matching لاحقاً.
 */
async function trackPendingV2Request(imei, ident, requestType, payload) {
  try {
    await pool.query(
      `INSERT INTO v2_pending_requests (imei, ident, request_type, payload)
       VALUES ($1,$2,$3,$4)`,
      [imei, ident, requestType, JSON.stringify(payload || {})]
    );
  } catch (err) {
    console.error('⚠️ [DB-v2] trackPendingV2Request:', err.message);
  }
}

/**
 * Mark pending request as responded.
 */
async function markPendingV2Responded(imei, ident) {
  try {
    await pool.query(
      `UPDATE v2_pending_requests SET responded_at = NOW()
       WHERE imei = $1 AND ident = $2 AND responded_at IS NULL`,
      [imei, ident]
    );
  } catch (err) {
    console.error('⚠️ [DB-v2] markPendingV2Responded:', err.message);
  }
}

module.exports = {
  pool,
  testConnection,
  initializeDatabase,
  getOrCreateDevice,
  saveLocation,
  saveHealthData,
  saveAlert,
  updateDailySteps,
  upsertHealthData,
  updateLocationById,
  saveLocationReturningId,
  // v2 helpers (additive)
  getOrCreateDeviceV2,
  updateDeviceHeartbeatV2,
  saveHealthDataV2,
  saveLocationV2,
  saveActivityV2,
  saveDeviceConfigV2,
  logV2Message,
  trackPendingV2Request,
  markPendingV2Responded,
};
