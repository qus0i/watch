# 📡 GPS Watch Server - سيرفر ساعة GPS الذكية

نظام متكامل لاستقبال ومعالجة بيانات ساعات GPS الذكية عبر بروتوكول TCP.

## 🎯 المميزات

- ✅ استقبال بيانات GPS (موقع، سرعة، اتجاه)
- ✅ استقبال القياسات الصحية (نبض، ضغط دم، حرارة، أكسجين)
- ✅ معالجة الإنذارات (SOS، وقوع، خلع الساعة)
- ✅ تتبع الخطوات اليومية
- ✅ دعم بيانات LBS و WIFI للتحديد الدقيق
- ✅ قاعدة بيانات PostgreSQL كاملة
- ✅ نظام Logging محترف
- ✅ إرسال أوامر للساعة (موقع فوري، تشغيل القياسات، إعدادات)

## 📋 المتطلبات

- Node.js >= 14.x
- PostgreSQL >= 12.x
- npm أو yarn

## 🚀 التثبيت والإعداد

### 1. تثبيت الـ Dependencies

```bash
npm install
```

### 2. إعداد قاعدة البيانات

**إنشاء قاعدة البيانات:**
```bash
# الدخول إلى PostgreSQL
sudo -u postgres psql

# إنشاء القاعدة
CREATE DATABASE gps_watch_db;
CREATE USER your_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE gps_watch_db TO your_user;
\q
```

**تهيئة الجداول:**
```bash
npm run init-db
```

### 3. إعداد البيئة

انسخ ملف `.env.example` إلى `.env` وعدّل القيم:

```bash
cp .env.example .env
nano .env
```

عدّل القيم التالية:
```env
# إعدادات السيرفر
SERVER_HOST=0.0.0.0
SERVER_PORT=5088

# إعدادات قاعدة البيانات
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gps_watch_db
DB_USER=your_user
DB_PASSWORD=your_secure_password

# إعدادات النظام
TIMEZONE=3          # للأردن +3
LOG_LEVEL=info
DEBUG=false
```

### 4. تشغيل السيرفر

**للتطوير (مع Auto-restart):**
```bash
npm run dev
```

**للإنتاج:**
```bash
npm start
```

## 🔧 إعداد الساعة

### ضبط عنوان السيرفر

أرسل SMS للساعة:
```
#host#=your-server.com,5088#
```

أو إذا عندك IP ثابت:
```
#ip#=198.123.45.67,5088#
```

### ضبط APN (حسب مشغل الشبكة)

**مثال لزين الأردن:**
```
#apn#=416,77,zain,zain,zain,zain,PAP#
```

**مثال لأورانج الأردن:**
```
#apn#=416,77,internet,internet,,,PAP#
```

### التحقق من الإعدادات

```
#status#
```

ستستقبل رسالة تحتوي على:
- IMEI
- APN
- عنوان السيرفر
- مستوى البطارية
- إصدار البرنامج

## 📊 هيكل قاعدة البيانات

### الجداول الرئيسية

**devices** - الأجهزة المُسجلة
- معلومات الجهاز (IMEI، SIM، مستخدم)
- تاريخ التسجيل وآخر اتصال

**locations** - سجل المواقع
- إحداثيات GPS
- بيانات LBS و WIFI
- السرعة والاتجاه
- حالة البطارية

**health_data** - القياسات الصحية
- نبض القلب
- ضغط الدم
- حرارة الجسم
- نسبة الأكسجين (SPO2)
- سكر الدم

**alerts** - الإنذارات
- SOS
- وقوع (Fall Detection)
- خلع الساعة

**daily_steps** - الخطوات اليومية
- عدد الخطوات
- تكرار الحركة

### Views الجاهزة

- `latest_locations` - آخر موقع لكل جهاز
- `latest_health_data` - آخر قياسات صحية
- `unhandled_alerts` - الإنذارات غير المُعالجة

## 🎮 أمثلة استخدام

### إرسال أوامر للساعة

```javascript
const server = require('./server');
const ProtocolBuilder = require('./protocol/builder');

// طلب موقع فوري
const imei = '353456789012345';
const command = ProtocolBuilder.buildLocationRequest(imei);
server.sendCommandToDevice(imei, command);

// تفعيل قياس النبض
const heartRateCmd = ProtocolBuilder.buildHeartRateTestCommand(imei);
server.sendCommandToDevice(imei, heartRateCmd);

// ضبط أرقام SOS
const sosCmd = ProtocolBuilder.buildSetSOSCommand(
  imei, 
  null, 
  ['+962791234567', '+962791234568', '+962791234569']
);
server.sendCommandToDevice(imei, sosCmd);

// تغيير وضع العمل
// 1: عادي (15 دقيقة)
// 2: توفير طاقة (60 دقيقة)
// 3: طوارئ (1 دقيقة)
const modeCmd = ProtocolBuilder.buildSetWorkingModeCommand(imei, null, 1);
server.sendCommandToDevice(imei, modeCmd);
```

