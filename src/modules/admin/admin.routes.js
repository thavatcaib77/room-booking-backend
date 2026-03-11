// src/modules/admin/admin.routes.js
import express from 'express';
import { pool } from '../../config/db.js';
import { requireRole } from '../../middleware/auth.js';
import { syncThaiHolidays } from '../holidays/holidaySync.service.js';

const router = express.Router();

// เฉพาะ super_admin
router.use(requireRole('super_admin'));

// ─── Dashboard Stats ──────────────────────────────────
router.get('/stats', async (req, res, next) => {
    try {
        const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

        const [totalRooms, totalUsers, bookingsToday, pendingCount,
               bookingsMonth, topRooms] = await Promise.all([
            // ห้องทั้งหมด (ทุก status)
            pool.query('SELECT COUNT(*) FROM rooms'),
            // ผู้ใช้งานที่ active
            pool.query('SELECT COUNT(*) FROM users WHERE is_active = TRUE'),
            // จองวันนี้ (approved + pending)
            pool.query(`
                SELECT COUNT(*) FROM bookings
                WHERE DATE(start_time AT TIME ZONE 'Asia/Bangkok') = $1
                  AND status IN ('pending','approved')
            `, [today]),
            // รออนุมัติ
            pool.query("SELECT COUNT(*) FROM bookings WHERE status = 'pending'"),
            // จอง 30 วันที่ผ่านมา
            pool.query("SELECT COUNT(*) FROM bookings WHERE created_at >= NOW() - INTERVAL '30 days'"),
            // ห้องยอดนิยม
            pool.query(`
                SELECT r.name, r.code, COUNT(b.id) AS booking_count
                FROM rooms r LEFT JOIN bookings b ON b.room_id = r.id
                  AND b.created_at >= NOW() - INTERVAL '30 days'
                  AND b.status = 'approved'
                GROUP BY r.id ORDER BY booking_count DESC LIMIT 5
            `),
        ]);

        res.json({
            // field ที่ frontend ใช้
            total_rooms:         parseInt(totalRooms.rows[0].count),
            total_users:         parseInt(totalUsers.rows[0].count),
            bookings_today:      parseInt(bookingsToday.rows[0].count),
            pending_count:       parseInt(pendingCount.rows[0].count),
            // ข้อมูลเสริม
            bookings_this_month: parseInt(bookingsMonth.rows[0].count),
            top_rooms:           topRooms.rows,
        });
    } catch (err) { next(err); }
});

// ─── Users Management ─────────────────────────────────
router.get('/users', async (req, res, next) => {
    try {
        const { role, search } = req.query;
        const params = [];
        let query = `
            SELECT id, email, full_name, avatar_url, role, department, is_active, created_at
            FROM users WHERE 1=1
        `;
        if (role)   { params.push(role);   query += ` AND role = $${params.length}`; }
        if (search) { params.push(`%${search}%`); query += ` AND (full_name ILIKE $${params.length} OR email ILIKE $${params.length})`; }
        query += ' ORDER BY created_at DESC';

        const result = await pool.query(query, params);
        res.json({ users: result.rows, total: result.rowCount });
    } catch (err) { next(err); }
});

router.patch('/users/:id/role', async (req, res, next) => {
    try {
        const { role } = req.body;
        const validRoles = ['student', 'staff', 'mlii_staff', 'room_admin', 'super_admin'];
        if (!validRoles.includes(role)) return res.status(400).json({ error: 'role ไม่ถูกต้อง' });

        const result = await pool.query(
            'UPDATE users SET role = $1::user_role WHERE id = $2 RETURNING id, email, full_name, role',
            [role, req.params.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'ไม่พบผู้ใช้' });
        res.json({ message: 'เปลี่ยน Role สำเร็จ', user: result.rows[0] });
    } catch (err) { next(err); }
});

// ─── Room Admin Assignment ────────────────────────────
router.post('/rooms/:roomId/admins', async (req, res, next) => {
    try {
        const { user_id } = req.body;
        await pool.query(
            'INSERT INTO room_admins (room_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [req.params.roomId, user_id]
        );
        // อัปเดต role ของ user เป็น room_admin ด้วย
        await pool.query(
            "UPDATE users SET role = 'room_admin'::user_role WHERE id = $1 AND role = 'student'::user_role",
            [user_id]
        );
        res.json({ message: 'กำหนดผู้ดูแลห้องสำเร็จ' });
    } catch (err) { next(err); }
});

router.delete('/rooms/:roomId/admins/:userId', async (req, res, next) => {
    try {
        await pool.query(
            'DELETE FROM room_admins WHERE room_id = $1 AND user_id = $2',
            [req.params.roomId, req.params.userId]
        );
        res.json({ message: 'ลบผู้ดูแลห้องสำเร็จ' });
    } catch (err) { next(err); }
});

