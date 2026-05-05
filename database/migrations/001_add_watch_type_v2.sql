-- ═══════════════════════════════════════════════════════════════
-- Migration 001: إضافة دعم الساعات الجديدة (Health Watch v2)
-- Additive only — لا يُعدّل أي عمود/جدول قائم
-- ═══════════════════════════════════════════════════════════════

-- 1) أعمدة جديدة على جدول devices للتمييز بين أنواع الساعات
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS watch_type VARCHAR(20) DEFAULT 'iw_legacy';

-- ملاحظة: عمود device_model موجود مسبقاً بـ VARCHAR(50). لا نلمسه.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS bind_status SMALLINT DEFAULT 0;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS firmware_v VARCHAR(50);

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS battery_level INTEGER;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS battery_state SMALLINT;

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS last_heartbeat TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_devices_watch_type ON devices(watch_type);

-- 2) جدول لتتبع الـ pending requests للـ ident-matching
--    (مفيد لربط الطلب الصادر من السيرفر بالرد القادم من الجهاز)
CREATE TABLE IF NOT EXISTS v2_pending_requests (
  id SERIAL PRIMARY KEY,
  imei VARCHAR(20) NOT NULL,
  ident BIGINT NOT NULL,
  request_type VARCHAR(50) NOT NULL,
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  responded_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_v2_pending_imei_ident
  ON v2_pending_requests(imei, ident);

-- 3) سجل خام للرسائل الواردة (مفيد للتشخيص — اختياري الاستخدام)
CREATE TABLE IF NOT EXISTS v2_message_log (
  id SERIAL PRIMARY KEY,
  imei VARCHAR(20),
  direction VARCHAR(4) NOT NULL, -- 'IN' | 'OUT'
  msg_type VARCHAR(50),
  ident BIGINT,
  ref VARCHAR(20),
  payload JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_message_log_imei_time
  ON v2_message_log(imei, created_at DESC);

-- 4) جدول للـ activity (run/walk/sleep) — لا يوجد مكان مناسب بالـ schema الحالي
CREATE TABLE IF NOT EXISTS v2_activity (
  id SERIAL PRIMARY KEY,
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  imei VARCHAR(20) NOT NULL,
  activity_type VARCHAR(30) NOT NULL, -- upRun, upWalk, upSleep, ...
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  duration_seconds INTEGER,
  consumed_kcal INTEGER,
  mileage_km NUMERIC(7, 2),
  step_count INTEGER,
  payload JSONB,                       -- نخزن الـ raw payload للحفاظ على كل الحقول
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_activity_imei_time
  ON v2_activity(imei, start_time DESC);

-- 5) جدول لإعدادات الجهاز الواردة (upDeviceConfig)
CREATE TABLE IF NOT EXISTS v2_device_configs (
  id SERIAL PRIMARY KEY,
  device_id INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  imei VARCHAR(20) NOT NULL,
  configs JSONB NOT NULL,
  received_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_device_configs_imei_time
  ON v2_device_configs(imei, received_at DESC);
