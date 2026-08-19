// lib/rostersheet.ts — ตัวแกะชีท "ยันยอดแอดมิน" แท็บ **Data** (ทะเบียนแอดมินฉบับที่ทีมดูแลเอง)
//
// ทำไมต้องมี: ชื่อที่หน้า Admin Performance โชว์คือ `admin_settings.nickname` ซึ่งเคย seed มือครั้งเดียว
// (2026-07) ตั้งแต่นั้นทีมรับคนใหม่ / ส่งต่อบัญชีเฟสให้คนอื่น / มีคนลาออก แต่ DB ไม่รู้เรื่อง
// ผลจริงที่เจอ 2026-08-19: บัญชี "ดาว เรนโบว์" ถูกส่งต่อให้ชีต้าร์ แต่หน้าเว็บยังป้ายว่า "ฮันนา"
// = ยอดขาย/แชทของคนหนึ่งถูกนับเป็นของอีกคนบนหน้าจอ
//
// โครงแท็บ Data: A=รหัสพนักงาน B=ชื่อแอดมิน C=Facebook D=ยันยอดขาย
//   B เก็บชื่อจริง + ชื่อเล่นในวงเล็บ และเติมคำว่า "ออก" ท้ายชื่อเมื่อลาออก
//     "สร้อยฟ้า อินมี (แตงกวา)" / "ฟ้า วิลัยเลิศ (ฟ้า) ออก"
//   C คือชื่อที่ Pancake ใช้ = ตรงกับ `admins.name` ของเรา (บางแถวมีเว้นวรรคนำหน้า
//     และมีหมายเหตุต่อท้ายแบบ "Kan Ti (เฟสปลิว)" ซึ่งไม่ใช่ส่วนหนึ่งของชื่อ)
//
// ⚠️ สีแดงในชีทไม่ใช่เกณฑ์ลาออก — แถว "Kan Ti (เฟสปลิว)" ก็แดงแต่คนยังทำงานอยู่
//    เกณฑ์เดียวที่เชื่อได้คือคำว่า "ออก" ต่อท้ายคอลัมน์ B

export interface RosterRow {
  /** รหัสพนักงาน 4-6 หลัก (คนเดียวมีได้หลายแถวถ้าใช้หลายบัญชีเฟส) */
  code: string;
  realName: string;
  nick: string;
  /** ชื่อ Facebook ตามที่ Pancake เห็น — ตัดหมายเหตุท้ายชื่อออกแล้ว */
  fb: string;
  /** ชื่อ Facebook ดิบตามชีท (ไว้ลองจับคู่ก่อนเป็นอันดับแรก) */
  fbRaw: string;
  /** ลาออกแล้ว (มีคำว่า "ออก" ต่อท้ายชื่อ) */
  left: boolean;
}

const clean_ = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** '63006' / 63006 / '63006.0' → '63006' (คืน '' ถ้าไม่ใช่รหัสพนักงาน) */
export function empCode(v: unknown): string {
  const m = clean_(v).match(/^(\d{4,6})(?:\.0+)?$/);
  return m ? m[1] : '';
}

/**
 * ตัดหมายเหตุท้ายชื่อเฟส: 'Kan Ti (เฟสปลิว)' → 'Kan Ti'
 * ตัดเฉพาะวงเล็บ "ท้ายสุด" และเฉพาะเมื่อยังเหลือชื่อจริงข้างหน้า —
 * ชื่อเฟสที่เป็นวงเล็บล้วนหรือชื่อที่มีวงเล็บกลางประโยคจะไม่ถูกแตะ
 */
export function stripFbNote(s: unknown): string {
  const t = clean_(s);
  const m = t.match(/^(.*\S)\s*\([^()]*\)$/);
  return m && m[1] ? m[1] : t;
}

/** 'ฟ้า วิลัยเลิศ (ฟ้า) ออก' → { nick: 'ฟ้า', left: true } */
function parseNameCell_(v: unknown): { realName: string; nick: string; left: boolean } {
  const t = clean_(v);
  // "ออก" ต้องอยู่ "นอก" วงเล็บและอยู่ท้ายสุด — ชื่อเล่นบางคนอาจมีคำนี้อยู่ข้างใน
  const left = /\)\s*ออก\s*$/.test(t) || /(?:^|\s)ออก\s*$/.test(t);
  const body = t.replace(/(?:^|\s)ออก\s*$/, '').trim();
  // ชื่อเล่นคือวงเล็บ "กลุ่มสุดท้าย" — ชื่อจริงบางคนมีวงเล็บซ้อน
  let nick = '';
  const all = body.match(/\(([^()]*)\)/g);
  if (all && all.length) nick = clean_(all[all.length - 1].slice(1, -1));
  const realName = clean_(body.replace(/\s*\([^()]*\)\s*$/, ''));
  return { realName, nick, left };
}

/**
 * แท็บ Data ทั้งแผ่น → แถวทะเบียนที่ใช้ได้ (ข้ามหัวตาราง/แถวว่างเอง)
 * แถวที่ไม่มีทั้งชื่อเฟสและชื่อเล่นถูกทิ้ง — เขียนอะไรลง DB ไม่ได้อยู่ดี
 */
export function parseRosterData(grid: string[][]): RosterRow[] {
  const out: RosterRow[] = [];
  for (const row of grid) {
    const code = empCode(row[0]);
    const nameCell = clean_(row[1]);
    if (!code && !nameCell) continue;
    const fbRaw = clean_(row[2]);
    if (!fbRaw) continue;
    const { realName, nick, left } = parseNameCell_(nameCell);
    if (!nick) continue;
    out.push({ code, realName, nick, fb: stripFbNote(fbRaw), fbRaw, left });
  }
  return out;
}
