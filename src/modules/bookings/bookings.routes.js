// src/modules/bookings/bookings.routes.js
import express from 'express';
import { z }   from 'zod';
import { pool } from '../../config/db.js';
import { requireAuth, requireRoomAdmin } from '../../middleware/auth.js';
import { logger } from '../../utils/logger.js';
import {
    createUserCalendarEvent,
    createRoomCalendarEvent,
    deleteCalendarEvent,
    updateCalendarEvent,
} from './googleCalendar.service.js';
import {
    sendEmail, formatBookingInfo,
    newBookingRequestTemplate,
    bookingSubmittedTemplate,
    bookingApprovedTemplate,
    bookingRejectedTemplate,
} from '../email/email.service.js';

const router = express.Router();

// ─── Schema ──────────────────────────────────────────
const BookingSchema = z.object({
    room_id:        z.string().uuid(),
    title:          z.string().min(1).max(255),
    description:    z.string().optional(),
    attendee_count: z.number().int().min(1),
    start_time:     z.string().datetime({ offset: true }),
    end_time:       z.string().datetime({ offset: true }),
    attendee_emails: z.array(z.string().email()).optional(),
});

// ─── GET /api/bookings/my — การจองของฉัน ─────────────
router.get('/my', requireAuth, async (req, res, next) => {
    try {
        const { status, from, to } = req.query;
        const params = [req.user.id];
        let query = `
            SELECT
                b.id, b.title, b.description, b.start_time, b.end_time,
                b.status, b.attendee_count, b.created_at,
                r.name AS room_name, r.code AS room_code, r.floor,
                bu.name AS building_name
            FROM bookings b
            JOIN rooms r ON r.id = b.room_id
            JOIN buildings bu ON bu.id = r.building_id
            WHERE b.booked_by = $1
        `;

        if (status) { params.push(status); query += ` AND b.status = $${params.length}`; }
        if (from)   { params.push(from);   query += ` AND b.start_time >= $${params.length}::TIMESTAMPTZ`; }
        if (to)     { params.push(to);     query += ` AND b.end_time   <= $${params.length}::TIMESTAMPTZ`; }

        query += ' ORDER BY b.start_time DESC';

        const result = await pool.query(query, params);
        res.json({ bookings: result.rows, total: result.rowCount });
    } catch (err) { next(err); }
});

// ─── GET /api/bookings/pending — รอการอนุมัติ (Room Admin) ─
router.get('/pending', requireRoomAdmin, async (req, res, next) => {
    try {
        // room_admin เห็นเฉพาะห้องที่ตนดูแล
        const result = await pool.query(`
            SELECT
                b.id, b.title, b.description, b.start_time, b.end_time,
                b.attendee_count, b.created_at, b.room_id, b.reference_number,
                r.name AS room_name, r.code AS room_code,
                bu.name AS building_name,
                u.full_name AS booked_by_name, u.email AS booked_by_email,
                u.avatar_url, u.department
            FROM bookings b
            JOIN rooms r ON r.id = b.room_id
            JOIN buildings bu ON bu.id = r.building_id
            JOIN users u ON u.id = b.booked_by
            LEFT JOIN room_admins ra ON ra.room_id = r.id
            WHERE b.status = 'pending'
              AND (ra.user_id = $1 OR $2 = 'super_admin')
            ORDER BY b.created_at ASC
        `, [req.user.id, req.user.role]);

        res.json({ bookings: result.rows, total: result.rowCount });
    } catch (err) { next(err); }
});


// ─── GET /api/bookings/managed-rooms — ห้องที่ room_admin ดูแล ──
router.get('/managed-rooms', requireRoomAdmin, async (req, res, next) => {
    try {
        let rows;
        if (req.user.role === 'super_admin') {
            const r = await pool.query(`
                SELECT r.id, r.name, r.code, r.floor, bu.name AS building_name,
                    COUNT(b.id) FILTER (WHERE b.status = 'pending') AS pending_count
                FROM rooms r
                JOIN buildings bu ON bu.id = r.building_id
                LEFT JOIN bookings b ON b.room_id = r.id AND b.status = 'pending'
                GROUP BY r.id, r.name, r.code, r.floor, bu.name
                ORDER BY bu.name, r.floor, r.name
            `);
            rows = r.rows;
        } else {
            const r = await pool.query(`
                SELECT r.id, r.name, r.code, r.floor, bu.name AS building_name,
                    COUNT(b.id) FILTER (WHERE b.status = 'pending') AS pending_count
                FROM room_admins ra
                JOIN rooms r ON r.id = ra.room_id
                JOIN buildings bu ON bu.id = r.building_id
                LEFT JOIN bookings b ON b.room_id = r.id AND b.status = 'pending'
                WHERE ra.user_id = $1
                GROUP BY r.id, r.name, r.code, r.floor, bu.name
                ORDER BY bu.name, r.floor, r.name
            `, [req.user.id]);
            rows = r.rows;
        }
        res.json({ rooms: rows });
    } catch (err) { next(err); }
});

