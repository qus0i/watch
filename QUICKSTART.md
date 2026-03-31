# 🚀 دليل البدء السريع

## الإعداد في 5 دقائق

### 1️⃣ تثبيت المتطلبات الأساسية

**على Ubuntu/Debian:**
```bash
# Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL
sudo apt-get install -y postgresql postgresql-contrib

# أدوات إضافية
sudo apt-get install -y git
```

**على MacOS:**
```bash
# استخدام Homebrew
brew install node
brew install postgresql
```

### 2️⃣ إعداد قاعدة البيانات

```bash
# بدء خدمة PostgreSQL
sudo systemctl start postgresql
sudo systemctl enable postgresql

# الدخول إلى PostgreSQL
sudo -u postgres psql

# إنشاء قاعدة البيانات والمستخدم
CREATE DATABASE gps_watch_db;
CREATE USER watch_user WITH PASSWORD 'SecurePass123!';
GRANT ALL PRIVILEGES ON DATABASE gps_watch_db TO watch_user;
\q
```

### 3️⃣ تثبيت المشروع

```bash
# فك الضغط (إذا كان ملف مضغوط)
unzip gps-watch-server.zip
cd gps-watch-server

# تثبيت Dependencies
npm install

# نسخ ملف البيئة
cp .env.example .env

# تعديل الإعدادات
nano .env
```

**عدّل القيم التالية في .env:**
```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=gps_watch_db
DB_USER=watch_user
DB_PASSWORD=SecurePass123!
SERVER_PORT=5088
TIMEZONE=3
```

### 4️⃣ تهيئة قاعدة البيانات

```bash
npm run init-db
```

يجب أن ترى:
```
✅ تم إنشاء الجداول بنجاح!
📊 الجداول المُنشأة:
   1. devices
   2. locations
   3. health_data
   4. alerts
   ...
```

### 5️⃣ تشغيل السيرفر

```bash
# للتطوير
npm run dev

# للإنتاج
npm start
```

يجب أن ترى:
```
✅ السيرفر يعمل على 0.0.0.0:5088
📊 المنطقة الزمنية: UTC+3
```

---

## 🔧 إعداد الساعة

### الخطوة 1: تركيب SIM Card

1. أطفئ الساعة
2. افتح غطاء SIM
3. ضع الشريحة (تأكد من وجود باقة إنترنت)
4. شغّل الساعة

### الخطوة 2: ضبط APN (حسب المُشغل)

**زين الأردن:**
```
#apn#=416,77,zain,zain,zain,zain,PAP#
```

**أورانج الأردن:**
```
#apn#=416,77,internet,internet,,,PAP#
```

**أمنية الأردن:**
```
#apn#=416,01,net,net,net,net,PAP#
```

### الخطوة 3: ضبط عنوان السيرفر

**إذا عندك Domain Name:**
```
#host#=your-server.com,5088#
```

**إذا عندك IP فقط:**
```
#ip#=203.123.45.67,5088#
```

### الخطوة 4: التحقق

```
#status#
```

ستستقبل SMS بمعلومات الساعة، تأكد من:
- ✅ APN صحيح
- ✅ Server IP/Domain صحيح
- ✅ البطارية مشحونة

---

## 🧪 اختبار النظام

### 1. تحقق من اتصال الساعة

راقب logs السيرفر:
```bash
tail -f logs/combined.log
```

يجب أن ترى:
```
🔌 اتصال جديد من: 192.168.1.100:45678
✅ تسجيل دخول ناجح: 353456789012345
📍 موقع GPS: 31.963158, 35.930359 | بطارية: 85%
```

### 2. اختبر الأوامر

```bash
# طلب موقع
node cli.js location 353456789012345

# قياس النبض
node cli.js heartrate 353456789012345
```

### 3. تحقق من قاعدة البيانات

