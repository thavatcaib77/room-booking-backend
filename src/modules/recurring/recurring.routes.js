// src/modules/recurring/recurring.routes.js
import express from 'express';
import { z }   from 'zod';
import { pool } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import { addDays, addWeeks, addMonths, format } from 'date-fns';

const router = express.Router();

// ─── Schema ──────────────────────────────────────────
const RecurringSchema = z.object({
    room_id:        z.string().uuid(),
    title:          z.string().min(1).max(255),
    description:    z.string().optional(),
    attendee_count: z.number().int().min(1),

    // วันและเวลา (date เป็น YYYY-MM-DD, time เป็น HH:mm)
    start_date:  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    start_time:  z.string().regex(/^\d{2}:\d{2}$/),
    end_time:    z.string().regex(/^\d{2}:\d{2}$/),

    // รูปแบบการจองซ้ำ
    recurrence_type: z.enum(['weekly', 'monthly', 'custom']),
    // weekly: เลือกวันในสัปดาห์ [1=จ, 2=อ, ... 5=ศ]
    days_of_week:    z.array(z.number().int().min(1).max(5)).optional(),
    // custom: ทุก N วัน
    interval_days:   z.number().int().min(1).max(365).optional(),

    attendee_emails: z.array(z.string().email()).optional(),
});

// ─── สร้าง dates ทั้งหมดจาก recurrence pattern ──────
function generateDates({ start_date, end_date, recurrence_type, days_of_week, interval_days }) {
    const dates = [];
    const end   = new Date(end_date + 'T23:59:59');
    let   cur   = new Date(start_date);

    if (recurrence_type === 'weekly') {
        // วนทุกวันตั้งแต่ start_date ถึง end_date
        while (cur <= end) {
            const dow = cur.getDay() === 0 ? 7 : cur.getDay(); // 1=จ..7=อา
            if (days_of_week?.includes(dow)) {
                dates.push(format(cur, 'yyyy-MM-dd'));
            }
            cur = addDays(cur, 1);
        }
    } else if (recurrence_type === 'monthly') {
        // วันเดิมทุกเดือน
        while (cur <= end) {
            dates.push(format(cur, 'yyyy-MM-dd'));
            cur = addMonths(cur, 1);
        }
    } else if (recurrence_type === 'custom') {
        // ทุก N วัน
        while (cur <= end) {
            dates.push(format(cur, 'yyyy-MM-dd'));
            cur = addDays(cur, interval_days ?? 7);
        }
    }

    return dates.slice(0, 60); // จำกัดสูงสุด 60 ครั้ง
}

