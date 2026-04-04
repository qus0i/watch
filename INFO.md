# 📡 GPS Watch Server - معلومات المشروع الكاملة

> **تاريخ آخر تحديث:** 3 أبريل 2026  
> **المطور:** Qusai Kanaan  
> **المنصة:** Railway (Node.js + PostgreSQL)

---

## 🎯 الفكرة والهدف من المشروع

### الهدف الرئيسي:
بناء نظام متكامل لاستقبال ومعالجة وتخزين بيانات ساعات GPS الذكية الصحية عبر بروتوكول TCP، مع إمكانية:
- تتبع المواقع الجغرافية (GPS + LBS)
- مراقبة القياسات الصحية (نبض، ضغط دم، حرارة، أكسجين)
- إدارة الإنذارات (SOS، وقوع، خلع الساعة)
- التحكم بالساعات عن بُعد

### حالة الاستخدام:
- مراقبة كبار السن
- تتبع الأطفال
- المراقبة الصحية عن بُعد
- أنظمة الطوارئ والسلامة

---

## 🏗️ المعمارية التقنية (Architecture)

```
┌─────────────────┐
│  GPS Watches    │ ← أجهزة ساعات GPS (شرائح Umniah 4G)
└────────┬────────┘
         │ TCP Connection
         │ (IW Protocol Messages)
         ▼
┌─────────────────────────────────────┐
│   Railway Platform                  │
│  ┌───────────────────────────────┐  │
│  │  TCP Proxy                    │  │
│  │  gondola.proxy.rlwy.net:15769 │  │
│  └──────────┬────────────────────┘  │
│             │                        │
│             ▼                        │
│  ┌───────────────────────────────┐  │
│  │  Node.js TCP Server           │  │
│  │  - Protocol Parser            │  │
│  │  - Message Handlers           │  │
│  │  - Periodic Measurements      │  │
│  │  Port: 5088 (internal)        │  │
│  └──────────┬────────────────────┘  │
│             │                        │
│             ▼                        │
│  ┌───────────────────────────────┐  │
│  │  PostgreSQL Database          │  │
│  │  - devices, locations         │  │
│  │  - health_data, alerts        │  │
│  └───────────────────────────────┘  │
└─────────────────────────────────────┘
         │
         ▼
   Future: Web Dashboard
   (React + Google Maps)
```

### المكونات الرئيسية:

1. **TCP Server (Node.js)**
   - استقبال اتصالات الساعات
   - تحليل الرسائل (Protocol Parsing)
   - معالجة البيانات
   - إرسال الأوامر للساعات

2. **PostgreSQL Database**
   - تخزين بيانات الأجهزة
   - سجل المواقع (GPS/LBS)
   - القياسات الصحية
   - الإنذارات

3. **Railway Platform**
   - استضافة السيرفر
   - إدارة قاعدة البيانات
   - TCP Proxy للاتصالات الخارجية

---

## 📋 البروتوكول المستخدم (IW Protocol)

### هيكل الرسالة الأساسي:
```
IW[COMMAND][DATA]#
```

### أنواع الرسائل من الساعة للسيرفر (AP):

| الأمر | الوصف | مثال |
|------|-------|------|
| **AP00** | تسجيل دخول (Login) | `IWAP00861265063710922#` |
| **AP01** | موقع GPS كامل | `IWAP01080524A2232.9806N11404.9355E...#` |
| **AP02** | موقع LBS (أبراج الشبكة) | `IWAP02,zh_cn,0,1,416,3,34102\|36303392\|23...#` |
| **AP03** | نبضة قلب النظام (Heartbeat) | `IWAP03,06000908000102,5555,30#` |
| **AP10** | إنذار + موقع | `IWAP10...01...#` (01=SOS) |
| **AP49** | قياس النبض | `IWAP49,68#` |
| **APHT** | نبض + ضغط دم | `IWAPHT,60,130,85#` |
| **APHP** | قياسات كاملة | `IWAPHP,60,130,85,95,90...#` |
| **AP50** | حرارة الجسم | `IWAP50,36.7,90#` |

