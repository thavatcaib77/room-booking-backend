// src/middleware/auth.js

// ตรวจสอบว่า login แล้ว
export function requireAuth(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
}

// ตรวจสอบ role
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.isAuthenticated()) {
            return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ error: 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้' });
        }
        next();
    };
}

// ตรวจสอบว่าเป็น room_admin ของห้องนั้นจริงๆ
export function requireRoomAdmin(req, res, next) {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
    }
    if (req.user.role === 'super_admin') return next(); // super_admin ผ่านได้เลย
    if (req.user.role !== 'room_admin') {
        return res.status(403).json({ error: 'เฉพาะผู้ดูแลห้องเท่านั้น' });
    }
    next();
}