// ─── GET /api/bookings/calendar — ดูการจองตามช่วงวัน ─
// ─── GET /api/bookings/public — ดู calendar แบบไม่ต้อง login ──
router.get('/public', async (req, res, next) => {
    try {
        const { from, to } = req.query;
        const fromDT = from ? `${from}T00:00:00+07:00` : new Date().toISOString();
        const toDT   = to   ? `${to}T23:59:59+07:00`
            : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const [bookingsResult, roomsResult] = await Promise.all([
            pool.query(`
                SELECT
                    b.id, b.title, b.start_time, b.end_time, b.status,
                    b.attendee_count, b.room_id,
                    r.name  AS room_name, r.code AS room_code,
                    bu.name AS building_name,
                    u.full_name AS booked_by_name,
                    COALESCE(
                        JSON_AGG(JSONB_BUILD_OBJECT('email', ba.email, 'name', ba.name))
                        FILTER (WHERE ba.id IS NOT NULL), '[]'
                    ) AS attendees
                FROM bookings b
                JOIN rooms    r  ON r.id  = b.room_id
                JOIN buildings bu ON bu.id = r.building_id
                JOIN users    u  ON u.id  = b.booked_by
                LEFT JOIN booking_attendees ba ON ba.booking_id = b.id
                WHERE b.status IN ('pending', 'approved')
                  AND b.start_time >= $1::TIMESTAMPTZ
                  AND b.end_time   <= $2::TIMESTAMPTZ
                GROUP BY b.id, r.name, r.code, bu.name, u.full_name
                ORDER BY b.start_time ASC
            `, [fromDT, toDT]),
            pool.query(`
                SELECT r.id, r.name, r.code, r.floor, r.capacity, r.status,
                       r.allowed_booking_roles,
                       bu.name AS building_name
                FROM rooms r
                JOIN buildings bu ON bu.id = r.building_id
                WHERE r.status = 'available'
                ORDER BY bu.name, r.floor, r.name
            `)
        ]);

        res.json({
            bookings: bookingsResult.rows,
            rooms:    roomsResult.rows,
        });
    } catch (err) { next(err); }
});

router.get('/calendar', requireAuth, async (req, res, next) => {
    try {
        const { from, to } = req.query;
        const fromDT = from ? `${from}T00:00:00+07:00` : new Date().toISOString();
        const toDT   = to   ? `${to}T23:59:59+07:00`   :
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        const result = await pool.query(`
            SELECT
                b.id, b.title, b.start_time, b.end_time, b.status,
                b.attendee_count, b.room_id,
                b.booked_by,
                r.name  AS room_name, r.code AS room_code,
                bu.name AS building_name,
                u.full_name AS booked_by_name,
                u.email     AS user_email,
                COALESCE(
                    JSON_AGG(JSONB_BUILD_OBJECT('email', ba.email, 'name', ba.name))
                    FILTER (WHERE ba.id IS NOT NULL), '[]'
                ) AS attendees
            FROM bookings b
            JOIN rooms    r  ON r.id  = b.room_id
            JOIN buildings bu ON bu.id = r.building_id
            JOIN users    u  ON u.id  = b.booked_by
            LEFT JOIN booking_attendees ba ON ba.booking_id = b.id
            WHERE b.status IN ('pending', 'approved')
              AND b.start_time >= $1::TIMESTAMPTZ
              AND b.end_time   <= $2::TIMESTAMPTZ
            GROUP BY b.id, r.name, r.code, bu.name, u.full_name, u.email, b.booked_by
            ORDER BY b.start_time ASC
        `, [fromDT, toDT]);

        res.json({ bookings: result.rows });
    } catch (err) { next(err); }
});

