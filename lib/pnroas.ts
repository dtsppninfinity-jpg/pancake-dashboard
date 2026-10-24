// lib/pnroas.ts — ตัวเรียก API "การ์ด PN ROAS" ของระบบ pn-infinity (โปรเจคที่บอทไลน์ใช้คิดการ์ด)
//
// ทำไม: พีสั่ง 22 ต.ค. 69 ให้เอา 11 ค่าของการ์ด PN ROAS มาโชว์ในหน้ายอดขาย "ตัวเลขชุดเดียวกับในไลน์"
// แทนที่จะคิดเองจาก POS/Pancake/Meta (ตัวเลขจะได้ไม่ต่างกัน + ไม่เพิ่มการเรียก Pancake/Meta ของเรา)
// อีกฝั่งคิดเสร็จทุกค่าแล้ว เราแค่ถาม + แปะชื่อเล่น — ห้ามคิดสูตรซ้ำฝั่งนี้
//
// เข้าระบบ: บัญชีเครื่องใน Keycloak (client_credentials) → Bearer token · รหัสลับอยู่ใน env PN_ROAS_CLIENT_SECRET
// ไม่ได้ตั้ง = ปิดทั้งฟีเจอร์เงียบๆ (หน้าเว็บไม่โชว์ส่วนนี้)
// ต้องส่ง User-Agent ของตัวเอง — Cloudflare หน้าระบบนั้นเคยปฏิเสธ UA ตั้งต้นของบางโปรแกรม (error code: 1010)
//
// ไม่เรียกถี่: ผลต่อช่วงวันที่เก็บ 5 นาที · ชื่อเล่นเก็บ 1 วัน (ในหน่วยความจำของ instance — Vercel แต่ละตัวเก็บแยก)

const CLIENT_ID = process.env.PN_ROAS_CLIENT_ID || 'roas-export-svc';
// เปลี่ยนที่อยู่ได้ทาง env (เทสบนเครื่องกับตัวจำลอง) — ค่าจริงคือค่าตั้งต้น
const AUTH_URL = process.env.PN_ROAS_AUTH_URL ||
  'https://auth.pninfinity.com/realms/pn-infinity/protocol/openid-connect/token';
const API_BASE = process.env.PN_ROAS_API_BASE || 'https://gw.pninfinity.com';
const USER_AGENT = 'pn-sales-dashboard/1.0';

const TIMEOUT_MS = 20_000;
const EXPORT_TTL_MS = 5 * 60 * 1000;
const NAMES_TTL_MS = 24 * 3600 * 1000;
const EXPORT_CACHE_MAX = 40;

/** 11 ค่าของการ์ด 1 แถว — null = ไม่รู้ค่า (หน้าเว็บโชว์ "—" ไม่ใช่ 0) · เงินเป็นบาท (อีกฝั่งแปลงจากสตางค์แล้ว) */
export interface RoasFigures {
  roas: number | null; roasPass: boolean | null;
  sales: number | null; spend: number | null; adPct: number | null; orders: number | null;
  perBill: number | null; newChats: number | null; contacts: number | null; tags: number | null;
  costPerChat: number | null; closePct: number | null;
}
export interface RoasAdminRow extends RoasFigures { sub: string; employeeCode: string; }
export interface RoasUnitRow extends RoasFigures { unit: string; admins: RoasAdminRow[]; others: RoasFigures; }
export interface RoasExport {
  from: string; to: string;
  spendAsOf: string | null; chatsAsOf: string | null;
  company: RoasFigures; units: RoasUnitRow[]; unattributed: RoasFigures;
}

export class PnRoasError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export function pnRoasConfigured(): boolean {
  return !!process.env.PN_ROAS_CLIENT_SECRET;
}

/* ---- token: ขอครั้งเดียวใช้จนใกล้หมดอายุ (เผื่อ 60 วิ) ----
 * คำขอที่มาพร้อมกัน (ข้อมูล + ชื่อเล่น) รอ token ตัวเดียวกัน ไม่ขอซ้อน */
let token_: { value: string; exp: number } | null = null;
let tokenP_: Promise<string> | null = null;

function getToken_(): Promise<string> {
  if (token_ && Date.now() < token_.exp) return Promise.resolve(token_.value);
  if (!tokenP_) tokenP_ = fetchToken_().finally(() => { tokenP_ = null; });
  return tokenP_;
}

async function fetchToken_(): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID,
    client_secret: process.env.PN_ROAS_CLIENT_SECRET || '',
  });
  const res = await fetch(AUTH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT, Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new PnRoasError('ขอสิทธิ์เข้าระบบการ์ด ROAS ไม่สำเร็จ (รหัส ' + res.status + ')', res.status);
  const j: any = await res.json().catch(() => null);
  if (!j || !j.access_token) throw new PnRoasError('ระบบการ์ด ROAS ตอบสิทธิ์เข้าระบบมาไม่ครบ', 502);
  const life = Number(j.expires_in) > 0 ? Number(j.expires_in) : 300;
  // เผื่อเวลาก่อนหมดอายุ 60 วิ — token อายุสั้น (≤ 2 นาที) เผื่อครึ่งเดียว ไม่งั้นหมดทันทีแล้วขอใหม่ทุกคำขอ
  token_ = { value: String(j.access_token), exp: Date.now() + (life - Math.min(60, life / 2)) * 1000 };
  return token_.value;
}