### الاستعلام عن البيانات

```javascript
const { pool } = require('./database/db');

// أحدث موقع لجهاز معين
const result = await pool.query(`
  SELECT * FROM latest_locations 
  WHERE imei = $1
`, ['353456789012345']);

// القياسات الصحية لآخر 24 ساعة
const health = await pool.query(`
  SELECT * FROM health_data 
  WHERE imei = $1 
  AND timestamp > NOW() - INTERVAL '24 hours'
  ORDER BY timestamp DESC
`, ['353456789012345']);

// الإنذارات غير المُعالجة
const alerts = await pool.query(`
  SELECT * FROM unhandled_alerts
  ORDER BY timestamp DESC
`);
```

## 📁 هيكل المشروع

```
gps-watch-server/
├── server.js                  # TCP Server الرئيسي
├── config.js                  # ملف الإعدادات
├── package.json              
├── .env                       # المتغيرات البيئية
├── protocol/
│   ├── parser.js             # تحليل الرسائل الواردة
│   └── builder.js            # بناء رسائل الرد
├── handlers/
│   └── messageHandlers.js    # معالجات الرسائل
├── database/
│   ├── schema.sql            # هيكل قاعدة البيانات
│   ├── db.js                 # Connection Pool
│   └── init-db.js            # سكريبت التهيئة
├── utils/
│   └── logger.js             # نظام التسجيل
└── logs/
    ├── error.log             # سجل الأخطاء
    └── combined.log          # السجل الكامل
```

## 🔒 الأمان

- استخدم HTTPS/TLS للاتصالات في الإنتاج
- غيّر كلمات المرور الافتراضية
- فعّل Firewall وافتح Port 5088 فقط
- استخدم VPN أو IP Whitelisting للوصول للسيرفر
- احفظ نسخ احتياطية من قاعدة البيانات بانتظام

## 🐛 استكشاف الأخطاء

### الساعة لا تتصل

1. تأكد من إعدادات APN صحيحة
2. تحقق من رصيد البيانات على الـ SIM
3. تأكد من Port 5088 مفتوح على الـ Firewall
4. راجع ملف `logs/error.log`

### قاعدة البيانات لا تتصل

```bash
# اختبار الاتصال
psql -h localhost -U your_user -d gps_watch_db

# تحقق من الخدمة
sudo systemctl status postgresql
```

### رسائل غير مفهومة

فعّل الـ Debug Mode:
```env
DEBUG=true
LOG_LEVEL=debug
```

## 📚 البروتوكول

### أنواع الرسائل من الساعة

| الأمر | الوصف |
|------|-------|
| AP00 | تسجيل دخول |
| AP01 | موقع GPS + LBS + WIFI |
| AP03 | Heartbeat (نبضة قلب النظام) |
| AP10 | إنذار + موقع |
| AP49 | قياس النبض |
| APHT | نبض + ضغط دم |
| APHP | قياسات كاملة |
| AP50 | حرارة الجسم |

### أوامر من السيرفر للساعة

| الأمر | الوصف |
|------|-------|
| BP16 | طلب موقع فوري |
| BPXL | قياس النبض |
| BPXY | قياس الضغط |
| BPXT | قياس الحرارة |
| BP12 | ضبط أرقام SOS |
| BP33 | تغيير وضع العمل |
| BP76 | تفعيل كشف الوقوع |

## 🤝 المساهمة

المشروع مفتوح المصدر. يمكنك:
- الإبلاغ عن الأخطاء
- اقتراح ميزات جديدة
- تحسين الكود

## 📝 الترخيص

MIT License

## 👨‍💻 المطور

Qusai Kanaan - Data Engineer @ Alpha Pro Consulting

---

**ملاحظة:** هذا السيرفر جاهز للاستخدام في بيئة الإنتاج، لكن يُنصح بإضافة:
- نظام مصادقة (Authentication)
- واجهة REST API
- Dashboard ويب
- نظام إشعارات (Push/SMS/Email)
- Monitoring و Metrics