### أوامر من السيرفر للساعة (BP):

| الأمر | الوصف | مثال |
|------|-------|------|
| **BP00** | رد تسجيل الدخول | `IWBP00,20260403123456,3#` |
| **BP16** | طلب موقع فوري | `IWBP16,IMEI,123456#` |
| **BPXL** | قياس النبض | `IWBPXL,IMEI,123456#` |
| **BPXY** | قياس الضغط | `IWBPXY,IMEI,123456#` |
| **BPXT** | قياس الحرارة | `IWBPXT,IMEI,123456#` |
| **BPXZ** | قياس الأكسجين | `IWBPXZ,IMEI,123456#` |
| **BP12** | ضبط أرقام SOS | `IWBP12,IMEI,123456,NUM1,NUM2,NUM3#` |
| **BP33** | تغيير وضع العمل | `IWBP33,IMEI,123456,1#` |
| **BP84** | تفعيل/إيقاف NOT_WEAR | `IWBP84,IMEI,123456,0#` |

### مثال تدفق الاتصال:
```
1. Watch → Server: IWAP00861265063710922#
2. Server → Watch: IWBP00,20260403123456,3#
3. Watch → Server: IWAP02,zh_cn,0,1,416,3,34102|36303392|23...#
4. Server → Watch: IWBP02#
5. Server → Watch: IWBPXL,861265063710922,123456#
6. Watch → Server: IWAPXL,123456#
7. Watch → Server: IWAP49,72#
8. Server → Watch: IWBP49#
```

---

## 🗄️ قاعدة البيانات (PostgreSQL Schema)

### الجداول الرئيسية:

#### 1. **devices** - الأجهزة المسجلة
```sql
- id (SERIAL PRIMARY KEY)
- imei (VARCHAR(15) UNIQUE) ← رقم الجهاز الفريد
- sim_number (VARCHAR(20))
- user_name (VARCHAR(100))
- user_phone (VARCHAR(20))
- registration_date (TIMESTAMP)
- last_connection (TIMESTAMP)
- is_active (BOOLEAN)
```

#### 2. **locations** - سجل المواقع
```sql
- id (SERIAL PRIMARY KEY)
- device_id (INTEGER → devices.id)
- imei (VARCHAR(15))
- timestamp (TIMESTAMP)
- latitude (DECIMAL) ← خط العرض
- longitude (DECIMAL) ← خط الطول
- speed (DECIMAL)
- direction (DECIMAL)
- gps_valid (BOOLEAN) ← GPS صحيح أو LBS
- satellite_count (INTEGER)
- gsm_signal (INTEGER)
- battery_level (INTEGER)
- mcc (INTEGER) ← Mobile Country Code
- mnc (INTEGER) ← Mobile Network Code
- lac (INTEGER) ← Location Area Code
- cell_id (INTEGER) ← Cell Tower ID
- wifi_data (JSONB) ← بيانات الـ WiFi
```

#### 3. **health_data** - القياسات الصحية
```sql
- id (SERIAL PRIMARY KEY)
- device_id (INTEGER → devices.id)
- imei (VARCHAR(15))
- timestamp (TIMESTAMP)
- heart_rate (INTEGER) ← نبض القلب (bpm)
- blood_pressure_systolic (INTEGER) ← ضغط انقباضي
- blood_pressure_diastolic (INTEGER) ← ضغط انبساطي
- spo2 (INTEGER) ← نسبة الأكسجين (%)
- blood_sugar (INTEGER) ← سكر الدم
- body_temperature (DECIMAL) ← حرارة الجسم (°C)
```

#### 4. **alerts** - الإنذارات
```sql
- id (SERIAL PRIMARY KEY)
- device_id (INTEGER → devices.id)
- imei (VARCHAR(15))
- timestamp (TIMESTAMP)
- alert_type (VARCHAR) ← SOS, FALL_DOWN, NOT_WEAR
- latitude (DECIMAL)
- longitude (DECIMAL)
- is_handled (BOOLEAN)
```

