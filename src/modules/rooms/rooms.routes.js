// src/modules/rooms/rooms.routes.js
import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoomAdmin, requireRole } from '../../middleware/auth.js';

const router = express.Router();

// ══════════════════════════════════════════════════════════
//  STATIC ROUTES ก่อน (ต้องอยู่เหนือ /:id ทั้งหมด)
// ══════════════════════════════════════════════════════════

// ─── GET /api/rooms/managed/mine ─────────────────────────
router.get('/managed/mine', requireRole('room_admin', 'super_admin'), async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT r.id, r.name, r.code, r.floor, r.capacity, r.status, r.description,
                   r.color_hex, r.notify_admin_email, r.google_calendar_id,
                   r.building_id, bu.name AS building_name,
                   COALESCE(
                       JSON_AGG(JSONB_BUILD_OBJECT('id',a.id,'name',a.name,'icon',a.icon))
                       FILTER (WHERE a.id IS NOT NULL), '[]'
                   ) AS amenities
            FROM rooms r
            JOIN buildings bu ON bu.id = r.building_id
            JOIN room_admins ra ON ra.room_id = r.id
            LEFT JOIN room_amenities rma ON rma.room_id = r.id
            LEFT JOIN amenities a ON a.id = rma.amenity_id
            WHERE ra.user_id = $1
            GROUP BY r.id, bu.name
            ORDER BY r.name
        `, [req.user.id]);
        res.json({ rooms: result.rows });
    } catch (err) { next(err); }
});

// ─── GET /api/rooms/buildings/all ────────────────────────
router.get('/buildings/all', requireAuth, async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM buildings ORDER BY name');
        res.json({ buildings: result.rows });
    } catch (err) { next(err); }
});

// ─── GET /api/rooms/amenities/all ────────────────────────
router.get('/amenities/all', requireAuth, async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM amenities ORDER BY name');
        res.json({ amenities: result.rows });
    } catch (err) { next(err); }
});

// ─── POST /api/rooms/buildings ───────────────────────────
router.post('/buildings', requireAuth, async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        const { name, code, address } = req.body;
        if (!name?.trim() || !code?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อและรหัสอาคาร' });
        const result = await pool.query(
            'INSERT INTO buildings (name, code, address) VALUES ($1,$2,$3) RETURNING *',
            [name.trim(), code.trim(), address?.trim() ?? null]
        );
        res.status(201).json({ building: result.rows[0] });
    } catch (err) { next(err); }
});

// ─── PATCH /api/rooms/buildings/:id ──────────────────────
router.patch('/buildings/:id', requireAuth, async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        const { name, code, address } = req.body;
        const result = await pool.query(
            `UPDATE buildings SET
                name    = COALESCE($1, name),
                code    = COALESCE($2, code),
                address = COALESCE($3, address)
             WHERE id = $4 RETURNING *`,
            [name?.trim() ?? null, code?.trim() ?? null, address?.trim() ?? null, req.params.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'ไม่พบอาคาร' });
        res.json({ building: result.rows[0] });
    } catch (err) { next(err); }
});

// ─── DELETE /api/rooms/buildings/:id ─────────────────────
router.delete('/buildings/:id', requireAuth, async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        const inUse = await pool.query('SELECT COUNT(*) FROM rooms WHERE building_id=$1', [req.params.id]);
        if (parseInt(inUse.rows[0].count) > 0)
            return res.status(400).json({ error: `ไม่สามารถลบได้ มีห้องอยู่ ${inUse.rows[0].count} ห้อง` });
        await pool.query('DELETE FROM buildings WHERE id=$1', [req.params.id]);
        res.json({ message: 'ลบสำเร็จ' });
    } catch (err) { next(err); }
});

// ─── POST /api/rooms/amenities ───────────────────────────
router.post('/amenities', requireAuth, async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        const { name, icon } = req.body;
        if (!name?.trim()) return res.status(400).json({ error: 'กรุณาระบุชื่อสิ่งอำนวยความสะดวก' });
        const result = await pool.query(
            'INSERT INTO amenities (name, icon) VALUES ($1,$2) RETURNING *',
            [name.trim(), icon?.trim() ?? '🏷️']
        );
        res.status(201).json({ amenity: result.rows[0] });
    } catch (err) { next(err); }
});

// ─── PATCH /api/rooms/amenities/:id ──────────────────────
router.patch('/amenities/:id', requireAuth, async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        const { name, icon } = req.body;
        const result = await pool.query(
            'UPDATE amenities SET name=COALESCE($1,name), icon=COALESCE($2,icon) WHERE id=$3 RETURNING *',
            [name?.trim() ?? null, icon?.trim() ?? null, req.params.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
        res.json({ amenity: result.rows[0] });
    } catch (err) { next(err); }
});

// ─── DELETE /api/rooms/amenities/:id ─────────────────────
router.delete('/amenities/:id', requireAuth, async (req, res, next) => {
    try {
        if (req.user.role !== 'super_admin') return res.status(403).json({ error: 'ไม่มีสิทธิ์' });
        const inUse = await pool.query('SELECT COUNT(*) FROM room_amenities WHERE amenity_id=$1', [req.params.id]);
        if (parseInt(inUse.rows[0].count) > 0)
            return res.status(400).json({ error: `ไม่สามารถลบได้ มีห้องใช้งาน ${inUse.rows[0].count} ห้อง` });
        await pool.query('DELETE FROM amenities WHERE id=$1', [req.params.id]);
        res.json({ message: 'ลบสำเร็จ' });
    } catch (err) { next(err); }
});

// ══════════════════════════════════════════════════════════
//  COLLECTION ROUTES
// ══════════════════════════════════════════════════════════

// ─── GET /api/rooms — ค้นหาห้องว่าง ──────────────────────
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const { date, start, end, capacity, amenities, all } = req.query;
        const isAdmin = ['super_admin', 'room_admin'].includes(req.user.role);

        let query = `
            SELECT r.id, r.name, r.code, r.floor, r.capacity, r.status,
                   r.description, r.cover_image_url, r.building_id, r.allowed_booking_roles,
                   r.color_hex, r.notify_admin_email, r.google_calendar_id,
                   bu.name AS building_name,
                   COALESCE(
                       JSON_AGG(JSONB_BUILD_OBJECT('id',a.id,'name',a.name,'icon',a.icon))
                       FILTER (WHERE a.id IS NOT NULL), '[]'
                   ) AS amenities
            FROM rooms r
            JOIN buildings bu ON bu.id = r.building_id
            LEFT JOIN room_amenities ra ON ra.room_id = r.id
            LEFT JOIN amenities a ON a.id = ra.amenity_id
            WHERE 1=1
        `;
        const params = [];

        // admin + all=true → ดึงทุก status, อื่นๆ → เฉพาะ available
        if (!(isAdmin && all === 'true')) {
            query += ` AND r.status = 'available'`;
        }

        if (capacity) { params.push(capacity); query += ` AND r.capacity >= $${params.length}`; }
        query += ' GROUP BY r.id, bu.name ORDER BY bu.name, r.floor, r.name';
        const result = await pool.query(query, params);
        res.json({ rooms: result.rows });
    } catch (err) { next(err); }
});

// ─── POST /api/rooms — สร้างห้องใหม่ ─────────────────────
router.post('/', requireRole('super_admin'), async (req, res, next) => {
    const client = await pool.connect();
    try {
        const { building_id, name, code, floor, capacity, description,
                cover_image_url, google_calendar_id, amenity_ids, operating_hours,
                allowed_booking_roles, color_hex, notify_admin_email } = req.body;
        if (!building_id || !name || !code || !capacity)
            return res.status(400).json({ error: 'กรุณาระบุข้อมูลที่จำเป็น' });

        await client.query('BEGIN');
        const room = await client.query(
            `INSERT INTO rooms (building_id, name, code, floor, capacity, description, cover_image_url, google_calendar_id, allowed_booking_roles, color_hex, notify_admin_email)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
            [building_id, name, code, floor ?? null, capacity, description ?? null, cover_image_url ?? null,
             google_calendar_id || null, allowed_booking_roles?.length ? allowed_booking_roles : null,
             color_hex ?? null, notify_admin_email !== false]
        );
        const roomId = room.rows[0].id;

        if (amenity_ids?.length) {
            for (const aid of amenity_ids) {
                await client.query(
                    'INSERT INTO room_amenities (room_id, amenity_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
                    [roomId, aid]
                );
            }
        }

        const hours = operating_hours ?? [1,2,3,4,5].map(d => ({
            day_of_week: d, open_time: '08:00', close_time: '18:00'
        }));
        for (const h of hours) {
            await client.query(
                `INSERT INTO room_operating_hours (room_id, day_of_week, open_time, close_time)
                 VALUES ($1,$2,$3,$4)`,
                [roomId, h.day_of_week, h.open_time, h.close_time]
            );
        }
        await client.query('COMMIT');
        res.status(201).json({ message: 'สร้างห้องสำเร็จ', room: room.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally { client.release(); }
});

