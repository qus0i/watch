# 📤 دليل رفع الكود على GitHub و Railway

## الملفات المطلوبة (✅ كلها جاهزة)

```
gps-watch-server/
├── 📄 package.json              # معلومات المشروع والـ dependencies
├── 📄 config.js                 # إعدادات النظام
├── 📄 server.js                 # TCP Server الرئيسي
├── 📄 railway.json              # إعدادات Railway (جديد!)
├── 📄 .gitignore                # ملفات مستثناة من Git
├── 📄 .env.example              # مثال على متغيرات البيئة
├── 📄 README.md                 # التوثيق الكامل
├── 📄 README.railway.md         # دليل Railway (جديد!)
├── 📄 QUICKSTART.md             # دليل البدء السريع
├── 📄 PROTOCOL.md               # شرح البروتوكول
├── 📄 cli.js                    # أداة سطر الأوامر
│
├── 📁 protocol/
│   ├── parser.js                # تحليل رسائل الساعة
│   └── builder.js               # بناء الردود
│
├── 📁 handlers/
│   └── messageHandlers.js       # معالجة الرسائل
│
├── 📁 database/
│   ├── schema.sql               # هيكل قاعدة البيانات
│   ├── db.js                    # اتصال قاعدة البيانات
│   └── init-db.js               # تهيئة تلقائية
│
└── 📁 utils/
    └── logger.js                # نظام التسجيل

المجموع: 17 ملف + 4 مجلدات
```

---

## 🚀 طريقة الرفع (اختر واحدة)

### **الطريقة 1: GitHub Desktop (الأسهل - موصى بها)**

1. **حمّل GitHub Desktop:**
   - Windows/Mac: https://desktop.github.com

2. **سجل دخول بحسابك على GitHub**

3. **أضف المشروع:**
   - File → Add Local Repository
   - اختر مجلد `gps-watch-server`
   - اضغط "Create Repository"

4. **ارفع للـ GitHub:**
   - اكتب commit message: "Initial GPS Watch Server"
   - اضغط "Commit to main"
   - اضغط "Publish repository"
   - اختر اسم: `gps-watch-server`
   - ✅ Public (أو Private حسب رغبتك)
   - اضغط "Publish"

**✅ خلص! الكود صار على GitHub**

---

### **الطريقة 2: Git Command Line**

```bash
# 1. افتح Terminal في مجلد gps-watch-server
cd /path/to/gps-watch-server

# 2. تهيئة Git
git init

# 3. إضافة جميع الملفات
git add .

# 4. عمل Commit
git commit -m "Initial GPS Watch Server for Railway deployment"

# 5. إنشاء Repository على GitHub
# روح https://github.com/new
# اسم الـ repo: gps-watch-server
# انسخ الـ URL اللي يطلع

# 6. ربط المشروع المحلي بـ GitHub
git remote add origin https://github.com/YOUR_USERNAME/gps-watch-server.git

# 7. رفع الكود
git branch -M main
git push -u origin main
```

**✅ خلص! الكود صار على GitHub**

---

### **الطريقة 3: تحميل مباشر على GitHub (لو ما عندك Git)**

1. روح https://github.com/new
2. اسم الـ repo: `gps-watch-server`
3. اضغط "Create repository"
4. اضغط "uploading an existing file"
5. اسحب **كل الملفات والمجلدات** من `gps-watch-server`
6. اضغط "Commit changes"

**⚠️ ملاحظة:** هذه الطريقة أبطأ لكن تنفع إذا ما عندك Git

---

## 🚂 بعد الرفع على GitHub → Railway

### **خطوات Railway:**

1. **روح https://railway.app**
2. سجل دخول بـ GitHub
3. **New Project**
4. **Deploy from GitHub repo**
5. اختر `gps-watch-server`

### **Railway رح يعمل:**
- ✅ قراءة `railway.json` تلقائياً
- ✅ تشغيل `npm install`
- ✅ تشغيل `npm run railway:start`
- ✅ تهيئة قاعدة البيانات تلقائياً

### **إضافة PostgreSQL:**
1. في نفس المشروع: **New** → **Database** → **PostgreSQL**
2. ✅ Railway يربط المتغيرات تلقائياً (ما في داعي تعمل شي!)

### **الحصول على TCP URL:**
1. اضغط على **Node.js service**
2. **Settings** → **Networking** → **Generate Domain**
3. انسخ **TCP Proxy** (مثل: `xyz.proxy.rlwy.net:12345`)

---

## 📱 ضبط الساعة

```sms
#host#=xyz.proxy.rlwy.net,12345#
```

*(استبدل بالـ URL اللي طلع عندك)*

```sms
#apn#=416,77,zain,zain,zain,zain,PAP#
```

```sms
#status#
```

---

## ✅ Checklist

- [ ] الكود على GitHub
- [ ] Railway Project منشئ
- [ ] PostgreSQL مضاف
- [ ] TCP URL موجود
- [ ] الساعة مضبوطة
- [ ] اتصال ناجح!

---

## 🆘 مشاكل؟

### الكود كبير؟
- ما تقلق، 17 ملف فقط (~500 KB)
- GitHub يدعم حتى 100 GB

### Railway ما يشتغل؟
- تحقق من Logs
- تأكد PostgreSQL service شغال
- راجع `README.railway.md`

### عندك تحديثات؟
```bash
git add .
git commit -m "وصف التحديث"
git push
```
Railway رح يعمل redeploy تلقائي!

---

**جاهز؟ ارفع الكود وقلي لما تخلص!** 🚀