#### 5. **daily_steps** - الخطوات اليومية
```sql
- id (SERIAL PRIMARY KEY)
- device_id (INTEGER → devices.id)
- date (DATE)
- step_count (INTEGER)
- roll_frequency (INTEGER)
```

### Views (الاستعلامات الجاهزة):

```sql
-- آخر موقع لكل جهاز
CREATE VIEW latest_locations AS ...

-- آخر قياسات صحية لكل جهاز
CREATE VIEW latest_health_data AS ...

-- الإنذارات غير المعالجة
CREATE VIEW unhandled_alerts AS ...
```

---

## 📁 هيكل الملفات والمسؤوليات

```
gps-watch-server/
│
├── server.js                    ← TCP Server الرئيسي
│   ├── إدارة الاتصالات
│   ├── معالجة الرسائل الواردة
│   ├── تتبع الأجهزة المتصلة
│   └── Graceful shutdown
│
├── config.js                    ← إعدادات النظام
│   ├── معلومات السيرفر (host, port)
│   ├── اتصال قاعدة البيانات
│   └── المنطقة الزمنية
│
├── protocol/
│   ├── parser.js                ← تحليل رسائل الساعة
│   │   ├── parseLoginPacket()
│   │   ├── parseLocationPacket()
│   │   ├── parseHeartRatePacket()
│   │   └── convertCoordinate()
│   │
│   └── builder.js               ← بناء رسائل الرد
│       ├── buildLoginResponse()
│       ├── buildLocationRequest()
│       ├── buildHeartRateTestCommand()
│       └── generateJournalNo()
│
├── handlers/
│   └── messageHandlers.js       ← معالجة الرسائل
│       ├── handleLogin()
│       ├── handleLocation()
│       ├── handleMultipleBases()
│       ├── handleHeartRate()
│       ├── handleFullHealth()
│       └── startPeriodicMeasurements()
│
├── database/
│   ├── schema.sql               ← هيكل قاعدة البيانات
│   ├── init-db.js               ← تهيئة القاعدة
│   └── db.js                    ← دوال التخزين والاستعلام
│       ├── saveLocation()
│       ├── saveHealthData()
│       ├── saveAlert()
│       └── getOrCreateDevice()
│
├── utils/
│   └── logger.js                ← نظام التسجيل (Winston)
│
└── cli.js                       ← أداة سطر الأوامر
    └── إرسال أوامر يدوية للساعات
```

---

## 🔄 كيفية العمل (Data Flow)

### 1. **تسجيل الدخول والاتصال الأولي:**

```
1. الساعة تتصل بـ TCP Server (gondola.proxy.rlwy.net:15769)
2. Server يقبل الاتصال ويحفظ socket
3. الساعة ترسل AP00 (Login) مع IMEI
4. Server يحفظ/يحدث الجهاز في جدول devices
5. Server يرسل BP00 مع الوقت والمنطقة الزمنية
6. Server يبدأ نظام القياسات الدورية
```

### 2. **القياسات الدورية (Periodic Measurements):**

```
كل 5 دقائق:
├── إرسال BPXL (طلب نبض)
│   └── انتظار 2 ثانية
├── إرسال BPXY (طلب ضغط)
│   └── انتظار 2 ثانية
├── إرسال BPXT (طلب حرارة)
│   └── انتظار 2 ثانية
├── إرسال BPXZ (طلب أكسجين)
│   └── انتظار 2 ثانية
└── إرسال BP16 (طلب موقع)
```

### 3. **معالجة بيانات الموقع:**

#### موقع GPS (AP01):
```
1. الساعة ترسل AP01 مع إحداثيات GPS كاملة
2. Parser يحول إحداثيات NMEA إلى Decimal
3. Handler يحفظ في جدول locations
4. gps_valid = true
5. latitude/longitude تكون قيم حقيقية
```

