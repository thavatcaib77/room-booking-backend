// src/modules/email/email.service.js
// แจ้งเตือนผ่าน Gmail SMTP ด้วย Nodemailer
import nodemailer from 'nodemailer';
import { logger }  from '../../utils/logger.js';

// ─── Transporter ──────────────────────────────────────
let transporter;

export function getTransporter() {
    if (!transporter) {
        transporter = nodemailer.createTransport({
            service: 'gmail',
            auth: {
                user: process.env.GMAIL_USER,
                pass: process.env.GMAIL_APP_PASSWORD, // App Password (ไม่ใช่ password จริง)
            },
        });
    }
    return transporter;
}

// ─── Email Templates ──────────────────────────────────
function baseTemplate(content) {
    return `
<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', sans-serif; background:#F7F9FC; margin:0; padding:0; color:#0F1C3F; }
    .wrapper { max-width:560px; margin:32px auto; background:#fff; border-radius:16px;
               border:1px solid #E4EAF4; overflow:hidden; }
    .header  { background:#1B4FD8; padding:28px 32px; }
    .header h1 { color:#fff; margin:0; font-size:18px; font-weight:700; }
    .header p  { color:rgba(255,255,255,0.75); margin:4px 0 0; font-size:13px; }
    .body    { padding:28px 32px; }
    .info-box { background:#F7F9FC; border-radius:12px; padding:16px 20px; margin:16px 0; }
    .info-row { display:flex; justify-content:space-between; padding:6px 0;
                border-bottom:1px solid #E4EAF4; font-size:13px; }
    .info-row:last-child { border-bottom:none; }
    .label { color:#4B5E8A; font-weight:500; }
    .value { color:#0F1C3F; font-weight:600; text-align:right; }
    .badge  { display:inline-block; padding:4px 12px; border-radius:99px; font-size:12px; font-weight:600; }
    .badge-pending  { background:#FEF3C7; color:#B45309; }
    .badge-approved { background:#D1FAE5; color:#065F46; }
    .badge-rejected { background:#FEE2E2; color:#991B1B; }
    .btn { display:inline-block; background:#1B4FD8; color:#fff; padding:12px 24px;
           border-radius:10px; text-decoration:none; font-size:14px; font-weight:600; margin-top:20px; }
    .footer { padding:16px 32px; border-top:1px solid #E4EAF4; font-size:11px; color:#8A98B8; text-align:center; }
  </style>
</head>
<body>
  <div class="wrapper">
    ${content}
    <div class="footer">ระบบจองห้องมหาวิทยาลัย · อีเมลนี้ส่งอัตโนมัติ กรุณาอย่าตอบกลับ</div>
  </div>
</body>
</html>`;
}

// ─── Template: ส่งคำขอจองสำเร็จ (ผู้จอง) ─────────────
export function bookingSubmittedTemplate({ booking, room, building }) {
    return baseTemplate(`
    <div class="header">
      <h1>📋 ส่งคำขอจองสำเร็จ</h1>
      <p>รอการอนุมัติจากผู้ดูแลห้อง</p>
    </div>
    <div class="body">
      <p>คำขอจองของคุณถูกส่งเรียบร้อยแล้ว กรุณารอการอนุมัติจากผู้ดูแลห้อง</p>
      <div class="info-box">
        <div class="info-row"><span class="label">กิจกรรม</span><span class="value">${booking.title}</span></div>
        <div class="info-row"><span class="label">ห้อง</span><span class="value">${room} · ${building}</span></div>
        <div class="info-row"><span class="label">วันที่</span><span class="value">${booking.date_th}</span></div>
        <div class="info-row"><span class="label">เวลา</span><span class="value">${booking.time_range}</span></div>
        <div class="info-row"><span class="label">ผู้เข้าร่วม</span><span class="value">${booking.attendee_count} คน</span></div>
        <div class="info-row"><span class="label">สถานะ</span>
          <span class="value"><span class="badge badge-pending">รอการอนุมัติ</span></span>
        </div>
      </div>
      <p style="font-size:13px;color:#4B5E8A;">คุณจะได้รับอีเมลแจ้งผลอีกครั้งเมื่อได้รับการอนุมัติหรือปฏิเสธ</p>
    </div>`);
}

// ─── Template: อนุมัติการจอง (ผู้จอง) ────────────────
export function bookingApprovedTemplate({ booking, room, building, note }) {
    return baseTemplate(`
    <div class="header" style="background:#059669;">
      <h1>✅ การจองได้รับการอนุมัติ</h1>
      <p>ห้องถูกจองสำเร็จแล้ว</p>
    </div>
    <div class="body">
      <p>ยินดีด้วย! การจองของคุณได้รับการอนุมัติแล้ว</p>
      <div class="info-box">
        <div class="info-row"><span class="label">กิจกรรม</span><span class="value">${booking.title}</span></div>
        <div class="info-row"><span class="label">ห้อง</span><span class="value">${room} · ${building}</span></div>
        <div class="info-row"><span class="label">วันที่</span><span class="value">${booking.date_th}</span></div>
        <div class="info-row"><span class="label">เวลา</span><span class="value">${booking.time_range}</span></div>
        <div class="info-row"><span class="label">สถานะ</span>
          <span class="value"><span class="badge badge-approved">อนุมัติแล้ว</span></span>
        </div>
        ${note ? `<div class="info-row"><span class="label">หมายเหตุ</span><span class="value">${note}</span></div>` : ''}
      </div>
    </div>`);
}

