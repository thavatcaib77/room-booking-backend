# 📚 Room Booking API — Documentation

Base URL: `http://localhost:3000`

---

## 🔐 Auth

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/auth/google` | เริ่ม Google OAuth |
| GET | `/auth/google/callback` | Callback จาก Google |
| GET | `/auth/me` | ดูข้อมูลตัวเอง |
| POST | `/auth/logout` | ออกจากระบบ |

---

## 🏢 Rooms

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/rooms` | user | ค้นหาห้องว่าง |
| GET | `/api/rooms?date=2025-07-01&start=09:00&end=11:00&capacity=20` | user | ค้นหาพร้อมกรองเวลา |
| GET | `/api/rooms/:id` | user | รายละเอียดห้อง |
| GET | `/api/rooms/:id/bookings` | user | ตารางจองของห้อง |
| POST | `/api/rooms` | super_admin | สร้างห้องใหม่ |
| PATCH | `/api/rooms/:id` | super_admin | แก้ไขห้อง |
| POST | `/api/rooms/:id/closures` | room_admin | ปิดห้องชั่วคราว |

---

## 📅 Bookings

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/api/bookings/my` | user | การจองของฉัน |
| GET | `/api/bookings/pending` | room_admin | รอการอนุมัติ |
| GET | `/api/bookings/:id` | user | รายละเอียดการจอง |
| POST | `/api/bookings` | user | สร้างการจองใหม่ |
| PATCH | `/api/bookings/:id/approve` | room_admin | อนุมัติ |
| PATCH | `/api/bookings/:id/reject` | room_admin | ปฏิเสธ (ต้องระบุ note) |
| PATCH | `/api/bookings/:id/cancel` | user | ยกเลิก (เฉพาะของตัวเอง) |

### POST /api/bookings — Request Body
```json
{
  "room_id": "uuid",
  "title": "ประชุมทีม",
  "description": "Agenda: ...",
  "attendee_count": 10,
  "start_time": "2025-07-01T09:00:00+07:00",
  "end_time":   "2025-07-01T11:00:00+07:00",
  "attendee_emails": ["a@example.com", "b@example.com"]
}
```

### Error Codes จาก Trigger
| Code | ความหมาย |
|------|----------|
| P0001 | ห้ามจองวันเสาร์-อาทิตย์ |
| P0002 | ห้ามจองวันหยุดนักขัตฤกษ์ |
| P0003 | ห้องปิดชั่วคราวในช่วงนั้น |
| P0004 | ห้องไม่เปิดบริการวันนั้น |
| P0005 | เวลาเกิน Operating Hours |

---

## 🔔 Notifications

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications` | ดูการแจ้งเตือน (ล่าสุด 50 รายการ) |
| PATCH | `/api/notifications/read-all` | อ่านทั้งหมด |
| PATCH | `/api/notifications/:id/read` | อ่านรายการเดียว |

---

## ⚙️ Admin (super_admin เท่านั้น)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/admin/stats` | Dashboard statistics |
| GET | `/api/admin/users` | จัดการผู้ใช้ |
| PATCH | `/api/admin/users/:id/role` | เปลี่ยน Role |
| POST | `/api/admin/rooms/:roomId/admins` | กำหนด Room Admin |
| DELETE | `/api/admin/rooms/:roomId/admins/:userId` | ลบ Room Admin |
| GET | `/api/admin/holidays?year=2025` | ดูวันหยุด |
| POST | `/api/admin/holidays/sync/:year` | Sync วันหยุดจาก API |
| POST | `/api/admin/holidays` | เพิ่มวันหยุดพิเศษ |
| DELETE | `/api/admin/holidays/:id` | ลบวันหยุด |
| GET | `/api/admin/reports/bookings` | รายงานสถิติ |

---

## 🚀 Getting Started

```bash
# 1. ติดตั้ง dependencies
npm install

# 2. ตั้งค่า environment
cp .env.example .env
# แก้ไข .env ใส่ค่าจริง

# 3. รัน Database migration
npm run db:migrate

# 4. Seed ข้อมูลเริ่มต้น
npm run db:seed

# 5. Start development server
npm run dev
```

## 📁 Project Structure
```
src/
├── app.js                    # Entry point
├── config/db.js              # Database connection
├── middleware/
│   ├── auth.js               # Auth & Role guards
│   └── rateLimit.js          # Rate limiting
├── modules/
│   ├── auth/                 # Google OAuth
│   ├── rooms/                # Room management
│   ├── bookings/             # Booking + Google Calendar
│   ├── holidays/             # Holiday sync (Cron)
│   ├── notifications/        # Notification system
│   └── admin/                # Admin dashboard
└── utils/logger.js           # Winston logger
```
