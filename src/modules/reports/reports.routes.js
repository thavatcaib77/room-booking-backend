// src/modules/reports/reports.routes.js
import express   from 'express';
import ExcelJS   from 'exceljs';
import { pool }  from '../../config/db.js';
import { requireRole } from '../../middleware/auth.js';
import { format } from 'date-fns';
import { th }    from 'date-fns/locale';

const router = express.Router();

// ─── Helper: ดึงข้อมูลสถิติ ───────────────────────────
async function fetchReportData({ from, to, room_id }) {
    const params = [from, to];
    let roomFilter = '';
    if (room_id) { params.push(room_id); roomFilter = `AND b.room_id = $${params.length}`; }

    const [bookings, roomStats, dailyStats, peakHours] = await Promise.all([
        // ข้อมูล bookings ดิบ
        pool.query(`
            SELECT
                b.id,
                b.title                                                      AS "ชื่อกิจกรรม",
                u.full_name                                                  AS "ผู้จอง",
                u.email                                                      AS "อีเมลผู้จอง",
                u.department                                                 AS "คณะ/ภาค",
                r.name                                                       AS "ห้อง",
                r.code                                                       AS "รหัสห้อง",
                bu.name                                                      AS "อาคาร",
                b.start_time AT TIME ZONE 'Asia/Bangkok'                     AS "เวลาเริ่ม",
                b.end_time   AT TIME ZONE 'Asia/Bangkok'                     AS "เวลาสิ้นสุด",
                ROUND(EXTRACT(EPOCH FROM (b.end_time - b.start_time))/3600,2) AS "ชั่วโมง",
                b.attendee_count                                             AS "จำนวนผู้เข้าร่วม",
                b.status                                                     AS "สถานะ",
                b.created_at AT TIME ZONE 'Asia/Bangkok'                     AS "วันที่จอง",
                CASE WHEN b.recurring_group_id IS NOT NULL THEN 'ใช่' ELSE 'ไม่' END AS "จองซ้ำ"
            FROM bookings b
            JOIN users u ON u.id = b.booked_by
            JOIN rooms r ON r.id = b.room_id
            JOIN buildings bu ON bu.id = r.building_id
            WHERE b.start_time BETWEEN $1 AND $2 ${roomFilter}
            ORDER BY b.start_time DESC
        `, params),

        // สถิติแต่ละห้อง
        pool.query(`
            SELECT
                r.name                                          AS "ห้อง",
                bu.name                                         AS "อาคาร",
                r.capacity                                      AS "ความจุ",
                COUNT(*)                                        AS "จองทั้งหมด",
                COUNT(*) FILTER (WHERE b.status='approved')     AS "อนุมัติ",
                COUNT(*) FILTER (WHERE b.status='rejected')     AS "ปฏิเสธ",
                COUNT(*) FILTER (WHERE b.status='cancelled')    AS "ยกเลิก",
                ROUND(SUM(EXTRACT(EPOCH FROM (b.end_time-b.start_time))/3600)
                    FILTER (WHERE b.status='approved'), 1)      AS "ชั่วโมงรวม",
                ROUND(AVG(b.attendee_count)
                    FILTER (WHERE b.status='approved'), 1)      AS "ผู้เข้าร่วมเฉลี่ย"
            FROM bookings b
            JOIN rooms r ON r.id = b.room_id
            JOIN buildings bu ON bu.id = r.building_id
            WHERE b.start_time BETWEEN $1 AND $2 ${roomFilter}
            GROUP BY r.id, r.name, bu.name, r.capacity
            ORDER BY COUNT(*) DESC
        `, params),

        // สถิติรายวัน
        pool.query(`
            SELECT
                DATE(b.start_time AT TIME ZONE 'Asia/Bangkok')  AS "วันที่",
                COUNT(*)                                         AS "จองทั้งหมด",
                COUNT(*) FILTER (WHERE b.status='approved')      AS "อนุมัติ",
                COUNT(*) FILTER (WHERE b.status='rejected')      AS "ปฏิเสธ",
                COUNT(*) FILTER (WHERE b.status='cancelled')     AS "ยกเลิก",
                COUNT(DISTINCT b.room_id)                        AS "ห้องที่ถูกจอง"
            FROM bookings b
            WHERE b.start_time BETWEEN $1 AND $2 ${roomFilter}
            GROUP BY 1 ORDER BY 1
        `, params),

        // Peak hours
        pool.query(`
            SELECT
                EXTRACT(HOUR FROM b.start_time AT TIME ZONE 'Asia/Bangkok') AS "ชั่วโมง",
                COUNT(*) FILTER (WHERE b.status='approved') AS "จำนวนการจอง"
            FROM bookings b
            WHERE b.start_time BETWEEN $1 AND $2 ${roomFilter}
            GROUP BY 1 ORDER BY 2 DESC
        `, params),
    ]);

    return { bookings: bookings.rows, roomStats: roomStats.rows, dailyStats: dailyStats.rows, peakHours: peakHours.rows };
}