// ─── Template: ปฏิเสธการจอง (ผู้จอง) ─────────────────
export function bookingRejectedTemplate({ booking, room, building, note }) {
    return baseTemplate(`
    <div class="header" style="background:#DC2626;">
      <h1>❌ การจองถูกปฏิเสธ</h1>
      <p>กรุณาตรวจสอบเหตุผลด้านล่าง</p>
    </div>
    <div class="body">
      <p>ขออภัย การจองของคุณไม่ได้รับการอนุมัติ</p>
      <div class="info-box">
        <div class="info-row"><span class="label">กิจกรรม</span><span class="value">${booking.title}</span></div>
        <div class="info-row"><span class="label">ห้อง</span><span class="value">${room} · ${building}</span></div>
        <div class="info-row"><span class="label">วันที่</span><span class="value">${booking.date_th}</span></div>
        <div class="info-row"><span class="label">เวลา</span><span class="value">${booking.time_range}</span></div>
        <div class="info-row"><span class="label">เหตุผล</span><span class="value" style="color:#DC2626;">${note}</span></div>
      </div>
      <p style="font-size:13px;color:#4B5E8A;">คุณสามารถทำการจองใหม่ได้อีกครั้ง</p>
    </div>`);
}

// ─── Template: มีคำขอจองใหม่ (Room Admin) ────────────
export function newBookingRequestTemplate({ booking, room, building, booker }) {
    return baseTemplate(`
    <div class="header">
      <h1>🔔 มีคำขอจองห้องใหม่</h1>
      <p>รอการพิจารณาจากคุณ</p>
    </div>
    <div class="body">
      <p><strong>${booker}</strong> ขอจองห้องที่คุณดูแล กรุณาเข้าระบบเพื่ออนุมัติหรือปฏิเสธ</p>
      <div class="info-box">
        <div class="info-row"><span class="label">ผู้จอง</span><span class="value">${booker}</span></div>
        <div class="info-row"><span class="label">กิจกรรม</span><span class="value">${booking.title}</span></div>
        <div class="info-row"><span class="label">ห้อง</span><span class="value">${room} · ${building}</span></div>
        <div class="info-row"><span class="label">วันที่</span><span class="value">${booking.date_th}</span></div>
        <div class="info-row"><span class="label">เวลา</span><span class="value">${booking.time_range}</span></div>
        <div class="info-row"><span class="label">ผู้เข้าร่วม</span><span class="value">${booking.attendee_count} คน</span></div>
      </div>
      <a href="${process.env.FRONTEND_URL}/approvals" class="btn">เข้าสู่ระบบเพื่ออนุมัติ →</a>
    </div>`);
}

// ─── Template: Reminder ก่อนการจอง ───────────────────
export function bookingReminderTemplate({ booking, room, building }) {
    return baseTemplate(`
    <div class="header" style="background:#D97706;">
      <h1>⏰ แจ้งเตือน: มีการจองในอีก 1 ชั่วโมง</h1>
      <p>อย่าลืมเตรียมตัวให้พร้อม</p>
    </div>
    <div class="body">
      <p>คุณมีกิจกรรมที่จะเกิดขึ้นในอีก <strong>1 ชั่วโมง</strong></p>
      <div class="info-box">
        <div class="info-row"><span class="label">กิจกรรม</span><span class="value">${booking.title}</span></div>
        <div class="info-row"><span class="label">ห้อง</span><span class="value">${room} · ${building}</span></div>
        <div class="info-row"><span class="label">วันที่</span><span class="value">${booking.date_th}</span></div>
        <div class="info-row"><span class="label">เวลา</span><span class="value">${booking.time_range}</span></div>
      </div>
    </div>`);
}

// ─── Send Email Helper ────────────────────────────────
export async function sendEmail({ to, subject, html }) {
    try {
        const info = await getTransporter().sendMail({
            from: `"ระบบจองห้อง" <${process.env.GMAIL_USER}>`,
            to, subject, html,
        });
        logger.info(`[Email] Sent to ${to}: ${subject} (${info.messageId})`);
        return true;
    } catch (err) {
        logger.error(`[Email] Failed to send to ${to}: ${err.message}`);
        return false; // ไม่ให้ email error หยุด flow หลัก
    }
}

// ─── Format helpers ───────────────────────────────────
import { format } from 'date-fns';
import { th }     from 'date-fns/locale';

export function formatBookingInfo(booking) {
    const start = new Date(booking.start_time);
    const end   = new Date(booking.end_time);
    return {
        ...booking,
        date_th:    format(start, 'EEEEที่ d MMMM yyyy', { locale: th }),
        time_range: `${format(start,'HH:mm')} – ${format(end,'HH:mm')} น.`,
    };
}