// ══════════════════════════════════════════════════════════
//  PARAM ROUTES  /:id  (ต้องอยู่หลัง static ทั้งหมด)
// ══════════════════════════════════════════════════════════

// ─── GET /api/rooms/:id ───────────────────────────────────
router.get('/:id', requireAuth, async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT r.*, bu.name AS building_name,
                   COALESCE(
                       JSON_AGG(JSONB_BUILD_OBJECT('id',a.id,'name',a.name,'icon',a.icon))
                       FILTER (WHERE a.id IS NOT NULL), '[]'
                   ) AS amenities,
                   COALESCE(
                       JSON_AGG(JSONB_BUILD_OBJECT(
                           'day_of_week', oh.day_of_week,
                           'open_time',   oh.open_time,
                           'close_time',  oh.close_time
                       )) FILTER (WHERE oh.id IS NOT NULL), '[]'
                   ) AS operating_hours
            FROM rooms r
            JOIN buildings bu ON bu.id = r.building_id
            LEFT JOIN room_amenities rma ON rma.room_id = r.id
            LEFT JOIN amenities a ON a.id = rma.amenity_id
            LEFT JOIN room_operating_hours oh ON oh.room_id = r.id
            WHERE r.id = $1
            GROUP BY r.id, bu.name
        `, [req.params.id]);
        if (!result.rows[0]) return res.status(404).json({ error: 'ไม่พบห้อง' });
        res.json(result.rows[0]);
    } catch (err) { next(err); }
});

// ─── PATCH /api/rooms/:id — แก้ไขห้อง (ครบทุก field) ────
router.patch('/:id', requireRole('super_admin'), async (req, res, next) => {
    const client = await pool.connect();
    try {
        const { building_id, name, code, floor, capacity,
                description, cover_image_url, google_calendar_id, allowed_booking_roles, status,
                color_hex, notify_admin_email,
                amenity_ids, operating_hours } = req.body;

        await client.query('BEGIN');

        // Dynamic UPDATE — เพิ่ม field เฉพาะที่ส่งมา
        const fields = [];
        const params = [];
        const push = (col, val) => { params.push(val); fields.push(`${col} = $${params.length}`); };

        if (building_id   !== undefined) push('building_id',   building_id);
        if (name          !== undefined) push('name',          name);
        if (code          !== undefined) push('code',          code);
        if (floor         !== undefined) push('floor',         floor ?? null);
        if (capacity      !== undefined) push('capacity',      capacity);
        if (description   !== undefined) push('description',   description ?? null);
        if (cover_image_url !== undefined) push('cover_image_url', cover_image_url || null);
        if (google_calendar_id !== undefined) push('google_calendar_id', google_calendar_id || null);
        if (status        !== undefined) push('status',        status);
        if (color_hex          !== undefined) push('color_hex',          color_hex ?? null);
        if (notify_admin_email !== undefined) push('notify_admin_email', notify_admin_email !== false);

        // allowed_booking_roles ต้องแยกเพราะเป็น array type
        if (allowed_booking_roles !== undefined) {
            const val = (Array.isArray(allowed_booking_roles) && allowed_booking_roles.length > 0)
                ? allowed_booking_roles : null;
            params.push(val);
            fields.push(`allowed_booking_roles = $${params.length}::TEXT[]`);
        }

        fields.push('updated_at = NOW()');
        params.push(req.params.id);

        const result = await client.query(
            `UPDATE rooms SET ${fields.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        if (!result.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'ไม่พบห้องนี้' }); }

        // อัปเดต amenities (ถ้าส่งมา)
        if (Array.isArray(amenity_ids)) {
            await client.query('DELETE FROM room_amenities WHERE room_id=$1', [req.params.id]);
            for (const aid of amenity_ids) {
                await client.query(
                    'INSERT INTO room_amenities (room_id, amenity_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
                    [req.params.id, aid]
                );
            }
        }

        // อัปเดต operating hours (ถ้าส่งมา)
        if (Array.isArray(operating_hours) && operating_hours.length > 0) {
            await client.query('DELETE FROM room_operating_hours WHERE room_id=$1', [req.params.id]);
            for (const h of operating_hours) {
                await client.query(
                    `INSERT INTO room_operating_hours (room_id, day_of_week, open_time, close_time)
                     VALUES ($1,$2,$3,$4)`,
                    [req.params.id, h.day_of_week, h.open_time, h.close_time]
                );
            }
        }

        await client.query('COMMIT');
        res.json({ message: 'แก้ไขสำเร็จ', room: result.rows[0] });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally { client.release(); }
});

