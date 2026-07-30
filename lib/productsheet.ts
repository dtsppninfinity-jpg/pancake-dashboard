// lib/productsheet.ts — ตัวแกะชีท "สรุปยอดรายสินค้า" (1 ไฟล์ = 1 ยูนิต)
//
// ทั้งสองแท็บวางเป็น "บล็อกละเดือน" ซ้อนกันลงไป บล็อกละ ~60 แถว
// ⚠️ ห้ามเชื่อชื่อเดือนในหัวตาราง — ทีมก๊อปบล็อกแล้วไม่ได้แก้ชื่อ (เจอ "พฤษภาคม" ซ้ำ 2 บล็อก)
//    และเลขเดือนในคอลัมน์ A ก็ผิด (A=5 ทั้งที่เป็น มิ.ย./ก.ค.)
//    เดือนที่ถูกต้องต้องอ่านจาก "วันที่จริง" ในคอลัมน์ A ของแถวข้อมูลเท่านั้น
//
// หาหัวตารางด้วยข้อความ ไม่ใช้เลขแถวตายตัว — ทีมแทรกแถว/คอลัมน์เพิ่มได้โดยไม่พัง

/** 'สร. UN3 : ดวงดรุณี 69' → 'UN3' (คืน '' ถ้าอ่านไม่ออก) */
export function unitFromTitle(title: unknown): string {
  const m = String(title || '').match(/สร\.\s*(U[N]?\d{1,3})/i);
  return m ? m[1].toUpperCase() : '';
}

function num_(v: unknown): number {
  const n = Number(String(v ?? '').replace(/,/g, '').trim());
  return isFinite(n) ? n : 0;
}