// ─── Holidays Management ──────────────────────────────
router.get('/holidays', async (req, res, next) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const result = await pool.query(
            'SELECT * FROM thai_public_holidays WHERE year = $1 ORDER BY date', [year]
        );
        res.json({ year, holidays: result.rows, total: result.rowCount });
    } catch (err) { next(err); }
});

router.post('/holidays/sync/:year', async (req, res, next) => {
    try {
        const year = parseInt(req.params.year);
        const result = await syncThaiHolidays(year);
        res.json({ message: `ซิงค์วันหยุดปี ${year} สำเร็จ`, ...result });
    } catch (err) { next(err); }
});

router.post('/holidays', async (req, res, next) => {
    try {
        const { date, name_th, name_en, is_substitution } = req.body;
        if (!date || !name_th) return res.status(400).json({ error: 'กรุณาระบุ date และ name_th' });

        const result = await pool.query(
            `INSERT INTO thai_public_holidays (date, name_th, name_en, is_substitution, created_by)
             VALUES ($1,$2,$3,$4,$5)
             ON CONFLICT (date) DO UPDATE SET name_th=EXCLUDED.name_th, name_en=EXCLUDED.name_en, is_substitution=EXCLUDED.is_substitution
             RETURNING *`,
            [date, name_th, name_en ?? null, is_substitution ?? false, req.user.id]
        );
        res.status(201).json({ holiday: result.rows[0] });
    } catch (err) { next(err); }
});

router.delete('/holidays/:id', async (req, res, next) => {
    try {
        const result = await pool.query(
            'DELETE FROM thai_public_holidays WHERE id = $1 RETURNING date, name_th',
            [req.params.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'ไม่พบวันหยุด' });
        res.json({ message: `ลบ "${result.rows[0].name_th}" สำเร็จ` });
    } catch (err) { next(err); }
});


// ─── Pre-approved Emails ──────────────────────────────
router.get('/pre-approved-emails', async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT p.*, u.full_name AS created_by_name
            FROM pre_approved_emails p
            LEFT JOIN users u ON u.id = p.created_by
            ORDER BY p.created_at DESC
        `);
        res.json({ emails: result.rows });
    } catch (err) { next(err); }
});

router.post('/pre-approved-emails', async (req, res, next) => {
    try {
        const { email, role, note } = req.body;
        if (!email) return res.status(400).json({ error: 'กรุณาระบุอีเมล' });
        const validRoles = ['student', 'staff', 'mlii_staff', 'room_admin'];
        const assignRole = validRoles.includes(role) ? role : 'staff';

        // ถ้า user มีในระบบแล้วให้อัปเดต role ทันที
        const existing = await pool.query('SELECT id FROM users WHERE email=$1', [email]);
        if (existing.rows[0]) {
            await pool.query('UPDATE users SET role=$1::user_role WHERE id=$2', [assignRole, existing.rows[0].id]);
        }

        const result = await pool.query(
            `INSERT INTO pre_approved_emails (email, role, note, created_by)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (email) DO UPDATE SET role=EXCLUDED.role, note=EXCLUDED.note
             RETURNING *`,
            [email.toLowerCase().trim(), assignRole, note ?? null, req.user.id]
        );
        res.status(201).json({ email: result.rows[0] });
    } catch (err) { next(err); }
});

router.delete('/pre-approved-emails/:id', async (req, res, next) => {
    try {
        const result = await pool.query(
            'DELETE FROM pre_approved_emails WHERE id=$1 RETURNING email',
            [req.params.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'ไม่พบอีเมล' });
        res.json({ message: `ลบ ${result.rows[0].email} สำเร็จ` });
    } catch (err) { next(err); }
});

// ─── Booking Reports ──────────────────────────────────
router.get('/reports/bookings', async (req, res, next) => {
    try {
        const { from, to } = req.query;
        const result = await pool.query(`
            SELECT
                DATE_TRUNC('day', b.start_time AT TIME ZONE 'Asia/Bangkok') AS date,
                COUNT(*) FILTER (WHERE b.status = 'approved')  AS approved,
                COUNT(*) FILTER (WHERE b.status = 'rejected')  AS rejected,
                COUNT(*) FILTER (WHERE b.status = 'cancelled') AS cancelled,
                COUNT(*) FILTER (WHERE b.status = 'pending')   AS pending
            FROM bookings b
            WHERE b.start_time >= COALESCE($1::TIMESTAMPTZ, NOW() - INTERVAL '30 days')
              AND b.start_time <= COALESCE($2::TIMESTAMPTZ, NOW())
            GROUP BY 1 ORDER BY 1
        `, [from ?? null, to ?? null]);
        res.json({ report: result.rows });
    } catch (err) { next(err); }
});

export default router;