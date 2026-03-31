const config = require('../config');

/**
 * بناء رسائل الرد للساعة
 * يُنشئ الردود المناسبة حسب بروتوكول الساعة
 */

class ProtocolBuilder {

  /**
   * بناء رد تسجيل الدخول (BP00)
   * @returns {string} - الرسالة الكاملة
   */
  static buildLoginResponse() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hour = String(now.getUTCHours()).padStart(2, '0');
    const minute = String(now.getUTCMinutes()).padStart(2, '0');
    const second = String(now.getUTCSeconds()).padStart(2, '0');
    
    const timeStr = `${year}${month}${day}${hour}${minute}${second}`;
    const timezone = config.system.timezone;
    
    return `IWBP00,${timeStr},${timezone}#`;
  }

  /**
   * بناء رد الموقع (BP01)
   */
  static buildLocationResponse() {
    return 'IWBP01#';
  }

  /**
   * بناء رد Heartbeat (BP03)
   */
  static buildHeartbeatResponse() {
    return 'IWBP03#';
  }

  /**
   * بناء رد الإنذار (BP10)
   * @param {boolean} needAddress - هل يحتاج عنوان
   * @param {string} address - العنوان (اختياري)
   */
  static buildAlarmResponse(needAddress = false, address = null) {
    if (!needAddress || !address) {
      return 'IWBP10#';
    }
    
    // تحويل العنوان إلى UNICODE
    const unicodeAddress = this.stringToUnicode(address);
    return `IWBP10${unicodeAddress}#`;
  }

  /**
   * بناء رد قياس النبض (BP49)
   */
  static buildHeartRateResponse() {
    return 'IWBP49#';
  }

  /**
   * بناء رد النبض والضغط (BPHT)
   */
  static buildHeartRateBPResponse() {
    return 'IWBPHT#';
  }

  /**
   * بناء رد القياسات الكاملة (BPHP)
   */
  static buildFullHealthResponse() {
    return 'IWBPHP#';
  }

  /**
   * بناء رد الحرارة (BP50)
   */
  static buildTemperatureResponse() {
    return 'IWBP50#';
  }

  /**
   * بناء رد أبراج متعددة (BP02)
   */
  static buildMultipleBasesResponse() {
    return 'IWBP02#';
  }

  /**
   * أوامر من السيرفر للساعة
   */

  /**
   * طلب موقع فوري (BP16)
   * @param {string} imei - رقم IMEI
   * @param {string} journalNo - رقم السجل
   */
  static buildLocationRequest(imei, journalNo = null) {
    if (!journalNo) {
      journalNo = this.generateJournalNo();
    }
    return `IWBP16,${imei},${journalNo}#`;
  }

  /**
   * تفعيل قياس النبض (BPXL)
   * @param {string} imei
   * @param {string} journalNo
   */
  static buildHeartRateTestCommand(imei, journalNo = null) {
    if (!journalNo) journalNo = this.generateJournalNo();
    return `IWBPXL,${imei},${journalNo}#`;
  }

  /**
   * تفعيل قياس الضغط (BPXY)
   */
  static buildBloodPressureTestCommand(imei, journalNo = null) {
    if (!journalNo) journalNo = this.generateJournalNo();
    return `IWBPXY,${imei},${journalNo}#`;
  }

  /**
   * تفعيل قياس الحرارة (BPXT)
   */
  static buildTemperatureTestCommand(imei, journalNo = null) {
    if (!journalNo) journalNo = this.generateJournalNo();
    return `IWBPXT,${imei},${journalNo}#`;
  }

  /**
   * تفعيل قياس الأكسجين (BPXZ)
   */
  static buildOxygenTestCommand(imei, journalNo = null) {
    if (!journalNo) journalNo = this.generateJournalNo();
    return `IWBPXZ,${imei},${journalNo}#`;
  }

  /**
   * ضبط أرقام SOS (BP12)
   * @param {string} imei
   * @param {string} journalNo
   * @param {Array<string>} numbers - مصفوفة من 3 أرقام
   */
  static buildSetSOSCommand(imei, journalNo, numbers) {
    if (!journalNo) journalNo = this.generateJournalNo();
    
    // تأكد من وجود 3 أرقام (أو فراغات)
    while (numbers.length < 3) numbers.push('');
    
    return `IWBP12,${imei},${journalNo},${numbers[0]},${numbers[1]},${numbers[2]}#`;
  }

  /**
   * ضبط وضع العمل (BP33)
   * @param {string} imei
   * @param {string} journalNo
   * @param {number} mode - 1: عادي، 2: توفير طاقة، 3: طوارئ
   */
  static buildSetWorkingModeCommand(imei, journalNo, mode) {
    if (!journalNo) journalNo = this.generateJournalNo();
    return `IWBP33,${imei},${journalNo},${mode}#`;
  }

  /**
   * ضبط المنطقة الزمنية (BP20)
   */
  static buildSetTimezoneCommand(imei, journalNo, timezone) {
    if (!journalNo) journalNo = this.generateJournalNo();
    return `IWBP20,${imei},${journalNo},0,${timezone}#`;
  }

  /**
   * تشغيل/إيقاف كشف الوقوع (BP76)
   * @param {boolean} enable - true للتفعيل
   */
  static buildFallDetectionCommand(imei, journalNo, enable) {
    if (!journalNo) journalNo = this.generateJournalNo();
    const value = enable ? 1 : 0;
    return `IWBP76,${imei},${journalNo},${value}#`;
  }

  /**
   * ضبط حساسية كشف الوقوع (BP77)
   * @param {number} level - 1، 2، أو 3 (3 الأكثر حساسية)
   */
  static buildFallSensitivityCommand(imei, journalNo, level) {
    if (!journalNo) journalNo = this.generateJournalNo();
    return `IWBP77,${imei},${journalNo},${level}#`;
  }

  /**
   * ضبط فترة قياس النبض التلقائي (BP86)
   * @param {boolean} enable
   * @param {number} intervalMinutes
   */
  static buildHeartRateIntervalCommand(imei, journalNo, enable, intervalMinutes) {
    if (!journalNo) journalNo = this.generateJournalNo();
    const flag = enable ? 1 : 0;
    return `IWBP86,${imei},${journalNo},${flag},${intervalMinutes}#`;
  }

  /**
   * إعادة ضبط المصنع (BP17)
   */
  static buildFactoryResetCommand(imei, journalNo) {
    if (!journalNo) journalNo = this.generateJournalNo();
    return `IWBP17,${imei},${journalNo}#`;
  }

  /**
   * إيقاف التشغيل (BP31)
   */
  static buildPowerOffCommand(imei, journalNo) {
    if (!journalNo) journalNo = this.generateJournalNo();
    return `IWBP31,${imei},${journalNo}#`;
  }

  /**
   * دوال مساعدة
   */

  // توليد رقم سجل Journal Number
  static generateJournalNo() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    return `${month}${day}${hour}${minute}${second}`;
  }

  // تحويل نص إلى UNICODE
  static stringToUnicode(str) {
    let unicode = '';
    for (let i = 0; i < str.length; i++) {
      const hex = str.charCodeAt(i).toString(16).padStart(4, '0');
      unicode += hex;
    }
    return unicode.toUpperCase();
  }
}

module.exports = ProtocolBuilder;