// ─── DELETE /api/rooms/:id ────────────────────────────────
router.delete('/:id', requireRole('super_admin'), async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // ห้ามลบถ้ายังมีการจองที่ pending หรือ approved อยู่
        const active = await client.query(
            "SELECT COUNT(*) FROM bookings WHERE room_id=$1 AND status IN ('pending','approved')",
            [req.params.id]
        );
        if (parseInt(active.rows[0].count) > 0) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'ไม่สามารถลบได้ มีการจองที่ยังไม่เสร็จสิ้น กรุณายกเลิกหรืออนุมัติการจองก่อน' });
        }

        // ลบข้อมูลที่เชื่อมกับห้องนี้ตามลำดับ
        await client.query('DELETE FROM notifications WHERE booking_id IN (SELECT id FROM bookings WHERE room_id=$1)', [req.params.id]);
        await client.query('DELETE FROM bookings WHERE room_id=$1', [req.params.id]);
        await client.query('DELETE FROM room_admins WHERE room_id=$1', [req.params.id]);
        await client.query('DELETE FROM room_amenities WHERE room_id=$1', [req.params.id]);
        await client.query('DELETE FROM room_operating_hours WHERE room_id=$1', [req.params.id]);
        await client.query('DELETE FROM room_closures WHERE room_id=$1', [req.params.id]);
        await client.query('DELETE FROM rooms WHERE id=$1', [req.params.id]);

        await client.query('COMMIT');
        res.json({ message: 'ลบห้องสำเร็จ' });
    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

