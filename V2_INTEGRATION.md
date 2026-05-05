# Health Watch v2 Protocol Integration

دعم **Health Watches الجديدة** (4G RTOS/Android — JSON over TCP/FCAF) مضاف
بشكل **additive** بجانب البروتوكول القديم (IW Text). كلا النوعين يخدمهم نفس
السيرفر على **نفس البورت** (5088 افتراضياً) — السيرفر يفصل بين البروتوكولين
تلقائياً بفحص أول بايت من الاتصال.

---

## آلية الـ Protocol Multiplexing

عند فتح اتصال TCP جديد، السيرفر يقرأ أول chunk ويفحص أول بايت:

| أول بايت | البروتوكول | الـ handler |
|---|---|---|
| `0x49` (`'I'`) | IW القديم — يبدأ كل رسالة بـ `IW` | `legacyHandler` (الكود الموجود) |
| `0xFC` + `0xAF` | v2 الجديد — FCAF binary header | `handleV2Connection` |
| غير ذلك | unknown | السيرفر يُغلق الاتصال |

التنفيذ في `server.js`:

```js
const server = net.createServer((socket) => {
  socket.once('data', (firstChunk) => {
    const firstByte = firstChunk[0];
    if (firstByte === 0xFC && firstChunk[1] === 0xAF) {
      require('./server-v2').handleV2Connection(socket, firstChunk);
      return;
    }
    if (firstByte === 0x49) {
      socket.unshift(firstChunk);     // أرجع البايتات للـ stream
      legacyHandler(socket);          // الكود الموجود حالياً
      return;
    }
    socket.destroy();
  });
});
```

**ملاحظات تقنية:**
- نستخدم `socket.once('data', ...)` للقراءة مرة وحدة، ثم نتسلّم.
- بعد كشف legacy، `socket.unshift(firstChunk)` يُرجع البايتات للـ stream
  حتى الـ legacy parser يقرأ الرسالة كاملة ولا يفقد أول حرف.
- بعد كشف v2، نمرّر البايتات الأولية مباشرة إلى `handleV2Connection`
  الذي يُغذّيها لـ `FrameAssembler`.

---

## ما الجديد؟

```
gps-watch-server/
├── server.js                   # تم إضافة multiplexer + استخراج logic القديم
│                               # كـ legacyHandler() (نفس الكود حرفياً)
├── server-v2.js                # 🆕 module يصدّر setupV2 + handleV2Connection
├── protocol/
│   ├── parser.js               # القديم — لم يُمَس
│   ├── builder.js              # القديم — لم يُمَس
│   └── v2/                     # 🆕
│       ├── frameCodec.js       # تجميع/فك FCAF binary frame
│       ├── parser.js           # JSON envelope parser
│       └── builder.js          # JSON response builder (s:reply / s:down)
├── handlers/
│   ├── messageHandlers.js      # القديم — لم يُمَس
│   └── v2/                     # 🆕
│       ├── index.js            # router
│       ├── auth.js             # login + heartbeat
│       ├── health.js           # upHealthData / upBatch / upBP / upBO ...
│       ├── location.js         # upLocation / upGPS / upBattery
│       ├── activity.js         # upRun / upWalk / upSleep / upTodayActivity
│       └── config.js           # upDeviceConfig / upCustom / dnDevBindStatus
├── database/
│   ├── schema.sql              # القديم — لم يُمَس
│   ├── db.js                   # تمت إضافة v2 helpers (additive only)
│   ├── init-db.js              # القديم — لم يُمَس
│   ├── migrate.js              # 🆕 Migrations runner (idempotent)
│   └── migrations/
│       └── 001_add_watch_type_v2.sql   # 🆕
└── tests/
    └── v2-client.js            # 🆕 عميل اختباري
```

### قاعدة البيانات

تتم الإضافة عبر migration واحد (`001_add_watch_type_v2.sql`):

