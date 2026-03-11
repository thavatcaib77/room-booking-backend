-- ================================================================
-- Migration: เพิ่มฟีเจอร์ Email, Recurring Booking, Reports
-- รัน query นี้ใน pgAdmin ก่อน restart backend
-- ================================================================

-- 1. เพิ่มคอลัมน์ reminder_sent ในตาราง bookings
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. สร้างตาราง recurring_booking_groups
CREATE TABLE IF NOT EXISTS recurring_booking_groups (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id             UUID         NOT NULL REFERENCES rooms(id),
    created_by          UUID         NOT NULL REFERENCES users(id),
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    attendee_count      INT          NOT NULL,
    start_time_of_day   TIME         NOT NULL,
    end_time_of_day     TIME         NOT NULL,
    recurrence_type     VARCHAR(20)  NOT NULL CHECK (recurrence_type IN ('weekly','monthly','custom')),
    days_of_week        JSONB,       -- [1,2,3,4,5] สำหรับ weekly
    interval_days       INT,         -- สำหรับ custom
    start_date          DATE         NOT NULL,
    end_date            DATE         NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 3. เพิ่ม foreign key ใน bookings -> recurring_booking_groups
ALTER TABLE bookings
    ADD COLUMN IF NOT EXISTS recurring_group_id UUID REFERENCES recurring_booking_groups(id) ON DELETE SET NULL;

-- 4. Index สำหรับ reminder cron
CREATE INDEX IF NOT EXISTS idx_bookings_reminder
    ON bookings (status, reminder_sent, start_time)
    WHERE status = 'approved' AND reminder_sent = FALSE;

-- 5. Index สำหรับ reports query
CREATE INDEX IF NOT EXISTS idx_bookings_start_time ON bookings (start_time);
CREATE INDEX IF NOT EXISTS idx_bookings_recurring   ON bookings (recurring_group_id);

-- ตรวจสอบ
SELECT 'Migration สำเร็จ! ✓' AS result;

-- ─── เพิ่ม token columns ใน users ─────────────────────────────
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS access_token  TEXT,
    ADD COLUMN IF NOT EXISTS refresh_token TEXT;
