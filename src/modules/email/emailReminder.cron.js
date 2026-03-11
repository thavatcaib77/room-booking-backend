// src/modules/email/emailReminder.cron.js
// Cron job ส่ง reminder email ก่อนการจอง 1 ชั่วโมง
import cron   from 'node-cron';
import { pool } from '../../config/db.js';
import { logger } from '../../utils/logger.js';
import { sendEmail, bookingReminderTemplate, formatBookingInfo } from './email.service.js';

export function startReminderCron() {
    // รันทุก 5 นาที ตรวจหาการจองที่จะเกิดในอีก 60±5 นาที
    cron.schedule('*/5 * * * *', async () => {
        try {
            const result = await pool.query(`
                SELECT
                    b.id, b.title, b.start_time, b.end_time, b.attendee_count,
                    b.reminder_sent,
                    u.email AS user_email, u.full_name,
                    r.name AS room_name,
                    bu.name AS building_name
                FROM bookings b
                JOIN users u ON u.id = b.booked_by
                JOIN rooms r ON r.id = b.room_id
                JOIN buildings bu ON bu.id = r.building_id
                WHERE b.status = 'approved'
                  AND b.reminder_sent = FALSE
                  AND b.start_time BETWEEN
                      NOW() + INTERVAL '55 minutes' AND
                      NOW() + INTERVAL '65 minutes'
            `);

            for (const booking of result.rows) {
                const info = formatBookingInfo(booking);
                await sendEmail({
                    to:      booking.user_email,
                    subject: `⏰ แจ้งเตือน: ${booking.title} อีก 1 ชั่วโมง`,
                    html:    bookingReminderTemplate({
                        booking:  info,
                        room:     booking.room_name,
                        building: booking.building_name,
                    }),
                });

                // Mark as sent
                await pool.query(
                    'UPDATE bookings SET reminder_sent = TRUE WHERE id = $1',
                    [booking.id]
                );
            }

            if (result.rowCount > 0) {
                logger.info(`[Reminder] Sent ${result.rowCount} reminder emails`);
            }
        } catch (err) {
            logger.error(`[Reminder] Cron error: ${err.message}`);
        }
    }, { timezone: 'Asia/Bangkok' });

    logger.info('[Reminder] Cron job started (every 5 min)');
}