// ─── GET /api/bookings/:id — ดูรายละเอียด ────────────
router.get('/:id', requireAuth, async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT
                b.*,
                r.name AS room_name, r.code AS room_code,
                r.floor, r.google_calendar_id AS room_calendar_id,
                bu.name AS building_name, bu.address,
                u.full_name AS booked_by_name, u.email AS booked_by_email,
                u.avatar_url, u.department,
                COALESCE(
                    JSON_AGG(JSONB_BUILD_OBJECT('email', ba.email, 'name', ba.name))
                    FILTER (WHERE ba.id IS NOT NULL), '[]'
                ) AS attendees
            FROM bookings b
            JOIN rooms r ON r.id = b.room_id
            JOIN buildings bu ON bu.id = r.building_id
            JOIN users u ON u.id = b.booked_by
            LEFT JOIN booking_attendees ba ON ba.booking_id = b.id
            WHERE b.id = $1
            GROUP BY b.id, r.name, r.code, r.floor, r.google_calendar_id,
                     bu.name, bu.address, u.full_name, u.email, u.avatar_url, u.department
        `, [req.params.id]);

        if (!result.rows[0]) return res.status(404).json({ error: 'ไม่พบการจองนี้' });

        // ตรวจสิทธิ์: เห็นได้เฉพาะของตัวเอง หรือ admin
        const booking = result.rows[0];
        const isOwner = booking.booked_by === req.user.id;
        const isAdmin = ['room_admin', 'super_admin'].includes(req.user.role);
        if (!isOwner && !isAdmin) return res.status(403).json({ error: 'ไม่มีสิทธิ์ดูการจองนี้' });

        res.json(booking);
    } catch (err) { next(err); }
});

// ─── POST /api/bookings — สร้างการจองใหม่ ────────────
router.post('/', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const data = BookingSchema.parse(req.body);

        // ตรวจสอบว่าเวลาสิ้นสุดมากกว่าเวลาเริ่ม
        if (new Date(data.end_time) <= new Date(data.start_time)) {
            return res.status(400).json({ error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' });
        }

        // ตรวจสอบ capacity
        const room = await pool.query(`
            SELECT r.*, bu.name AS building_name, bu.address, r.notify_admin_email
            FROM rooms r JOIN buildings bu ON bu.id = r.building_id
            WHERE r.id = $1 AND r.status = 'available'
        `, [data.room_id]);

        if (!room.rows[0]) return res.status(404).json({ error: 'ไม่พบห้องหรือห้องไม่พร้อมใช้งาน' });
        if (data.attendee_count > room.rows[0].capacity) {
            return res.status(400).json({
                error: `จำนวนผู้เข้าร่วมเกินความจุห้อง (สูงสุด ${room.rows[0].capacity} คน)`
            });
        }

        // ตรวจสอบ allowed_booking_roles
        const allowedRoles = room.rows[0].allowed_booking_roles;
        if (allowedRoles && allowedRoles.length > 0) {
            if (!allowedRoles.includes(req.user.role)) {
                return res.status(403).json({
                    error: `ห้องนี้จองได้เฉพาะ: ${allowedRoles.join(', ')} เท่านั้น`
                });
            }
        }

        await client.query('BEGIN');

        // INSERT booking (Trigger validate_booking จะรันอัตโนมัติ)
        const booking = await client.query(
            `INSERT INTO bookings
                (room_id, booked_by, title, description, attendee_count, start_time, end_time)
             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
            [data.room_id, req.user.id, data.title, data.description ?? null,
             data.attendee_count, data.start_time, data.end_time]
        );
        const b = booking.rows[0];

        // เพิ่มผู้เข้าร่วม
        if (data.attendee_emails?.length) {
            for (const email of data.attendee_emails) {
                await client.query(
                    `INSERT INTO booking_attendees (booking_id, email) VALUES ($1, $2)`,
                    [b.id, email]
                );
            }
        }

        // Notification ไปยัง Room Admin
        const admins = await client.query(
            `SELECT u.id, u.full_name FROM room_admins ra
             JOIN users u ON u.id = ra.user_id
             WHERE ra.room_id = $1`,
            [data.room_id]
        );
        for (const admin of admins.rows) {
            await client.query(
                `INSERT INTO notifications (user_id, booking_id, type, title, message)
                 VALUES ($1,$2,'booking_submitted',$3,$4)`,
                [admin.id, b.id,
                 `มีคำขอจองห้อง ${room.rows[0].name}`,
                 `${req.user.full_name} ขอจองห้อง ${room.rows[0].name} วันที่ ${new Date(b.start_time).toLocaleDateString('th-TH')}`]
            );
        }

        await client.query('COMMIT');

        // ─── ส่ง Email แบบ Parallel (ไม่บล็อก response) ──────
        const bookingInfo = formatBookingInfo(b);
        // ส่งให้ผู้ดูแลห้อง เฉพาะห้องที่เปิด notify_admin_email
        if (room.rows[0].notify_admin_email !== false) {
            const adminEmails = await pool.query(
                `SELECT u.email, u.full_name FROM room_admins ra
                 JOIN users u ON u.id = ra.user_id WHERE ra.room_id = $1`,
                [data.room_id]
            );
            for (const admin of adminEmails.rows) {
                sendEmail({
                    to:      admin.email,
                    subject: `[MLii Room Reservation] มีคำขอใหม่: ${b.title}`,
                    html:    newBookingRequestTemplate({
                        booking:  bookingInfo,
                        room:     room.rows[0].name,
                        building: room.rows[0].building_name,
                        booker:   req.user.full_name,
                    }),
                });
            }
        }
        // ส่ง confirm ให้ผู้จอง
        sendEmail({
            to:      req.user.email,
            subject: `[MLii Room Reservation] รับคำขอแล้ว: ${b.title}`,
            html:    bookingSubmittedTemplate({
                booking:  bookingInfo,
                room:     room.rows[0].name,
                building: room.rows[0].building_name,
            }),
        });

        // Google Calendar — ดึง token จาก DB เพื่อให้ได้ refresh_token เสมอ
        const bookerFresh = await pool.query(
            'SELECT id, email, access_token, refresh_token FROM users WHERE id = $1',
            [req.user.id]
        );
        const bookerUser = bookerFresh.rows[0];

        const roomObj     = { ...room.rows[0], code: room.rows[0].code };
        const buildingObj = { name: room.rows[0].building_name };

        logger.info(`[GCal] Creating event for booker ${bookerUser?.email}, has_access=${!!bookerUser?.access_token}, has_refresh=${!!bookerUser?.refresh_token}`);

        const gcEventIdBooker = await createUserCalendarEvent({
            booking: b,
            room: roomObj,
            building: buildingObj,
            attendeeEmails: data.attendee_emails ?? [],
            user: bookerUser,
        });

        if (gcEventIdBooker) {
            await pool.query(
                'UPDATE bookings SET gc_event_id_booker = $1 WHERE id = $2',
                [gcEventIdBooker, b.id]
            );
            logger.info(`[GCal] Event saved: ${gcEventIdBooker} for booking ${b.id}`);
        } else {
            logger.warn(`[GCal] No event created for booking ${b.id} — check token or scope`);
        }

        logger.info(`[Booking] New booking ${b.id} by ${req.user.email}`);
        res.status(201).json({
            message: 'ส่งคำขอจองสำเร็จ รอการอนุมัติจากผู้ดูแลห้อง',
            booking: { ...b, gc_event_id_booker: gcEventIdBooker },
        });

    } catch (err) {
        await client.query('ROLLBACK');
        // แปลง Trigger error ให้เป็น user-friendly
        if (err.code === 'P0001') return res.status(400).json({ error: err.message });
        if (err.code === 'P0002') return res.status(400).json({ error: err.message });
        if (err.code === 'P0003') return res.status(400).json({ error: err.message });
        if (err.code === 'P0004') return res.status(400).json({ error: err.message });
        if (err.code === 'P0005') return res.status(400).json({ error: err.message });
        if (err instanceof z.ZodError) return res.status(400).json({ error: err.errors });
        next(err);
    } finally {
        client.release();
    }
});

