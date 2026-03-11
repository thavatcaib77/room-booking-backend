// src/modules/auth/auth.routes.js
import express  from 'express';
import passport from 'passport';
import { authLimiter } from '../../middleware/rateLimit.js';
import { requireAuth } from '../../middleware/auth.js';

const router = express.Router();

// เริ่ม Google OAuth
router.get('/google', authLimiter, passport.authenticate('google'));

// Callback หลัง Google ยืนยัน
router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: `${process.env.FRONTEND_URL}/login?error=auth_failed` }),
    (req, res) => {
        res.redirect(`${process.env.FRONTEND_URL}/dashboard`);
    }
);

// Re-authorize เพื่อขอ refresh_token ใหม่ (กรณี token หมดหรือไม่มี)
router.get('/google/reauth', authLimiter,
    passport.authenticate('google', {
        accessType: 'offline',
        prompt: 'consent',
        scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar'],
    })
);
// Re-authorize เพื่อขอ refresh_token ใหม่ (กรณี token หมดหรือไม่มี)
router.get('/google/reauth', authLimiter,
    passport.authenticate('google', {
        accessType: 'offline',
        prompt: 'consent',
        scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar'],
    })
);

// ดูข้อมูลตัวเอง
router.get('/me', requireAuth, (req, res) => {
    const { id, email, full_name, avatar_url, role, department, phone, refresh_token } = req.user;
    res.json({ id, email, full_name, avatar_url, role, department, phone, has_calendar_token: !!refresh_token });
});

// Logout
router.post('/logout', requireAuth, (req, res, next) => {
    req.logout(err => {
        if (err) return next(err);
        req.session.destroy(() => {
            res.clearCookie('connect.sid');
            res.json({ message: 'ออกจากระบบสำเร็จ' });
        });
    });
});


// ─── Demo Login (ข้าม Google OAuth) ──────────────────
router.post('/demo-login', authLimiter, async (req, res, next) => {
    try {
        const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'mlii2025';
        const { password } = req.body;

        if (password !== DEMO_PASSWORD) {
            return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
        }

        // หา demo user หรือสร้างใหม่
        const { pool } = await import('../../config/db.js');
        let result = await pool.query(
            'SELECT * FROM users WHERE email = $1',
            ['demo@room-booking.local']
        );

        if (result.rows.length === 0) {
            result = await pool.query(`
                INSERT INTO users (google_id, email, full_name, avatar_url, role, is_active)
                VALUES ($1, $2, $3, $4, $5, TRUE)
                ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name
                RETURNING *
            `, ['demo-local', 'demo@room-booking.local', 'Demo User', null, 'staff']);
        }

        const demoUser = result.rows[0];

        // สร้าง session เหมือน passport login
        req.login(demoUser, (err) => {
            if (err) return next(err);
            res.json({ ok: true, user: {
                id: demoUser.id,
                email: demoUser.email,
                full_name: demoUser.full_name,
                role: demoUser.role,
            }});
        });
    } catch (err) { next(err); }
});

export default router;
