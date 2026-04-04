require('dotenv').config();

module.exports = {
  // إعدادات الـ TCP Server
  server: {
    host: process.env.SERVER_HOST || '0.0.0.0',
    port: process.env.SERVER_PORT || 5088,
    keepAliveInterval: 30000, // 30 ثانية
  },

  // إعدادات قاعدة البيانات
  database: process.env.DATABASE_URL ? {
    // إذا في DATABASE_URL من Railway، استخدمه مباشرة
    connectionString: process.env.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  } : {
    // وإلا استخدم المتغيرات المنفصلة
    host: process.env.PGHOST || process.env.DB_HOST || 'localhost',
    port: process.env.PGPORT || process.env.DB_PORT || 5432,
    database: process.env.PGDATABASE || process.env.DB_NAME || 'gps_watch_db',
    user: process.env.PGUSER || process.env.DB_USER || 'postgres',
    password: process.env.PGPASSWORD || process.env.DB_PASSWORD || 'postgres',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  },

  // إعدادات النظام
  system: {
    timezone: process.env.TIMEZONE || 3, // المنطقة الزمنية (للأردن +3)
    logLevel: process.env.LOG_LEVEL || 'info',
    enableDebug: process.env.DEBUG === 'true',
  },

  // ⭐ إعدادات القياسات الصحية الدورية (جديد)
  healthMonitoring: {
    // تفعيل/تعطيل النظام بالكامل
    enabled: process.env.HEALTH_MONITORING_ENABLED !== 'false', // true افتراضياً
    
    // الفاصل الزمني بين كل جولة قياسات (بالدقائق)
    intervalMinutes: parseInt(process.env.HEALTH_MONITORING_INTERVAL) || 5,
    
    // أنواع القياسات المطلوبة
    measurements: {
      location: process.env.REQUEST_LOCATION !== 'false',           // طلب الموقع (true افتراضياً)
      bloodPressure: process.env.MEASURE_BLOOD_PRESSURE !== 'false', // قياس الضغط + النبض معاً (true افتراضياً)
      temperature: process.env.MEASURE_TEMPERATURE !== 'false',     // قياس الحرارة (true افتراضياً)
      bloodOxygen: process.env.MEASURE_BLOOD_OXYGEN !== 'false',    // قياس الأكسجين (true افتراضياً)
    },
    
    // ⭐ التأخير بين كل أمر قياس (بالثواني)
    // ⚠️ IMPORTANT: القياسات الطبية تاخذ 30-60 ثانية لإتمامها!
    // لو التأخير قصير → الساعة ترسل 0,0,0 (قياسات غير مكتملة)
    delayBetweenCommands: parseInt(process.env.DELAY_BETWEEN_COMMANDS) || 60,
  },

  // ⭐ إعدادات خدمات تحديد الموقع (محسّن - عدة مصادر كـ fallback)
  locationServices: {
    // المصدر 1: OpenCellID API (مجاني - crowdsourced)
    opencellid: {
      enabled: true,
      apiToken: process.env.OPENCELLID_TOKEN || 'pk.d85c81393cf2681894a4076dd87a04c7',
      apiUrl: 'https://opencellid.org/cell/get',
    },

    // المصدر 2: Google Geolocation API (الأدق - يحتاج API key)
    // أنشئ مفتاح: https://console.cloud.google.com/apis/credentials
    // فعّل: Geolocation API
    // مجاني: أول 40,000 طلب/شهر
    google: {
      apiKey: process.env.GOOGLE_GEOLOCATION_KEY || '',
    },

    // المصدر 3: UnwiredLabs (مجاني محدود)
    // سجّل: https://unwiredlabs.com/
    unwiredlabs: {
      apiToken: process.env.UNWIREDLABS_TOKEN || '',
    },

    // المصدر 4: Combain (100 طلب مجاني)
    // سجّل: https://portal.combain.com/
    combain: {
      apiKey: process.env.COMBAIN_API_KEY || '',
    },

    // المصدر 5: radiocells.org (مجاني بالكامل بدون API key)
    // لا يحتاج إعدادات
  }
};
