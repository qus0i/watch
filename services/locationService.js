const https = require('https');
const http = require('http');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * خدمة تحديد الموقع من بيانات الأبراج والـ WiFi
 * تستخدم عدة APIs كـ fallback:
 * 1. OpenCellID (مجاني)
 * 2. OpenCellID مع eNodeB مستخرج (للـ LTE)
 * 3. UnwiredLabs (مجاني محدود)
 * 4. Google Geolocation API (دقيق جداً)
 * 5. Combain (100 طلب مجاني)
 * 6. radiocells.org (مجاني بالكامل)
 */

class LocationService {

  /**
   * تحويل بيانات الأبراج/WiFi إلى إحداثيات
   * يجرب عدة APIs حتى ينجح أحدها
   */
  static async resolveLocation(mcc, mnc, lac, cellId, wifiData = []) {
    // التحقق من صحة البيانات
    if (!mcc || !lac || !cellId) {
      console.log(`⚠️ [LOCATION_SVC] بيانات أبراج غير كافية: MCC=${mcc}, LAC=${lac}, CID=${cellId}`);
      return null;
    }

    const isLTE = cellId > 65535;
    const eNodeBId = isLTE ? Math.floor(cellId / 256) : null;
    const localCellId = isLTE ? cellId % 256 : null;
    
    if (isLTE) {
      console.log(`📡 [LOCATION_SVC] LTE detected: eNodeB=${eNodeBId}, localCell=${localCellId}, fullCID=${cellId}`);
    }

    // ═══ محاولة 1: OpenCellID مع الـ CID الكامل ═══
    try {
      const result = await this.resolveViaOpenCellID(mcc, mnc, lac, cellId, isLTE ? 'lte' : 'gsm');
      if (result) {
        console.log(`✅ [LOCATION_SVC] OpenCellID (full CID): ${result.latitude}, ${result.longitude} (دقة: ${result.accuracy}م)`);
        return result;
      }
    } catch (err) {
      console.log(`⚠️ [LOCATION_SVC] OpenCellID (full CID) خطأ: ${err.message}`);
    }

    // ═══ محاولة 2: OpenCellID مع أنواع radio مختلفة (LTE towers sometimes indexed as UMTS) ═══
    if (isLTE) {
      for (const radio of ['umts', 'gsm']) {
        try {
          const result = await this.resolveViaOpenCellID(mcc, mnc, lac, cellId, radio);
          if (result) {
            console.log(`✅ [LOCATION_SVC] OpenCellID (${radio}): ${result.latitude}, ${result.longitude}`);
            return result;
          }
        } catch (err) {
          // silent - try next
        }
      }
    }

    // ═══ محاولة 3: Google Geolocation API (الأدق) ═══
    try {
      const result = await this.resolveViaGoogle(mcc, mnc, lac, cellId, wifiData);
      if (result) {
        console.log(`✅ [LOCATION_SVC] Google: ${result.latitude}, ${result.longitude} (دقة: ${result.accuracy}م)`);
        return result;
      }
    } catch (err) {
      console.log(`⚠️ [LOCATION_SVC] Google خطأ: ${err.message}`);
    }

    // ═══ محاولة 4: UnwiredLabs API ═══
    try {
      const result = await this.resolveViaUnwiredLabs(mcc, mnc, lac, cellId, wifiData);
      if (result) {
        console.log(`✅ [LOCATION_SVC] UnwiredLabs: ${result.latitude}, ${result.longitude}`);
        return result;
      }
    } catch (err) {
      console.log(`⚠️ [LOCATION_SVC] UnwiredLabs خطأ: ${err.message}`);
    }

    // ═══ محاولة 5: Combain API ═══
    try {
      const result = await this.resolveViaCombain(mcc, mnc, lac, cellId, wifiData);
      if (result) {
        console.log(`✅ [LOCATION_SVC] Combain: ${result.latitude}, ${result.longitude}`);
        return result;
      }
    } catch (err) {
      console.log(`⚠️ [LOCATION_SVC] Combain خطأ: ${err.message}`);
    }

    // ═══ محاولة 6: radiocells.org (مجاني بالكامل بدون API key) ═══
    try {
      const result = await this.resolveViaRadioCells(mcc, mnc, lac, cellId);
      if (result) {
        console.log(`✅ [LOCATION_SVC] RadioCells: ${result.latitude}, ${result.longitude}`);
        return result;
      }
    } catch (err) {
      console.log(`⚠️ [LOCATION_SVC] RadioCells خطأ: ${err.message}`);
    }

    console.log(`⚠️ [LOCATION_SVC] فشلت جميع المحاولات لتحويل الموقع`);
    return null;
  }

