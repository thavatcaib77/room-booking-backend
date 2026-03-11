// src/middleware/rateLimit.js
import rateLimit from 'express-rate-limit';

export const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 นาที
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'คำขอมากเกินไป กรุณาลองใหม่ในอีก 15 นาที' },
});

export const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    message: { error: 'พยายามเข้าสู่ระบบมากเกินไป กรุณาลองใหม่ภายหลัง' },
});
