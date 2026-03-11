/**
 * localHolidayFallback.js
 * ─────────────────────────────────────────────────────────────
 * ข้อมูลวันหยุดสำรอง — ใช้เมื่อ Nager API ไม่ตอบสนอง
 * Admin ควร update ไฟล์นี้ทุกปีเมื่อ ครม. ประกาศวันหยุดอย่างเป็นทางการ
 * ─────────────────────────────────────────────────────────────
 */

export const localHolidayFallback = {
    2025: [
        { date: '2025-01-01', name_th: 'วันขึ้นปีใหม่',                            name_en: "New Year's Day",                    is_substitution: false },
        { date: '2025-02-12', name_th: 'วันมาฆบูชา',                               name_en: 'Makha Bucha Day',                   is_substitution: false },
        { date: '2025-04-06', name_th: 'วันจักรี',                                  name_en: 'Chakri Memorial Day',               is_substitution: false },
        { date: '2025-04-07', name_th: 'ชดเชยวันจักรี',                            name_en: 'Chakri Memorial Day (Substitute)',   is_substitution: true  },
        { date: '2025-04-13', name_th: 'วันสงกรานต์',                              name_en: 'Songkran Festival',                 is_substitution: false },
        { date: '2025-04-14', name_th: 'วันสงกรานต์',                              name_en: 'Songkran Festival',                 is_substitution: false },
        { date: '2025-04-15', name_th: 'วันสงกรานต์',                              name_en: 'Songkran Festival',                 is_substitution: false },
        { date: '2025-05-01', name_th: 'วันแรงงานแห่งชาติ',                        name_en: 'National Labour Day',               is_substitution: false },
        { date: '2025-05-05', name_th: 'วันฉัตรมงคล',                              name_en: 'Coronation Day',                    is_substitution: false },
        { date: '2025-05-12', name_th: 'วันวิสาขบูชา',                             name_en: 'Visakha Bucha Day',                 is_substitution: false },
        { date: '2025-06-03', name_th: 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี',      name_en: "The Queen's Birthday",              is_substitution: false },
        { date: '2025-07-10', name_th: 'วันอาสาฬหบูชา',                            name_en: 'Asarnha Bucha Day',                 is_substitution: false },
        { date: '2025-07-11', name_th: 'วันเข้าพรรษา',                             name_en: 'Buddhist Lent Day',                 is_substitution: false },
        { date: '2025-07-28', name_th: 'วันเฉลิมพระชนมพรรษารัชกาลที่ 10',          name_en: "The King's Birthday",               is_substitution: false },
        { date: '2025-08-12', name_th: 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนี',  name_en: "The Queen Mother's Birthday",       is_substitution: false },
        { date: '2025-10-13', name_th: 'วันคล้ายวันสวรรคตรัชกาลที่ 9',             name_en: 'King Bhumibol Memorial Day',        is_substitution: false },
        { date: '2025-10-23', name_th: 'วันปิยมหาราช',                             name_en: 'Chulalongkorn Day',                 is_substitution: false },
        { date: '2025-12-05', name_th: 'วันเฉลิมพระชนมพรรษารัชกาลที่ 9',           name_en: "King Bhumibol's Birthday",          is_substitution: false },
        { date: '2025-12-10', name_th: 'วันรัฐธรรมนูญ',                            name_en: 'Constitution Day',                  is_substitution: false },
        { date: '2025-12-31', name_th: 'วันสิ้นปี',                                name_en: "New Year's Eve",                    is_substitution: false },
    ],
    2026: [
        { date: '2026-01-01', name_th: 'วันขึ้นปีใหม่',                            name_en: "New Year's Day",                    is_substitution: false },
        { date: '2026-03-03', name_th: 'วันมาฆบูชา',                               name_en: 'Makha Bucha Day',                   is_substitution: false },
        { date: '2026-04-06', name_th: 'วันจักรี',                                  name_en: 'Chakri Memorial Day',               is_substitution: false },
        { date: '2026-04-13', name_th: 'วันสงกรานต์',                              name_en: 'Songkran Festival',                 is_substitution: false },
        { date: '2026-04-14', name_th: 'วันสงกรานต์',                              name_en: 'Songkran Festival',                 is_substitution: false },
        { date: '2026-04-15', name_th: 'วันสงกรานต์',                              name_en: 'Songkran Festival',                 is_substitution: false },
        { date: '2026-05-01', name_th: 'วันแรงงานแห่งชาติ',                        name_en: 'National Labour Day',               is_substitution: false },
        { date: '2026-05-05', name_th: 'วันฉัตรมงคล',                              name_en: 'Coronation Day',                    is_substitution: false },
        { date: '2026-06-01', name_th: 'วันวิสาขบูชา',                             name_en: 'Visakha Bucha Day',                 is_substitution: false },
        { date: '2026-06-03', name_th: 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี',      name_en: "The Queen's Birthday",              is_substitution: false },
        { date: '2026-07-28', name_th: 'วันเฉลิมพระชนมพรรษารัชกาลที่ 10',          name_en: "The King's Birthday",               is_substitution: false },
        { date: '2026-07-29', name_th: 'วันอาสาฬหบูชา',                            name_en: 'Asarnha Bucha Day',                 is_substitution: false },
        { date: '2026-07-30', name_th: 'วันเข้าพรรษา',                             name_en: 'Buddhist Lent Day',                 is_substitution: false },
        { date: '2026-08-12', name_th: 'วันเฉลิมพระชนมพรรษาสมเด็จพระบรมราชชนนี',  name_en: "The Queen Mother's Birthday",       is_substitution: false },
        { date: '2026-10-13', name_th: 'วันคล้ายวันสวรรคตรัชกาลที่ 9',             name_en: 'King Bhumibol Memorial Day',        is_substitution: false },
        { date: '2026-10-23', name_th: 'วันปิยมหาราช',                             name_en: 'Chulalongkorn Day',                 is_substitution: false },
        { date: '2026-12-05', name_th: 'วันเฉลิมพระชนมพรรษารัชกาลที่ 9',           name_en: "King Bhumibol's Birthday",          is_substitution: false },
        { date: '2026-12-10', name_th: 'วันรัฐธรรมนูญ',                            name_en: 'Constitution Day',                  is_substitution: false },
        { date: '2026-12-31', name_th: 'วันสิ้นปี',                                name_en: "New Year's Eve",                    is_substitution: false },
    ],
};