// ─── GET /api/reports/export/excel ───────────────────
router.get('/export/excel', requireRole('room_admin', 'super_admin'), async (req, res, next) => {
    try {
        const { from, to, room_id } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'กรุณาระบุ from และ to' });

        const data = await fetchReportData({
            from: new Date(from), to: new Date(to + 'T23:59:59'),
            room_id: room_id || null,
        });

        const workbook = new ExcelJS.Workbook();
        workbook.creator  = 'ระบบจองห้องมหาวิทยาลัย';
        workbook.created  = new Date();

        // ─── Style helper ─────────────────────────────
        const headerStyle = {
            font:      { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
            fill:      { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B4FD8' } },
            alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
            border: {
                bottom: { style: 'thin', color: { argb: 'FF1340B0' } },
            },
        };
        const addSheet = (name, rows) => {
            if (!rows.length) return;
            const ws = workbook.addWorksheet(name, {
                views: [{ state: 'frozen', ySplit: 1 }],
            });
            const cols = Object.keys(rows[0]);
            ws.columns = cols.map(k => ({ header: k, key: k, width: Math.min(Math.max(k.length + 4, 14), 36) }));

            // Header style
            ws.getRow(1).eachCell(cell => Object.assign(cell, headerStyle));
            ws.getRow(1).height = 32;

            // Data rows
            rows.forEach((row, i) => {
                const r = ws.addRow(row);
                r.eachCell(cell => {
                    cell.alignment = { vertical: 'middle', wrapText: false };
                    if (i % 2 === 1) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F9FC' } };
                    }
                });
            });

            // Auto-filter
            ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
        };

        // ─── Sheet 1: ข้อมูลดิบ ──────────────────────
        addSheet('ข้อมูลการจอง', data.bookings.map(r => ({
            ...r,
            'เวลาเริ่ม':  r['เวลาเริ่ม']  ? format(new Date(r['เวลาเริ่ม']),  'dd/MM/yyyy HH:mm') : '',
            'เวลาสิ้นสุด': r['เวลาสิ้นสุด'] ? format(new Date(r['เวลาสิ้นสุด']), 'dd/MM/yyyy HH:mm') : '',
            'วันที่จอง':  r['วันที่จอง']  ? format(new Date(r['วันที่จอง']),  'dd/MM/yyyy HH:mm') : '',
        })));

        // ─── Sheet 2: สถิติแต่ละห้อง ─────────────────
        addSheet('สถิติห้อง', data.roomStats);

        // ─── Sheet 3: สถิติรายวัน ─────────────────────
        addSheet('สถิติรายวัน', data.dailyStats.map(r => ({
            ...r, 'วันที่': r['วันที่'] ? format(new Date(r['วันที่']), 'd MMM yyyy', { locale: th }) : '',
        })));

        // ─── Sheet 4: Peak Hours ──────────────────────
        addSheet('ช่วงเวลายอดนิยม', data.peakHours.map(r => ({
            'ช่วงเวลา': `${String(r['ชั่วโมง']).padStart(2,'0')}:00 – ${String(parseInt(r['ชั่วโมง'])+1).padStart(2,'0')}:00`,
            'จำนวนการจอง': r['จำนวนการจอง'],
        })));

        // ─── Sheet 5: สรุปภาพรวม ─────────────────────
        const summaryWs = workbook.addWorksheet('สรุป', { views: [] });
        summaryWs.columns = [{ key: 'label', width: 30 }, { key: 'value', width: 20 }];
        const totalApproved  = data.bookings.filter(b => b['สถานะ'] === 'approved').length;
        const totalHours     = data.bookings
            .filter(b => b['สถานะ'] === 'approved')
            .reduce((s, b) => s + (parseFloat(b['ชั่วโมง']) || 0), 0);

        [
            ['📊 รายงานสรุปการจองห้อง', ''],
            ['ช่วงเวลา', `${format(new Date(from),'d MMM yyyy',{locale:th})} – ${format(new Date(to),'d MMM yyyy',{locale:th})}`],
            ['', ''],
            ['จองทั้งหมด', data.bookings.length],
            ['อนุมัติ', totalApproved],
            ['ปฏิเสธ', data.bookings.filter(b => b['สถานะ'] === 'rejected').length],
            ['ยกเลิก', data.bookings.filter(b => b['สถานะ'] === 'cancelled').length],
            ['ชั่วโมงการใช้งานรวม', `${totalHours.toFixed(1)} ชั่วโมง`],
            ['ห้องที่ถูกจองมากที่สุด', data.roomStats[0]?.['ห้อง'] ?? '-'],
        ].forEach(([label, value], i) => {
            const row = summaryWs.addRow({ label, value });
            if (i === 0) {
                row.getCell('label').font = { bold: true, size: 13, color: { argb: 'FF1B4FD8' } };
            } else if (i > 2) {
                row.getCell('label').font  = { bold: true };
                row.getCell('value').font  = { bold: true, color: { argb: 'FF1B4FD8' } };
            }
        });

        // ─── Response ─────────────────────────────────
        const filename = `room-report-${from}-to-${to}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) { next(err); }
});

// ─── GET /api/reports/export/powerbi — CSV สำหรับ Power BI ─
router.get('/export/powerbi', requireRole('room_admin', 'super_admin'), async (req, res, next) => {
    try {
        const { from, to, room_id } = req.query;
        if (!from || !to) return res.status(400).json({ error: 'กรุณาระบุ from และ to' });

        const data = await fetchReportData({
            from: new Date(from), to: new Date(to + 'T23:59:59'),
            room_id: room_id || null,
        });

        // Power BI ต้องการ UTF-8 BOM + CSV
        const rows    = data.bookings;
        if (!rows.length) return res.status(204).end();

        const headers = Object.keys(rows[0]);
        const csvRows = [
            headers.join(','),
            ...rows.map(row =>
                headers.map(h => {
                    const val = row[h] ?? '';
                    // format dates
                    if (h === 'เวลาเริ่ม' || h === 'เวลาสิ้นสุด' || h === 'วันที่จอง') {
                        return val ? format(new Date(val), 'yyyy-MM-dd HH:mm:ss') : '';
                    }
                    const str = String(val).replace(/"/g, '""');
                    return str.includes(',') || str.includes('\n') ? `"${str}"` : str;
                }).join(',')
            ),
        ];

        const BOM = '\uFEFF'; // UTF-8 BOM สำหรับ Excel และ Power BI
        const csv = BOM + csvRows.join('\n');

        const filename = `room-report-powerbi-${from}-to-${to}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);

    } catch (err) { next(err); }
});

// ─── GET /api/reports/summary — ดูสถิติใน UI (JSON) ──
router.get('/summary', requireRole('room_admin', 'super_admin'), async (req, res, next) => {
    try {
        const { from, to, room_id } = req.query;
        const fromDate = from ? new Date(from) : new Date(new Date().setDate(1)); // ต้นเดือน
        const toDate   = to   ? new Date(to + 'T23:59:59') : new Date();

        const data = await fetchReportData({ from: fromDate, to: toDate, room_id: room_id || null });
        res.json({
            period:      { from: fromDate, to: toDate },
            total:       data.bookings.length,
            approved:    data.bookings.filter(b => b['สถานะ'] === 'approved').length,
            rejected:    data.bookings.filter(b => b['สถานะ'] === 'rejected').length,
            cancelled:   data.bookings.filter(b => b['สถานะ'] === 'cancelled').length,
            room_stats:  data.roomStats,
            daily_stats: data.dailyStats,
            peak_hours:  data.peakHours,
        });
    } catch (err) { next(err); }
});

export default router;