#### موقع LBS (AP02):
```
1. الساعة ترسل AP02 مع MCC, MNC, LAC, Cell ID
2. Parser يستخرج بيانات الأبراج
3. Handler يحفظ في جدول locations
4. gps_valid = false
5. latitude/longitude = 0 (يمكن تحويلها لاحقاً عبر OpenCellID)
```

### 4. **معالجة القياسات الصحية:**

```
1. السيرفر يرسل أمر قياس (BPXL/BPXY/BPXT/BPXZ)
2. الساعة ترد بـ acknowledgment (APXL/APXY/APXT/APXZ)
3. الساعة تقوم بالقياس
4. الساعة ترسل النتيجة (AP49/APHT/APHP/AP50)
5. Handler يتحقق من صحة القيم:
   - نبض: 0-200 bpm
   - ضغط: 0-250 mmHg
   - أكسجين: 0-100%
   - حرارة: 30-45°C
6. Handler يحفظ القيم الصحيحة في health_data
7. القيم الخاطئة (0, NULL, NaN) يتم تجاهلها
```

### 5. **معالجة الإنذارات:**

```
1. الساعة ترسل AP10 مع نوع الإنذار
2. Handler يحفظ الموقع في locations
3. Handler يحفظ الإنذار في alerts (is_handled = false)
4. Logger يسجل تحذير
5. TODO: إرسال إشعار للمستخدم (Push/SMS/Email)
```

---

## 🔧 المشاكل التي تم حلها

### المشكلة 1: اتصال قاعدة البيانات
**المشكلة:** السيرفر لا يتصل بـ PostgreSQL  
**السبب:** استخدام متغيرات قديمة (DB_HOST, DB_USER) بدلاً من DATABASE_URL  
**الحل:** تحديث config.js لاستخدام DATABASE_URL من Railway مباشرة

### المشكلة 2: TCP Proxy Port Mismatch
**المشكلة:** الساعة لا تتصل رغم صحة العنوان  
**السبب:** Railway TCP Proxy كان موجّه لـ port 12345 بدلاً من 5088  
**الحل:** إعادة ضبط TCP Proxy: internal 5088 → external 15769

### المشكلة 3: Schema Initialization Failures
**المشكلة:** فشل التهيئة عند إعادة Deploy  
**السبب:** أخطاء "already exists" عند تشغيل init-db.js  
**الحل:** إضافة try-catch في init-db.js لتجاهل الأخطاء

### المشكلة 4: تحليل رسائل LBS خاطئ
**المشكلة:** MCC, MNC, LAC, Cell ID غير صحيحة  
**السبب:** استخدام Array indices خاطئة بعد split(',')  
**الحل:** 
```javascript
// قبل:
const mcc = parseInt(parts[3]); // خطأ
// بعد:
const mcc = parseInt(parts[4]); // صح
```