```bash
psql -U watch_user -d gps_watch_db

# عرض الأجهزة المسجلة
SELECT * FROM devices;

# آخر موقع لكل جهاز
SELECT * FROM latest_locations;

# القياسات الصحية
SELECT * FROM health_data ORDER BY timestamp DESC LIMIT 10;
```

---

## 📱 الاستخدام اليومي

### مراقبة السيرفر

```bash
# عرض الـ logs الحية
tail -f logs/combined.log

# عرض الأخطاء فقط
tail -f logs/error.log

# إحصائيات الاتصالات
# TODO: إضافة endpoint للإحصائيات
```

### إرسال الأوامر

```bash
# موقع فوري
node cli.js location <IMEI>

# قياسات صحية
node cli.js heartrate <IMEI>
node cli.js bloodpressure <IMEI>
node cli.js temperature <IMEI>

# تغيير الإعدادات
node cli.js mode <IMEI> 1        # وضع عادي
node cli.js mode <IMEI> 3        # وضع طوارئ
node cli.js falldetect <IMEI> on # تفعيل كشف الوقوع
```

### ضبط أرقام الطوارئ

```bash
node cli.js sos <IMEI> +962791234567 +962791234568 +962791234569
```

---

## 🐛 حل المشاكل الشائعة

### الساعة لا تتصل

```bash
# 1. تحقق من السيرفر يعمل
sudo systemctl status postgresql
ps aux | grep node

# 2. تحقق من الـ Firewall
sudo ufw status
sudo ufw allow 5088/tcp

# 3. تحقق من logs
tail -50 logs/error.log

# 4. تحقق من الشبكة
ping your-server-ip
telnet your-server-ip 5088
```

### قاعدة البيانات لا تتصل

```bash
# تحقق من PostgreSQL
sudo systemctl status postgresql

# اختبر الاتصال
psql -U watch_user -d gps_watch_db -h localhost

# راجع الإعدادات
cat .env | grep DB_
```

### الساعة ترسل بيانات غريبة

```bash
# فعّل Debug Mode
nano .env
# غيّر DEBUG=true و LOG_LEVEL=debug

# أعد تشغيل السيرفر
npm restart

# راقب التفاصيل
tail -f logs/combined.log
```

---

## 🔒 أمان الإنتاج

### 1. غيّر كلمات المرور

```bash
# PostgreSQL
sudo -u postgres psql
ALTER USER watch_user WITH PASSWORD 'NewSecurePassword2024!';
```

### 2. فعّل Firewall

```bash
sudo ufw enable
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 5088/tcp  # GPS Server
```

### 3. استخدم SSL/TLS

للإنتاج، استخدم Reverse Proxy مع SSL:
```bash
# Nginx مع Let's Encrypt
sudo apt-get install nginx certbot python3-certbot-nginx
```

### 4. نسخ احتياطي دوري

```bash
# إنشاء cron job للنسخ الاحتياطي
crontab -e

# أضف هذا السطر (نسخة يومية الساعة 2 صباحاً)
0 2 * * * pg_dump gps_watch_db > /backup/db_$(date +\%Y\%m\%d).sql
```

---

## 📊 الخطوات التالية

1. **بناء Dashboard ويب**
   - React + Google Maps
   - عرض المواقع الحية
   - رسوم بيانية للقياسات الصحية

2. **REST API**
   - Express.js endpoints
   - Authentication (JWT)
   - Mobile App integration

3. **نظام إشعارات**
   - Push Notifications
   - SMS للإنذارات
   - Email alerts

4. **تحليلات متقدمة**
   - تتبع المسارات
   - تنبيهات المناطق الآمنة/الخطرة
   - تقارير صحية دورية

---

## 📞 الدعم

إذا واجهت أي مشكلة:
1. راجع ملف `PROTOCOL.md` للتفاصيل التقنية
2. راجع `logs/error.log` للأخطاء
3. تحقق من `README.md` للتوثيق الكامل

---

**🎉 مبروك! سيرفرك الآن جاهز للعمل!**
