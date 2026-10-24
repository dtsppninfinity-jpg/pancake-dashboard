// lib/api/roascard.ts — 11 ค่าของการ์ด PN ROAS ต่อยูนิต + รายแอดมิน (หน้าต่างยูนิต หน้ายอดขาย)
//
// ตัวเลขทุกตัวมาจากระบบ pn-infinity (lib/pnroas.ts) ซึ่งเป็นที่เดียวกับที่บอทไลน์คิดการ์ด — ฝั่งนี้ไม่คิดสูตรเอง
// แค่แปลงตัวกรองช่วงวันที่ของหน้ายอดขายเป็น from/to + แปะชื่อเล่น + เรียงแอดมินยอดมากก่อน
// ⚠️ กติกาต่างจากตัวเลขอื่นในหน้ายอดขาย: นับทุกช่องทาง · บิลยืนยันแล้ว · งบจาก Meta ของอีกระบบ — จึงไม่เท่ากันเป๊ะ
import { resolveRange_ } from './sales';
import { fmtDateBkk } from '@/lib/config';
import { fetchRoasExport, fetchNicknames, pnRoasConfigured, PnRoasError, type RoasFigures } from '@/lib/pnroas';

/** อีกฝั่งรับช่วงยาวสุด 31 วัน (เกิน = 400) — ปุ่มสำเร็จรูปทุกปุ่มไม่เกิน มีแค่ "กำหนดเอง" ที่เลยได้ */
const MAX_DAYS = 31;

const FIG_KEYS: (keyof RoasFigures)[] = [
  'roas', 'roasPass', 'sales', 'spend', 'adPct', 'orders',
  'perBill', 'newChats', 'contacts', 'tags', 'costPerChat', 'closePct',
];

/** เอาเฉพาะ 11 ค่า (+ผ่านเกณฑ์) — ช่องอื่นที่อีกฝั่งเพิ่มมาภายหลังไม่หลุดถึงเบราว์เซอร์ · ช่องที่ไม่มี = null */
function figs_(src: any): RoasFigures {
  const out: any = {};
  for (const k of FIG_KEYS) {
    const v = src ? src[k] : null;
    out[k] = v === undefined ? null : v;
  }
  return out;
}

export const unitKey = (u: unknown): string => String(u || '').trim().toUpperCase();

/** ชื่อเล่นรอได้ไม่เกินนี้หลังได้ตัวเลขแล้ว — ช้ากว่านี้โชว์รหัสพนักงานไปก่อน (คำขอยังวิ่งต่อ ได้ผลแล้วจำไว้ให้รอบหน้า) */
const NAMES_WAIT_MS = 3000;

export async function apiRoasCard(params: any) {
  if (!pnRoasConfigured()) return { configured: false };
  let from = '';
  let to = '';
  try {
    const r = resolveRange_(params);
    from = fmtDateBkk(r.start);
    to = fmtDateBkk(r.end);
  } catch {
    return { configured: true, error: 'ช่วงวันที่ไม่ถูกต้อง' };
  }
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  // "กำหนดเอง" เลือกวันในอนาคตได้ (ปฏิทินแค่ทำสีจาง) → to ถูกตัดที่วันนี้ อยู่ก่อน from — อีกฝั่งตอบ 400 ลองใหม่กี่ครั้งก็ไม่ได้
  if (!(days >= 1)) return { configured: true, from, to, notYet: true };
  if (days > MAX_DAYS) return { configured: true, from, to, tooLong: true, maxDays: MAX_DAYS };
  try {
    const nicksP = fetchNicknames();
    const ex = await fetchRoasExport(from, to);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const nicks = await Promise.race([
      nicksP,
      new Promise<Record<string, string>>(function (res) { timer = setTimeout(function () { res({}); }, NAMES_WAIT_MS); }),
    ]);
    clearTimeout(timer);
    const units: Record<string, any> = {};
    for (const u of ex.units || []) {
      const admins = (u.admins || []).map(function (a) {
        return Object.assign({ name: nicks[a.sub] || a.employeeCode || '' }, figs_(a));
      });
      admins.sort(function (a, b) { return (Number(b.sales) || 0) - (Number(a.sales) || 0); });
      units[unitKey(u.unit)] = { total: figs_(u), admins: admins, others: figs_(u.others) };
    }
    return {
      configured: true, from, to,
      spendAsOf: ex.spendAsOf || null,
      chatsAsOf: ex.chatsAsOf || null,
      units,
    };
  } catch (e: any) {
    console.error('[apiRoasCard]', from, to, e && e.message);
    const timeout = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return {
      configured: true, from, to,
      error: e instanceof PnRoasError ? e.message
        : timeout ? 'ระบบการ์ด ROAS ตอบช้าเกินไป ลองใหม่อีกครั้ง'
        : 'เชื่อมต่อระบบการ์ด ROAS ไม่ได้',
    };
  }
}