### المشكلة 5: NOT_WEAR Sensor يمنع القياسات
**المشكلة:** كل القياسات الصحية = 0 أو NULL  
**السبب:** سنسور "عدم اللبس" مفعّل  
**الحل:** إضافة أمر تلقائي لتعطيل NOT_WEAR عند تسجيل الدخول:
```javascript
const notWearCmd = `IWBP84,${imei},${journalNo},0#`;
socket.write(notWearCmd);
```

### المشكلة 6: حفظ قيم خاطئة في Database
**المشكلة:** حفظ قيم 0, NULL, NaN في القياسات  
**السبب:** عدم التحقق من صحة القيم قبل الحفظ  
**الحل:** إضافة Validation في كل handler:
```javascript
if (data.heartRate && data.heartRate > 0 && data.heartRate < 200) {
  // احفظ فقط القيم الصحيحة
}
```

---

## 📊 الحالة الحالية للمشروع

### ✅ ما يعمل الآن:

1. **TCP Server:**
   - ✅ استقبال اتصالات الساعات
   - ✅ تحليل جميع أنواع الرسائل (AP00-AP50)
   - ✅ إرسال الردود والأوامر
   - ✅ إدارة اتصالات متعددة

2. **قاعدة البيانات:**
   - ✅ تخزين بيانات الأجهزة
   - ✅ تخزين مواقع LBS (MCC, MNC, LAC, Cell ID)
   - ✅ تخزين القياسات الصحية (مع validation)
   - ✅ تخزين الإنذارات
   - ✅ Schema كامل مع Views

3. **نظام القياسات الدورية:**
   - ✅ طلب نبض تلقائي كل 5 دقائق
   - ✅ طلب ضغط دم تلقائي
   - ✅ طلب حرارة تلقائي
   - ✅ طلب أكسجين تلقائي
   - ✅ طلب موقع تلقائي

4. **Logging & Debugging:**
   - ✅ Winston logger شامل
   - ✅ Console logs تفصيلية
   - ✅ تتبع كل خطوة من معالجة البيانات

### ⚠️ قيد الاختبار:

1. **موقع GPS الحقيقي:**
   - ⏳ حالياً: فقط LBS (الساعة داخل المبنى)
   - 🎯 مطلوب: اختبار خارجي للحصول على GPS signal
   - 📍 متوقع: إحداثيات حقيقية عند الخروج للخارج

2. **القياسات الصحية:**
   - ⚠️ حالياً: بعض القيم = NULL (NOT_WEAR issue تم حله)
   - 🎯 مطلوب: مراقبة القراءات بعد لبس الساعة
   - ❤️ متوقع: قيم صحيحة للنبض، الضغط، الحرارة، الأكسجين

### ❌ لم يتم تطويره بعد:

1. **Web Dashboard:**
   - خريطة لعرض المواقع
   - رسوم بيانية للقياسات الصحية
   - إدارة الأجهزة
   - عرض الإنذارات

2. **REST API:**
   - Endpoints للحصول على البيانات
   - Authentication (JWT)
   - Mobile app integration

3. **نظام الإشعارات:**
   - Push notifications
   - SMS للإنذارات
   - Email alerts

4. **تحويل LBS إلى إحداثيات:**
   - OpenCellID API integration
   - تحويل LAC+CID إلى lat/lng تقريبية

---

## 🌍 معلومات الشبكة والأجهزة

### الأجهزة المسجلة حالياً:

#### الساعة 1 (نشطة):
```
IMEI: 861265063710922
الشبكة: Umniah Jordan (MCC:416, MNC:3)
آخر اتصال: نشط
الحالة: ✅ متصلة ومرسلة بيانات
```

#### الساعة 2 (قيد الإعداد):
```
IMEI: (غير معروف بعد)
الشبكة: Umniah Jordan (MCC:416, MNC:3)
الحالة: ⚠️ إعداد جديد - بحاجة لشحن وإعادة تشغيل
```

### معلومات الشبكة:

```
MCC: 416 (Jordan)
MNC: 3 (Umniah)
APN: net
المشغلون الآخرون:
  - MNC 77: Zain Jordan
  - MNC 1: Orange Jordan