/** GET พร้อม token · 401 = token อาจหมดก่อนกำหนด → ขอใหม่แล้วลองอีกครั้งเดียว */
async function getJson_(path: string): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(API_BASE + path, {
      headers: { Authorization: 'Bearer ' + (await getToken_()), 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    if (res.status === 401 && attempt === 0) { token_ = null; continue; }
    if (!res.ok) throw new PnRoasError(httpMessage_(res.status), res.status);
    const j = await res.json().catch(() => null);
    if (!j) throw new PnRoasError('ระบบการ์ด ROAS ตอบกลับมาอ่านไม่ออก', 502);
    return j;
  }
  throw new PnRoasError(httpMessage_(401), 401);
}

function httpMessage_(status: number): string {
  if (status === 400) return 'ระบบการ์ด ROAS ไม่รับช่วงวันที่นี้ (รหัส 400)';
  if (status === 401 || status === 403) return 'ระบบการ์ด ROAS ไม่ให้สิทธิ์เข้า (รหัส ' + status + ')';
  if (status === 404) return 'ระบบการ์ด ROAS ยังไม่เปิดให้ใช้ (รหัส 404)';
  return 'ระบบการ์ด ROAS ตอบผิดปกติ (รหัส ' + status + ')';
}

/* ---- ผลต่อช่วงวันที่ ---- */
const exportCache_ = new Map<string, { at: number; p: Promise<RoasExport> }>();

/** from/to = 'YYYY-MM-DD' เวลาไทย · อีกฝั่งรับช่วงยาวสุด 31 วัน (คนเรียกต้องเช็คก่อน) */
export function fetchRoasExport(from: string, to: string): Promise<RoasExport> {
  const key = from + '|' + to;
  const hit = exportCache_.get(key);
  if (hit && Date.now() - hit.at < EXPORT_TTL_MS) return hit.p;
  const p = getJson_('/orders-api/roas-export?from=' + encodeURIComponent(from) + '&to=' + encodeURIComponent(to))
    .then(function (j: any): RoasExport {
      // รูปร่างผิด = ถือว่าพลาด (ไม่จำ 5 นาที) · แถวว่างในรายการตัดทิ้ง
      if (!j || !Array.isArray(j.units)) throw new PnRoasError('ระบบการ์ด ROAS ตอบข้อมูลมาไม่ครบ', 502);
      j.units = j.units.filter(Boolean).map(function (u: any) {
        return Object.assign({}, u, { admins: Array.isArray(u.admins) ? u.admins.filter(Boolean) : [] });
      });
      return j;
    });
  exportCache_.set(key, { at: Date.now(), p });
  p.catch(() => { if (exportCache_.get(key)?.p === p) exportCache_.delete(key); });   // พลาดแล้วไม่จำ — กดลองใหม่ต้องถามจริง
  if (exportCache_.size > EXPORT_CACHE_MAX) {
    const oldest = exportCache_.keys().next().value;
    if (oldest !== undefined) exportCache_.delete(oldest);
  }
  return p;
}

/* ---- ชื่อเล่น sub → ชื่อเล่น (อ่านไม่ได้ = ใช้ของเดิมที่จำไว้ / ว่าง — ไม่ทำให้การ์ดพัง) ----
 * พลาดแล้วจำความพลาดไว้ 10 นาที ไม่ถามซ้ำทุกครั้ง (ปลายทางค้าง = ทุกคำขอรอเต็มเวลา) · คำขอที่มาพร้อมกันรอตัวเดียวกัน */
const NAMES_RETRY_MS = 10 * 60 * 1000;
let names_: { at: number; ttl: number; map: Record<string, string> } | null = null;
let namesP_: Promise<Record<string, string>> | null = null;

export function fetchNicknames(): Promise<Record<string, string>> {
  if (names_ && Date.now() - names_.at < names_.ttl) return Promise.resolve(names_.map);
  if (!namesP_) {
    namesP_ = getJson_('/onboarding/people/names').then(function (j: any) {
      const map: Record<string, string> = {};
      for (const p of (j && j.people) || []) {
        const nick = String((p && p.nickname) || '').trim();
        if (p && p.sub && nick) map[String(p.sub)] = nick;
      }
      names_ = { at: Date.now(), ttl: NAMES_TTL_MS, map };
      return map;
    }, function (e: any) {
      console.error('[pnroas] names', e && e.message);
      const old = names_ ? names_.map : {};
      names_ = { at: Date.now(), ttl: NAMES_RETRY_MS, map: old };
      return old;
    }).finally(() => { namesP_ = null; });
  }
  return namesP_;
}