// ─── POST /api/recurring — สร้างการจองซ้ำ ────────────
router.post('/', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const data = RecurringSchema.parse(req.body);

        // Validate
        if (data.recurrence_type === 'weekly' && !data.days_of_week?.length) {
            return res.status(400).json({ error: 'กรุณาเลือกวันในสัปดาห์สำหรับการจองซ้ำรายสัปดาห์' });
        }
        if (data.recurrence_type === 'custom' && !data.interval_days) {
            return res.status(400).json({ error: 'กรุณาระบุจำนวนวันสำหรับการจองซ้ำแบบกำหนดเอง' });
        }

        // ตรวจสอบ capacity
        const room = await pool.query(
            'SELECT * FROM rooms WHERE id = $1 AND status = $2',
            [data.room_id, 'available']
        );
        if (!room.rows[0]) return res.status(404).json({ error: 'ไม่พบห้องหรือห้องไม่พร้อมใช้งาน' });
        if (data.attendee_count > room.rows[0].capacity) {
            return res.status(400).json({ error: `เกินความจุห้อง (สูงสุด ${room.rows[0].capacity} คน)` });
        }

        // สร้าง dates
        const dates = generateDates(data);
        if (!dates.length) {
            return res.status(400).json({ error: 'ไม่พบวันที่ตรงกับเงื่อนไขที่ระบุ' });
        }

        await client.query('BEGIN');

        // สร้าง recurring_group
        const group = await client.query(
            `INSERT INTO recurring_booking_groups
                (room_id, created_by, title, description, attendee_count,
                 start_time_of_day, end_time_of_day, recurrence_type,
                 days_of_week, interval_days, start_date, end_date)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
            [data.room_id, req.user.id, data.title, data.description ?? null,
             data.attendee_count, data.start_time, data.end_time,
             data.recurrence_type,
             data.days_of_week ? JSON.stringify(data.days_of_week) : null,
             data.interval_days ?? null,
             data.start_date, data.end_date]
        );
        const groupId = group.rows[0].id;

        // สร้าง bookings ทีละวัน
        const created = [], skipped = [];
        for (const date of dates) {
            const startDT = `${date}T${data.start_time}:00+07:00`;
            const endDT   = `${date}T${data.end_time}:00+07:00`;
            try {
                const b = await client.query(
                    `INSERT INTO bookings
                        (room_id, booked_by, title, description, attendee_count,
                         start_time, end_time, recurring_group_id)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, start_time`,
                    [data.room_id, req.user.id, data.title, data.description ?? null,
                     data.attendee_count, startDT, endDT, groupId]
                );
                created.push({ id: b.rows[0].id, date });

                // เพิ่มผู้เข้าร่วม
                for (const email of data.attendee_emails ?? []) {
                    await client.query(
                        'INSERT INTO booking_attendees (booking_id, email) VALUES ($1,$2)',
                        [b.rows[0].id, email]
                    );
                }
            } catch (err) {
                // Trigger error = วันนั้นจองไม่ได้ (วันหยุด / ห้องปิด / ซ้อน)
                skipped.push({ date, reason: err.message });
            }
        }

        await client.query('COMMIT');

        logger.info(`[Recurring] Created ${created.length} bookings, skipped ${skipped.length}`);
        res.status(201).json({
            message:   `สร้างการจองซ้ำสำเร็จ ${created.length} ครั้ง`,
            group_id:  groupId,
            created:   created.length,
            skipped:   skipped.length,
            skipped_dates: skipped,
        });

    } catch (err) {
        await client.query('ROLLBACK');
        if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
        next(err);
    } finally {
        client.release();
    }
});

// ─── GET /api/recurring/my — ดู recurring groups ของฉัน ─
router.get('/my', requireAuth, async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT
                g.*,
                r.name AS room_name, bu.name AS building_name,
                COUNT(b.id) AS total_bookings,
                COUNT(b.id) FILTER (WHERE b.status = 'approved')  AS approved_count,
                COUNT(b.id) FILTER (WHERE b.status = 'pending')   AS pending_count,
                COUNT(b.id) FILTER (WHERE b.status = 'cancelled') AS cancelled_count,
                MIN(b.start_time) AS first_booking,
                MAX(b.start_time) AS last_booking
            FROM recurring_booking_groups g
            JOIN rooms r ON r.id = g.room_id
            JOIN buildings bu ON bu.id = r.building_id
            LEFT JOIN bookings b ON b.recurring_group_id = g.id
            WHERE g.created_by = $1
            GROUP BY g.id, r.name, bu.name
            ORDER BY g.created_at DESC
        `, [req.user.id]);

        res.json({ groups: result.rows });
    } catch (err) { next(err); }
});

// ─── DELETE /api/recurring/:groupId — ยกเลิกทั้ง group ─
router.delete('/:groupId', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ตรวจว่าเป็นเจ้าของ
        const group = await client.query(
            'SELECT * FROM recurring_booking_groups WHERE id = $1 AND created_by = $2',
            [req.params.groupId, req.user.id]
        );
        if (!group.rows[0]) return res.status(404).json({ error: 'ไม่พบกลุ่มการจองนี้' });

        // ยกเลิกเฉพาะที่ยัง pending/approved และยังไม่เกิดขึ้น
        const cancelled = await client.query(
            `UPDATE bookings SET status = 'cancelled'
             WHERE recurring_group_id = $1
               AND status IN ('pending','approved')
               AND start_time > NOW()
             RETURNING id`,
            [req.params.groupId]
        );

        await client.query('COMMIT');
        res.json({
            message: `ยกเลิกการจองซ้ำสำเร็จ ${cancelled.rowCount} รายการ`,
            cancelled_count: cancelled.rowCount,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

// ─── GET /api/recurring/:groupId/bookings — ดูการจองทั้งหมดใน group ─
router.get('/:groupId/bookings', requireAuth, async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT b.id, b.title, b.start_time, b.end_time, b.status
            FROM bookings b
            WHERE b.recurring_group_id = $1 AND b.booked_by = $2
            ORDER BY b.start_time ASC
        `, [req.params.groupId, req.user.id]);

        res.json({ bookings: result.rows });
    } catch (err) { next(err); }
});

export default router;