```

### معلومات السيرفر:

```
Platform: Railway
Service: Node.js 18.x
TCP Endpoint: gondola.proxy.rlwy.net:15769
Internal Port: 5088
Database: PostgreSQL 15
Region: US West
```

---

## 🚀 الخطوات القادمة (Roadmap)

### المرحلة 1: تثبيت النظام الحالي (الأسبوع القادم)
- [x] حل مشاكل LBS parsing
- [x] حل مشاكل NOT_WEAR sensor
- [ ] اختبار GPS خارجي
- [ ] تأكيد استقرار القياسات الصحية
- [ ] إضافة الساعة الثانية

### المرحلة 2: تحسين البيانات (الأسبوعان القادمان)
- [ ] دمج OpenCellID API لتحويل LBS
- [ ] إضافة Geocoding للحصول على عناوين
- [ ] تحسين دقة المواقع
- [ ] إضافة تحليلات للقياسات الصحية

### المرحلة 3: Web Dashboard (الشهر القادم)
- [ ] React frontend
- [ ] Google Maps integration
- [ ] Charts للقياسات الصحية
- [ ] إدارة الأجهزة
- [ ] عرض الإنذارات
- [ ] Authentication

### المرحلة 4: النشر الكامل (الشهران القادمان)
- [ ] REST API
- [ ] Mobile app (React Native)
- [ ] نظام الإشعارات
- [ ] Backup system
- [ ] Monitoring & Alerts
- [ ] Documentation

---

## 🔐 الأمان والخصوصية

### الإجراءات الحالية:
- ✅ اتصال TCP مباشر (غير مشفر - لكن البروتوكول خاص)
- ✅ قاعدة بيانات محمية (Railway managed)
- ✅ لا يوجد API عام حالياً
- ✅ البيانات الصحية محفوظة بشكل آمن

### المطلوب للإنتاج:
- [ ] SSL/TLS للاتصالات
- [ ] Authentication للـ API
- [ ] Encryption للبيانات الحساسة
- [ ] Access control
- [ ] Audit logs
- [ ] GDPR compliance

---

## 📞 معلومات الاتصال والدعم

### المطور:
```
الاسم: Qusai Kanaan
الدور: Data Engineer @ Alpha Pro Consulting
```

### روابط المشروع:
```
GitHub: (رابط الـ repo)
Railway: https://railway.app (gondola project)
Documentation: README.md, PROTOCOL.md, QUICKSTART.md
```

### الملفات المهمة:
```
INFO.md          ← هذا الملف (نظرة شاملة)
README.md        ← دليل المستخدم الكامل
PROTOCOL.md      ← تفاصيل البروتوكول
QUICKSTART.md    ← دليل البدء السريع
README.railway.md ← دليل Railway
```

---

## 📝 ملاحظات للاستخدام مع AI Systems

### عند استخدام هذا الملف مع Antigravity أو AI آخر:

1. **السياق الكامل موجود هنا** - كل التفاصيل التقنية والمشاكل المحلولة
2. **الملفات الرئيسية:**
   - `server.js` - نقطة البداية
   - `protocol/parser.js` - تحليل الرسائل
   - `handlers/messageHandlers.js` - المعالجة
   - `database/db.js` - التخزين

3. **المشاكل الشائعة:**
   - إذا فشل الاتصال: تحقق من TCP Proxy port mapping
   - إذا فشل حفظ البيانات: تحقق من DATABASE_URL
   - إذا القياسات = 0: NOT_WEAR sensor مفعّل
   - إذا موقع = 0,0: LBS data (مش GPS) - طبيعي داخل المباني

4. **البروتوكول:**
   - كل رسالة تبدأ بـ `IW` وتنتهي بـ `#`
   - AP = من الساعة
   - BP = للساعة
   - Journal Number = MMDDHHMMSS

5. **قاعدة البيانات:**
   - gps_valid = true → GPS حقيقي
   - gps_valid = false → LBS (أبراج)
   - MCC 416 = الأردن
   - MNC 3 = Umniah

---

## 🎓 الدروس المستفادة (Lessons Learned)

1. **Railway Environment Variables:**
   - استخدم المتغيرات التي يوفرها Railway (DATABASE_URL)
   - لا تعتمد على متغيرات يدوية قديمة

2. **TCP Proxy Configuration:**
   - يجب أن يتطابق Port mapping تماماً
   - Internal port ≠ External port

3. **Protocol Parsing:**
   - انتبه للـ Array indices بعد split()
   - اطبع كل خطوة للـ debugging

4. **Database Validation:**
   - لا تحفظ قيم 0 أو NULL للقياسات الصحية
   - تحقق من نطاق القيم المنطقي

5. **Hardware Sensors:**
   - بعض السنسورات (NOT_WEAR) تمنع القياسات
   - يمكن تعطيلها عبر أوامر

6. **LBS vs GPS:**
   - LBS يعطي موقع تقريبي (داخل المباني)
   - GPS يحتاج سماء مفتوحة
   - لا تتوقع GPS coordinates داخل البناء

---

**آخر تحديث:** 3 أبريل 2026، الساعة 6:30 مساءً  
**الحالة:** النظام يعمل ✅ - قيد الاختبار الميداني 🧪