// ─── PATCH /api/bookings/:id/approve — อนุมัติ ───────
router.patch('/:id/approve', requireRoomAdmin, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const { note } = req.body;
        await client.query('BEGIN');

        const booking = await client.query(`
            SELECT b.*, r.google_calendar_id AS room_calendar_id,
                   r.name AS room_name, r.code AS room_code, bu.name AS building_name
            FROM bookings b
            JOIN rooms r ON r.id = b.room_id
            JOIN buildings bu ON bu.id = r.building_id
            WHERE b.id = $1 AND b.status = 'pending'
        `, [req.params.id]);

        if (!booking.rows[0]) return res.status(404).json({ error: 'ไม่พบคำขอที่รอการอนุมัติ' });
        const b = booking.rows[0];

        // ตรวจสิทธิ์ room_admin
        if (req.user.role === 'room_admin') {
            const isAdmin = await client.query(
                'SELECT 1 FROM room_admins WHERE room_id = $1 AND user_id = $2',
                [b.room_id, req.user.id]
            );
            if (!isAdmin.rowCount) return res.status(403).json({ error: 'คุณไม่ได้ดูแลห้องนี้' });
        }

        // อัปเดต status
        await client.query(
            "UPDATE bookings SET status = 'approved' WHERE id = $1",
            [b.id]
        );

        // บันทึก approval log
        await client.query(
            `INSERT INTO booking_approvals (booking_id, reviewed_by, action, note)
             VALUES ($1,$2,'approved',$3)`,
            [b.id, req.user.id, note ?? null]
        );

        // Notification ไปยังผู้จอง
        await client.query(
            `INSERT INTO notifications (user_id, booking_id, type, title, message)
             VALUES ($1,$2,'booking_approved',$3,$4)`,
            [b.booked_by, b.id,
             `การจองห้อง ${b.room_name} ได้รับการอนุมัติแล้ว`,
             note ? `หมายเหตุ: ${note}` : 'การจองของคุณได้รับการอนุมัติแล้ว']
        );

        await client.query('COMMIT');

        // ส่ง Email แจ้งผู้จองว่าอนุมัติแล้ว
        const bookerResult = await pool.query(
            'SELECT email, full_name FROM users WHERE id = $1', [b.booked_by]
        );
        if (bookerResult.rows[0]) {
            sendEmail({
                to:      bookerResult.rows[0].email,
                subject: `[MLii Room Reservation] อนุมัติแล้ว: ${b.title}`,
                html:    bookingApprovedTemplate({
                    booking:  formatBookingInfo(b),
                    room:     b.room_name,
                    building: b.building_name,
                    note:     note ?? null,
                }),
            });
        }

        // ดึง attendees + booker token สำหรับ calendar sync
        const [attendeesResult, bookerUser] = await Promise.all([
            pool.query('SELECT email FROM booking_attendees WHERE booking_id = $1', [b.id]),
            pool.query('SELECT id, email, access_token, refresh_token FROM users WHERE id = $1', [b.booked_by]),
        ]);
        const attendeeEmails   = attendeesResult.rows.map(a => a.email);
        const booker           = bookerUser.rows[0];
        const roomObj          = { name: b.room_name, code: b.room_code, google_calendar_id: b.room_calendar_id };
        const buildingObj      = { name: b.building_name };

        // ── DEBUG: ตรวจสอบข้อมูลก่อน sync ──
        logger.info(`[GCal DEBUG] room_calendar_id = "${b.room_calendar_id}"`);
        logger.info(`[GCal DEBUG] booker = ${booker?.email}, has_access_token = ${!!booker?.access_token}, has_refresh_token = ${!!booker?.refresh_token}`);
        logger.info(`[GCal DEBUG] gc_event_id_booker = "${b.gc_event_id_booker}"`);
        logger.info(`[GCal DEBUG] SERVICE_ACCOUNT_JSON set = ${!!process.env.GOOGLE_SERVICE_ACCOUNT_JSON}`);

        // 1) สร้าง/อัพเดต event ใน calendar ของผู้จอง
        if (b.gc_event_id_booker) {
            // มี event อยู่แล้ว (สร้างตอน pending) → update ให้ข้อมูลล่าสุด
            await updateCalendarEvent({
                eventId: b.gc_event_id_booker,
                booking: b, room: roomObj, building: buildingObj,
                user: booker,
            });
        } else if (booker) {
            // ไม่มี event → สร้างใหม่ตอน approve
            const gcEventIdBooker = await createUserCalendarEvent({
                booking: b, room: roomObj, building: buildingObj,
                attendeeEmails, user: booker,
            });
            if (gcEventIdBooker) {
                await pool.query(
                    'UPDATE bookings SET gc_event_id_booker = $1 WHERE id = $2',
                    [gcEventIdBooker, b.id]
                );
            }
        }

        // 2) สร้าง event ใน Room Calendar (Service Account)
        const gcEventIdRoom = await createRoomCalendarEvent({
            booking: b, room: roomObj, building: buildingObj, attendeeEmails,
        });
        if (gcEventIdRoom) {
            await pool.query(
                'UPDATE bookings SET gc_event_id_room = $1 WHERE id = $2',
                [gcEventIdRoom, b.id]
            );
        }

        logger.info(`[Booking] Approved: ${b.id} by ${req.user.email}`);
        res.json({ message: 'อนุมัติการจองสำเร็จ' });

    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

// ─── PATCH /api/bookings/:id/reject — ปฏิเสธ ────────
router.patch('/:id/reject', requireRoomAdmin, async (req, res, next) => {
    const client = await pool.connect();
    try {
        const { note } = req.body;
        if (!note) return res.status(400).json({ error: 'กรุณาระบุเหตุผลการปฏิเสธ' });

        await client.query('BEGIN');

        const booking = await client.query(
            `SELECT b.*,
                    r.name AS room_name,
                    r.google_calendar_id AS room_calendar_id,
                    bu.name AS building_name,
                    u.email AS user_email,
                    u.access_token  AS booker_access_token,
                    u.refresh_token AS booker_refresh_token
             FROM bookings b
             JOIN rooms r    ON r.id  = b.room_id
             JOIN buildings bu ON bu.id = r.building_id
             JOIN users u    ON u.id  = b.booked_by
             WHERE b.id = $1 AND b.status = 'pending'`,
            [req.params.id]
        );
        if (!booking.rows[0]) return res.status(404).json({ error: 'ไม่พบคำขอ' });
        const b = booking.rows[0];

        await client.query("UPDATE bookings SET status = 'rejected' WHERE id = $1", [b.id]);
        await client.query(
            `INSERT INTO booking_approvals (booking_id, reviewed_by, action, note)
             VALUES ($1,$2,'rejected',$3)`,
            [b.id, req.user.id, note]
        );
        await client.query(
            `INSERT INTO notifications (user_id, booking_id, type, title, message)
             VALUES ($1,$2,'booking_rejected',$3,$4)`,
            [b.booked_by, b.id, `การจองห้อง ${b.room_name} ถูกปฏิเสธ`, `เหตุผล: ${note}`]
        );

        await client.query('COMMIT');

        // ส่ง Email แจ้งผู้จองว่าถูกปฏิเสธ
        sendEmail({
            to:      b.user_email,
            subject: `[MLii Room Reservation] ไม่ได้รับอนุมัติ: ${b.title}`,
            html:    bookingRejectedTemplate({
                booking:  formatBookingInfo(b),
                room:     b.room_name,
                building: b.building_name,
                note,
            }),
        });

        // ลบ Event ผู้จอง → Google แจ้ง attendees ทุกคนอัตโนมัติ
        if (b.gc_event_id_booker) {
            await deleteCalendarEvent({
                eventId: b.gc_event_id_booker,
                user: { id: b.booked_by, access_token: b.booker_access_token, refresh_token: b.booker_refresh_token },
            });
        }

        // ลบ Event จาก Room Calendar
        if (b.gc_event_id_room && b.room_calendar_id) {
            await deleteCalendarEvent({ eventId: b.gc_event_id_room, calendarId: b.room_calendar_id });
        }

        logger.info(`[Booking] Rejected: ${b.id} by ${req.user.email}`);
        res.json({ message: 'ปฏิเสธการจองสำเร็จ' });

    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

// ─── PATCH /api/bookings/:id/cancel — ยกเลิก ─────────
router.patch('/:id/cancel', requireAuth, async (req, res, next) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const booking = await client.query(
            `SELECT b.*, r.name AS room_name, r.google_calendar_id AS room_calendar_id
             FROM bookings b JOIN rooms r ON r.id = b.room_id
             WHERE b.id = $1 AND b.booked_by = $2 AND b.status IN ('pending','approved')`,
            [req.params.id, req.user.id]
        );

        if (!booking.rows[0]) return res.status(404).json({ error: 'ไม่พบการจอง หรือไม่สามารถยกเลิกได้' });
        const b = booking.rows[0];

        await client.query("UPDATE bookings SET status = 'cancelled' WHERE id = $1", [b.id]);
        await client.query('COMMIT');

        // ลบ Events ใน Google Calendar
        await Promise.all([
            b.gc_event_id_booker && deleteCalendarEvent({ eventId: b.gc_event_id_booker, user: req.user }),
            b.gc_event_id_room   && deleteCalendarEvent({ eventId: b.gc_event_id_room, calendarId: b.room_calendar_id }),
        ]);

        logger.info(`[Booking] Cancelled: ${b.id} by ${req.user.email}`);
        res.json({ message: 'ยกเลิกการจองสำเร็จ' });

    } catch (err) {
        await client.query('ROLLBACK');
        next(err);
    } finally {
        client.release();
    }
});

export default router;