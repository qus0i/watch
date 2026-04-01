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
  }
};