| تعديل | الغرض |
|---|---|
| `devices.watch_type` | تمييز `iw_legacy` vs `health_v2` |
| `devices.bind_status`, `firmware_v`, `battery_level`, `battery_state`, `last_heartbeat` | بيانات الجهاز الجديد |
| `v2_pending_requests` | تتبّع طلبات السيرفر للـ ident-matching |
| `v2_message_log` | سجل خام (in/out) للتشخيص |
| `v2_activity` | run / walk / sleep / today activity |
| `v2_device_configs` | إعدادات الجهاز الواردة |
| `schema_migrations` | جدول داخلي يتتبّع الـ migrations المنفّذة |

الجداول الموجودة `health_data`, `locations`, `daily_steps` تستخدم كما هي للبيانات
الصحية والموقع — التمييز يحصل عبر `devices.watch_type` فقط.

الـ migrations تُشغَّل تلقائياً عند بدء السيرفر (`server.js` ينادي `setupV2()`
بعد `db.initializeDatabase()`).

---

## كيف يعمل البروتوكول الجديد؟

### Frame format (TCP)

كل رسالة:

```
| 0xFC 0xAF | uint16 BE length | JSON payload |
```

* أول 2 بايت ثابتة: `0xFC 0xAF` (start marker)
* بايتان: طول JSON payload (big-endian unsigned short)
* الـ payload: JSON UTF-8

مثال (login):

```
\xFC\xAF\x00\xA6{"type":"login","ident":762250,"ref":"w:update","imei":"865028000000306","data":{"type":"login","imei":"865028000000306","deviceModel":"X","timestamp":1648111390074},"timestamp":1648111390074}
```

### Envelope عام (Common request body)

```json
{
  "type":      "<مطابق لـ data.type>",
  "ident":     762250,
  "ref":       "w:update",
  "imei":      "865028000000306",
  "data": {
    "type":        "login",
    "imei":        "865028000000306",
    "deviceModel": "...",
    "timestamp":   1648111390074
  },
  "timestamp": 1648111390074
}
```

* `ref` من الجهاز: `w:update` (تحديث) أو `w:reply` (رد على أمر سيرفر)
* `ref` من السيرفر: `s:reply` أو `s:down`
* `ident` لازم يطابق بين الطلب والرد.
* `timestamp` بـ **milliseconds** (لا ثواني).

### الأوامر المدعومة

| Type | Direction | Handler | Stored in |
|---|---|---|---|
| `login` | up | auth.login | devices (bindStatus=1, firmware) |
| `heartbeat` | up | auth.heartbeat | devices (battery, last_heartbeat) |
| `upHealthData` | up | health.upHealthData | health_data |
| `upBatch` | up | health.upBatch | health_data (multi-row) |
| `upHeartRate`, `upBP`, `upBO`, `upBodyTemperature`, `upBS` | up | health.* | health_data |
| `upLocation` (+ `upGPS` alias) | up | location.upLocation | locations |
| `upBattery` | up | location.upBattery | devices |
| `upRun` / `upWalk` / `upRide` / ... | up | activity.runLike | v2_activity |
| `upSleep` | up | activity.upSleep | v2_activity |
| `upTodayActivity` | up | activity.upTodayActivity | v2_activity + daily_steps |
| `upDeviceConfig` | up | config.upDeviceConfig | v2_device_configs |
| `upCustom` | up | config.upCustom | log only |
| `dnDevBindStatus` | down | builder.devBindStatus | (يُرسَل من السيرفر) |
| `dnCustom` | down | builder.down | (يُرسَل من السيرفر) |

أي type غير معروف يحصل على generic ack (لا تنقطع الـ session).

---

## التشغيل

### محلياً

```bash
npm start          # السيرفر الموحّد على 5088 — يدعم البروتوكولين معاً
npm run migrate    # شغّل migrations يدوياً (اختياري — تشتغل تلقائياً عند start)
```

### اختبار محلي

```bash
# Terminal 1: شغّل السيرفر
npm start

# Terminal 2: شغّل عميل v2 الاختباري (يتصل على نفس بورت 5088)
npm run test:v2-client
```

العميل الاختباري يرسل: login → heartbeat → upHealthData × 4 → upLocation → upBatch → upRun → upDeviceConfig، ويطبع كل response.

---

## النشر على Railway

