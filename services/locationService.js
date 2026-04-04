const https = require('https');
const http = require('http');
const config = require('../config');
const logger = require('../utils/logger');

/**
 * خدمة تحديد الموقع من بيانات الأبراج والـ WiFi
 * تستخدم OpenCellID API لتحويل MCC/MNC/LAC/CellID إلى إحداثيات
 */

class LocationService {

  /**
   * تحويل بيانات الأبراج/WiFi إلى إحداثيات
   * @param {number} mcc - Mobile Country Code
   * @param {number} mnc - Mobile Network Code
   * @param {number} lac - Location Area Code
   * @param {number} cellId - Cell Tower ID
   * @param {Array} wifiData - بيانات WiFi (اختياري)
   * @returns {object|null} - { latitude, longitude, accuracy } أو null
   */
  static async resolveLocation(mcc, mnc, lac, cellId, wifiData = []) {
    // التحقق من صحة البيانات
    if (!mcc || !lac || !cellId) {
      console.log(`⚠️ [LOCATION_SVC] بيانات أبراج غير كافية: MCC=${mcc}, LAC=${lac}, CID=${cellId}`);
      return null;
    }

    // محاولة 1: OpenCellID API
    try {
      const result = await this.resolveViaOpenCellID(mcc, mnc, lac, cellId);
      if (result) {
        console.log(`✅ [LOCATION_SVC] OpenCellID: نجح - ${result.latitude}, ${result.longitude} (دقة: ${result.accuracy}م)`);
        return result;
      }
    } catch (err) {
      console.error(`❌ [LOCATION_SVC] OpenCellID خطأ: ${err.message}`);
    }

    // محاولة 2: UnwiredLabs API (fallback مجاني)
    try {
      const result = await this.resolveViaUnwiredLabs(mcc, mnc, lac, cellId, wifiData);
      if (result) {
        console.log(`✅ [LOCATION_SVC] UnwiredLabs: نجح - ${result.latitude}, ${result.longitude}`);
        return result;
      }
    } catch (err) {
      console.error(`❌ [LOCATION_SVC] UnwiredLabs خطأ: ${err.message}`);
    }

    console.log(`⚠️ [LOCATION_SVC] فشلت جميع المحاولات لتحويل الموقع`);
    return null;
  }

  /**
   * OpenCellID API
   * مجاني - يحتاج API token
   */
  static resolveViaOpenCellID(mcc, mnc, lac, cellId) {
    return new Promise((resolve, reject) => {
      const opencellConfig = config.locationServices?.opencellid;
      
      if (!opencellConfig?.enabled || !opencellConfig?.apiToken) {
        return reject(new Error('OpenCellID غير مفعّل أو بدون token'));
      }

      const token = opencellConfig.apiToken;
      
      // ⭐ Cell IDs > 65535 are LTE (4G) towers - need radio=lte parameter
      const radioType = cellId > 65535 ? 'lte' : 'gsm';
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
              console.log(`⚠️ [LOCATION_SVC] OpenCellID: برج غير موجود في القاعدة`);
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
   * UnwiredLabs API - Fallback
   * يدعم cell towers و WiFi معاً
   */
  static resolveViaUnwiredLabs(mcc, mnc, lac, cellId, wifiData = []) {
    return new Promise((resolve, reject) => {
      const apiToken = config.locationServices?.unwiredlabs?.apiToken || process.env.UNWIREDLABS_TOKEN;
      
      if (!apiToken) {
        return resolve(null); // لا يوجد token - skip بدون خطأ
      }

      const requestBody = {
        token: apiToken,
        radio: 'gsm',
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
            signal: w.signal || -50,
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
}

module.exports = LocationService;
