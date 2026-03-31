# 🚂 Deploy على Railway - دليل سريع

## خطوات النشر

### 1. ربط Repository
1. سجل دخول على https://railway.app
2. New Project → Deploy from GitHub repo
3. اختر `gps-watch-server`

### 2. إضافة PostgreSQL
1. في نفس المشروع: New → Database → PostgreSQL
2. Railway سيربط المتغيرات تلقائياً

### 3. لا حاجة لضبط Variables!
Railway يوفر المتغيرات التالية تلقائياً:
- `PGHOST`
- `PGPORT` 
- `PGDATABASE`
- `PGUSER`
- `PGPASSWORD`

المشروع معد للتعرف عليها تلقائياً! ✅

### 4. الحصول على TCP Endpoint
1. اضغط على Node.js service
2. Settings → Networking → Generate Domain
3. انسخ **TCP Proxy URL** (مثل: `xxx.proxy.rlwy.net:12345`)

### 5. ضبط الساعة
أرسل SMS للساعة:
```
#host#=YOUR_RAILWAY_HOST,YOUR_RAILWAY_PORT#
```

مثال:
```
#host#=gps-watch-server.proxy.rlwy.net,12345#
```

### 6. ضبط APN (حسب المشغل)
```
#apn#=416,77,zain,zain,zain,zain,PAP#
```

### 7. التحقق
```
#status#
```

---

## مراقبة النظام

### عرض الـ Logs
1. اضغط على Node.js service
2. Deployments → اختر آخر deployment
3. View Logs

### الوصول لقاعدة البيانات
في PostgreSQL service → Connect → انسخ الـ connection string:
```bash
psql <RAILWAY_DATABASE_URL>
```

ثم:
```sql
SELECT * FROM devices;
SELECT * FROM locations ORDER BY timestamp DESC LIMIT 10;
```

---

## التكاليف

**Free Tier:** $5 credit/month = ~500 ساعات تشغيل
- كافي لـ 10-50 ساعة GPS في مرحلة الاختبار

**Hobby Plan:** $5/month
- Unlimited execution hours

---

## استكشاف الأخطاء

### السيرفر لا يبدأ
- تحقق من Logs
- تأكد من PostgreSQL service يعمل
- تحقق من Variables موجودة

### الساعة لا تتصل
- تأكد من استخدام TCP Proxy URL (ليس HTTP domain)
- تحقق من Port صحيح
- راجع Firewall settings في Railway

### قاعدة البيانات فارغة
- السيرفر يعمل init تلقائياً عند أول تشغيل
- إذا لم ينجح، شغل يدوياً:
  - Railway Console → `npm run init-db`

---

## الدعم
- Railway Docs: https://docs.railway.app
- Project README.md للتفاصيل الكاملة
