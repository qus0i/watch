const https = require('https');
const http = require('http');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * خدمة تحديد الموقع من بيانات الأبراج والـ WiFi
 * تستخدم عدة APIs كـ fallback:
 * 1. ⭐ Google Geolocation API (الأدق - الأولوية الأولى)
 * 2. UnwiredLabs (cell + WiFi)
 * 3. OpenCellID (مجاني)
 * 4. Combain
 * 5. WiFi-only عبر UnwiredLabs
 * 6. radiocells.org (مجاني بالكامل)
 */

class LocationService {

  /**
   * تحويل بيانات الأبراج/WiFi إلى إحداثيات
   * يجرب عدة APIs حتى ينجح أحدها
   * ⭐ Google أولاً لأنه الأدق
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

    console.log(`🔍 [LOCATION_SVC] بدء تحديد الموقع: MCC=${mcc}, MNC=${mnc}, LAC=${lac}, CID=${cellId}, WiFi=${wifiData.length} networks`);

    // ═══ محاولة 1: ⭐ Google Geolocation API (الأدق والأشمل) ═══
    try {
      console.log(`🌐 [LOCATION_SVC] ═══ محاولة 1: Google Geolocation API ═══`);
      const result = await this.resolveViaGoogle(mcc, mnc, lac, cellId, wifiData);
      if (result) {
        console.log(`✅ [LOCATION_SVC] ✨ Google نجح! ${result.latitude}, ${result.longitude} (دقة: ${result.accuracy}م)`);
        return result;
      } else {
        console.log(`⚠️ [LOCATION_SVC] Google لم يرجع نتيجة`);
      }
    } catch (err) {
      console.log(`⚠️ [LOCATION_SVC] Google خطأ: ${err.message}`);
    }

    // ═══ محاولة 2: UnwiredLabs API (cell + WiFi) ═══
    try {
      console.log(`🌐 [LOCATION_SVC] ═══ محاولة 2: UnwiredLabs ═══`);
      const result = await this.resolveViaUnwiredLabs(mcc, mnc, lac, cellId, wifiData);
      if (result) {
        console.log(`✅ [LOCATION_SVC] UnwiredLabs: ${result.latitude}, ${result.longitude}`);
        return result;
      }
    } catch (err) {
      console.log(`⚠️ [LOCATION_SVC] UnwiredLabs خطأ: ${err.message}`);
    }

    // ═══ محاولة 3: OpenCellID مع الـ CID الكامل ═══
    try {
      console.log(`🌐 [LOCATION_SVC] ═══ محاولة 3: OpenCellID (full CID) ═══`);
      const result = await this.resolveViaOpenCellID(mcc, mnc, lac, cellId, isLTE ? 'lte' : 'gsm');
      if (result) {
        console.log(`✅ [LOCATION_SVC] OpenCellID (full CID): ${result.latitude}, ${result.longitude} (دقة: ${result.accuracy}م)`);
        return result;
      }
    } catch (err) {
      console.log(`⚠️ [LOCATION_SVC] OpenCellID (full CID) خطأ: ${err.message}`);
    }

    // ═══ محاولة 4: OpenCellID مع أنواع radio مختلفة ═══
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

    // ═══ محاولة 5: OpenCellID مع eNodeB ID ═══
    if (isLTE && eNodeBId) {
      try {
        console.log(`🌐 [LOCATION_SVC] OpenCellID (eNodeB): trying CID=${eNodeBId} instead of ${cellId}`);
        const result = await this.resolveViaOpenCellID(mcc, mnc, lac, eNodeBId, 'lte');
        if (result) {
          console.log(`✅ [LOCATION_SVC] OpenCellID (eNodeB): ${result.latitude}, ${result.longitude}`);
          return result;
        }
      } catch (err) {
        // silent
      }
    }

    // ═══ محاولة 6: UnwiredLabs مع eNodeB ID ═══
    if (isLTE && eNodeBId) {
      try {
        console.log(`🌐 [LOCATION_SVC] UnwiredLabs (eNodeB): trying CID=${eNodeBId}`);
        const result = await this.resolveViaUnwiredLabs(mcc, mnc, lac, eNodeBId, wifiData);
        if (result) {
          console.log(`✅ [LOCATION_SVC] UnwiredLabs (eNodeB): ${result.latitude}, ${result.longitude}`);
          return result;
        }
      } catch (err) {
        console.log(`⚠️ [LOCATION_SVC] UnwiredLabs (eNodeB) خطأ: ${err.message}`);
      }
    }

    // ═══ محاولة 7: WiFi-only عبر UnwiredLabs ═══
    if (wifiData && wifiData.length > 0) {
      try {
        console.log(`📶 [LOCATION_SVC] WiFi-only positioning: ${wifiData.length} networks`);
        const result = await this.resolveViaWifiOnly(wifiData);
        if (result) {
          console.log(`✅ [LOCATION_SVC] WiFi-only: ${result.latitude}, ${result.longitude} (دقة: ${result.accuracy}م)`);
          return result;
        }
      } catch (err) {
        console.log(`⚠️ [LOCATION_SVC] WiFi-only خطأ: ${err.message}`);
      }
    }

    // ═══ محاولة 8: Combain API ═══
    try {
      const result = await this.resolveViaCombain(mcc, mnc, lac, cellId, wifiData);
      if (result) {
        console.log(`✅ [LOCATION_SVC] Combain: ${result.latitude}, ${result.longitude}`);
        return result;
      }
    } catch (err) {
      console.log(`⚠️ [LOCATION_SVC] Combain خطأ: ${err.message}`);
    }

    console.log(`❌ [LOCATION_SVC] فشلت جميع المحاولات لتحويل الموقع (8 محاولات)`);
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
   * ⭐ Google Geolocation API
   * الأدق والأشمل - يدعم cell towers + WiFi معاً
   * يحتاج Google Maps API key مع تفعيل Geolocation API
   */
  static resolveViaGoogle(mcc, mnc, lac, cellId, wifiData = []) {
    return new Promise((resolve, reject) => {
      const rawKey = config.locationServices?.google?.apiKey || process.env.GOOGLE_GEOLOCATION_KEY;
      
      // ⭐ تحقق مفصّل من المفتاح
      if (!rawKey || rawKey.trim() === '') {
        console.log(`❌ [GOOGLE] لا يوجد API key! تأكد من ضبط GOOGLE_GEOLOCATION_KEY`);
        console.log(`   config value: "${config.locationServices?.google?.apiKey || 'EMPTY'}"`);
        console.log(`   env value: "${process.env.GOOGLE_GEOLOCATION_KEY ? 'SET (' + process.env.GOOGLE_GEOLOCATION_KEY.substring(0, 10) + '...)' : 'NOT SET'}"`);
        return resolve(null);
      }

      // تنظيف المفتاح من أي فراغات أو أحرف غير مرئية
      const apiKey = rawKey.trim().replace(/[^\x20-\x7E]/g, '');
      
      console.log(`🔑 [GOOGLE] API Key: ${apiKey.substring(0, 10)}...${apiKey.substring(apiKey.length - 4)} (length: ${apiKey.length})`);

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
        console.log(`📶 [GOOGLE] WiFi networks added: ${requestBody.wifiAccessPoints.length}`);
      }

      const postData = JSON.stringify(requestBody);

      console.log(`🌐 [GOOGLE] Request: MCC=${mcc}, MNC=${mnc}, LAC=${lac}, CID=${cellId}, radio=${isLTE ? 'lte' : 'gsm'}`);
      console.log(`📦 [GOOGLE] Body: ${postData}`);

      const options = {
        hostname: 'www.googleapis.com',
        port: 443,
        path: `/geolocation/v1/geolocate?key=${apiKey}`,
        method: 'POST',
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      console.log(`🌐 [GOOGLE] URL: https://${options.hostname}${options.path.replace(apiKey, apiKey.substring(0, 10) + '...')}`);

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            console.log(`📨 [GOOGLE] Response status: ${res.statusCode}`);
            console.log(`📨 [GOOGLE] Response body: ${data}`);

            const json = JSON.parse(data);
            
            if (json.location && json.location.lat && json.location.lng) {
              console.log(`✅ [GOOGLE] نجح! lat=${json.location.lat}, lng=${json.location.lng}, accuracy=${json.accuracy}م`);
              resolve({
                latitude: parseFloat(json.location.lat),
                longitude: parseFloat(json.location.lng),
                accuracy: json.accuracy || 0,
                source: 'google',
              });
            } else if (json.error) {
              console.log(`❌ [GOOGLE] API Error:`);
              console.log(`   Code: ${json.error.code}`);
              console.log(`   Message: ${json.error.message}`);
              console.log(`   Status: ${json.error.status}`);
              if (json.error.errors) {
                json.error.errors.forEach((e, i) => {
                  console.log(`   Error ${i}: domain=${e.domain}, reason=${e.reason}, message=${e.message}`);
                });
              }
              resolve(null);
            } else {
              console.log(`⚠️ [GOOGLE] رد غير متوقع: ${data}`);
              resolve(null);
            }
          } catch (parseErr) {
            console.log(`❌ [GOOGLE] فشل تحليل الرد: ${parseErr.message}`);
            console.log(`   Raw data: ${data.substring(0, 500)}`);
            reject(new Error(`فشل تحليل رد Google: ${parseErr.message}`));
          }
        });
      });

      req.on('error', (err) => {
        console.log(`❌ [GOOGLE] Network error: ${err.message}`);
        reject(err);
      });
      req.on('timeout', () => {
        console.log(`❌ [GOOGLE] Timeout after 15 seconds`);
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
        console.log(`⚠️ [LOCATION_SVC] UnwiredLabs: لا يوجد token - تخطي`);
        return resolve(null);
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

      console.log(`🌐 [LOCATION_SVC] UnwiredLabs request: MCC=${mcc}, MNC=${mnc}, LAC=${lac}, CID=${cellId}, radio=${isLTE ? 'lte' : 'gsm'}`);

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
            console.log(`📡 [LOCATION_SVC] UnwiredLabs response: status=${json.status}, lat=${json.lat}, lon=${json.lon}, message=${json.message || 'none'}`);
            
            if (json.status === 'ok' && json.lat && json.lon) {
              resolve({
                latitude: parseFloat(json.lat),
                longitude: parseFloat(json.lon),
                accuracy: json.accuracy || 0,
                source: 'unwiredlabs',
              });
            } else {
              console.log(`⚠️ [LOCATION_SVC] UnwiredLabs: ${json.message || json.status || 'no data'}`);
              resolve(null);
            }
          } catch (parseErr) {
            console.log(`❌ [LOCATION_SVC] UnwiredLabs parse error: ${parseErr.message}, raw: ${data.substring(0, 200)}`);
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

  /**
   * WiFi-only positioning عبر UnwiredLabs
   * يستخدم بيانات WiFi فقط (بدون cell towers)
   */
  static resolveViaWifiOnly(wifiData) {
    return new Promise((resolve, reject) => {
      const apiToken = config.locationServices?.unwiredlabs?.apiToken || process.env.UNWIREDLABS_TOKEN;
      
      if (!apiToken) {
        console.log(`⚠️ [LOCATION_SVC] WiFi-only: لا يوجد UnwiredLabs token`);
        return resolve(null);
      }

      if (!wifiData || wifiData.length === 0) {
        return resolve(null);
      }

      const wifiNetworks = wifiData
        .filter(w => w.mac)
        .map(w => ({
          bssid: w.mac,
          signal: w.signal ? -Math.abs(w.signal) : -50,
        }));

      if (wifiNetworks.length === 0) {
        return resolve(null);
      }

      const requestBody = {
        token: apiToken,
        wifi: wifiNetworks,
        address: 1,
      };

      const postData = JSON.stringify(requestBody);

      console.log(`📶 [LOCATION_SVC] WiFi-only request: ${wifiNetworks.length} networks, MACs: ${wifiNetworks.map(w => w.bssid).join(', ')}`);

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
            console.log(`📶 [LOCATION_SVC] WiFi-only response: status=${json.status}, lat=${json.lat}, lon=${json.lon}, address=${json.address || 'none'}`);
            
            if (json.status === 'ok' && json.lat && json.lon) {
              resolve({
                latitude: parseFloat(json.lat),
                longitude: parseFloat(json.lon),
                accuracy: json.accuracy || 0,
                source: 'wifi-unwiredlabs',
              });
            } else {
              console.log(`⚠️ [LOCATION_SVC] WiFi-only: ${json.message || 'no matches'}`);
              resolve(null);
            }
          } catch (parseErr) {
            console.log(`❌ [LOCATION_SVC] WiFi-only parse error: ${parseErr.message}`);
            reject(new Error(`WiFi-only parse error: ${parseErr.message}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('WiFi-only timeout'));
      });

      req.write(postData);
      req.end();
    });
  }
}

module.exports = LocationService;
