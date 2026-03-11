// src/modules/bookings/googleCalendar.service.js
import { google }  from 'googleapis';
import { pool }    from '../../config/db.js';
import { logger }  from '../../utils/logger.js';

// ─── OAuth Client (ใช้ token ของ user) ───────────────
function getUserCalendarClient(user) {
    const auth = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_CALLBACK_URL,
    );
    auth.setCredentials({
        access_token:  user.access_token,
        refresh_token: user.refresh_token,
    });

    // Auto-refresh: save token ใหม่ลง DB ทันที
    auth.on('tokens', async (tokens) => {
        try {
            if (tokens.access_token) {
                await pool.query(
                    `UPDATE users SET
                        access_token  = $1,
                        refresh_token = COALESCE($2, refresh_token),
                        updated_at    = NOW()
                     WHERE id = $3`,
                    [tokens.access_token, tokens.refresh_token ?? null, user.id]
                );
                logger.info(`[GCal] Token refreshed and saved for user ${user.id}`);
            }
        } catch (err) {
            logger.warn(`[GCal] Failed to save refreshed token: ${err.message}`);
        }
    });

    return google.calendar({ version: 'v3', auth });
}

// ─── Service Account (ใช้กับ Room Calendar) ──────────
function getRoomCalendarClient() {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
    try {
        const serviceAccountJson = Buffer.from(
            process.env.GOOGLE_SERVICE_ACCOUNT_JSON, 'base64'
        ).toString('utf-8');
        const auth = new google.auth.GoogleAuth({
            credentials: JSON.parse(serviceAccountJson),
            scopes: ['https://www.googleapis.com/auth/calendar'],
        });
        return google.calendar({ version: 'v3', auth });
    } catch (err) {
        logger.error(`[GCal] Failed to create service account client: ${err.message}`);
        return null;
    }
}

// ─── ตรวจสอบว่า user มี token พร้อมใช้ ──────────────
function hasValidToken(user) {
    return !!(user?.access_token && user?.refresh_token);
}

// ─── Helper: สร้าง Event body ─────────────────────────
function buildEventBody({ booking, room, building, attendeeEmails = [], bookerEmail = null }) {
    const attendees = [...new Set([
        ...(attendeeEmails ?? []),
        ...(bookerEmail ? [bookerEmail] : []),
    ])].map(email => ({ email }));

    return {
        summary:  `[จองห้อง] ${booking.title}`,
        description: [
            `📍 ห้อง: ${room.name}${room.code ? ` (${room.code})` : ''}`,
            `🏢 อาคาร: ${building?.name ?? ''}`,
            `👥 จำนวนผู้เข้าร่วม: ${booking.attendee_count} คน`,
            booking.description ? `\nรายละเอียด:\n${booking.description}` : '',
            `\n🔗 จัดการการจอง: ${process.env.FRONTEND_URL}/dashboard/bookings`,
        ].filter(Boolean).join('\n'),
        location:  building?.name ? `${building.name} - ${room.name}` : room.name,
        start:     { dateTime: new Date(booking.start_time).toISOString(), timeZone: 'Asia/Bangkok' },
        end:       { dateTime: new Date(booking.end_time).toISOString(),   timeZone: 'Asia/Bangkok' },
        attendees,
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'email', minutes: 60 },
                { method: 'popup', minutes: 15 },
            ],
        },
        colorId: '2',
    };
}

// ─── สร้าง Event ใน Calendar ผู้จอง ──────────────────
export async function createUserCalendarEvent({ booking, room, building, attendeeEmails, user }) {
    if (!hasValidToken(user)) {
        logger.warn(`[GCal] Skipping — user ${user?.email ?? user?.id} missing token (access=${!!user?.access_token}, refresh=${!!user?.refresh_token})`);
        return null;
    }
    try {
        const calendar = getUserCalendarClient(user);
        const body = buildEventBody({ booking, room, building, attendeeEmails, bookerEmail: user.email });
        logger.info(`[GCal] Inserting event: "${body.summary}" start=${body.start.dateTime}`);
        const event = await calendar.events.insert({
            calendarId:  'primary',
            sendUpdates: 'all',
            requestBody: body,
        });
        logger.info(`[GCal] Event created OK: ${event.data.id} for ${user.email}`);
        return event.data.id;
    } catch (err) {
        logger.error(`[GCal] createUserCalendarEvent failed (code=${err.code}): ${err.message}`);
        if (err.response?.data) logger.error(`[GCal] API response: ${JSON.stringify(err.response.data)}`);
        return null;
    }
}

// ─── สร้าง Event ใน Room Calendar (Service Account) ──
export async function createRoomCalendarEvent({ booking, room, building, attendeeEmails }) {
    if (!room.google_calendar_id) return null;
    const calendar = getRoomCalendarClient();
    if (!calendar) return null;
    try {
        const event = await calendar.events.insert({
            calendarId:  room.google_calendar_id,
            sendUpdates: 'all',
            requestBody: buildEventBody({ booking, room, building, attendeeEmails }),
        });
        logger.info(`[GCal] Room event created: ${event.data.id}`);
        return event.data.id;
    } catch (err) {
        logger.error(`[GCal] Failed to create room event: ${err.message}`);
        return null;
    }
}

// ─── ลบ Event (แจ้ง attendees อัตโนมัติ) ─────────────
export async function deleteCalendarEvent({ eventId, calendarId, user }) {
    if (!eventId) return;
    try {
        if (user && hasValidToken(user)) {
            const calendar = getUserCalendarClient(user);
            await calendar.events.delete({ calendarId: 'primary', eventId, sendUpdates: 'all' });
            logger.info(`[GCal] User event deleted: ${eventId}`);
        } else if (calendarId) {
            const calendar = getRoomCalendarClient();
            if (!calendar) return;
            await calendar.events.delete({ calendarId, eventId, sendUpdates: 'all' });
            logger.info(`[GCal] Room event deleted: ${eventId}`);
        }
    } catch (err) {
        if (err.code === 410 || err.code === 404) {
            logger.info(`[GCal] Event ${eventId} already deleted`);
        } else {
            logger.warn(`[GCal] Could not delete event ${eventId}: ${err.message}`);
        }
    }
}

// ─── อัปเดต Event ─────────────────────────────────────
export async function updateCalendarEvent({ eventId, calendarId, booking, room, building, user }) {
    if (!eventId) return;
    try {
        if (user && hasValidToken(user)) {
            const calendar = getUserCalendarClient(user);
            await calendar.events.patch({
                calendarId: 'primary', eventId, sendUpdates: 'all',
                requestBody: buildEventBody({ booking, room, building }),
            });
            logger.info(`[GCal] User event updated: ${eventId}`);
        } else if (calendarId) {
            const calendar = getRoomCalendarClient();
            if (!calendar) return;
            await calendar.events.patch({
                calendarId, eventId, sendUpdates: 'all',
                requestBody: buildEventBody({ booking, room, building }),
            });
            logger.info(`[GCal] Room event updated: ${eventId}`);
        }
    } catch (err) {
        logger.warn(`[GCal] Could not update event ${eventId}: ${err.message}`);
    }
}