**لا يوجد أي تغيير على إعداد Railway**. السيرفر يعمل على نفس البورت
السابق، والـ TCP Proxy الواحد المُخصّص للـ service يخدم النوعين معاً.

```
gondola.proxy.rlwy.net:15769  ←  IW legacy + v2 health watches
                                  (نفس endpoint، السيرفر يميّز تلقائياً)
```

### ربط الساعة الجديدة

الساعات الجديدة تأخذ **نفس** host:port المستخدم حالياً للساعات القديمة.

| المعامل | القيمة |
|---|---|
| Server host | `gondola.proxy.rlwy.net` (أو الـ Railway TCP proxy hostname) |
| Server port | `15769` (أو الـ public port الذي خصّصه Railway) |
| Protocol | TCP (FCAF JSON) |

أوامر AT أو SMS لإعداد الجهاز تعتمد على موديل الساعة (راجع وثيقة الـ vendor).
نمط شائع:

```
AT+IPADDR=gondola.proxy.rlwy.net,15769
AT+UPLOAD=ON
```

أو SMS configuration:
```
pw,123456,ip,gondola.proxy.rlwy.net,15769#
```

### متغيّرات البيئة (اختيارية)

| المتغيّر | الافتراضي | الوصف |
|---|---|---|
| `SERVER_PORT` | 5088 | بورت السيرفر (ينطبق على كلا البروتوكولين) |
| `V2_ENABLED` | true | اضبطها `false` لتعطيل v2 (السيرفر يقفل أي اتصال FCAF) |
| `V2_LOG_MESSAGES` | true | سجل كل JSON in/out في `v2_message_log` |
| `V2_SOCKET_TIMEOUT_MS` | 300000 | timeout للساعة v2 (5 دقائق) |
| `V2_KEEPALIVE_MS` | 30000 | keepAlive لاتصال v2 |

---

## أمثلة على Frames صحيحة

> الأمثلة بـ JSON ومعها ترميز الـ binary header.

### Login

JSON:
```json
{
  "type": "login",
  "ident": 762250,
  "ref": "w:update",
  "imei": "865028000000306",
  "data": {
    "type": "login",
    "imei": "865028000000306",
    "deviceModel": "TestWatch-v2",
    "platform": "ASR",
    "Version": "1.2.42",
    "batteryLevel": 87,
    "timestamp": 1648111390074
  },
  "timestamp": 1648111390074
}
```

Frame: `FC AF 00 A6 7B 22 74 79 ...` (header = `FCAF` + length=0x00A6).

السيرفر يرد:

```json
{
  "type": "login",
  "ident": 762250,
  "ref": "s:reply",
  "imei": "865028000000306",
  "data": {
    "type": "login",
    "imei": "865028000000306",
    "timestamp": 1648111390200,
    "bindStatus": 1,
    "deviceModel": "TestWatch-v2"
  },
  "timestamp": 1648111390200
}
```

### Heartbeat

```json
{
  "type": "heartbeat",
  "ident": 762251,
  "ref": "w:update",
  "imei": "865028000000306",
  "data": {
    "type": "heartbeat",
    "imei": "865028000000306",
    "deviceModel": "TestWatch-v2",
    "batteryLevel": 86,
    "batteryState": 1,
    "timestamp": 1648111400000
  },
  "timestamp": 1648111400000
}
```

### upHealthData (heart rate)

```json
{
  "type": "upHealthData",
  "ident": 762252,
  "ref": "w:update",
  "imei": "865028000000306",
  "data": {
    "type": "upHeartRate",
    "imei": "865028000000306",
    "deviceModel": "TestWatch-v2",
    "data": "72",
    "testType": 0,
    "timestamp": 1648111410000
  },
  "timestamp": 1648111410000
}
```

ملاحظة: حقل النوع الفعلي للقياس هو `data.type` (في هذا المثال `upHeartRate`).
الـ outer `type` يُستخدم كـ wrapper. مفهوم القياسات:

| inner type | data field | mapping |
|---|---|---|
| `upHeartRate` | `"72"` | `heart_rate=72` |
| `upBP` | `"120/80/72"` | `systolic=120, diastolic=80, heart_rate=72` |
| `upBO` | `"97"` | `spo2=97` |
| `upBodyTemperature` | `"36.7/30.5/25.0"` | `body_temperature=36.7` |
| `upBS` | `"9.6"` | `blood_sugar=9.6` |

