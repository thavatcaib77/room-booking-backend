// src/modules/auth/passport.config.js
import passport     from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { pool }     from '../../config/db.js';
import { logger }   from '../../utils/logger.js';

passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL,
    scope: ['profile', 'email', 'https://www.googleapis.com/auth/calendar'],
    accessType:   'offline',   // บังคับขอ refresh_token
    prompt:       'consent',   // บังคับ consent screen ทุกครั้ง เพื่อให้ได้ refresh_token ใหม่
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email    = profile.emails?.[0]?.value;
        const googleId = profile.id;

        if (!email) return done(new Error('ไม่พบอีเมลจาก Google'));

        // ตรวจสอบ pre-approved role ก่อน upsert
        const preApproved = await pool.query(
            'SELECT role FROM pre_approved_emails WHERE email=$1',
            [email.toLowerCase()]
        );
        const preRole = preApproved.rows[0]?.role ?? null;

        // Upsert user + บันทึก token ลง DB ทันที
        const result = await pool.query(
            `INSERT INTO users (google_id, email, full_name, avatar_url, access_token, refresh_token, role)
             VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::user_role, 'staff'::user_role))
             ON CONFLICT (google_id) DO UPDATE
                SET full_name     = EXCLUDED.full_name,
                    avatar_url    = EXCLUDED.avatar_url,
                    access_token  = EXCLUDED.access_token,
                    refresh_token = COALESCE(EXCLUDED.refresh_token, users.refresh_token),
                    role          = CASE
                                      WHEN $7 IS NOT NULL THEN $7::user_role
                                      WHEN users.role = 'student'::user_role THEN 'staff'::user_role
                                      ELSE users.role
                                    END,
                    updated_at    = NOW()
             RETURNING *`,
            [googleId, email, profile.displayName, profile.photos?.[0]?.value,
             accessToken, refreshToken ?? null, preRole]
        );

        const user = result.rows[0];
        logger.info(`[Auth] User logged in: ${email} (${user.role})`);
        return done(null, user);

    } catch (err) {
        logger.error('[Auth] OAuth error:', err.message);
        return done(err);
    }
}));

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (data, done) => {
    try {
        // รองรับ session เก่าที่เก็บเป็น object { id, accessToken, ... }
        const userId = typeof data === 'object' ? data.id : data;

        if (!userId || typeof userId !== 'string') return done(null, false);

        const result = await pool.query(
            'SELECT * FROM users WHERE id = $1 AND is_active = TRUE', [userId]
        );
        if (!result.rows[0]) return done(null, false);
        done(null, result.rows[0]);
    } catch (err) {
        done(err);
    }
});