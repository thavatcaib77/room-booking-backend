// src/modules/holidays/holidaySync.service.js
// (ย้ายมาจาก holiday-sync/ เพื่อให้อยู่ใน module structure)
import cron   from 'node-cron';
import fetch  from 'node-fetch';
import { pool }   from '../../config/db.js';
import { logger } from '../../utils/logger.js';
import { localHolidayFallback } from './localHolidayFallback.js';

const NAGER_API  = 'https://date.nager.at/api/v3/PublicHolidays';
const COUNTRY    = 'TH';

export async function syncThaiHolidays(year) {
    logger.info(`[HolidaySync] ซิงค์ปี ${year}`);
    let holidays = [], source = 'api';

    try {
        const res  = await fetch(`${NAGER_API}/${year}/${COUNTRY}`, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        holidays   = data.map(h => ({
            date:            h.date,
            name_th:         h.localName,
            name_en:         h.name,
            is_substitution: h.localName?.includes('ชดเชย') ?? false,
        }));
    } catch {
        holidays = localHolidayFallback[year] ?? [];
        source   = 'fallback';
        if (!holidays.length) return { success: false, year, inserted: 0, source };
    }

    const client = await pool.connect();
    let inserted = 0, updated = 0;
    try {
        await client.query('BEGIN');
        for (const h of holidays) {
            const r = await client.query(
                `INSERT INTO thai_public_holidays (date, name_th, name_en, is_substitution)
                 VALUES ($1,$2,$3,$4)
                 ON CONFLICT (date) DO UPDATE
                    SET name_th=EXCLUDED.name_th, name_en=EXCLUDED.name_en, is_substitution=EXCLUDED.is_substitution
                 RETURNING (xmax = 0) AS is_insert`,
                [h.date, h.name_th, h.name_en, h.is_substitution]
            );
            r.rows[0]?.is_insert ? inserted++ : updated++;
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }

    logger.info(`[HolidaySync] ปี ${year} — inserted: ${inserted}, updated: ${updated}`);
    return { success: true, year, source, inserted, updated };
}

export function startHolidaySyncCron() {
    // ซิงค์ทุก 1 พฤศจิกายน เวลา 02:00
    cron.schedule('0 2 1 11 *', async () => {
        const year = new Date().getFullYear();
        await syncThaiHolidays(year).catch(e => logger.error(`[HolidaySync] ${e.message}`));
        await syncThaiHolidays(year + 1).catch(e => logger.error(`[HolidaySync] ${e.message}`));
    }, { timezone: 'Asia/Bangkok' });

    // ซิงค์ทุก 1 มกราคม เวลา 02:00
    cron.schedule('0 2 1 1 *', async () => {
        await syncThaiHolidays(new Date().getFullYear()).catch(e => logger.error(`[HolidaySync] ${e.message}`));
    }, { timezone: 'Asia/Bangkok' });

    logger.info('[HolidaySync] Cron jobs ตั้งค่าแล้ว');
}
