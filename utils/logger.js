const winston = require('winston');
const config = require('../config');

// تعريف الألوان للـ Console
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  debug: 'blue',
};

winston.addColors(colors);

// إنشاء Logger
const logger = winston.createLogger({
  level: config.system.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.printf(({ timestamp, level, message, stack }) => {
      const msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
      return stack ? `${msg}\n${stack}` : msg;
    })
  ),
  transports: [
    // كتابة الأخطاء في ملف منفصل
    new winston.transports.File({ 
      filename: 'logs/error.log', 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    // كتابة كل السجلات في ملف آخر
    new winston.transports.File({ 
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
  ],
});

// في وضع التطوير، اطبع على الـ Console بألوان
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize({ all: true }),
      winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
      winston.format.printf(({ timestamp, level, message }) => {
        return `${timestamp} [${level}]: ${message}`;
      })
    ),
  }));
}

module.exports = logger;