/** 'dd/mm/yy' (ค.ศ. 2 หลัก) → 'YYYY-MM-DD' — คืน '' ถ้าไม่ใช่วันที่ */
function date_(v: unknown): string {
  const m = String(v || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return '';
  return `20${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

const clean_ = (v: unknown) => String(v || '').replace(/\s+/g, ' ').trim();
/** เทียบหัวคอลัมน์แบบไม่สนช่องว่าง — ไฟล์รุ่นเก่า/ใหม่เขียนต่างกัน ("กำไรสุทธิ" vs "กำไร สุทธิ") */
const squash_ = (v: unknown) => String(v || '').replace(/\s+/g, '');

export interface UnitDailyRow {
  date: string; sales: number; orders: number; ads: number; profit: number; margin: number;
}

/**
 * แท็บ `สรุปยอดขาย` → ยอด/ออเดอร์/ค่าแอด/กำไรสุทธิ รายวัน
 *
 * หัวตารางกินสองแถว: แถวบนเป็นหัวข้อกลุ่ม (ADS, กำไรสุทธิ) แถวล่างเป็นหัวข้อย่อย (ยอดรวม, Orderรวม)
 * %มาร์จิ้นคือคอลัมน์ถัดจาก "กำไรสุทธิ" หนึ่งช่อง (หัวเป็น "%" เฉยๆ ระบุด้วยชื่อไม่ได้)
 */
export function parseSalesSummary(grid: string[][]): UnitDailyRow[] {
  const out: UnitDailyRow[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < grid.length; i++) {
    if (clean_(grid[i][0]) !== 'วันที่') continue;
    const head = grid[i], sub = grid[i + 1] || [];
    const cProfit = head.findIndex((c) => squash_(c) === 'กำไรสุทธิ');
    if (cProfit < 0) continue;                       // บล็อกที่ไม่มีคอลัมน์กำไร = ข้าม ไม่เดา
    const cMargin = cProfit + 1;
    const cAds = head.findIndex((c) => squash_(c).toUpperCase() === 'ADS');
    const cSales = sub.findIndex((c) => squash_(c) === 'ยอดรวม');
    const cOrders = sub.findIndex((c) => squash_(c).toLowerCase() === 'orderรวม');

    // ⚠️ ห้ามหยุดที่แถวว่างแถวเดียว — บางเดือนมีช่องวันที่ว่างคั่นกลาง (สูตรคืนค่าว่าง)
    // ถ้าหยุดทันทีจะเก็บได้ครึ่งเดือนแล้วเงียบ (เทียบกับแถว "รวม" ของชีทแล้วเจอส่วนต่างจริง)
    // ปล่อยให้ข้ามได้ถึง 3 แถว แล้วค่อยถือว่าจบบล็อก — แถว "รวม/roasรวม/ยอดเฉลี่ย" ติดกันพอดี
    let gap = 0;
    for (let r = i + 2; r < grid.length; r++) {
      const d = date_(grid[r][0]);
      if (!d) {
        if (++gap > 3) break;
        continue;
      }
      gap = 0;
      if (seen.has(d)) continue;                      // กันบล็อกซ้ำ (ทีมก๊อปบล็อกทิ้งไว้)
      seen.add(d);
      const row = grid[r];
      out.push({
        date: d,
        sales: cSales >= 0 ? num_(row[cSales]) : 0,
        orders: cOrders >= 0 ? num_(row[cOrders]) : 0,
        ads: cAds >= 0 ? num_(row[cAds]) : 0,
        profit: num_(row[cProfit]),
        margin: num_(row[cMargin]),
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : 1));
}

export interface CommissionRow {
  month: string; admin: string; realName: string;
  sales: number; returns: number; cancel: number; remaining: number;
  com: number; comSub: number; comHead: number;
  closeRate: number | null; // % ปิดการขายลูกค้าใหม่ (0-100) — null ถ้าชีทไม่มี/ว่าง
}

/**
 * แท็บ `Com:Admin` → อ่าน "ตารางประเมินรายเดือน" (บล็อกสรุปใต้ตารางรายวันของแต่ละเดือน)
 *
 * บอสสั่ง (2026-07-30) ให้ใช้ตัวเลขจากตารางนี้ตรงๆ — โดยเฉพาะ "คงเหลือ" (ยอดจริงหลังหักตีกลับ/ยกเลิก)
 * กับ "Commission (Admin)" ห้ามรวมเองจากรายวัน: คอมจริงมีเงื่อนไขถึงเป้า/ไม่ถึงเป้าที่ทีมคิดไว้ในชีทแล้ว
 * (เจอจริง: ยอดขาย 167,560 แต่คอม = 0 เพราะไม่ถึงเป้า — รวมจากรายวันจะได้เลขผิด)
 *
 * โครงบล็อก: แถวหัว = แถวที่มีเซลล์ 'คงเหลือ' → คอลัมน์อ่านจากหัวจริง
 *   ลำดับ | รหัสพนักงาน | ชื่อจริง | ชื่อ(@เล่น) | ยอดขาย | ยอดขายค่าCom | ตีกลับ | ยกเลิก | คงเหลือ |
 *   Commission(Admin) | (รองหัวหน้า) | (หัวหน้า) | %Error | %ปิดการขายลูกค้าใหม่ | เปอร์บิล
 * ⚠️ ชื่อคอลัมน์คอมสะกดต่างกันระหว่างไฟล์ ("Commission (Admin)" / "Commission@Admin" / "Commission DH.")
 *    → ใช้ตำแหน่ง: 3 คอลัมน์ถัดจาก 'คงเหลือ' เสมอ (ตรวจกับไฟล์จริงแล้วทั้งสองรุ่น)
 * ⚠️ เดือนของบล็อกห้ามอ่านจากหัว "ประเมิณเดือน ..." (ทีมก๊อปแล้วไม่แก้ชื่อ เหมือนแท็บสรุปยอดขาย)
 *    → ใช้เดือนจากวันที่จริงของตารางรายวันบล็อกเดียวกัน (แถว 'วันที่' ที่อยู่ก่อนหน้า)
 */
export function parseCommission(grid: string[][]): CommissionRow[] {
  const out: CommissionRow[] = [];
  const seen = new Set<string>(); // `${month}|${admin}` — กันบล็อกเดือนซ้ำ (บล็อกแรกชนะ เหมือนแท็บรายวัน)
  let curMonth = '';              // เดือนของบล็อกล่าสุดที่อ่านเจอจากวันที่จริง

  for (let i = 0; i < grid.length; i++) {
    const row = grid[i] || [];

    // เจอตารางรายวันของบล็อก → นับเดือนจากวันที่จริง (เอาเดือนที่พบบ่อยสุด กันแถวหลงบล็อก)
    if (clean_(row[0]) === 'วันที่') {
      const cnt: Record<string, number> = {};
      let gap = 0;
      for (let r = i + 2; r < grid.length; r++) {
        const d = date_(grid[r]?.[0]);
        if (!d) { if (++gap > 3) break; continue; }
        gap = 0;
        cnt[d.slice(0, 7)] = (cnt[d.slice(0, 7)] || 0) + 1;
      }
      let best = '', bestN = 0;
      Object.keys(cnt).forEach((m) => { if (cnt[m] > bestN) { bestN = cnt[m]; best = m; } });
      if (best) curMonth = best;
      continue;
    }

    // เจอหัวตารางประเมิน (มีเซลล์ 'คงเหลือ') → อ่านแถวแอดมินใต้หัว
    const cRemain = row.findIndex((c) => squash_(c) === 'คงเหลือ');
    if (cRemain < 0 || !curMonth) continue;
    const cName = row.findIndex((c) => squash_(c) === 'ชื่อ');
    const cReal = row.findIndex((c) => squash_(c) === 'ชื่อจริง');
    const cSales = row.findIndex((c) => squash_(c) === 'ยอดขาย');
    const cRet = row.findIndex((c) => squash_(c) === 'ตีกลับ');
    const cCancel = row.findIndex((c) => squash_(c) === 'ยกเลิก');
    const cClose = row.findIndex((c) => squash_(c).startsWith('%ปิดการขาย'));
    if (cName < 0) continue;

    for (let r = i + 1; r < Math.min(i + 30, grid.length); r++) {
      const dr = grid[r] || [];
      if (clean_(dr[1]) === 'รวม') break;             // แถวรวมท้ายตาราง = จบบล็อก
      const nick = clean_(dr[cName]);
      if (!nick.startsWith('@') || nick.length < 2) continue; // แถวลำดับว่าง (6..10) ข้าม
      const admin = nick.slice(1);
      if (/^Admin\d+$/i.test(admin)) continue;        // ช่องเผื่อที่ทีมยังไม่ใส่คนจริง
      const key = `${curMonth}|${admin}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const closeRaw = clean_(dr[cClose]);
      const closeNum = num_(closeRaw);
      out.push({
        month: curMonth,
        admin,
        realName: cReal >= 0 ? clean_(dr[cReal]) : '',
        sales: cSales >= 0 ? num_(dr[cSales]) : 0,
        returns: cRet >= 0 ? num_(dr[cRet]) : 0,
        cancel: cCancel >= 0 ? num_(dr[cCancel]) : 0,
        remaining: num_(dr[cRemain]),
        com: num_(dr[cRemain + 1]),
        comSub: num_(dr[cRemain + 2]),
        comHead: num_(dr[cRemain + 3]),
        // ชีทเก็บเป็นสัดส่วน (0.3258 = 32.58%) — เผื่อบางไฟล์กรอกเป็นเปอร์เซ็นต์แล้วด้วย
        closeRate: cClose >= 0 && closeRaw !== ''
          ? Math.round((closeNum <= 1.5 ? closeNum * 100 : closeNum) * 100) / 100
          : null,
      });
    }
  }
  return out.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : a.admin.localeCompare(b.admin)));
}