// ─── GET /api/rooms/:id/admins ────────────────────────────
router.get('/:id/admins', requireRole('super_admin'), async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.full_name, u.email, u.avatar_url, ra.created_at
            FROM room_admins ra JOIN users u ON u.id = ra.user_id
            WHERE ra.room_id = $1 ORDER BY ra.created_at ASC
        `, [req.params.id]);
        res.json({ admins: result.rows });
    } catch (err) { next(err); }
});

// ─── POST /api/rooms/:id/admins ───────────────────────────
router.post('/:id/admins', requireRole('super_admin'), async (req, res, next) => {
    const client = await pool.connect();
    try {
        const { user_id } = req.body;
        if (!user_id) return res.status(400).json({ error: 'กรุณาระบุ user_id' });
        await client.query('BEGIN');
        await client.query(
            'INSERT INTO room_admins (room_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
            [req.params.id, user_id]
        );
        // upgrade role เป็น room_admin ถ้ายังไม่ใช่ admin
        await client.query(
            "UPDATE users SET role='room_admin'::user_role WHERE id=$1 AND role NOT IN ('room_admin'::user_role,'super_admin'::user_role)",
            [user_id]
        );
        await client.query('COMMIT');
        res.status(201).json({ message: 'เพิ่มผู้ดูแลสำเร็จ' });
    } catch (err) { await client.query('ROLLBACK'); next(err); }
    finally { client.release(); }
});

// ─── DELETE /api/rooms/:id/admins/:userId ─────────────────
router.delete('/:id/admins/:userId', requireRole('super_admin'), async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'DELETE FROM room_admins WHERE room_id=$1 AND user_id=$2',
            [req.params.id, req.params.userId]
        );
        // downgrade role ถ้าไม่มีห้องดูแลแล้ว
        const remaining = await client.query(
            'SELECT COUNT(*) FROM room_admins WHERE user_id=$1', [req.params.userId]
        );
        if (parseInt(remaining.rows[0].count) === 0) {
            await client.query(
                "UPDATE users SET role='staff'::user_role WHERE id=$1 AND role='room_admin'::user_role",
                [req.params.userId]
            );
        }
        await client.query('COMMIT');
        res.json({ message: 'ลบผู้ดูแลสำเร็จ' });
    } catch (err) { await client.query('ROLLBACK'); next(err); }
    finally { client.release(); }
});

// ─── GET /api/rooms/:id/bookings ─────────────────────────
router.get('/:id/bookings', requireAuth, async (req, res, next) => {
    try {
        const { from, to } = req.query;
        const result = await pool.query(`
            SELECT b.id, b.title, b.start_time, b.end_time, b.status, b.attendee_count,
                   u.full_name AS booked_by_name, u.avatar_url
            FROM bookings b JOIN users u ON u.id = b.booked_by
            WHERE b.room_id=$1 AND b.status IN ('pending','approved')
              AND b.start_time >= COALESCE($2::TIMESTAMPTZ, NOW())
              AND b.end_time   <= COALESCE($3::TIMESTAMPTZ, NOW() + INTERVAL '30 days')
            ORDER BY b.start_time ASC
        `, [req.params.id, from ?? null, to ?? null]);
        res.json({ bookings: result.rows });
    } catch (err) { next(err); }
});

// ─── GET /api/rooms/:id/closures ─────────────────────────
router.get('/:id/closures', requireAuth, async (req, res, next) => {
    try {
        const result = await pool.query(
            'SELECT * FROM room_closures WHERE room_id=$1 AND end_datetime >= NOW() ORDER BY start_datetime',
            [req.params.id]
        );
        res.json({ closures: result.rows });
    } catch (err) { next(err); }
});

// ─── POST /api/rooms/:id/closures ────────────────────────
router.post('/:id/closures', requireRoomAdmin, async (req, res, next) => {
    try {
        const { closure_type, start_datetime, end_datetime, reason, notify_bookers } = req.body;
        if (!start_datetime || !end_datetime || !reason)
            return res.status(400).json({ error: 'กรุณาระบุช่วงเวลาและเหตุผล' });
        const result = await pool.query(
            `INSERT INTO room_closures (room_id, closure_type, start_datetime, end_datetime, reason, notify_bookers, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [req.params.id, closure_type ?? 'full_day', start_datetime, end_datetime,
             reason, notify_bookers ?? true, req.user.id]
        );
        res.status(201).json({ message: 'ปิดห้องชั่วคราวสำเร็จ', closure: result.rows[0] });
    } catch (err) { next(err); }
});

// ─── DELETE /api/rooms/:id/closures/:cid ─────────────────
router.delete('/:id/closures/:cid', requireRoomAdmin, async (req, res, next) => {
    try {
        await pool.query('DELETE FROM room_closures WHERE id=$1 AND room_id=$2', [req.params.cid, req.params.id]);
        res.json({ message: 'ยกเลิกการปิดห้องสำเร็จ' });
    } catch (err) { next(err); }
});

export default router;