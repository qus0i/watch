const { Pool } = require('pg');
const config = require('../config');
const logger = require('../utils/logger');

const pool = new Pool(config.database);

pool.on('error', (err, client) => {
  logger.error('خطأ غير متوقع في قاعدة البيانات:', err);
  console.error('❌ خطأ غير متوقع في قاعدة البيانات:', err);
});

pool.on('connect', () => {
  logger.info('تم الاتصال بقاعدة البيانات بنجاح');
  console.log('✅ تم الاتصال بقاعدة البيانات بنجاح');
});

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

/**
 * ⭐ الحصول على الموقع باستخدام Multiple Cell Towers + WiFi
 * دقة أعلى بكثير من برج واحد!
 */
async function getEnhancedLBSLocation(mcc, mnc, cellTowers, wifiNetworks) {
  try {
    const url = 'https://location.services.mozilla.com/v1/geolocate?key=test';
    
    const requestBody = {
      cellTowers: [],
      wifiAccessPoints: []
    };

    // إضافة كل الأبراج
    if (cellTowers && cellTowers.length > 0) {
      for (const tower of cellTowers) {
        requestBody.cellTowers.push({
          mobileCountryCode: mcc,
          mobileNetworkCode: mnc || 0,
          locationAreaCode: tower.lac,
          cellId: tower.cellId,
          signalStrength: tower.signalStrength ? -(150 - tower.signalStrength) : undefined
        });
      }
    }

    // إضافة كل شبكات WiFi
    if (wifiNetworks && wifiNetworks.length > 0) {
      for (const wifi of wifiNetworks) {
        const cleanMac = wifi.mac.replace(/[│-]/g, ':').toUpperCase();
        requestBody.wifiAccessPoints.push({
          macAddress: cleanMac,
          signalStrength: wifi.signalStrength ? -(150 - wifi.signalStrength) : undefined
        });
      }
    }

    console.log(`\n🔍 تحديد الموقع المحسّن:`);
    console.log(`   📡 ${requestBody.cellTowers.length} أبراج`);
    console.log(`   📶 ${requestBody.wifiAccessPoints.length} شبكات WiFi`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      console.log(`   ⚠️ LBS API error: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.location) {
      const lat = data.location.lat;
      const lng = data.location.lng;
      const accuracy = data.accuracy || 500;

      console.log(`   ✅ تم تحديد الموقع:`);
      console.log(`      📍 ${lat.toFixed(6)}, ${lng.toFixed(6)}`);
      console.log(`      🎯 دقة محسّنة: ~${accuracy} متر\n`);

      logger.info(`📡 Enhanced LBS: ${lat}, ${lng} (accuracy: ${accuracy}m, ${requestBody.cellTowers.length} towers, ${requestBody.wifiAccessPoints.length} wifi)`);

      return {
        latitude: lat,
        longitude: lng,
        accuracy: accuracy,
        source: cellTowers.length > 1 || wifiNetworks.length > 0 ? 'LBS+WiFi' : 'LBS'
      };
    }

    console.log(`   ⚠️ لم يتم العثور على موقع\n`);
    return null;

  } catch (err) {
    logger.error('خطأ في Enhanced LBS:', err.message);
    console.error(`   ❌ خطأ في Enhanced LBS: ${err.message}\n`);
    return null;
  }
}

/**
 * ⭐ حفظ موقع من AP02 (Multiple Bases) - الأدق!
 */
async function saveMultipleBasesLocation(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);

    console.log(`\n📡 معالجة رسالة أبراج متعددة من ${data.imei}`);
    
    const location = await getEnhancedLBSLocation(
      data.mcc,
      data.mnc,
      data.cellTowers,
      data.wifiNetworks
    );

    if (!location) {
      console.log(`❌ فشل تحديد الموقع من الأبراج المتعددة\n`);
      return false;
    }

    await client.query(`
      INSERT INTO locations (
        device_id, imei, timestamp, latitude, longitude,
        gps_valid, mcc, mnc, lac, cell_id, wifi_data,
        location_source, accuracy
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      deviceId,
      data.imei,
      data.timestamp,
      location.latitude,
      location.longitude,
      false,
      data.mcc,
      data.mnc,
      data.cellTowers[0]?.lac || null,
      data.cellTowers[0]?.cellId || null,
      JSON.stringify({ cellTowers: data.cellTowers, wifiNetworks: data.wifiNetworks }),
      location.source,
      location.accuracy
    ]);

    console.log(`✅ تم حفظ موقع محسّن: ${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}\n`);
    logger.info(`📍 تم حفظ موقع محسّن (${data.cellTowers.length} towers, ${data.wifiNetworks.length} wifi)`);
    
    return true;

  } catch (err) {
    logger.error('خطأ في حفظ موقع الأبراج المتعددة:', err.message);
    console.error('❌ خطأ في حفظ موقع الأبراج المتعددة:', err);
    return false;
  } finally {
    client.release();
  }
}

/**
 * حفظ موقع GPS/LBS عادي من AP01
 */
async function saveLocation(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);

    let lat = parseFloat(data.latitude);
    let lng = parseFloat(data.longitude);
    let locationSource = 'GPS';
    let accuracy = null;
    
    const gpsValid = !isNaN(lat) && !isNaN(lng) && !(lat === 0 && lng === 0);

    if (!gpsValid) {
      logger.warn(`⚠️ GPS غير متاح من ${data.imei} - محاولة استخدام LBS...`);
      console.log(`\n⚠️ GPS غير متاح من ${data.imei}`);
      
      const wifiNetworks = [];
      if (data.wifiData && data.wifiData.length > 0) {
        for (const wifi of data.wifiData) {
          wifiNetworks.push({
            ssid: wifi.ssid,
            mac: wifi.mac,
            signalStrength: wifi.signal
          });
        }
      }

      const cellTowers = data.lac && data.cellId ? [{
        lac: data.lac,
        cellId: data.cellId,
        signalStrength: data.gsmSignal
      }] : [];

      if (cellTowers.length > 0 || wifiNetworks.length > 0) {
        const lbsLocation = await getEnhancedLBSLocation(
          data.mcc,
          data.mnc || 0,
          cellTowers,
          wifiNetworks
        );

        if (lbsLocation) {
          lat = lbsLocation.latitude;
          lng = lbsLocation.longitude;
          locationSource = lbsLocation.source;
          accuracy = lbsLocation.accuracy;
          
          console.log(`✅ سيتم استخدام موقع ${locationSource}\n`);
        } else {
          console.log(`❌ لا يمكن تحديد الموقع\n`);
          return false;
        }
      } else {
        console.log(`❌ لا توجد بيانات للموقع\n`);
        return false;
      }
    } else {
      accuracy = 10;
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
      deviceId, data.imei, data.timestamp, lat, lng,
      data.speed, data.direction, gpsValid, data.satelliteCount,
      data.gsmSignal, data.batteryLevel, data.mcc, data.mnc, data.lac,
      data.cellId, JSON.stringify(data.wifiData), data.fortificationState,
      data.workingMode, locationSource, accuracy
    ]);

    logger.info(`📍 تم حفظ موقع ${locationSource} للجهاز ${data.imei}`);
    console.log(`📍 تم حفظ موقع ${locationSource}: ${lat.toFixed(6)}, ${lng.toFixed(6)} (دقة: ~${accuracy}م)\n`);
    return true;

  } catch (err) {
    logger.error('خطأ في حفظ الموقع:', err.message);
    console.error('❌ خطأ في حفظ الموقع:', err);
    return false;
  } finally {
    client.release();
  }
}

async function saveHealthData(data) {
  const client = await pool.connect();
  try {
    const deviceId = await getOrCreateDevice(data.imei);

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
      const measurementId = recentMeasurement.rows[0].id;
      
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
  saveMultipleBasesLocation,
  saveHealthData,
  saveAlert,
  updateDailySteps,
  logCommand,
};
