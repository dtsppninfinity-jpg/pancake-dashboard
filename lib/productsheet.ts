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
  month: string; admin: string; sales: number; com: number; comSub: number; comHead: number;
}

/**
 * แท็บ `Com:Admin` → ค่าคอมรายเดือน × แอดมิน
 *
 * แต่ละบล็อกมีแอดมินหลายคนวางเรียงกันตามแนวนอน คนละ 4 คอลัมน์
 * แถวชื่อ (A = 'วันที่') เก็บ '@ชื่อเล่น' ที่คอลัมน์แรกของแต่ละคน
 * แถวถัดมาเป็นหัวข้อย่อยของคนนั้น: ยอดขาย/รายวัน | รวม Com.@ | รวม Com.รองH | รวม Com.H
 */
export function parseCommission(grid: string[][]): CommissionRow[] {
  const agg: Record<string, CommissionRow> = {};
  for (let i = 0; i < grid.length; i++) {
    if (clean_(grid[i][0]) !== 'วันที่') continue;
    const nameRow = grid[i], subRow = grid[i + 1] || [];
    const people: Array<{ name: string; at: number }> = [];
    nameRow.forEach((c, j) => {
      const t = clean_(c);
      if (t.startsWith('@') && t.length > 1) people.push({ name: t.slice(1), at: j });
    });
    if (!people.length) continue;

    for (let k = 0; k < people.length; k++) {
      const start = people[k].at;
      const end = k + 1 < people.length ? people[k + 1].at : start + 4;
      let cSales = -1, cCom = -1, cSub = -1, cHead = -1;
      for (let j = start; j < end; j++) {
        const lab = clean_(subRow[j]);
        const sq = squash_(subRow[j]);
        if (/^ยอดขาย\/รายวัน$/.test(lab)) cSales = j;
        else if (/^รวมCom\.@/.test(sq)) cCom = j;
        else if (/^รวมCom\.รองH/.test(sq)) cSub = j;
        else if (/^รวมCom\.H/.test(sq)) cHead = j;
      }
      for (let r = i + 2; r < grid.length; r++) {
        const d = date_(grid[r][0]);
        if (!d) break;
        const month = d.slice(0, 7);
        const key = `${month}|${people[k].name}`;
        if (!agg[key]) agg[key] = { month, admin: people[k].name, sales: 0, com: 0, comSub: 0, comHead: 0 };
        const row = grid[r];
        agg[key].sales += cSales >= 0 ? num_(row[cSales]) : 0;
        agg[key].com += cCom >= 0 ? num_(row[cCom]) : 0;
        agg[key].comSub += cSub >= 0 ? num_(row[cSub]) : 0;
        agg[key].comHead += cHead >= 0 ? num_(row[cHead]) : 0;
      }
    }
  }
  return Object.keys(agg).sort().map((k) => agg[k]);
}