  /**
   * OpenCellID API
   */
  static resolveViaOpenCellID(mcc, mnc, lac, cellId, radioType = 'lte') {
    return new Promise((resolve, reject) => {
      const opencellConfig = config.locationServices?.opencellid;
      
      if (!opencellConfig?.enabled || !opencellConfig?.apiToken) {
        return reject(new Error('OpenCellID غير مفعّل أو بدون token'));
      }

      const token = opencellConfig.apiToken;
      const url = `https://opencellid.org/cell/get?key=${token}&mcc=${mcc}&mnc=${mnc}&lac=${lac}&cellid=${cellId}&radio=${radioType}&format=json`;

      console.log(`🌐 [LOCATION_SVC] OpenCellID request: MCC=${mcc}, MNC=${mnc}, LAC=${lac}, CID=${cellId}, radio=${radioType}`);

      const req = https.get(url, { timeout: 10000 }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            if (json.lat && json.lon) {
              resolve({
                latitude: parseFloat(json.lat),
                longitude: parseFloat(json.lon),
                accuracy: json.range || 0,
                source: 'opencellid',
              });
            } else if (json.error) {
              console.log(`⚠️ [LOCATION_SVC] OpenCellID error: ${json.error}`);
              resolve(null);
            } else {
              resolve(null);
            }
          } catch (parseErr) {
            reject(new Error(`فشل تحليل رد OpenCellID: ${parseErr.message}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('OpenCellID timeout'));
      });
    });
  }

  /**
   * Google Geolocation API
   * الأدق والأشمل - يدعم cell towers + WiFi معاً
   * يحتاج Google Maps API key مع تفعيل Geolocation API
   */
  static resolveViaGoogle(mcc, mnc, lac, cellId, wifiData = []) {
    return new Promise((resolve, reject) => {
      const rawKey = config.locationServices?.google?.apiKey || process.env.GOOGLE_GEOLOCATION_KEY;
      
      if (!rawKey) {
        return resolve(null); // skip silently
      }

      // تنظيف المفتاح من أي فراغات أو أحرف غير مرئية
      const apiKey = rawKey.trim().replace(/[^\x20-\x7E]/g, '');

      const isLTE = cellId > 65535;
      
      const requestBody = {
        homeMobileCountryCode: mcc,
        homeMobileNetworkCode: mnc,
        radioType: isLTE ? 'lte' : 'gsm',
        considerIp: false,
        cellTowers: [{
          cellId: cellId,
          locationAreaCode: lac,
          mobileCountryCode: mcc,
          mobileNetworkCode: mnc,
          signalStrength: -60,
        }],
      };

      // إضافة WiFi إذا متوفر
      if (wifiData && wifiData.length > 0) {
        requestBody.wifiAccessPoints = wifiData
          .filter(w => w.mac)
          .map(w => ({
            macAddress: w.mac,
            signalStrength: w.signal ? -Math.abs(w.signal) : -50,
          }));
      }

      const postData = JSON.stringify(requestBody);

      console.log(`🌐 [LOCATION_SVC] Google Geolocation request: MCC=${mcc}, MNC=${mnc}, LAC=${lac}, CID=${cellId}`);

      const encodedKey = encodeURIComponent(apiKey);
      const options = {
        hostname: 'www.googleapis.com',
        port: 443,
        path: `/geolocation/v1/geolocate?key=${encodedKey}`,
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            if (json.location && json.location.lat && json.location.lng) {
              resolve({
                latitude: parseFloat(json.location.lat),
                longitude: parseFloat(json.location.lng),
                accuracy: json.accuracy || 0,
                source: 'google',
              });
            } else {
              if (json.error) {
                console.log(`⚠️ [LOCATION_SVC] Google error: ${json.error.message || JSON.stringify(json.error)}`);
              }
              resolve(null);
            }
          } catch (parseErr) {
            reject(new Error(`فشل تحليل رد Google: ${parseErr.message}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Google Geolocation timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * UnwiredLabs API - Fallback
   * يدعم cell towers و WiFi معاً
   */
  static resolveViaUnwiredLabs(mcc, mnc, lac, cellId, wifiData = []) {
    return new Promise((resolve, reject) => {
      const apiToken = config.locationServices?.unwiredlabs?.apiToken || process.env.UNWIREDLABS_TOKEN;
      
      if (!apiToken) {
        return resolve(null); // skip silently
      }

      const isLTE = cellId > 65535;

      const requestBody = {
        token: apiToken,
        radio: isLTE ? 'lte' : 'gsm',
        mcc: mcc,
        mnc: mnc,
        cells: [{
          lac: lac,
          cid: cellId,
        }],
      };

      // إضافة WiFi إذا متوفر
      if (wifiData && wifiData.length > 0) {
        requestBody.wifi = wifiData
          .filter(w => w.mac)
          .map(w => ({
            bssid: w.mac,
            signal: w.signal ? -Math.abs(w.signal) : -50,
          }));
      }

      const postData = JSON.stringify(requestBody);

      const options = {
        hostname: 'us1.unwiredlabs.com',
        port: 443,
        path: '/v2/process.php',
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            if (json.status === 'ok' && json.lat && json.lon) {
              resolve({
                latitude: parseFloat(json.lat),
                longitude: parseFloat(json.lon),
                accuracy: json.accuracy || 0,
                source: 'unwiredlabs',
              });
            } else {
              resolve(null);
            }
          } catch (parseErr) {
            reject(new Error(`فشل تحليل رد UnwiredLabs: ${parseErr.message}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('UnwiredLabs timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * Combain API
   * 100 طلب مجاني عند التسجيل
   */
  static resolveViaCombain(mcc, mnc, lac, cellId, wifiData = []) {
    return new Promise((resolve, reject) => {
      const apiKey = config.locationServices?.combain?.apiKey || process.env.COMBAIN_API_KEY;
      
      if (!apiKey) {
        return resolve(null); // skip silently
      }

      const isLTE = cellId > 65535;

      const requestBody = {
        cellTowers: [{
          mobileCountryCode: mcc,
          mobileNetworkCode: mnc,
          locationAreaCode: lac,
          cellId: cellId,
          radioType: isLTE ? 'lte' : 'gsm',
        }],
      };

      // إضافة WiFi
      if (wifiData && wifiData.length > 0) {
        requestBody.wifiAccessPoints = wifiData
          .filter(w => w.mac)
          .map(w => ({
            macAddress: w.mac,
            signalStrength: w.signal ? -Math.abs(w.signal) : -50,
          }));
      }

      const postData = JSON.stringify(requestBody);

      const options = {
        hostname: 'apiv2.combain.com',
        port: 443,
        path: `/v2/search?key=${apiKey}`,
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            if (json.location && json.location.lat && json.location.lng) {
              resolve({
                latitude: parseFloat(json.location.lat),
                longitude: parseFloat(json.location.lng),
                accuracy: json.accuracy || 0,
                source: 'combain',
              });
            } else {
              resolve(null);
            }
          } catch (parseErr) {
            reject(new Error(`فشل تحليل رد Combain: ${parseErr.message}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Combain timeout'));
      });

      req.write(postData);
      req.end();
    });
  }

  /**
   * radiocells.org API
   * مجاني بالكامل - بدون API key
   */
  static resolveViaRadioCells(mcc, mnc, lac, cellId) {
    return new Promise((resolve, reject) => {
      const isLTE = cellId > 65535;

      const requestBody = {
        cellTowers: [{
          mobileCountryCode: mcc,
          mobileNetworkCode: mnc,
          locationAreaCode: lac,
          cellId: cellId,
          radioType: isLTE ? 'lte' : 'gsm',
        }],
      };

      const postData = JSON.stringify(requestBody);

      const options = {
        hostname: 'radiocells.org',
        port: 443,
        path: '/geolocation',
        method: 'POST',
        timeout: 10000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            
            if (json.location && json.location.lat && json.location.lng) {
              resolve({
                latitude: parseFloat(json.location.lat),
                longitude: parseFloat(json.location.lng),
                accuracy: json.accuracy || 0,
                source: 'radiocells',
              });
            } else {
              resolve(null);
            }
          } catch (parseErr) {
            reject(new Error(`فشل تحليل رد RadioCells: ${parseErr.message}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('RadioCells timeout'));
      });

      req.write(postData);
      req.end();
    });
  }
}

module.exports = LocationService;
