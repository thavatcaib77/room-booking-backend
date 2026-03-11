// src/modules/notifications/notifications.routes.js
import express from 'express';
import { pool } from '../../config/db.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

// GET /api/notifications — การแจ้งเตือนของฉัน
router.get('/', requireAuth, async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT id, booking_id, type, title, message, is_read, created_at
            FROM notifications
            WHERE user_id = $1
            ORDER BY created_at DESC
            LIMIT 50
        `, [req.user.id]);

        const unread = result.rows.filter(n => !n.is_read).length;
        res.json({ notifications: result.rows, unread_count: unread });
    } catch (err) { next(err); }
});

// PATCH /api/notifications/read-all — อ่านทั้งหมด
router.patch('/read-all', requireAuth, async (req, res, next) => {
    try {
        await pool.query(
            "UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE",
            [req.user.id]
        );
        res.json({ message: 'อ่านการแจ้งเตือนทั้งหมดแล้ว' });
    } catch (err) { next(err); }
});

// PATCH /api/notifications/:id/read — อ่านรายการเดียว
router.patch('/:id/read', requireAuth, async (req, res, next) => {
    try {
        await pool.query(
            "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2",
            [req.params.id, req.user.id]
        );
        res.json({ message: 'OK' });
    } catch (err) { next(err); }
});

export default router;