### upLocation

```json
{
  "type": "upLocation",
  "ident": 762253,
  "ref": "w:update",
  "imei": "865028000000306",
  "data": {
    "type": "upLocation",
    "imei": "865028000000306",
    "gps": { "lon": "35.910278", "lat": "31.954500", "satelliteNum": 8, "GSM": 90 },
    "wifi": [{"ssid":"home","mac":"aa:bb:..","signal":"-65"}],
    "baseStation": [{"mcc":416,"mnc":1,"lac":12345,"ci":67890}],
    "timestamp": 1648111420000
  },
  "timestamp": 1648111420000
}
```

---

## Troubleshooting

### كيف أتأكد إن الفصل بين البروتوكولين يشتغل؟

من اللوقز عند بدء أي اتصال جديد:
- اتصال IW: `🔌 اتصال جديد من: IP:PORT`
- اتصال v2: `🔌 [v2] connection IP:PORT`
- بروتوكول غير معروف: `⚠️ بروتوكول غير معروف من IP — أول بايت 0xXX`

### الجهاز الجديد يتصل ثم ينفصل بعد ثوانٍ

* تأكد إنه يرسل `login` كأول رسالة بصيغة FCAF صحيحة.
* `V2_SOCKET_TIMEOUT_MS=300000` (5 دقائق) — لو ما وصلت أي data، السيرفر
  يُغلق الاتصال.
* راجع `v2_message_log`:

  ```sql
  SELECT * FROM v2_message_log
  WHERE imei = '865028000000306'
  ORDER BY id DESC LIMIT 20;
  ```

### رد السيرفر لا يصل للجهاز الجديد

* تأكد إن الجهاز يقبل الـ `s:reply` بنفس الـ `ident`. بعض firmware يهمل
  ردود مختلفة الـ ident.
* راجع لوقز السيرفر — كل response مُسجَّلة بنوعها.

### اتصال v2 لكن أول بايت 0xFC والثاني مش 0xAF

السيرفر يعتبره unknown ويُغلقه. الجهاز يحتاج يرسل FCAF بشكل صحيح.

### الإطارات (frames) متقطّعة أو مكسورة

* `FrameAssembler` يُجمّع البايتات تلقائياً عبر TCP chunks ويتجاوز أي
  garbage يسبق `FCAF`. لو شفت "invalid JSON" متكرر، غالباً مشكلة UTF-8
  على جهة الجهاز.

### اختلاط البيانات بين الساعات القديمة والجديدة

* لا يحصل: السيرفر يفصل البروتوكولين قبل ما توصل أي بيانات للـ DB،
  والجداول تستخدم `watch_type`.
* للاستعلام عن الساعات الجديدة فقط:

  ```sql
  SELECT * FROM devices WHERE watch_type = 'health_v2';
  ```

### تعطيل v2 مؤقتاً

```
V2_ENABLED=false
```

السيرفر القديم يستمر بالعمل، وأي اتصال FCAF يُرفض ويُغلق.

### الوصول إلى السجل الخام

```sql
-- كل رسائل آخر ساعة لجهاز معيّن
SELECT direction, msg_type, ident, ref, created_at
FROM v2_message_log
WHERE imei = '865028000000306'
  AND created_at > NOW() - INTERVAL '1 hour'
ORDER BY id DESC;

-- آخر 10 قياسات صحية v2
SELECT h.* FROM health_data h
JOIN devices d ON d.id = h.device_id
WHERE d.watch_type = 'health_v2'
ORDER BY h.timestamp DESC
LIMIT 10;
```

---

## خطوات قادمة (TODO)

* مزيد من الـ down commands (dnLocation, dnHeartRate, deviceMeasuringFrequency)
* Video call commands stubs → real handlers
* OTA flow (upGetOTA + dnOTA)
* ECG/HRV/PPG waveform storage (جدول مخصص بدل health_data)
* Family number / phonebook download
* Mapping of `upRun` heartRate-array إلى `health_data` time-series
