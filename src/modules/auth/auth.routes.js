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

export default router;