-- قاعدة البيانات لنظام الساعة الذكية
-- Database Schema for GPS Watch System

-- جدول الساعات (الأجهزة)
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    imei VARCHAR(15) UNIQUE NOT NULL,
    sim_number VARCHAR(20),
    user_name VARCHAR(100),
    user_phone VARCHAR(20),
    registration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_connection TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    device_model VARCHAR(50),
    firmware_version VARCHAR(20),
    notes TEXT
);

-- جدول المواقع (GPS Data)
CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    imei VARCHAR(15) NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    speed DECIMAL(6, 2),
    direction DECIMAL(6, 2),
    gps_valid BOOLEAN,
    satellite_count INTEGER,
    gsm_signal INTEGER,
    battery_level INTEGER,
    -- بيانات LBS (أبراج الشبكة)
    mcc INTEGER,
    mnc INTEGER,
    lac INTEGER,
    cell_id INTEGER,
    -- بيانات WIFI
    wifi_data JSONB,
    -- حالة الجهاز
    fortification_state INTEGER,
    working_mode INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- فهرس لتسريع البحث حسب الجهاز والوقت
CREATE INDEX idx_locations_device_time ON locations(device_id, timestamp DESC);
CREATE INDEX idx_locations_imei ON locations(imei);

-- جدول القياسات الصحية
CREATE TABLE IF NOT EXISTS health_data (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    imei VARCHAR(15) NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- قياسات القلب
    heart_rate INTEGER,
    blood_pressure_systolic INTEGER,
    blood_pressure_diastolic INTEGER,
    -- قياسات أخرى
    spo2 INTEGER, -- نسبة الأكسجين
    blood_sugar INTEGER,
    body_temperature DECIMAL(4, 2),
    -- بيانات ECG (إذا وُجِدت)
    ecg_data JSONB,
    battery_level INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_health_device_time ON health_data(device_id, timestamp DESC);
CREATE INDEX idx_health_imei ON health_data(imei);

-- جدول الإنذارات
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    imei VARCHAR(15) NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    alert_type VARCHAR(20) NOT NULL, -- 'SOS', 'FALL_DOWN', 'NOT_WEAR', etc.
    latitude DECIMAL(10, 7),
    longitude DECIMAL(10, 7),
    address TEXT,
    is_handled BOOLEAN DEFAULT false,
    handled_at TIMESTAMP,
    handled_by VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_alerts_device ON alerts(device_id, created_at DESC);
CREATE INDEX idx_alerts_unhandled ON alerts(is_handled, created_at DESC);

-- جدول أرقام الطوارئ (SOS Numbers)
CREATE TABLE IF NOT EXISTS sos_numbers (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    contact_name VARCHAR(100),
    priority INTEGER DEFAULT 1, -- 1, 2, 3 (أولوية الاتصال)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- جدول القائمة البيضاء (Phone Book)
CREATE TABLE IF NOT EXISTS whitelist_contacts (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    phone_number VARCHAR(20) NOT NULL,
    contact_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- جدول التنبيهات والتذكيرات
CREATE TABLE IF NOT EXISTS reminders (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    reminder_type INTEGER, -- 1: دواء, 2: ماء, 3: حركة
    reminder_time TIME NOT NULL,
    days_of_week VARCHAR(10), -- '135' = الاثنين والأربعاء والجمعة
    is_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- جدول الخطوات اليومية
CREATE TABLE IF NOT EXISTS daily_steps (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    step_count INTEGER DEFAULT 0,
    roll_frequency INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(device_id, date)
);

-- جدول الأوامر المرسلة
CREATE TABLE IF NOT EXISTS commands_log (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    imei VARCHAR(15) NOT NULL,
    command_type VARCHAR(10) NOT NULL,
    command_data TEXT,
    journal_no VARCHAR(20),
    sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    response_received BOOLEAN DEFAULT false,
    response_data TEXT,
    response_at TIMESTAMP
);

CREATE INDEX idx_commands_device ON commands_log(device_id, sent_at DESC);

-- جدول الرسائل الصوتية
CREATE TABLE IF NOT EXISTS voice_messages (
    id SERIAL PRIMARY KEY,
    device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
    imei VARCHAR(15) NOT NULL,
    direction VARCHAR(10) NOT NULL, -- 'UPLOAD' or 'DOWNLOAD'
    sender_name VARCHAR(100),
    timestamp TIMESTAMP NOT NULL,
    total_packets INTEGER,
    received_packets INTEGER DEFAULT 0,
    audio_data BYTEA,
    audio_format VARCHAR(10) DEFAULT 'amr',
    is_complete BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Views للاستعلامات السريعة

-- آخر موقع لكل جهاز
CREATE OR REPLACE VIEW latest_locations AS
SELECT DISTINCT ON (device_id)
    l.device_id,
    d.imei,
    d.user_name,
    l.latitude,
    l.longitude,
    l.timestamp,
    l.battery_level,
    l.gps_valid
FROM locations l
JOIN devices d ON l.device_id = d.id
ORDER BY device_id, timestamp DESC;

-- آخر قياسات صحية لكل جهاز (آخر قيمة غير فارغة لكل حقل على حدة)
CREATE OR REPLACE VIEW latest_health_data AS
SELECT
    d.id AS device_id,
    d.imei,
    d.user_name,
    (
        SELECT heart_rate FROM health_data
        WHERE device_id = d.id AND heart_rate IS NOT NULL
        ORDER BY timestamp DESC LIMIT 1
    ) AS heart_rate,
    (
        SELECT blood_pressure_systolic FROM health_data
        WHERE device_id = d.id AND blood_pressure_systolic IS NOT NULL
        ORDER BY timestamp DESC LIMIT 1
    ) AS blood_pressure_systolic,
    (
        SELECT blood_pressure_diastolic FROM health_data
        WHERE device_id = d.id AND blood_pressure_diastolic IS NOT NULL
        ORDER BY timestamp DESC LIMIT 1
    ) AS blood_pressure_diastolic,
    (
        SELECT spo2 FROM health_data
        WHERE device_id = d.id AND spo2 IS NOT NULL
        ORDER BY timestamp DESC LIMIT 1
    ) AS spo2,
    (
        SELECT body_temperature FROM health_data
        WHERE device_id = d.id AND body_temperature IS NOT NULL
        ORDER BY timestamp DESC LIMIT 1
    ) AS body_temperature,
    (
        SELECT battery_level FROM health_data
        WHERE device_id = d.id AND battery_level IS NOT NULL
        ORDER BY timestamp DESC LIMIT 1
    ) AS battery_level,
    (
        SELECT timestamp FROM health_data
        WHERE device_id = d.id
        ORDER BY timestamp DESC LIMIT 1
    ) AS timestamp
FROM devices d;

-- الإنذارات غير المُعالجة
CREATE OR REPLACE VIEW unhandled_alerts AS
SELECT 
    a.id,
    a.device_id,
    d.imei,
    d.user_name,
    d.user_phone,
    a.alert_type,
    a.timestamp,
    a.latitude,
    a.longitude,
    a.created_at
FROM alerts a
JOIN devices d ON a.device_id = d.id
WHERE a.is_handled = false
ORDER BY a.created_at DESC;

-- إدراج بيانات تجريبية (اختياري)
-- INSERT INTO devices (imei, user_name, user_phone, sim_number) 
-- VALUES ('353456789012345', 'أحمد محمد', '+962791234567', '0791234567');
