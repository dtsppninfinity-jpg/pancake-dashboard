// lib/ui/helpers.ts — helpers ฝั่ง client (port จาก JsCommon.html)
// ฟังก์ชัน pure รันบน browser เท่านั้น — ห้าม import อะไรจากฝั่ง server
// HTML string / ชื่อ class / ข้อความไทย / esc() คงเดิมทุกตัวอักษรจากเวอร์ชัน GAS
// (ยกเว้น logoMark() ที่ page.tsx ฝั่ง server เรียกด้วย — ไฟล์นี้จึงห้ามแตะ window/document ตอน import)

import { icon, brandIcon } from '@/lib/ui/icons';
import { FIRST_CALLS } from '@/lib/ui/first-calls';

/* ---------------- โลโก้ PN ----------------
 * วาดตัว P กับ N เป็นรูปทรงล้วน (path) ไม่ใช้ <text> — เดิมโลโก้/ไอคอนแท็บพิมพ์ "PN" ด้วยฟอนต์ Segoe UI
 * ซึ่งไม่มีใน iPhone/Android ตัวอักษรเลยเพี้ยนเป็นฟอนต์อื่นคนละหน้าตาในแต่ละเครื่อง
 * ⚠️ ถ้าแก้รูปทรงตรงนี้ ต้องแก้ app/icon.svg (ไอคอนแท็บเบราว์เซอร์) ให้ตรงกันด้วย — ไฟล์นั้นเป็น SVG นิ่ง import ไม่ได้ */
// กริด 64×64: ตัวอักษรสูง 26 (y 19–45) เส้นหนา 5 · P กว้าง x 10–30 · N กว้าง x 34–54 → กึ่งกลางพอดี
// P = กรอบนอก + รูตรงกลาง (fill-rule evenodd เจาะรูให้) · N = รูปหลายเหลี่ยมก้อนเดียว (ขาซ้าย+เฉียง+ขาขวา)
const LOGO_P = 'M10 45V19h12a8 8 0 0 1 0 16h-7v10zM15 24v6h7a3 3 0 0 0 0-6z';
const LOGO_N = 'M34 45V19h6l9 16.71V19h5v26h-6l-9-16.71V45z';

/** โลโก้ PN (สี่เหลี่ยมมุมมนสีม่วงหลัก + ตัวอักษรขาว) — คืน HTML string ของ <svg> */
export function logoMark(size = 38, label?: string): string {
  const a11y = label ? 'role="img" aria-label="' + esc(label) + '"' : 'aria-hidden="true"';
  return '<svg class="logo-mark" viewBox="0 0 64 64" width="' + size + '" height="' + size + '" focusable="false" ' + a11y + '>' +
    '<rect width="64" height="64" rx="14" fill="#6c5ce7"/>' +
    '<path fill="#fff" fill-rule="evenodd" d="' + LOGO_P + '"/>' +
    '<path fill="#fff" d="' + LOGO_N + '"/>' +
  '</svg>';
}

/* ---------------- server call ---------------- */

/**
 * คำขอที่ page.tsx ยิงไว้ล่วงหน้าตอนเปิดเว็บ (ดู lib/ui/first-calls.ts) — ใช้ได้ครั้งเดียวต่อคำขอ
 * ต้องตรงทั้งชื่อ API และ body ทุกตัวอักษร · page.tsx ล้างทิ้งเองหลัง 15 วิ (ไม่เอาผลเก่ามาใช้ตอนรีเฟรชรอบหลัง)
 */
function takePrefetch_(fn: string, body: string): Promise<Response> | null {
  if (typeof window === 'undefined') return null;
  const pre = (window as any).__pnPre as Record<string, Promise<Response>> | null | undefined;
  if (!pre) return null;
  const k = fn + '|' + body;
  const p = pre[k];
  if (!p) return null;
  delete pre[k];
  return p;
}

/* ---- รุ่นข้อมูล: เพิ่มทุกครั้งที่มีการบันทึก/แก้ข้อมูลผ่าน API ----
 * app-core ใช้ตัดสินว่า "หน้าที่เพิ่งโหลดไปไม่ถึง 90 วิ" ยังใช้ของที่วาดค้างไว้ได้ไหม
 * (เช่น แก้ U Map แล้วกลับไปหน้ายอดขาย ต้องดึงใหม่ให้เห็นผลทันทีเหมือนเดิม)
 * ⚠️ นับเป็น "อ่านอย่างเดียว" เฉพาะที่อยู่ในรายการข้างล่าง — API ใหม่/คำสั่งใหม่ที่ไม่อยู่ในรายการ = ถือว่าแก้ข้อมูล (ปลอดภัยไว้ก่อน) */
let dataEpoch_ = 0;
export function dataEpoch(): number { return dataEpoch_; }
/** นับคำขอที่พลาด (ทุกชนิด) — หน้าที่ดึงเบื้องหลังพลาดแล้วโชว์ของเดิมค้างไว้ ต้องไม่ถูกนับว่า "สด" */
let failEpoch_ = 0;
export function failEpoch(): number { return failEpoch_; }
const READ_ONLY_FNS: Record<string, 1> = {
  apiDashboard: 1, apiSales: 1, apiContentAds: 1, apiUnitPerf: 1, apiReport: 1, apiAdminPerf: 1, apiKpi: 1,
  apiProfit: 1, apiAdmins: 1, apiBootstrap: 1, apiNavBadges: 1, apiPageMedia: 1, apiMe: 1,
};
function isReadOnlyCall_(fn: string, params: any, body: string): boolean {
  if (READ_ONLY_FNS[fn]) return true;
  if (fn === 'apiScoreConfig' || fn === 'apiUMap') return body === '{}';
  if (fn === 'apiUsers') return !!params && params.action === 'list';
  if (fn === 'apiAdminCom') return !params || !params.action;
  return false;
}

/** แทน google.script.run เดิม → เรียก route /api/<fn> ด้วย fetch POST */
export async function serverCall<T = any>(fn: string, params?: unknown): Promise<T> {
  const body = JSON.stringify(params || {});
  lastBody_[fn] = body;
  if (!isReadOnlyCall_(fn, params, body)) {
    // นับทั้งตอนเริ่มและตอนจบ — หน้าที่โหลดระหว่างกำลังบันทึกก็ต้องถือว่าเก่า
    dataEpoch_++;
    const done = () => { dataEpoch_++; };
    return serverCallRaw_<T>(fn, body).then((v) => { done(); return v; }, (e) => { done(); failEpoch_++; throw e; });
  }
  return serverCallRaw_<T>(fn, body).catch((e) => { failEpoch_++; throw e; });
}

/* ---- กด F5 แล้วเห็นตัวเลขทันที: จำผลคำขอแรกของหน้าไว้ในแท็บนี้ (sessionStorage) ----
 * ตอนเปิดเว็บ/รีเฟรช คำขอแรกของหน้า (ตัวที่ page.tsx ยิงล่วงหน้า) ถ้ามีผลเดิมของคำขอเดียวกันที่อายุไม่เกิน 10 นาที
 * → คืนผลเดิมให้หน้าวาดทันที + ปุ่มรีเฟรชหมุน (app-core ฟัง pn-f5-stale) แล้วพอผลใหม่มาถึง
 *   app-core สั่งหน้าโหลดใหม่ (pn-f5-fresh) → serverCall ครั้งนั้นได้ผลใหม่ที่รอไว้ (ไม่ยิงซ้ำ) → ตัวเลขล่าสุดแทนที่ภายใน ~1 วิ
 * เฉพาะหน้าที่ "โชว์ของเดิมก่อนแล้วดึงใหม่เบื้องหลัง" อยู่แล้ว และคำขอถัดไปใช้ตัวกรองเดิม (F5_VIEWS)
 *   ไม่ใส่: รายงาน/KPI/ผลงานยูนิต — จำ "เดือน" จากผลที่ได้ → ผลเก่าข้ามเดือนจะพาไปเดือนที่แล้ว และคำขอถัดไปคนละ key (ยิงซ้ำ)
 *   ไม่ใส่: หน้าที่มีการแก้ข้อมูล/หน้าต่างค้าง (แอดมิน/U Map/บัญชี/ผลงานของฉัน)
 * ผูกกับผู้ใช้ + สิทธิ์ (ออกจากระบบ/เปลี่ยนบัญชีในแท็บเดียวกันไม่เห็นของคนก่อน) + รุ่นเว็บ (deploy ใหม่ = ไม่ใช้ของรุ่นเก่า
 * ที่รูปข้อมูลอาจต่างกัน) · แท็บปิด = หายเอง · ปิดทั้งระบบ: ตั้ง F5_MAX_AGE_MS = 0 */
const F5_MAX_AGE_MS = 10 * 60 * 1000;
const F5_MAX_CHARS = 1_500_000;        // ผลใหญ่กว่านี้ไม่จำ (เช่น โฆษณา 7 MB) — sessionStorage ทั้งเว็บได้ราว 5 MB
const F5_FRESH_MS = 60 * 1000;         // ผลใหม่ที่รอให้หน้ามาหยิบ เก็บไว้ไม่เกิน 1 นาที
const F5_PREFIX = 'pn-f5|';
// รุ่นเว็บ — ตั้งตอน build (next.config.mjs env PN_BUILD_ID) · ของที่จำไว้จากรุ่นอื่นไม่ใช้
const F5_BUILD = String(process.env.PN_BUILD_ID || '');
const F5_VIEWS = ['dashboard', 'sales', 'contentads', 'profit'];
/** body ล่าสุดที่แต่ละ API ถูกขอ — ผลใหม่หลัง F5 วาดทับเฉพาะเมื่อหน้ายังขอด้วยตัวกรองเดิม (ดู isLatestCall) */
const lastBody_: Record<string, string> = {};
/** คำขอ fn|body นี้ยังเป็นคำขอล่าสุดของ fn ไหม — ผู้ใช้เปลี่ยนตัวกรองไปแล้ว = ไม่ใช่ (ห้ามวาดผลของตัวกรองเก่าทับ) */
export function isLatestCall(key: string): boolean {
  const i = key.indexOf('|');
  return i > 0 && lastBody_[key.slice(0, i)] === key.slice(i + 1);
}
let f5Keys_: Record<string, string> | null = null;   // fn|body → ชื่อหน้า
const f5Fresh_: Record<string, { p: Promise<any>; at: number }> = {};

function f5Keys(): Record<string, string> {
  if (!f5Keys_) {
    f5Keys_ = {};
    for (const v of F5_VIEWS) {
      (FIRST_CALLS[v] || []).forEach(([fn, p]) => { f5Keys_![fn + '|' + JSON.stringify(p)] = v; });
    }
  }
  return f5Keys_;
}
function f5User_(): string {
  if (typeof document === 'undefined') return '';
  const app = document.getElementById('app');
  const nm = document.querySelector('.me-name');
  return ((app && app.getAttribute('data-role')) || '') + '|' + ((nm && nm.textContent) || '').trim();
}
function f5Read_(k: string): unknown {
  if (!(F5_MAX_AGE_MS > 0)) return undefined;
  try {
    const raw = sessionStorage.getItem(F5_PREFIX + k);
    if (!raw) return undefined;
    const o = JSON.parse(raw);
    if (!o || o.u !== f5User_() || o.b !== F5_BUILD || !(Date.now() - Number(o.t) < F5_MAX_AGE_MS)) return undefined;
    return o.v;
  } catch (e) { return undefined; }
}
function f5Write_(k: string, text: string): void {
  if (!(F5_MAX_AGE_MS > 0) || text.length > F5_MAX_CHARS) return;
  const val = '{"t":' + Date.now() + ',"u":' + JSON.stringify(f5User_()) + ',"b":' + JSON.stringify(F5_BUILD) + ',"v":' + text + '}';
  try { sessionStorage.setItem(F5_PREFIX + k, val); } catch (e) {
    // เต็ม → ล้างของหน้าอื่นที่จำไว้แล้วลองอีกครั้ง · ยังไม่ได้ก็ไม่จำ (แค่ F5 รอบหน้าไม่เร็ว)
    try { clearF5Cache(); sessionStorage.setItem(F5_PREFIX + k, val); } catch (e2) { /* ไม่จำ */ }
  }
}
/** ล้างผลที่จำไว้ทั้งหมด (ออกจากระบบ / session หมดอายุ) */
export function clearF5Cache(): void {
  try {
    const ks: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k && k.indexOf(F5_PREFIX) === 0) ks.push(k);
    }
    ks.forEach((k) => sessionStorage.removeItem(k));
  } catch (e) { /* ไม่มี sessionStorage */ }
}
function f5Emit_(name: string, detail: unknown): void {
  try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* เบราว์เซอร์เก่า */ }
}

/** อ่านคำตอบ: 401 = เด้งไปล็อกอิน · ไม่ ok = error พร้อมข้อความ server · คืน [ผล, ข้อความดิบ] */
async function readResp_(r: Response): Promise<[any, string]> {
  if (r.status === 401) {
    // session หมดอายุ / ยังไม่ล็อกอิน → เด้งไปหน้า login
    if (typeof window !== 'undefined') { clearF5Cache(); window.location.href = '/login'; }
    throw new Error('unauthorized');
  }
  if (!r.ok) throw new Error(await r.text());
  const text = await r.text();
  return [JSON.parse(text), text];
}

async function serverCallRaw_<T>(fn: string, body: string): Promise<T> {
  const send = () => fetch('/api/' + fn, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
  const k = fn + '|' + body;
  const view = typeof window !== 'undefined' ? f5Keys()[k] : undefined;
  // ผลใหม่ที่ดึงไว้ตอนโชว์ของเดิมหลัง F5 — หน้ามาขอรอบนี้ = ใช้ตัวนั้นเลย ไม่ยิงซ้ำ
  const waiting = f5Fresh_[k];
  if (waiting) {
    delete f5Fresh_[k];
    if (Date.now() - waiting.at < F5_FRESH_MS) return waiting.p;
  }
  const pre = takePrefetch_(fn, body);
  if (pre && view) {
    // เปิดเว็บ/F5: มีผลเดิมของคำขอนี้ในแท็บ → คืนทันที แล้วรอผลใหม่เบื้องหลัง
    const cached = f5Read_(k);
    if (cached !== undefined) {
      const freshP = pre.catch(send).then(readResp_).then(([v, text]) => { f5Write_(k, text); return v; });
      f5Fresh_[k] = { p: freshP, at: Date.now() };
      freshP.then(() => f5Emit_('pn-f5-fresh', { view, key: k, ok: true }), () => f5Emit_('pn-f5-fresh', { view, key: k, ok: false }));
      f5Emit_('pn-f5-stale', { view, key: k });
      return cached as T;
    }
  }
  // คำขอล่วงหน้าพลาดแบบเน็ตสะดุด (ไม่ใช่ server ตอบ error) → ยิงใหม่เองเหมือนไม่มีของล่วงหน้า
  const r = pre ? await pre.catch(send) : await send();
  const [v, text] = await readResp_(r);
  if (view) f5Write_(k, text);   // จำไว้ให้ F5 รอบหน้า (เฉพาะคำขอแรกของหน้าที่รองรับ)
  return v as T;
}

/* ---------------- formatting helpers ---------------- */

export function esc(s: unknown): string {
  return String(s === undefined || s === null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---- ตัวจัดรูปแบบตัวเลข/วันที่ชุดกลาง (ตรวจ UI ข้อ E2) ----
 * ทั้งเว็บเขียนเงิน / เปอร์เซ็นต์ / ROAS / วันที่ แบบเดียวกัน — เดิมแต่ละหน้าเขียนเอง
 * ได้ "฿-2,278,072" ในหน้าหนึ่ง "-฿2.3M" อีกหน้า และ "573.0k" ตัวเล็กอีกหน้า คนอ่านต้องสะดุดทุกครั้ง
 *   เงินเต็ม   THB(-2278072)   → "-฿2,278,072"   (ลบอยู่หน้า ฿ เสมอ)
 *   เงินย่อ    THBk(-2278072)  → "-฿2.28M"  · THBk(573000) → "฿573.0K"  (K/M ตัวใหญ่ มี ฿ ทุกครั้ง)
 *   %ปิด/%Error/%ตีกลับ  pct2(12.9) → "12.90%"
 *   %บรรลุเป้า           pct1(80)   → "80.0%"  (ไม่ตัดศูนย์ทิ้ง)
 *   ROAS                 roasFmt(3.031) → "3.03x"
 *   วันที่  dateTh('2026-09-25') → "25 ก.ย. 69" · เดือน monthTh('2026-09') → "ก.ย. 69"
 * ค่าที่ไม่มี = "—" (ตัวหนังสือล้วน ใช้ได้ทั้งใน HTML / title / esc()) · อยากได้แบบสีจางใน HTML ใช้ dash()
 * ⚠️ ไฟล์ CSV/Excel ห้ามส่งผลของตัวจัดรูปแบบเหล่านี้ — ส่งตัวเลขดิบ ให้ Excel คำนวณต่อได้
 */
const NA = '—';
const bad_ = (n: unknown): boolean => n === null || n === undefined || (n as unknown) === '' || !isFinite(Number(n));

export function fmtNum(n: number | null | undefined): string {
  if (bad_(n)) return NA;
  return Number(n).toLocaleString('th-TH');
}

/** เงินเต็มจำนวน "-฿2,278,072" — ปัดเป็นบาทเต็ม · ปัดแล้วเป็น 0 ไม่มีเครื่องหมายลบ (กัน "-฿0") */
export function THB(n: number | null | undefined): string {
  if (bad_(n)) return NA;
  const v = Math.round(Number(n));
  return (v < 0 ? '-' : '') + '฿' + Math.abs(v).toLocaleString('th-TH');
}

/** ย่อจำนวน (ไม่มีสกุลเงิน) "1.25M" / "573.4K" / "750K" / "950" — ตัวเลขเดียวกับ THBk แต่ไม่มี ฿ */
export function numK(n: number | null | undefined): string {
  if (bad_(n)) return NA;
  const v = Number(n);
  const a = Math.abs(v);
  // เกณฑ์เลื่อนหน่วยคิดจาก "ค่าหลังปัด" — ไม่งั้น 999,990 จะกลายเป็น "1000.0K" แทน "1.00M"
  let s: string;
  if (a >= 999950) s = (a / 1e6).toFixed(2) + 'M';
  else if (a >= 999.5) s = (a / 1e3).toFixed(1) + 'K';
  else s = Math.round(a).toLocaleString('th-TH');
  // ตัดศูนย์ท้ายทศนิยม: 750.0K → 750K, 1.50M → 1.5M (ศูนย์ท้ายไม่บอกอะไรเพิ่ม แต่ทำให้ช่องแคบบนมือถือล้น)
  s = s.replace(/\.0+([KM])$/, '$1').replace(/(\.\d*[1-9])0+([KM])$/, '$1$2');
  return (v < 0 && s !== '0' ? '-' : '') + s;
}

/** เงินแบบย่อ "-฿2.28M" / "฿573.4K" / "฿750K" / "฿950" — ตัวเต็มควรอยู่ใน tooltip/ตารางละเอียดเสมอ */
export function THBk(n: number | null | undefined): string {
  if (bad_(n)) return NA;
  const s = numK(n);
  return s.charAt(0) === '-' ? '-฿' + s.slice(1) : '฿' + s;
}

/** ย่อจำนวนแบบเดิม (ใช้กับแกนกราฟ/ตัวเลขรอง) — ตอนนี้ K ตัวใหญ่ตามชุดกลาง ส่วนทศนิยม 1 ตำแหน่งคงเดิม */
export function kFmt(n: number | null | undefined): string {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 999950) return (v / 1000000).toFixed(1) + 'M';
  if (a >= 999.5) return (v / 1000).toFixed(1) + 'K';
  return String(Math.round(v));
}

/** ตัวเลขบนแกนกราฟ: ตัดศูนย์ท้ายทิ้ง "25K" "1.5M" (ขั้นแกนเป็นเลขกลมอยู่แล้ว ".0" มีแต่รก) · money = ใส่ ฿ */
export function axisFmt(n: number, money = false): string {
  if (!isFinite(n)) return '';
  const a = Math.abs(n);
  const trim = (x: number, d: number) => x.toFixed(d).replace(/\.?0+$/, '');
  const s = a >= 1e6 ? trim(a / 1e6, 2) + 'M' : a >= 1e3 ? trim(a / 1e3, 1) + 'K' : trim(a, a < 10 ? 1 : 0);
  return (n < 0 ? '-' : '') + (money ? '฿' : '') + s;
}

/** %ทศนิยม 2 ตำแหน่ง "12.90%" — %ปิด %Error %ตีกลับ (สเปกทีมแอด) */
export function pct2(n: number | null | undefined): string {
  return bad_(n) ? NA : Number(n).toFixed(2) + '%';
}

/** %ทศนิยม 1 ตำแหน่ง ไม่ตัดศูนย์ "80.0%" — %บรรลุเป้า สัดส่วน */
export function pct1(n: number | null | undefined): string {
  return bad_(n) ? NA : Number(n).toFixed(1) + '%';
}

/** ชื่อเดิม — ตอนนี้ = pct1 (เดิมตัดศูนย์ทิ้งเป็น "80%" คู่กับ "80.5%" ในคอลัมน์เดียวกัน อ่านไม่ตรงหลัก)
 *  หน้าไหนเป็น %ปิด/%Error/%ตีกลับ ให้เปลี่ยนไปใช้ pct2 */
export function pctFmt(n: number | null | undefined): string {
  return pct1(n);
}

/** ROAS "3.03x" — ไม่มีค่าใช้จ่ายแอด (หารศูนย์ = Infinity) ถือว่าไม่มีข้อมูล */
export function roasFmt(n: number | null | undefined): string {
  return bad_(n) ? NA : Number(n).toFixed(2) + 'x';
}

/** ขีด "ไม่มีข้อมูล" สีจางแบบเดียวทั้งเว็บ (HTML) — ห้ามใส่ใน title/esc() ให้ใช้ตัวหนังสือ '—' แทน */
export function dash(): string {
  return '<span class="tx-muted">' + NA + '</span>';
}

const TH_MON_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/**
 * วันที่ไทยแบบสั้น "25 ก.ย. 69" (พ.ศ. 2 หลักท้าย — ทีมอ่านแบบนี้ในชีททุกใบ)
 * รับ 'YYYY-MM-DD' (วันตามปฏิทิน อ่านตรงจากตัวเลข ไม่ผ่าน Date — กันคลาด 1 วันจาก UTC)
 * หรือเวลาแบบ ISO / Date (แปลงเป็นวันตามนาฬิกาเครื่องผู้ใช้)
 */
export function dateTh(s: string | Date | null | undefined): string {
  if (s === null || s === undefined || s === '') return NA;
  let y: number, m: number, d: number;
  const civil = typeof s === 'string' ? s.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (civil) {
    y = Number(civil[1]); m = Number(civil[2]) - 1; d = Number(civil[3]);
  } else {
    const dt = s instanceof Date ? s : new Date(String(s).replace(' ', 'T'));
    if (isNaN(dt.getTime())) return NA;
    y = dt.getFullYear(); m = dt.getMonth(); d = dt.getDate();
  }
  if (!(m >= 0 && m < 12) || !(d >= 1 && d <= 31)) return NA;
  return d + ' ' + TH_MON_SHORT[m] + ' ' + String((y + 543) % 100).padStart(2, '0');
}

/** เดือนไทยแบบสั้น "ก.ย. 69" — รับ 'YYYY-MM' หรือ 'YYYY-MM-DD' */
export function monthTh(s: string | null | undefined): string {
  const m = String(s || '').match(/^(\d{4})-(\d{2})/);
  if (!m) return NA;
  const mi = Number(m[2]) - 1;
  if (!(mi >= 0 && mi < 12)) return NA;
  return TH_MON_SHORT[mi] + ' ' + String((Number(m[1]) + 543) % 100).padStart(2, '0');
}

/** iso 'yyyy-MM-ddTHH:mm:ss' → 'x นาทีที่แล้ว' */
export function relTime(iso: string | null | undefined): string {
  if (!iso) return '-';
  const d = new Date(String(iso).replace(' ', 'T'));
  if (isNaN(d.getTime())) return '-';
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return 'เมื่อกี้';
  if (mins < 60) return mins + ' นาทีที่แล้ว';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + ' ชม.ที่แล้ว';
  return Math.floor(hrs / 24) + ' วันที่แล้ว';
}

/** โลโก้ช่องทางของเพจ (สีแบรนด์จริง) — ⚠️ คืน HTML ของ <svg> ไม่ใช่ตัวอักษร:
 *  ห้ามส่งเข้า esc() / title= / <option> (จะกลายเป็นโค้ดดิบโผล่บนจอ) ให้ต่อเข้า HTML ตรงๆ เท่านั้น
 *  (เดิมคืนอีโมจิ 🟢/📘 ซึ่งทำให้ "วงกลมเขียว" ในเว็บมีสองความหมาย: LINE กับ สถานะดี) */
export function platformIcon(pf: string | null | undefined): string {
  const p = String(pf || '').toLowerCase();
  if (p === 'line' || p === 'instagram' || p === 'tiktok' || p === 'shopee') return brandIcon(p, { size: 14 });
  return brandIcon('facebook', { size: 14 });
}

// สีรูปโปรไฟล์: โทนม่วง/น้ำเงิน/เขียวอมฟ้า/เทาเท่านั้น (ตรวจ UI ข้อ E3) — เดิมมีแดง ส้ม เขียว เหลือง
// ซึ่งไปวางข้างป้ายสถานะ (แดง = ปัญหา, เขียว = ดี) แล้วอ่านเป็นสถานะได้ · ทุกสีตัวหนังสือขาวได้คอนทราสต์ ≥4.5:1
const AVATAR_COLORS = ['#6c5ce7', '#4f46e5', '#7c3aed', '#2563eb', '#0369a1', '#0e7490', '#64748b', '#6d28d9'];
export function avatarColor(id: string | number | null | undefined): string {
  let h = 0;
  const s = String(id || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function initials(name: string | null | undefined): string {
  const s = String(name || '?').trim().replace(/^แอดมิน/, '');
  return s.slice(0, 2) || '?';
}

export function avatarHtml(
  id: string | number | null | undefined,
  name: string | null | undefined,
  online?: boolean,
  size?: string,
): string {
  const cls = 'avatar' + (size === 'sm' ? ' sm' : '');
  const dot = (online === undefined) ? '' :
    '<span class="status-dot ' + (online ? 'online' : 'offline') + '"></span>';
  return '<div class="' + cls + '" style="background:' + avatarColor(id) + '">' +
    esc(initials(name)) + dot + '</div>';
}

/* ---------------- UI helpers ---------------- */

/* ---------- ประกาศให้โปรแกรมอ่านหน้าจอ (live region) ----------
 * แยกเป็นกล่องล่องหนถาวร 2 กล่อง (สุภาพ / ด่วน) แทนการติด aria-live ที่ตัว toast แต่ละใบ
 * เพราะ live region ที่ "เพิ่งถูกสร้างพร้อมข้อความ" โปรแกรมอ่านหน้าจอหลายตัวไม่อ่านเลย
 * ต้องมีกล่องอยู่ก่อนแล้วค่อยเปลี่ยนข้อความข้างใน ถึงจะถูกอ่านแน่นอน
 * สไตล์ซ่อนใส่ inline เพราะเว็บยังไม่มีคลาส sr-only กลาง (ไม่มีสีจึงไม่ผิดกติกา token) */
let annPolite_: HTMLElement | null = null;
let annAssert_: HTMLElement | null = null;

function announcer_(assertive: boolean): HTMLElement {
  const cur = assertive ? annAssert_ : annPolite_;
  if (cur && cur.isConnected) return cur;
  const el = document.createElement('div');
  el.className = 'pn-announcer';
  el.setAttribute('role', assertive ? 'alert' : 'status');
  el.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;' +
    'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';
  document.body.appendChild(el);
  if (assertive) annAssert_ = el; else annPolite_ = el;
  return el;
}

/** ให้โปรแกรมอ่านหน้าจออ่านข้อความนี้ (ไม่แสดงบนจอ) — assertive = ขัดจังหวะทันที ใช้กับข้อผิดพลาดเท่านั้น */
export function announce(msg: string, assertive = false): void {
  if (typeof document === 'undefined' || !msg) return;
  const el = announcer_(assertive);
  // ล้างก่อนแล้วค่อยใส่ — ข้อความเดิมซ้ำ (เช่น "บันทึกแล้ว" 2 ครั้ง) จะได้ถูกอ่านทุกครั้ง
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 60);
}

/* ---------- ข้อความเด้งมุมจอ (toast) — ตรวจ UI ข้อ F4/F5 ---------- */

/** ชนิดของข้อความเด้ง — กำหนดไอคอน+สีขีดซ้าย (แทนอีโมจิ ✅ ⚠️ ❌ ⟳ ที่เคยพิมพ์ไว้หน้าข้อความ) */
export type ToastKind = 'ok' | 'warn' | 'error' | 'info' | 'busy';
export interface ToastOpts {
  /** ปุ่มในข้อความ เช่น { label: 'เลิกทำ', fn } หรือ { label: 'ลองใหม่', fn } */
  action?: { label: string; fn: () => void };
  /** ค้างกี่มิลลิวินาที (0 = ค้างจนกดปิด) — ไม่ใส่ = ตามชนิด */
  ms?: number;
}
const TOAST_ICON: Record<ToastKind, string> = {
  ok: 'circle-check', warn: 'triangle-alert', error: 'circle-x', info: 'info', busy: 'refresh-cw',
};
/** สำเร็จหายไว (3 วิ) · ข้อผิดพลาดค้างนาน (8 วิ) ให้อ่านทัน/กดลองใหม่ทัน */
const TOAST_MS: Record<ToastKind, number> = { ok: 3000, info: 4000, warn: 5000, error: 8000, busy: 4000 };
/** ซ้อนกันเกินนี้ ตัวเก่าสุดหลีกทาง — กองข้อความเต็มมุมจอบังปุ่มข้างหลัง */
const TOAST_MAX = 4;

/** เดาชนิดจากคำ (เฉพาะกรณีที่ชัดเจน) — มี toast หลายสิบจุดทั่วเว็บที่ไม่ได้ส่งชนิดมา
 *  "ไม่สำเร็จ/ผิดพลาด/ล้มเหลว" = error · ขึ้นต้น "กำลัง" = busy · "...แล้ว" (บันทึกแล้ว/ลบแล้ว) = ok
 *  ที่เหลือ = info (ขีดเทา) — ไอคอนผิดความหมายแย่กว่าข้อความกลางๆ */
function guessToastKind_(msg: string): ToastKind {
  if (/ไม่สำเร็จ|ผิดพลาด|ล้มเหลว/.test(msg)) return 'error';
  if (/^กำลัง/.test(msg)) return 'busy';
  if (/แล้ว(?=$|[\s—.!,)])/.test(msg) && !/^ยัง|ไม่ได้/.test(msg)) return 'ok';
  return 'info';
}

/** กล่องซ้อน toast — ใช้ #toast-stack ที่หน้าเว็บมีอยู่ ไม่มีก็สร้างเอง */
function toastStack_(): HTMLElement {
  let el = document.getElementById('toast-stack');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast-stack';
    document.body.appendChild(el);
  }
  // live region อยู่ที่ announce() แล้ว — ถ้าตัวกล่องเป็น live region ด้วย โปรแกรมอ่านหน้าจอจะอ่านซ้ำ 2 รอบ
  if (el.hasAttribute('aria-live')) el.removeAttribute('aria-live');
  if (el.getAttribute('role') === 'status') el.removeAttribute('role');
  return el;
}

/**
 * ข้อความเด้งมุมจอ — toast('บันทึกแล้ว', 'ok') · toast('โหลดไม่สำเร็จ', 'error', { action: { label: 'ลองใหม่', fn } })
 * ไม่ส่ง kind มา = เดาจากคำ (ดู guessToastKind_) · ข้อความเป็น textContent เสมอ (ข้อความจากเซิร์ฟเวอร์ห้ามเป็น HTML)
 * ชี้เมาส์/โฟกัสค้างที่ข้อความ = หยุดนับเวลา (อ่านไม่ทันต้องไม่หายไปต่อหน้า)
 */
export function toast(msg: string, kind?: ToastKind, opts?: ToastOpts): void {
  if (typeof document === 'undefined') return;
  const k: ToastKind = kind || guessToastKind_(String(msg || ''));
  const o = opts || {};
  const stack = toastStack_();

  // "กำลัง..." หมดหน้าที่ทันทีที่ผลลัพธ์ตามมา · ข้อความเดิมซ้ำ = แทนที่ตัวเก่า (กดรีเฟรชรัวๆ ไม่ขึ้นเป็นกอง)
  stack.querySelectorAll('.toast').forEach((el) => {
    const t = el as HTMLElement;
    if ((k !== 'busy' && t.classList.contains('toast-busy')) || t.dataset.msg === msg) t.remove();
  });

  const t = document.createElement('div');
  t.className = 'toast toast-' + k;
  t.dataset.msg = msg;
  const ic = document.createElement('span');
  ic.className = 'toast-ic';
  ic.innerHTML = icon(TOAST_ICON[k], { size: 16 });
  t.appendChild(ic);
  const tx = document.createElement('span');
  tx.className = 'toast-msg';
  tx.textContent = msg;
  t.appendChild(tx);

  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    t.remove();
  };

  if (o.action && o.action.label) {
    const a = document.createElement('button');
    a.type = 'button';
    a.className = 'toast-action';
    a.textContent = o.action.label;
    const fn = o.action.fn;
    a.addEventListener('click', () => {
      if (closed) return;     // กันกดซ้ำ (เลิกทำ 2 ครั้ง = ทำซ้ำกลับไปกลับมา)
      close();
      try { fn(); } catch (e) { console.error(e); }
    });
    t.appendChild(a);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'toast-close';
  x.setAttribute('aria-label', 'ปิดข้อความ');
  x.innerHTML = icon('x', { size: 16 });
  x.addEventListener('click', close);
  t.appendChild(x);

  stack.appendChild(t);
  const all = stack.querySelectorAll('.toast');
  for (let i = 0; i < all.length - TOAST_MAX; i++) all[i].remove();

  announce(msg, k === 'error');

  const base = typeof o.ms === 'number' ? o.ms : (o.action ? Math.max(5000, TOAST_MS[k]) : TOAST_MS[k]);
  if (base > 0) {
    let remaining = base;
    let started = Date.now();
    timer = setTimeout(close, remaining);
    const pause = () => {
      if (!timer || closed) return;
      clearTimeout(timer); timer = null;
      remaining -= Date.now() - started;
    };
    const resume = () => {
      if (timer || closed) return;
      started = Date.now();
      timer = setTimeout(close, Math.max(1500, remaining));
    };
    t.addEventListener('mouseenter', pause);
    t.addEventListener('mouseleave', resume);
    t.addEventListener('focusin', pause);
    t.addEventListener('focusout', resume);
  }
}

/** แถบ "ทำไปแล้ว · เลิกทำ" ค้าง ms มิลลิวินาที — ใช้กับคำสั่งที่ทำทันทีแต่ย้อนได้ (เช่น ระงับแอดมิน) */
export function undoToast(msg: string, onUndo: () => void, ms = 5000): void {
  toast(msg, 'ok', { action: { label: 'เลิกทำ', fn: onUndo }, ms });
}

/* ---------- ปุ่มกำลังทำงาน (F4) ----------
 * ระหว่างรอเซิร์ฟเวอร์ ปุ่มต้องเปลี่ยนหน้าตา+กดซ้ำไม่ได้ ไม่งั้นเน็ตช้าแล้วคนกดซ้ำจนข้อมูลซ้ำ
 * กดซ้ำระหว่างทำงาน (ถ้าหลุดมาถึงได้) จะได้ promise ตัวเดิมกลับไป ไม่เริ่มงานรอบใหม่ */
const busyRuns_ = new WeakMap<HTMLElement, Promise<unknown>>();

/**
 * withBusy(btn, 'กำลังบันทึก…', () => serverCall(...))
 * ปิดปุ่ม + วงหมุน + คำว่ากำลังทำ → เสร็จ/พลาดก็คืนหน้าตาเดิมเสมอ (ผลลัพธ์/ข้อผิดพลาดส่งต่อให้คนเรียกตามปกติ)
 */
export function withBusy<T>(btn: HTMLElement | null, busyText: string, fn: () => Promise<T>): Promise<T> {
  if (!btn) return Promise.resolve().then(fn);
  const running = busyRuns_.get(btn);
  if (running) return running as Promise<T>;

  const b = btn as HTMLButtonElement;
  const canDisable = 'disabled' in b;
  const prevHtml = btn.innerHTML;
  const prevDisabled = canDisable ? b.disabled : false;
  const prevMinW = btn.style.minWidth;
  const hadFocus = document.activeElement === btn;
  // ล็อกความกว้างเดิม — คำว่า "กำลังบันทึก…" ยาวกว่า/สั้นกว่าเดิม ปุ่มข้างๆ จะไม่กระโดด
  const w = btn.getBoundingClientRect().width;
  if (w) btn.style.minWidth = Math.ceil(w) + 'px';
  btn.classList.add('is-busy');
  btn.setAttribute('aria-busy', 'true');
  if (canDisable) b.disabled = true; else btn.setAttribute('aria-disabled', 'true');
  btn.innerHTML = icon('loader-circle', { size: 16, cls: 'spin' }) + '<span>' + esc(busyText) + '</span>';

  const restore = () => {
    busyRuns_.delete(btn);
    btn.classList.remove('is-busy');
    btn.removeAttribute('aria-busy');
    if (canDisable) b.disabled = prevDisabled; else btn.removeAttribute('aria-disabled');
    btn.innerHTML = prevHtml;
    btn.style.minWidth = prevMinW;
    // ปุ่มที่ถูก disabled ระหว่างโฟกัสอยู่ เบราว์เซอร์ทิ้งโฟกัสไปที่ body — คืนให้คนใช้คีย์บอร์ดกดต่อได้
    if (hadFocus && btn.isConnected && document.activeElement === document.body) {
      try { btn.focus({ preventScroll: true }); } catch { /* ไม่เป็นไร */ }
    }
  };

  let p: Promise<T>;
  try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); }
  const out = p.then((v) => { restore(); return v; }, (e) => { restore(); throw e; });
  busyRuns_.set(btn, out);
  return out;
}

/* ---------- ปุ่ม ⓘ คำอธิบาย (D3) ----------
 * คืน markup อย่างเดียว — พฤติกรรม (แตะแล้วกรอบค้าง / Esc ปิด) อยู่ที่ lib/ui/infotip.ts
 * text: ตัวคั่น " • " = ขึ้นบรรทัดใหม่ · บรรทัดที่มี "=" แสดงเป็นสูตร · label = ชื่อเรื่อง (เช่น "%ปิด")
 * ⚠️ ห้ามวางไว้ "ในปุ่มอื่น" (เช่น ปุ่มเรียงหัวตาราง) — ปุ่มซ้อนปุ่มกดไม่ได้ ให้วางต่อท้ายแทน */
export function infoTip(text: string, label?: string): string {
  const aria = label ? 'คำอธิบาย: ' + label : 'คำอธิบาย';
  return '<button type="button" class="info-i" aria-label="' + esc(aria) + '" data-tip="' + esc(text) + '"' +
    (label ? ' data-tip-title="' + esc(label) + '"' : '') + '>' + icon('info', { size: 14 }) + '</button>';
}

/* ---------- กล่องสถานะ ไม่มีข้อมูล / รอข้อมูล / ยังไม่พร้อม / ผิดพลาด (D3) ----------
 * เขียนเป็นภาษาคน: หัวข้อ + ประโยคบอกทางแก้ + ปุ่ม · ชื่อไฟล์ .sql / คำสั่ง npm / ข้อความ error ดิบ
 * อยู่ใน "รายละเอียดสำหรับผู้ดูแล" ที่พับไว้ และแสดงเฉพาะผู้ดูแลระบบ (superadmin) เท่านั้น */
export type StateKind = 'nodata' | 'wait' | 'notready' | 'error';
const STATE_DEF: Record<StateKind, { ic: string; title: string; body: string }> = {
  nodata: { ic: 'inbox', title: 'ช่วงนี้ยังไม่มีข้อมูล', body: 'ลองเปลี่ยนช่วงวันที่หรือตัวกรอง' },
  wait: { ic: 'hourglass', title: 'กำลังรอข้อมูลรอบถัดไป', body: 'ระบบดึงข้อมูลใหม่เป็นรอบๆ ลองกลับมาดูอีกครั้งในอีกสักครู่' },
  notready: { ic: 'circle-alert', title: 'ส่วนนี้ยังไม่พร้อม', body: 'กรุณาแจ้งผู้ดูแลระบบ' },
  error: { ic: 'cloud-off', title: 'โหลดข้อมูลไม่สำเร็จ', body: 'ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลระบบ' },
};

/** คนที่เปิดหน้าอยู่เป็นผู้ดูแลระบบไหม (page.tsx ใส่ data-role ไว้ที่ #app) */
function isSuperadmin_(): boolean {
  if (typeof document === 'undefined') return false;
  const app = document.getElementById('app');
  return !!app && app.dataset.role === 'superadmin';
}

/**
 * stateHtml('nodata', { actionsHtml: '<button ...>เปลี่ยนช่วงวันที่</button>' })
 * title/body = ข้อความธรรมดา (escape ให้) ไม่ใส่ = ใช้คำมาตรฐานของชนิดนั้น · body: '' = ไม่มีบรรทัดอธิบาย
 * actionsHtml = HTML ของปุ่ม (คนเรียกผูก event เอง) · adminDetail = ข้อความเทคนิค (ผู้ดูแลระบบเท่านั้นที่เห็น)
 */
export function stateHtml(
  kind: StateKind,
  opts?: { title?: string; body?: string; actionsHtml?: string; adminDetail?: string },
): string {
  const d = STATE_DEF[kind] || STATE_DEF.nodata;
  const o = opts || {};
  const body = o.body !== undefined ? o.body : d.body;
  return '<div class="state state-' + kind + '"' + (kind === 'error' ? ' role="alert"' : '') + '>' +
    '<div class="state-title">' + icon(d.ic, { size: 18 }) + '<span>' + esc(o.title || d.title) + '</span></div>' +
    (body ? '<div class="state-body">' + esc(body) + '</div>' : '') +
    (o.actionsHtml ? '<div class="state-actions">' + o.actionsHtml + '</div>' : '') +
    (o.adminDetail && isSuperadmin_()
      ? '<details class="state-admin"><summary>รายละเอียดสำหรับผู้ดูแล</summary><pre>' + esc(o.adminDetail) + '</pre></details>'
      : '') +
  '</div>';
}

/* ---------- หน้าต่าง (modal / bottom sheet) ----------
 * F5: หน้าต่างบอกตัวเองว่าเป็น dialog (role + aria-modal + ชื่อจากหัวข้อ) ย้ายโฟกัสเข้าไปตอนเปิด
 *     คืนโฟกัสให้ปุ่มที่กดเปิดตอนปิด · Tab วนอยู่ในหน้าต่าง · Esc ปิด
 * ซ้อนได้ 1 ชั้นสำหรับกล่องยืนยัน (confirmDialog เปิดจากในหน้าต่างอื่นได้โดยไม่ลบหน้าต่างเดิม)
 * ⚠️ #modal-root ต้องว่างสนิทตอนไม่มีหน้าต่าง — หลายหน้าเช็ค modalRoot.innerHTML เพื่อรู้ว่ามีหน้าต่างเปิดอยู่
 * เหตุการณ์ 'pn:modal' (detail.open, detail.depth) ยิงที่ document ทุกครั้งที่เปิด/ปิด — ให้ตัวจัดการปุ่มย้อนกลับ (F3) ใช้ */

interface ModalLayer { overlay: HTMLElement; opener: HTMLElement | null; onClose?: () => void }
let layers_: ModalLayer[] = [];
let mdlSeq_ = 0;
let modalKeysBound_ = false;

export interface ModalOpts {
  /** คลาสเพิ่มที่ .modal เช่น 'modal-confirm' */
  cls?: string;
  /** ชื่อหน้าต่างสำหรับโปรแกรมอ่านหน้าจอ เมื่อไม่มีหัวข้อ h3 ให้หยิบ */
  label?: string;
  role?: 'dialog' | 'alertdialog';
  /** เรียกเมื่อหน้าต่างนี้ถูกปิด (ไม่ว่าทางไหน: ปุ่มปิด / ฉากหลัง / Esc / ลาก / ถูกหน้าต่างใหม่แทนที่) */
  onClose?: () => void;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/** detail = { open: มีหน้าต่างเหลือไหม, depth: จำนวนชั้นที่เปิดอยู่ } — เปิดแทนที่หน้าต่างเดิม depth ไม่เปลี่ยน */
function emitModal_(): void {
  const depth = layers_.length;
  try { document.dispatchEvent(new CustomEvent('pn:modal', { detail: { open: depth > 0, depth } })); } catch { /* เบราว์เซอร์เก่า */ }
}

/* ของลอยที่ไม่ได้อยู่ใน #modal-root (ปฏิทินเลือกวัน / เมนู ⋯ / เมนูดาวน์โหลด)
   ลงทะเบียนตัวปิดไว้ที่นี่ ให้ปุ่มย้อนกลับของมือถือ "ปิดของลอยก่อน" เหมือนหน้าต่าง (app-core onPopState)
   เดิมกดย้อนกลับตอนปฏิทิน/เมนูเปิด = ออกจากหน้าไปเลย ของลอยค้างอยู่ในหน้าที่ถูกซ่อน (รีวิวมือถือ 27 ก.ย. 69) */
const floaters_: Array<() => void> = [];

function emitFloater_(): void {
  try { document.dispatchEvent(new CustomEvent('pn:overlay')); } catch { /* เบราว์เซอร์เก่า */ }
}

/** เปิดของลอย — close = ฟังก์ชันปิดของมันเอง (ต้องเรียก floaterClosed ตอนปิดทุกทาง) */
export function floaterOpened(close: () => void): void {
  if (floaters_.indexOf(close) < 0) floaters_.push(close);
  emitFloater_();
}

/** ของลอยปิดแล้ว (ปิดเองทางไหนก็ตาม) — เรียกซ้ำได้ ไม่มีผล */
export function floaterClosed(close: () => void): void {
  const i = floaters_.indexOf(close);
  if (i < 0) return;
  floaters_.splice(i, 1);
  emitFloater_();
}

export function floaterIsOpen(): boolean { return floaters_.length > 0; }

/** ปิดของลอยชิ้นบนสุด (ปุ่มย้อนกลับ) */
export function closeTopFloater(): void {
  const c = floaters_[floaters_.length - 1];
  if (c) c();
  floaterClosed(c);   // เผื่อตัวปิดไม่ได้แจ้งกลับ — ไม่งั้นค้างนับว่าเปิดตลอด
}

/** มีหน้าต่างเปิดอยู่ไหม */
export function isModalOpen(): boolean {
  const root = typeof document !== 'undefined' ? document.getElementById('modal-root') : null;
  return !!(root && root.firstElementChild);
}

function captureOpener_(): HTMLElement | null {
  const a = document.activeElement;
  return a instanceof HTMLElement && a !== document.body ? a : null;
}

/** ตั้งชื่อ/บทบาทให้ .modal — หัวข้อหาได้จาก .confirm-title / .modal-title / h3 ใน .modal-head */
function labelDialog_(modal: HTMLElement, fallback?: string): void {
  if (!modal.getAttribute('role')) modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('tabindex', '-1');
  // ตัวกล่องรับโฟกัสได้เพื่อให้โปรแกรมอ่านหน้าจออ่านชื่อหน้าต่าง แต่ไม่ใช่ปุ่ม — ไม่ต้องมีกรอบโฟกัสรอบทั้งกล่อง
  modal.style.outline = 'none';
  const t = modal.querySelector('.confirm-title, .modal-title, .modal-head h1, .modal-head h2, .modal-head h3, .modal-head h4, h2, h3') as HTMLElement | null;
  if (t) {
    if (!t.id) t.id = 'mdl-t' + (++mdlSeq_);
    modal.setAttribute('aria-labelledby', t.id);
    modal.removeAttribute('aria-label');
  } else {
    modal.removeAttribute('aria-labelledby');
    modal.setAttribute('aria-label', fallback || modal.getAttribute('aria-label') || 'หน้าต่าง');
  }
}

/** ผูกปุ่ม .modal-close ที่ยังไม่เคยผูก (กันผูกซ้ำตอน rebindModalClose) */
function bindCloseBtns_(scope: HTMLElement, fn: () => void): void {
  scope.querySelectorAll('.modal-close').forEach((x) => {
    const el = x as HTMLElement;
    if (el.getAttribute('data-mc')) return;
    el.setAttribute('data-mc', '1');
    el.addEventListener('click', fn);
  });
}

function topModal_(): HTMLElement | null {
  const l = layers_[layers_.length - 1];
  return l ? (l.overlay.querySelector('.modal') as HTMLElement | null) : null;
}

/** โฟกัสเข้าหน้าต่าง: ตัวที่ติด data-autofocus ก่อน ไม่มีก็ตัวกล่อง (ไม่โฟกัสช่องกรอกเอง — มือถือจะเด้งคีย์บอร์ดบังจอ) */
function focusInto_(modal: HTMLElement): void {
  const target = (modal.querySelector('[data-autofocus], [autofocus]') as HTMLElement | null) || modal;
  try { target.focus({ preventScroll: true }); } catch { target.focus(); }
}

function trapTab_(e: KeyboardEvent): void {
  const top = topModal_();
  if (!top) return;
  const els = Array.from(top.querySelectorAll(FOCUSABLE)).filter((el) => {
    const h = el as HTMLElement;
    return h.offsetParent !== null || h === document.activeElement;
  }) as HTMLElement[];
  if (!els.length) { e.preventDefault(); top.focus(); return; }
  const first = els[0], last = els[els.length - 1];
  const act = document.activeElement;
  if (!act || !top.contains(act)) { e.preventDefault(); first.focus(); return; }
  if (e.shiftKey && (act === first || act === top)) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && act === last) { e.preventDefault(); first.focus(); }
}

function bindModalKeys_(): void {
  if (modalKeysBound_) return;
  modalKeysBound_ = true;
  // ⚠️ ผูกแบบ capture: ต้องได้ Esc ก่อนตัวจัดการ Esc ของหัวเว็บ (app-core ปิด "หน้าต่าง/เมนู" แบบรวบ)
  //    เราปิดทีละชั้น (กล่องยืนยันที่ซ้อนอยู่ปิดก่อน หน้าต่างข้างล่างยังอยู่) แล้ว preventDefault
  //    เพื่อบอกตัวอื่นว่า Esc ครั้งนี้ใช้ไปแล้ว — กรอบคำอธิบาย ⓘ ผูก capture ไว้ก่อนเรา จึงได้ปิดตัวเองก่อนเสมอ
  document.addEventListener('keydown', (e) => {
    if (!layers_.length) return;
    if (!isModalOpen()) { layers_ = []; return; }     // มีโค้ดล้าง #modal-root เองโดยไม่ผ่าน closeModal
    if (e.key === 'Escape') {
      // ตัวอื่นจัดการ Esc ไปแล้ว (กรอบคำอธิบาย) หรือปฏิทินเลือกวันเปิดอยู่ → ปิดแค่ตัวนั้น หน้าต่างยังอยู่
      if (e.defaultPrevented || dpCtx_) return;
      e.preventDefault();
      closeTopModal();
    } else if (e.key === 'Tab') {
      trapTab_(e);
    }
  }, true);
}

/** สร้างชั้นหน้าต่าง (ฉากหลัง + กล่อง) แล้วผูกปิด/ลาก/ชื่อ/โฟกัส */
function mountLayer_(html: string, opts: ModalOpts, stacked: boolean): HTMLElement {
  const root = document.getElementById('modal-root')!;
  const opener = captureOpener_();
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const modal = document.createElement('div');
  modal.className = 'modal' + (opts.cls ? ' ' + opts.cls : '');
  if (opts.role) modal.setAttribute('role', opts.role);
  modal.innerHTML = html;
  overlay.appendChild(modal);

  let layer: ModalLayer;
  if (stacked) {
    layer = { overlay, opener, onClose: opts.onClose };
    root.appendChild(overlay);
    layers_.push(layer);
  } else {
    // แทนที่หน้าต่างเดิม: ปุ่มที่ต้องคืนโฟกัสคือปุ่มที่เปิดหน้าต่าง "แรก" ไม่ใช่ปุ่มในหน้าต่างที่กำลังจะหายไป
    const baseOpener = layers_.length && root.firstElementChild ? layers_[0].opener : opener;
    const old = layers_.slice().reverse();
    layers_ = [];
    root.innerHTML = '';
    old.forEach((l) => { try { if (l.onClose) l.onClose(); } catch (e) { console.error(e); } });
    root.appendChild(overlay);
    layer = { overlay, opener: baseOpener, onClose: opts.onClose };
    layers_ = [layer];
  }
  const closeThis = () => closeLayer_(layer);

  overlay.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeThis();
  });
  normalizeCloseBtns_(overlay);
  // ต้อง querySelectorAll — modal ส่วนใหญ่มีปุ่มปิด 2 ตัว (✕ มุมบน + "ยกเลิก" ท้ายฟอร์ม)
  // ถ้า bind แค่ตัวแรก ปุ่ม "ยกเลิก" จะกดไม่ติด (เคยเป็นบั๊กจริงบนหน้าจัดการผู้ใช้)
  bindCloseBtns_(overlay, closeThis);
  bindSheetDrag_(overlay, closeThis);
  labelDialog_(modal, opts.label);
  bindModalKeys_();
  focusInto_(modal);
  emitModal_();
  return overlay;
}

/** ปิดชั้นหน้าต่างชั้นเดียว (ชั้นล่างสุด = ปิดทั้งหมด) */
function closeLayer_(layer: ModalLayer): void {
  const i = layers_.indexOf(layer);
  if (i < 0) return;
  if (i === 0) { closeModal(); return; }
  layers_.splice(i, 1);
  layer.overlay.remove();
  try { if (layer.onClose) layer.onClose(); } catch (e) { console.error(e); }
  const back = layer.opener && layer.opener.isConnected ? layer.opener : topModal_();
  if (back) { try { back.focus({ preventScroll: true }); } catch { /* ไม่เป็นไร */ } }
  emitModal_();
}

/** ปิดหน้าต่างบนสุดชั้นเดียว (Esc / ปุ่มย้อนกลับของมือถือ) — ไม่มีชั้นซ้อน = ปิดหน้าต่าง */
export function closeTopModal(): void {
  const l = layers_[layers_.length - 1];
  if (l) closeLayer_(l); else closeModal();
}

/** ปุ่มปิดมุมบนของโมดัล (ใส่ใน .modal-head) — ปุ่มไอคอนล้วนจึงต้องมี aria-label + title เสมอ */
export function modalCloseBtn(): string {
  return '<button type="button" class="modal-close btn-icon" aria-label="ปิด" title="ปิด">' + icon('x', { size: 20 }) + '</button>';
}

/** ตัวกากบาทแบบเก่าที่ view บางหน้ายังพิมพ์ไว้ในปุ่มปิด (✕ ✖ ×) — สร้างจากรหัสอักขระ กันตัวตรวจอีโมจิสะดุด */
const LEGACY_CLOSE = [0x2715, 0x2716, 0xd7, 0x78, 0x58].map((c) => String.fromCharCode(c));

/** ปุ่มปิดที่ยังเป็นตัวกากบาทพิมพ์ → เปลี่ยนเป็นไอคอนเส้นชุดเดียวกับทั้งเว็บ + ชื่อปุ่มให้โปรแกรมอ่านหน้าจอ
    ทำที่นี่จุดเดียวแทนการไล่แก้ทุก view (ปุ่ม "ยกเลิก" ที่ใช้ class เดียวกันไม่โดน เพราะข้อความไม่ใช่กากบาท) */
function normalizeCloseBtns_(root: HTMLElement): void {
  root.querySelectorAll('.modal-close').forEach((b) => {
    const el = b as HTMLElement;
    if (el.querySelector('svg') || LEGACY_CLOSE.indexOf((el.textContent || '').trim()) < 0) return;
    el.innerHTML = icon('x', { size: 20 });
    el.classList.add('btn-icon');
    if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', 'ปิด');
    if (!el.getAttribute('title')) el.setAttribute('title', 'ปิด');
  });
}

/** เปิดหน้าต่าง (แทนที่หน้าต่างเดิมถ้ามี) — opts ไม่บังคับ ของเดิมที่เรียก openModal(html) ใช้ได้เหมือนเดิม */
export function openModal(html: string, opts?: ModalOpts): void {
  mountLayer_(html, opts || {}, false);
}

/* ---------- ลากแผ่นลงเพื่อปิด (bottom sheet) ----------
   ขีดจับด้านบนต้องลากได้จริง ไม่ใช่ขีดตกแต่ง — ของที่หน้าตาเหมือนจับได้แต่จับไม่ได้
   แย่กว่าไม่มีขีดเลย เพราะคนลองแล้วคิดว่าเว็บค้าง
   จับที่ .modal-head เท่านั้น ไม่ใช่ทั้งแผ่น ไม่งั้นจะไปแย่งการเลื่อนเนื้อหาข้างใน
   ⚠️ ผูกที่ .modal-overlay แล้วค่อยเช็คว่าโดน .modal-head ไหม (event delegation)
      ไม่ผูกที่ .modal-head ตรงๆ เพราะบางโมดัลเขียนทับเนื้อหาตัวเองทีหลัง (เช่น กำไรรายวัน
      ที่โหลดเสร็จแล้วแทน innerHTML ทั้งก้อน) หัวแผ่นอันเดิมจะหายไปพร้อม listener */

const SHEET_CLOSE_RATIO = 0.25;   // ลากลงเกิน 1 ใน 4 ของความสูงแผ่น = ปิด
const SHEET_FLING_SPEED = 0.6;    // px ต่อ ms — สะบัดลงเร็วๆ สั้นๆ ก็ต้องปิดได้
const SHEET_ANIM_MS = 180;

function bindSheetDrag_(overlay: HTMLElement, closeFn: () => void): void {
  let id = -1, y0 = 0, t0 = 0, dy = 0;
  let sheet: HTMLElement | null = null;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  overlay.addEventListener('pointerdown', function (e) {
    // จอ ≥600 โมดัลเป็นกล่องลอยกลางจอ ไม่ใช่แผ่น จึงไม่มีอะไรให้ลาก
    if (window.matchMedia('(min-width: 600px)').matches) return;
    const tgt = e.target as Element | null;
    if (!tgt || !tgt.closest || !tgt.closest('.modal-head')) return;
    if (tgt.closest('button, a, input, select')) return;
    sheet = overlay.querySelector('.modal');
    if (!sheet) return;
    id = e.pointerId; y0 = e.clientY; t0 = e.timeStamp; dy = 0;
    overlay.setPointerCapture(id);
    sheet.style.transition = 'none';
  });

  // กันเบราว์เซอร์เอาท่าทางนี้ไปทำ scroll — ต้องเป็น listener แบบ non-passive ถึงจะ preventDefault ได้
  // (ใช้แทน CSS touch-action ซึ่งแก้ปัญหาเดียวกันได้แต่ไปกลืนการแตะครั้งถัดไป — ดูคอมเมนต์ที่ .modal-head)
  // + ปัดบน "พื้นมืด" (นอกแผ่น) = ไม่มีอะไรให้เลื่อน — เดิมหน้าข้างหลังเลื่อนตาม ปิดแผ่นแล้วหลงตำแหน่ง
  overlay.addEventListener('touchmove', function (e) {
    if ((id !== -1 || e.target === overlay) && e.cancelable) e.preventDefault();
  }, { passive: false });

  overlay.addEventListener('pointermove', function (e) {
    if (e.pointerId !== id || !sheet) return;
    dy = Math.max(0, e.clientY - y0);   // ลากขึ้นไม่ต้องทำอะไร แผ่นชิดขอบล่างอยู่แล้ว
    sheet.style.transform = 'translateY(' + dy + 'px)';
    // ฉากหลังจางลงตามระยะที่ลาก ให้รู้สึกว่ากำลัง "ปล่อยออก" ไม่ใช่แค่เลื่อนกล่อง
    overlay.style.background = 'rgba(5,8,18,' + (0.7 * Math.max(0, 1 - dy / 400)).toFixed(3) + ')';
  });

  function end(e: PointerEvent): void {
    if (e.pointerId !== id || !sheet) return;
    id = -1;
    const speed = dy / Math.max(1, e.timeStamp - t0);
    if (dy > sheet.offsetHeight * SHEET_CLOSE_RATIO || speed > SHEET_FLING_SPEED) {
      if (reduce) { closeFn(); return; }
      // ⚠️ ระหว่างแอนิเมชันปิด ฉากหลังยังคาอยู่บนจอและยังรับการแตะอยู่ ทั้งที่มองไม่เห็นแล้ว
      //    แตะปุ่มทันทีหลังปัด = โดนฉากหลังกินไปเฉยๆ (วัดได้: elementFromPoint คืน .modal-overlay)
      //    ปิดการรับสัมผัสทันทีที่ตัดสินใจปิด นิ้วจะทะลุไปโดนของจริงข้างล่างได้เลย
      overlay.style.pointerEvents = 'none';
      sheet.style.transition = 'transform ' + SHEET_ANIM_MS + 'ms ease-in';
      sheet.style.transform = 'translateY(100%)';
      overlay.style.background = 'rgba(5,8,18,0)';
      setTimeout(closeFn, SHEET_ANIM_MS - 10);
    } else {
      sheet.style.transition = reduce ? 'none' : 'transform ' + SHEET_ANIM_MS + 'ms ease-out';
      sheet.style.transform = '';
      overlay.style.background = '';
    }
  }
  overlay.addEventListener('pointerup', end);
  // pointercancel = เบราว์เซอร์ยึดท่าทางไปทำอย่างอื่น (เช่น เลื่อนเนื้อหา) ไม่ใช่เจตนาปิดของผู้ใช้
  // จึงเด้งกลับเสมอ ไม่ปิด — ปิดโดยที่ผู้ใช้ไม่ได้ตั้งใจแย่กว่าไม่ปิด
  overlay.addEventListener('pointercancel', function (e) {
    if (e.pointerId !== id || !sheet) return;
    id = -1;
    sheet.style.transition = reduce ? 'none' : 'transform ' + SHEET_ANIM_MS + 'ms ease-out';
    sheet.style.transform = '';
    overlay.style.background = '';
  });
}

/** โมดัลที่โหลดเนื้อหาทีหลังแล้วเขียนทับตัวเอง เรียกอันนี้แทนการผูกปุ่มปิดเอง
    (ปุ่มปิดของ openModal ผูกไว้กับ element เดิมซึ่งหายไปพร้อม innerHTML) — ตั้งชื่อหน้าต่างใหม่ให้ด้วย */
export function rebindModalClose(): void {
  const root = document.getElementById('modal-root');
  if (!root) return;
  normalizeCloseBtns_(root);
  if (layers_.length && root.firstElementChild) {
    layers_.forEach((l) => bindCloseBtns_(l.overlay, () => closeLayer_(l)));
  } else {
    bindCloseBtns_(root, closeModal);
  }
  root.querySelectorAll('.modal').forEach((m) => labelDialog_(m as HTMLElement));
}

/** ปิดหน้าต่างทั้งหมด แล้วคืนโฟกัสให้ปุ่มที่กดเปิด */
export function closeModal(): void {
  const root = document.getElementById('modal-root');
  if (!root) return;
  const had = layers_.length > 0 || !!root.firstElementChild;
  const opener = layers_.length ? layers_[0].opener : null;
  const old = layers_.slice().reverse();
  layers_ = [];
  root.innerHTML = '';
  old.forEach((l) => { try { if (l.onClose) l.onClose(); } catch (e) { console.error(e); } });
  if (opener && opener.isConnected) {
    try { opener.focus({ preventScroll: true }); } catch { /* ไม่เป็นไร */ }
  }
  if (had) emitModal_();
}

/* ---------- กล่องยืนยันของเว็บเอง (F4) — แทน confirm() ของเบราว์เซอร์ ----------
 * หัวข้อเป็นคำถาม ปุ่มหลักเขียนชัดว่าจะทำอะไร (เช่น "ลบบัญชี sale69427") คู่ปุ่ม "ยกเลิก"
 * บนมือถือเป็นแผ่นเลื่อนขึ้นจากขอบล่างแบบเดียวกับหน้าต่างอื่น · เปิดซ้อนบนหน้าต่างอื่นได้
 * danger = ปุ่มแดงทึบ และโฟกัสเริ่มที่ "ยกเลิก" (กด Enter พลาดต้องไม่ลบของ)
 * ปิดด้วยทางไหนก็ตามที่ไม่ใช่ปุ่มหลัก = false */
export function confirmDialog(opts: {
  title: string; body?: string; confirmText: string; cancelText?: string; danger?: boolean;
}): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };
    const n = ++mdlSeq_;
    const html =
      '<h3 class="confirm-title" id="cf-t' + n + '">' + esc(opts.title) + '</h3>' +
      (opts.body ? '<div class="confirm-body" id="cf-b' + n + '">' + esc(opts.body).replace(/\n/g, '<br>') + '</div>' : '') +
      // modal-actions = จัดวางปุ่มแบบเดียวกับฟอร์มอื่น (มือถือ: ปุ่มหลักอยู่บน เต็มความกว้าง)
      '<div class="confirm-actions modal-actions">' +
        '<button type="button" class="btn" data-cf="cancel"' + (opts.danger ? ' data-autofocus' : '') + '>' +
          esc(opts.cancelText || 'ยกเลิก') + '</button>' +
        '<button type="button" class="btn ' + (opts.danger ? 'danger solid' : 'primary') + '" data-cf="ok"' +
          (opts.danger ? '' : ' data-autofocus') + '>' + esc(opts.confirmText) + '</button>' +
      '</div>';
    const lopts: ModalOpts = { cls: 'modal-confirm', role: 'alertdialog', onClose: () => finish(false) };
    const stacked = isModalOpen() && layers_.length > 0;
    const overlay = mountLayer_(html, lopts, stacked);
    const modal = overlay.querySelector('.modal') as HTMLElement;
    if (opts.body) modal.setAttribute('aria-describedby', 'cf-b' + n);
    const layer = layers_.filter((l) => l.overlay === overlay)[0];
    const ok = modal.querySelector('[data-cf="ok"]');
    const cancel = modal.querySelector('[data-cf="cancel"]');
    if (ok) ok.addEventListener('click', () => { finish(true); if (layer) closeLayer_(layer); });
    if (cancel) cancel.addEventListener('click', () => { if (layer) closeLayer_(layer); else finish(false); });
  });
}

/** คัดลอกข้อความ — คัดลอกไม่ได้ (เบราว์เซอร์ไม่ให้สิทธิ์) เปิดแผ่นที่มีช่องข้อความเลือกไว้ให้ + ปุ่มคัดลอก
 *  แทน window.prompt() ซึ่งบนมือถือหน้าตาเหมือนระบบถามรหัส (F4) */
export function copyText(text: string, okMsg = 'คัดลอกแล้ว', title = 'คัดลอกลิงก์'): void {
  const fallback = () => {
    openModal('<div class="modal-head"><h3>' + esc(title) + '</h3>' + modalCloseBtn() + '</div>' +
      '<div class="card-sub">กดค้างที่ช่องด้านล่างเพื่อคัดลอก หรือกดปุ่มคัดลอก</div>' +
      '<input class="input" id="copy-fallback" readonly value="' + esc(text) + '" aria-label="' + esc(title) + '" style="width:100%">' +
      '<div class="modal-actions"><button type="button" class="btn modal-close">ปิด</button>' +
      '<button type="button" class="btn primary" id="copy-fallback-btn" data-autofocus>' + icon('copy', { size: 16 }) + 'คัดลอก</button></div>');
    const inp = document.getElementById('copy-fallback') as HTMLInputElement | null;
    if (inp) { inp.focus({ preventScroll: true }); inp.select(); }
    const b = document.getElementById('copy-fallback-btn');
    if (b) b.addEventListener('click', () => {
      if (!inp) return;
      inp.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      if (ok) { closeModal(); toast(okMsg, 'ok'); } else toast('คัดลอกเองได้เลย — ข้อความถูกเลือกไว้แล้ว', 'info');
    });
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => toast(okMsg, 'ok')).catch(fallback);
  } else fallback();
}

export function showLoading(el: HTMLElement): void {
  el.innerHTML = '<div class="loading"><div class="spinner"></div>กำลังโหลดข้อมูล...</div>';
}

/** ข้อความผิดพลาดที่คนทั่วไปอ่านเข้าใจ (ภาษาไทย ไม่มีศัพท์เทคนิค) — ที่เหลือเก็บไว้ให้ผู้ดูแลระบบดู */
function humanErr_(msg: string): string {
  let m = String(msg || '').trim();
  // บาง route ตอบเป็น JSON { error: '...' } — ดึงเฉพาะข้อความออกมา
  if (m.charAt(0) === '{') {
    try { const j = JSON.parse(m); if (j && typeof j.error === 'string') m = j.error; } catch { /* ใช้ข้อความเดิม */ }
  }
  if (!/[฀-๿]/.test(m) || m.length > 160) return '';
  if (/^(เรียก|โหลด)ข้อมูลไม่สำเร็จ$/.test(m)) return '';          // ซ้ำกับหัวข้ออยู่แล้ว
  if (/\.sql|npm |sql|relation|column|function|supabase|postgres|PGRST|TypeError|SyntaxError|\{|https?:\/\//i.test(m)) return '';
  return m;
}

/** กล่อง "โหลดข้อมูลไม่สำเร็จ — ลองใหม่อีกครั้ง" + ปุ่มลองใหม่ (#err-retry) · ข้อความดิบเห็นเฉพาะผู้ดูแลระบบ */
export function showError(el: HTMLElement, msg: string, retryFn?: () => void): void {
  const human = humanErr_(msg);
  el.innerHTML = stateHtml('error', {
    body: human || undefined,
    actionsHtml: retryFn
      ? '<button type="button" class="btn" id="err-retry">' + icon('refresh-cw', { size: 16 }) + 'ลองใหม่</button>'
      : '',
    adminDetail: human ? '' : String(msg || ''),
  });
  const b = el.querySelector('#err-retry');
  if (b && retryFn) b.addEventListener('click', retryFn);
}

/** สร้าง CSV แล้วดาวน์โหลด (BOM สำหรับภาษาไทยใน Excel) */
export function downloadCSV(rows: unknown[][], filename?: string): void {
  const csv = rows.map((r) => {
    return r.map((c) => {
      let s = String(c === undefined || c === null ? '' : c);
      // กัน formula injection: ค่าที่ขึ้นต้นด้วย = + - @ ให้เติม ' นำหน้า
      // ยกเว้นตัวเลขจริง (เช่น -12.5) กับ '-' ที่ใช้แทนค่าว่าง เพื่อให้ Excel อ่านเป็นตัวเลขได้
      const isNumeric = /^-?\d+(\.\d+)?$/.test(s);
      if (!isNumeric && s !== '-' && /^[=+\-@]/.test(s)) s = "'" + s;
      return (s.indexOf(',') >= 0 || s.indexOf('"') >= 0 || s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0)
        ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',');
  }).join('\r\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (filename || 'export') + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('ดาวน์โหลด CSV แล้ว', 'ok');
}

/**
 * สร้างไฟล์ .xls (ตาราง HTML ที่ Excel เปิดได้ตรงๆ — วิธีเดียวกับ mockup)
 * ข้อดีกว่า CSV: ไทยไม่เพี้ยนแน่นอน + ตัวเลขจัด format ได้ | escape ทุก cell กัน HTML injection
 */
export function downloadXLS(rows: unknown[][], filename?: string, sheetName?: string): void {
  const body = rows.map((r, ri) => {
    const tag = ri === 0 ? 'th' : 'td';
    return '<tr>' + r.map((c) => {
      const s = String(c === undefined || c === null ? '' : c);
      // เซลล์เป็น "ตัวเลข" ต่อเมื่อ caller ส่ง number จริงมาเท่านั้น — string ทุกตัวบังคับ text
      // (กัน Excel ทำ id ยาวๆ เพี้ยนเป็น 1.2E+17: FB ad_id 16-18 หลักเกิน precision 15 หลักของ Excel)
      const isNumeric = typeof c === 'number' && isFinite(c);
      const style = isNumeric ? '' : ' style="mso-number-format:\'\\@\'"';
      return '<' + tag + style + '>' + esc(s) + '</' + tag + '>';
    }).join('') + '</tr>';
  }).join('');
  const html = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="UTF-8">' +
    '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>' +
    '<x:Name>' + esc(sheetName || 'Report') + '</x:Name>' +
    '<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>' +
    '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->' +
    '</head><body><table border="1">' + body + '</table></body></html>';
  const blob = new Blob(['﻿' + html], { type: 'application/vnd.ms-excel;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (filename || 'export') + '.xls';
  a.click();
  URL.revokeObjectURL(a.href);
  toast('ดาวน์โหลด Excel แล้ว', 'ok');
}

/**
 * C4 ปุ่มดาวน์โหลดปุ่มเดียวทุกหน้า (ขวาสุดของ .toolbar)
 * มีแค่ CSV → ปุ่ม "ดาวน์โหลด" กดแล้วได้ไฟล์เลย · มี Excel ด้วย → "ดาวน์โหลด ▾" เปิดเมนูเลือก CSV / Excel
 * ต้องเรียก bindDownloadMenu(root, id, …) หลัง render ทุกครั้ง (หน้า re-render ทั้งก้อน)
 */
export function downloadMenuHtml(id: string, opts: { excel?: boolean; label?: string } = {}): string {
  const label = esc(opts.label || 'ดาวน์โหลด');
  if (!opts.excel) {
    return '<button type="button" class="btn" id="' + esc(id) + '">' + icon('download', { size: 16 }) + label + '</button>';
  }
  return '<div class="menu-wrap">' +
    '<button type="button" class="btn" id="' + esc(id) + '" aria-haspopup="menu" aria-expanded="false" aria-controls="' + esc(id) + '-pop">' +
      icon('download', { size: 16 }) + label + icon('chevron-down', { size: 14 }) + '</button>' +
    '<div class="menu-pop" id="' + esc(id) + '-pop" role="menu" hidden>' +
      '<button type="button" class="menu-item" role="menuitem" data-dl="csv">' + icon('file-text', { size: 16 }) + 'CSV<small>ไฟล์ตาราง</small></button>' +
      '<button type="button" class="menu-item" role="menuitem" data-dl="xls">' + icon('file-spreadsheet', { size: 16 }) + 'Excel<small>ภาษาไทยไม่เพี้ยน</small></button>' +
    '</div></div>';
}

export function bindDownloadMenu(
  root: ParentNode, id: string, handlers: { csv: () => void; xls?: () => void },
): void {
  const btn = root.querySelector<HTMLButtonElement>('#' + id);
  if (!btn) return;
  const pop = root.querySelector<HTMLElement>('#' + id + '-pop');
  if (!pop || !handlers.xls) {
    btn.addEventListener('click', () => handlers.csv());
    return;
  }
  const close = (focusBtn: boolean) => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    floaterClosed(backClose);
    if (focusBtn) btn.focus();
  };
  const backClose = () => close(false);
  // ปิดเมื่อแตะที่อื่น / กด Esc (capture — ไม่ให้ Esc ไปปิดหน้าต่างข้างหลังด้วย)
  // ปุ่มหลุดจากหน้าแล้ว (view วาดใหม่ระหว่างเมนูเปิด) → ถอดตัวดักทิ้งเงียบๆ ไม่กิน Esc ของหน้าต่างอื่น
  const detached = () => {
    // offsetParent = null → ปุ่มถูกซ่อน (สลับไปหน้าอื่นด้วยปุ่มย้อนกลับขณะเมนูเปิดอยู่)
    if (btn.isConnected && btn.offsetParent !== null) return false;
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
    floaterClosed(backClose);
    return true;
  };
  const onOutside = (e: Event) => {
    if (detached()) return;
    if (!pop.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) close(false);
  };
  const onKey = (e: KeyboardEvent) => {
    if (detached()) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
  };
  btn.addEventListener('click', () => {
    if (!pop.hidden) { close(false); return; }
    pop.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey, true);
    floaterOpened(backClose);
    const first = pop.querySelector<HTMLElement>('.menu-item');
    if (first) first.focus();
  });
  pop.addEventListener('click', (e) => {
    const it = (e.target as HTMLElement).closest<HTMLElement>('[data-dl]');
    if (!it) return;
    close(true);
    if (it.dataset.dl === 'xls' && handlers.xls) handlers.xls(); else handlers.csv();
  });
}

/** สีประจำแท็ก/ชื่อ — hash ชื่อ → HSL คงที่ (ชื่อเดิมได้สีเดิมเสมอ ทุกหน้า) */
export function tagColor(name: unknown): string {
  const s = String(name || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 'hsl(' + (h % 360) + ', 62%, 52%)';
}

/* ---------------- range controls (ใช้ร่วมกันหลายหน้า) ---------------- */

export interface RangeState {
  preset: string;
  from?: string;
  to?: string;
}
/* ---------------- ปฏิทินเลือกช่วงวัน (date range picker) ----------------
 * ใช้แทนช่อง <input type="date"> 2 ช่องของโหมด "กำหนดเอง" — ทีมต้องเลือกช่วงวันบ่อย
 * ช่องเดิมกดยาก (ต้องกรอก 2 ช่องแยกกันแล้วกดแสดง) และมองไม่เห็นว่าช่วงที่เลือกกินกี่วัน
 *
 * ⚠️ วันที่ในนี้เป็น "วันตามปฏิทิน" (civil date) เก็บเป็นสตริง 'YYYY-MM-DD' ล้วน
 *    ห้ามแปลงเป็น Date object แล้วอ่านกลับ — new Date('2026-08-27') ตีความเป็น UTC
 *    พอเครื่องอยู่ไทย (+7) จะกลายเป็นวันก่อนหน้า = คลาดไป 1 วันทั้งระบบ
 *    เทียบมาก/น้อยใช้เทียบสตริงตรงๆ ได้เลย เพราะรูปแบบ YYYY-MM-DD เรียงตามตัวอักษร = เรียงตามเวลา
 */

const TH_MON = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const TH_DOW = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];

const pad2_ = (n: number) => (n < 10 ? '0' + n : String(n));
/** ปี-เดือน-วัน → 'YYYY-MM-DD' (m เริ่มที่ 0 เหมือน Date) */
const ymd_ = (y: number, m: number, d: number) => y + '-' + pad2_(m + 1) + '-' + pad2_(d);
/** 'YYYY-MM-DD' → [ปี, เดือน(0-11), วัน] — คืน null ถ้ารูปแบบไม่ถูก */
function parseYmd_(s: unknown): [number, number, number] | null {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
}
/** วันนี้ตามนาฬิกาเครื่องผู้ใช้ (ไม่ใช่ UTC) */
function todayYmd_(): string {
  const d = new Date();
  return ymd_(d.getFullYear(), d.getMonth(), d.getDate());
}
const daysInMonth_ = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
/** วันในสัปดาห์ของวันที่ 1 ของเดือน (0=อาทิตย์) — สร้าง Date จากตัวเลข ไม่ได้ parse สตริง จึงไม่โดนกับดัก UTC */
const firstDow_ = (y: number, m: number) => new Date(y, m, 1).getDay();
/** เลื่อนเดือน คืน [ปี, เดือน] */
function addMonth_(y: number, m: number, delta: number): [number, number] {
  const t = y * 12 + m + delta;
  return [Math.floor(t / 12), ((t % 12) + 12) % 12];
}
/** บวกวัน (ใช้ Date เป็นตัวคำนวณล้วน ไม่แตะ timezone เพราะสร้างจากตัวเลขและอ่านกลับเป็นตัวเลข) */
function addDays_(s: string, delta: number): string {
  const p = parseYmd_(s);
  if (!p) return s;
  const d = new Date(p[0], p[1], p[2] + delta);
  return ymd_(d.getFullYear(), d.getMonth(), d.getDate());
}
/** '2026-08-27' → '27 ส.ค. 69' — ชื่อเดิม ส่งต่อให้ dateTh() ตัวกลาง (รับเฉพาะ 'YYYY-MM-DD' เหมือนเดิม) */
export function thaiDateShort(s: unknown): string {
  return parseYmd_(s) ? dateTh(String(s)) : '—';
}
/** จำนวนวันในช่วง (นับหัวท้าย) */
function spanDays_(from: string, to: string): number {
  const a = parseYmd_(from), b = parseYmd_(to);
  if (!a || !b) return 0;
  return Math.round((new Date(b[0], b[1], b[2]).getTime() - new Date(a[0], a[1], a[2]).getTime()) / 86400000) + 1;
}

/* ---- สถานะของปฏิทินที่กำลังเปิดอยู่ (มีได้ทีละตัว) ---- */
interface DpCtx {
  state: RangeState;
  idPrefix: string;
  onChange: () => void;
  /** เดือนซ้ายที่กำลังแสดง */
  vy: number; vm: number;
  /** ค่าที่กำลังเลือกอยู่ในปฏิทิน (ยังไม่ยืนยัน) */
  from: string; to: string;
  /** true = คลิกถัดไปคือ "วันจบ" */
  picking: boolean;
  /** วันที่เมาส์ชี้อยู่ ใช้ระบายช่วงล่วงหน้า */
  hover: string;
  /** วันที่คีย์บอร์ดโฟกัสอยู่ */
  focus: string;
}
let dpCtx_: DpCtx | null = null;

/** ปฏิทิน 1 เดือน */
/** ข้อความสรุปหัวปฏิทิน — ระหว่างลากเมาส์บอกช่วงที่กำลังจะได้ให้เห็นก่อนกด */
function dpSummary_(c: DpCtx): string {
  if (c.picking) {
    const hi = c.hover && c.hover > c.from ? c.hover : '';
    return hi
      ? thaiDateShort(c.from) + ' – ' + thaiDateShort(hi) + ' · ' + spanDays_(c.from, hi) + ' วัน'
      : 'เลือกวันสิ้นสุด';
  }
  return c.from && c.to
    ? thaiDateShort(c.from) + ' – ' + thaiDateShort(c.to) + ' · ' + spanDays_(c.from, c.to) + ' วัน'
    : 'เลือกวันเริ่มต้น';
}

function dpMonthHtml_(c: DpCtx, y: number, m: number): string {
  const today = todayYmd_();
  let cells = '';
  const blanks = firstDow_(y, m);
  for (let i = 0; i < blanks; i++) cells += '<div class="dp-cell dp-blank" role="gridcell"></div>';
  const n = daysInMonth_(y, m);
  for (let d = 1; d <= n; d++) {
    const sday = ymd_(y, m, d);
    // ใช้ตัวคำนวณคลาสตัวเดียวกับ dpTint_ — ไม่งั้นสีตอนวาดกับตอนลากเมาส์จะเพี้ยนคนละแบบ
    const cls = dpDayCls_(c, sday, today);
    cells += '<div class="dp-cell" role="gridcell" aria-selected="' + (cls.indexOf('dp-sel') >= 0 ? 'true' : 'false') + '">' +
      '<button type="button" class="' + cls + '" data-d="' + sday + '"' +
      (sday === c.focus ? ' data-focus="1"' : '') +
      ' tabindex="' + (sday === c.focus ? '0' : '-1') + '"' +
      ' aria-label="' + d + ' ' + TH_MON[m] + ' ' + (y + 543) + '">' + d + '</button></div>';
  }
  return '<div class="dp-month">' +
    '<div class="dp-mon-head">' + TH_MON[m] + ' ' + (y + 543) + '</div>' +
    '<div class="dp-dow">' + TH_DOW.map((w) => '<span>' + w + '</span>').join('') + '</div>' +
    '<div class="dp-grid" role="grid">' + cells + '</div>' +
  '</div>';
}

/** ทั้งป๊อปโอเวอร์ */
function dpHtml_(c: DpCtx): string {
  const [ny, nm] = addMonth_(c.vy, c.vm, 1);
  const summary = dpSummary_(c);
  const quick = [
    ['7', '7 วันล่าสุด'], ['14', '14 วันล่าสุด'], ['30', '30 วันล่าสุด'], ['90', '90 วันล่าสุด'],
  ].map(([n, label]) =>
    '<button type="button" class="dp-quick" data-quick="' + n + '">' + label + '</button>').join('');
  return '<div class="dp-pop" role="dialog" aria-modal="false" aria-label="เลือกช่วงวันที่">' +
    '<div class="dp-nav">' +
      '<button type="button" class="dp-arrow" data-mv="-1" aria-label="เดือนก่อนหน้า">‹</button>' +
      '<div class="dp-sum">' + summary + '</div>' +
      '<button type="button" class="dp-arrow" data-mv="1" aria-label="เดือนถัดไป">›</button>' +
    '</div>' +
    '<div class="dp-months">' + dpMonthHtml_(c, c.vy, c.vm) + dpMonthHtml_(c, ny, nm) + '</div>' +
    '<div class="dp-quicks">' + quick + '</div>' +
    '<div class="dp-foot">' +
      '<button type="button" class="btn" data-dp="cancel">ยกเลิก</button>' +
      '<button type="button" class="btn primary" data-dp="apply"' +
        (c.from && c.to && !c.picking ? '' : ' disabled') + '>แสดง</button>' +
    '</div>' +
  '</div>';
}

/** วาดใหม่ทั้งป๊อปโอเวอร์ แล้วผูก event ใหม่ (วิธีเดียวกับวิวอื่นในโปรเจกต์) */
/**
 * ดันกล่องให้อยู่ในจอเสมอ — กล่องเกาะซ้ายของปุ่ม พอปุ่มอยู่ค่อนไปทางขวาของจอ
 * ปฏิทิน 2 เดือน (~500px) จะล้นขอบขวาจนเดือนที่สองโดนตัด (เจอจริงบนจอ 1280)
 * วัดแล้วเลื่อนเอง ไม่ผูกกับ right:0 เพราะบางหน้าปุ่มอยู่ชิดซ้าย จะกลายเป็นล้นซ้ายแทน
 */
function dpPlace_(host: HTMLElement): void {
  host.style.left = '0px';
  host.style.top = '';      // ล้างค่าที่เคยพลิกไว้รอบก่อน ไม่งั้นค้างกางขึ้นบนตลอด
  host.style.bottom = '';
  const pop = host.firstElementChild as HTMLElement | null;
  if (!pop) return;
  const M = 8;   // เว้นขอบจอ
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // แนวนอน
  const r = pop.getBoundingClientRect();
  let shift = 0;
  if (r.right > vw - M) shift -= (r.right - (vw - M));
  if (r.left + shift < M) shift += M - (r.left + shift);
  if (shift) host.style.left = Math.round(shift) + 'px';

  // แนวตั้ง — ต้องจำกัดสูงตาม "ที่ว่างจริงบนจอ" ไม่ใช่ %ของ viewport เฉยๆ
  // ไม่งั้นบนมือถือกล่องยาวเลยขอบล่าง แถวปุ่ม "แสดง" หลุดออกนอกจอจนกดไม่ได้เลย
  const MIN_H = 260;
  const belowTop = pop.getBoundingClientRect().top;
  const spaceBelow = vh - belowTop - M;
  if (spaceBelow >= MIN_H) {
    pop.style.maxHeight = Math.round(spaceBelow) + 'px';
    return;
  }
  // ที่ว่างข้างล่างไม่พอ → พลิกไปกางขึ้นข้างบนปุ่มแทน (ถ้าข้างบนกว้างกว่า)
  const wrapTop = (host.parentElement || host).getBoundingClientRect().top;
  const spaceAbove = wrapTop - M;
  if (spaceAbove > spaceBelow) {
    host.style.top = 'auto';
    host.style.bottom = 'calc(100% + var(--sp-2))';
    pop.style.maxHeight = Math.round(spaceAbove) + 'px';
  } else {
    // ข้างบน-ข้างล่างไม่พอทั้งคู่ (มือถือแนวนอน สูง ~390px) — เดิมกล่องสูง 260px ยื่นเลยขอบล่างจอ ~55px
    // ปุ่ม "แสดง" หลุดจอ → เลื่อนหน้าขึ้นเท่าที่ขาด ให้ทั้งกล่องอยู่ในจอ (รีวิวมือถือ 27 ก.ย. 69)
    const h = Math.min(MIN_H, vh - M * 2);
    if (spaceBelow < h) window.scrollBy(0, Math.ceil(h - spaceBelow));
    const below2 = vh - pop.getBoundingClientRect().top - M;
    pop.style.maxHeight = Math.round(Math.max(h, below2)) + 'px';
  }
}

/** คลาสของช่องวันหนึ่งช่อง (ใช้ทั้งตอนวาดครั้งแรกและตอนระบายตามเมาส์) */
function dpDayCls_(c: DpCtx, sday: string, today: string): string {
  const lo = c.from;
  // ระหว่างเลือกวันจบ ให้ระบายตามวันที่เมาส์ชี้ เพื่อให้เห็นช่วงก่อนกดจริง
  const hi = c.picking ? (c.hover && c.hover > c.from ? c.hover : c.from) : c.to;
  const isStart = !!lo && sday === lo;
  const isEnd = !!hi && sday === hi && hi !== lo;
  const cls = ['dp-day'];
  if (isStart || isEnd) cls.push('dp-sel');
  if (isStart && hi && hi !== lo) cls.push('dp-start');
  if (isEnd) cls.push('dp-end');
  if (!!lo && !!hi && sday > lo && sday < hi) cls.push('dp-in');
  if (sday === today) cls.push('dp-today');
  if (sday > today) cls.push('dp-future');
  return cls.join(' ');
}

/**
 * ระบายช่วงใหม่ "โดยไม่วาด HTML ใหม่" — สลับแค่คลาสของปุ่มที่มีอยู่
 *
 * ⚠️ ห้ามวาดใหม่ตอนเมาส์ลากผ่าน: การเขียน innerHTML ทับจะสร้างปุ่มวันชุดใหม่ทั้งหมด
 * ปุ่มที่ผู้ใช้กำลังกดค้างอยู่จะถูกแทนที่ระหว่าง mousedown กับ mouseup
 * เบราว์เซอร์เลยไม่นับเป็น click → กดเลือกวันจบไม่ติดเลยแม้แต่ครั้งเดียว
 * (เทสที่สั่ง .click() ด้วยโค้ดจับบั๊กนี้ไม่ได้ เพราะไม่ได้ผ่านลำดับเมาส์จริง)
 */
function dpTint_(host: HTMLElement): void {
  const c = dpCtx_;
  if (!c) return;
  const today = todayYmd_();
  host.querySelectorAll('[data-d]').forEach((b) => {
    const d = b.getAttribute('data-d') || '';
    const cls = dpDayCls_(c, d, today) + (b.getAttribute('data-focus') === '1' ? '' : '');
    if (b.className !== cls) b.className = cls;
    const cell = b.parentElement;
    if (cell) cell.setAttribute('aria-selected', cls.indexOf('dp-sel') >= 0 ? 'true' : 'false');
  });
  const sum = host.querySelector('.dp-sum');
  if (sum) sum.textContent = dpSummary_(c);
  const apply = host.querySelector('[data-dp="apply"]') as HTMLButtonElement | null;
  if (apply) apply.disabled = !(c.from && c.to && !c.picking);
}

/** ผูก event ครั้งเดียวต่อกล่อง แล้วใช้การมอบหมาย (delegation) — ปุ่มถูกวาดใหม่กี่รอบก็ยังทำงาน */
function dpWire_(host: HTMLElement): void {
  if (host.getAttribute('data-dp-wired')) return;
  host.setAttribute('data-dp-wired', '1');

  host.addEventListener('click', (e) => {
    const c = dpCtx_;
    if (!c) return;
    const t = (e.target as HTMLElement).closest('[data-d],[data-mv],[data-quick],[data-dp]') as HTMLElement | null;
    if (!t) return;

    const mv = t.getAttribute('data-mv');
    if (mv) {
      const [y, m] = addMonth_(c.vy, c.vm, Number(mv));
      c.vy = y; c.vm = m;
      dpPaint_(host);
      return;
    }
    const q = t.getAttribute('data-quick');
    if (q) {
      const today = todayYmd_();
      c.to = today;
      c.from = addDays_(today, -(Number(q) - 1));
      c.picking = false;
      c.focus = c.from;
      const pp = parseYmd_(c.from)!;
      c.vy = pp[0]; c.vm = pp[1];   // เลื่อนปฏิทินไปให้เห็นวันเริ่มต้นที่เพิ่งตั้ง
      dpPaint_(host);
      return;
    }
    const act = t.getAttribute('data-dp');
    if (act) {
      if (act === 'apply') dpApply_(); else dpClose_();
      return;
    }
    const d = t.getAttribute('data-d');
    if (d) {
      if (!c.picking) { c.from = d; c.to = ''; c.hover = ''; c.picking = true; }
      // กดย้อนหลังกว่าวันเริ่ม = เริ่มใหม่ที่วันนั้น ดีกว่าสลับให้เงียบๆ แล้วได้ช่วงที่ไม่ได้ตั้งใจ
      else if (d < c.from) { c.from = d; c.to = ''; c.hover = ''; c.picking = true; }
      else { c.to = d; c.picking = false; }
      c.focus = d;
      dpPaint_(host);
    }
  });

  // ระบายล่วงหน้าตามเมาส์ — แตะแค่คลาส ไม่วาด HTML ใหม่ (ดูคำเตือนใน dpTint_)
  host.addEventListener('mouseover', (e) => {
    const c = dpCtx_;
    if (!c || !c.picking) return;
    const t = (e.target as HTMLElement).closest('[data-d]') as HTMLElement | null;
    if (!t) return;
    const d = t.getAttribute('data-d') || '';
    if (d === c.hover) return;
    c.hover = d;
    dpTint_(host);
  });
}

function dpPaint_(host: HTMLElement): void {
  const c = dpCtx_;
  if (!c) return;
  host.innerHTML = dpHtml_(c);
  dpPlace_(host);
  dpWire_(host);
  // คืนโฟกัสให้วันที่กำลังโฟกัส เพื่อให้ลูกศรเดินต่อได้หลังวาดใหม่
  const f = host.querySelector('[data-focus="1"]') as HTMLElement | null;
  if (f && document.activeElement && host.contains(document.activeElement)) f.focus();
}

function dpMoveFocus_(host: HTMLElement, delta: number, byMonth: boolean): void {
  const c = dpCtx_;
  if (!c) return;
  if (byMonth) {
    const p = parseYmd_(c.focus)!;
    const [y, m] = addMonth_(p[0], p[1], delta);
    c.focus = ymd_(y, m, Math.min(p[2], daysInMonth_(y, m)));
  } else {
    c.focus = addDays_(c.focus, delta);
  }
  const p = parseYmd_(c.focus)!;
  // ให้เดือนที่โฟกัสอยู่ในสองเดือนที่แสดงเสมอ
  const [ry, rm] = addMonth_(c.vy, c.vm, 1);
  if (!((p[0] === c.vy && p[1] === c.vm) || (p[0] === ry && p[1] === rm))) { c.vy = p[0]; c.vm = p[1]; }
  dpPaint_(host);
  const f = host.querySelector('[data-focus="1"]') as HTMLElement | null;
  if (f) f.focus();
}

let dpOutside_: ((e: Event) => void) | null = null;
let dpKey_: ((e: KeyboardEvent) => void) | null = null;

function dpClose_(): void {
  const c = dpCtx_;
  dpCtx_ = null;
  floaterClosed(dpClose_);
  if (dpOutside_) { document.removeEventListener('mousedown', dpOutside_, true); dpOutside_ = null; }
  if (dpKey_) { document.removeEventListener('keydown', dpKey_, true); dpKey_ = null; }
  document.querySelectorAll('.dp-host').forEach((h) => { h.innerHTML = ''; });
  document.querySelectorAll('.dp-trigger[aria-expanded="true"]').forEach((t) => {
    t.setAttribute('aria-expanded', 'false');
    (t as HTMLElement).focus();
  });
  if (c) { /* ปิดเฉยๆ ไม่แตะ state — ค่าที่ยังไม่กด "แสดง" ต้องไม่มีผล */ }
}

/** ย้ายปฏิทินที่เปิดอยู่ไปยังปุ่ม/กล่องชุดใหม่ หลังแถวควบคุมถูกวาดใหม่ (คงค่าที่เลือกค้างไว้) */
function dpRebind_(trig: HTMLElement, host: HTMLElement, state: RangeState, onChange: () => void): void {
  const c = dpCtx_;
  if (!c) return;
  c.state = state;          // state object อาจเป็นตัวเดิม แต่ผูกใหม่ให้ชัวร์
  c.onChange = onChange;
  trig.setAttribute('aria-expanded', 'true');
  dpPaint_(host);
  // ตัวจับคลิกนอกกล่องยังชี้ไป node เก่า → ผูกใหม่ให้ชี้ของใหม่
  if (dpOutside_) document.removeEventListener('mousedown', dpOutside_, true);
  dpOutside_ = (e: Event) => {
    const t = e.target as Node;
    if (host.contains(t) || trig.contains(t)) return;
    dpClose_();
  };
  document.addEventListener('mousedown', dpOutside_, true);
}

function dpApply_(): void {
  const c = dpCtx_;
  if (!c || !c.from || !c.to || c.picking) return;
  c.state.from = c.from;
  c.state.to = c.to;
  const onChange = c.onChange;
  dpClose_();
  onChange();
}

function dpOpen_(trigger: HTMLElement, host: HTMLElement, state: RangeState, idPrefix: string, onChange: () => void): void {
  if (dpCtx_ && dpCtx_.idPrefix === idPrefix) { dpClose_(); return; }   // กดซ้ำที่ปุ่มเดิม = ปิด
  dpClose_();
  const today = todayYmd_();
  const from = parseYmd_(state.from) ? String(state.from) : today;
  const to = parseYmd_(state.to) ? String(state.to) : from;
  const p = parseYmd_(from)!;
  // เปิดค้างไว้ที่เดือนของวันเริ่มต้น แต่ถ้าช่วงกินข้ามเดือนพอดี เดือนขวาจะโชว์วันจบให้เอง
  dpCtx_ = { state, idPrefix, onChange, vy: p[0], vm: p[1], from, to, picking: false, hover: '', focus: from };
  trigger.setAttribute('aria-expanded', 'true');
  dpPaint_(host);

  dpOutside_ = (e: Event) => {
    const t = e.target as Node;
    if (host.contains(t) || trigger.contains(t)) return;
    dpClose_();
  };
  document.addEventListener('mousedown', dpOutside_, true);

  dpKey_ = (e: KeyboardEvent) => {
    if (!dpCtx_) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); dpClose_(); return; }
    if (k === 'Enter') {
      const act = document.activeElement as HTMLElement | null;
      if (act && act.classList.contains('dp-day')) return;   // ปล่อยให้ปุ่มวันจัดการเอง
      if (dpCtx_.from && dpCtx_.to && !dpCtx_.picking) { e.preventDefault(); dpApply_(); }
      return;
    }
    const map: Record<string, [number, boolean]> = {
      ArrowLeft: [-1, false], ArrowRight: [1, false],
      ArrowUp: [-7, false], ArrowDown: [7, false],
      PageUp: [-1, true], PageDown: [1, true],
    };
    if (map[k]) { e.preventDefault(); dpMoveFocus_(host, map[k][0], map[k][1]); }
  };
  document.addEventListener('keydown', dpKey_, true);
  floaterOpened(dpClose_);

  // preventScroll: วันนี้อาจอยู่ส่วนล่างของกล่อง — focus() เฉยๆ ลากทั้งหน้าเลื่อนตาม (วัดได้ 276px บนมือถือแนวนอน)
  const f = host.querySelector('[data-focus="1"]') as HTMLElement | null;
  if (f) f.focus({ preventScroll: true });
}



// เรียงลำดับตามหน้าเว็บแอด (วันนี้ → เมื่อวาน → 3/7/30 วัน → เดือนนี้ → กำหนดเอง) ตามที่บอสขอ
// ⚠️ ทุก key ที่เพิ่มตรงนี้ ต้องมี case ใน resolveRange_ ของ lib/api/sales.ts และ lib/api/adminperf.ts ด้วย
//    ไม่งั้นมันจะตกไป default: = "วันนี้" เงียบๆ (ปุ่ม active แต่ตัวเลขไม่เปลี่ยน)
// ⚠️ เดิมทุกปุ่มมีอีโมจิปฏิทิน (📅 📆 🗓️ สลับกัน 3 แบบ) ซึ่ง "ทุกปุ่มมีเหมือนกัน" = ไม่ได้บอกอะไร
// แต่ทำให้ปุ่มกว้างขึ้นตัวละ ~22px รวม 7 ปุ่มก็เกินหนึ่งบรรทัดบนมือถือ (แถวปุ่มกินไป 3 บรรทัด)
// ปุ่ม "กำหนดเอง" ก็เป็นคำล้วนแล้ว (ตรวจ UI รอบ 2) — ไอคอนปฏิทินย้ายไปอยู่บนปุ่มเลือกวันที่ที่โผล่ข้างๆ แทน
// ซึ่งเป็นตัวที่เปิดปฏิทินจริง ไม่ต้องมีปฏิทินสองอันวางติดกัน
export const RANGE_PRESETS = [
  { key: 'today', label: 'วันนี้' },
  { key: 'yesterday', label: 'เมื่อวานนี้' },
  { key: '3d', label: '3 วันล่าสุด' },
  { key: '7d', label: '7 วันล่าสุด' },
  { key: '30d', label: '30 วันล่าสุด' },
  { key: 'month', label: 'เดือนนี้' },
  { key: 'custom', label: 'กำหนดเอง' },
];

/** ชื่อช่วงเวลาที่เลือกอยู่ (ใช้บนปุ่มมือถือ "ช่วงเวลา: วันนี้") */
export function rangeLabel(state: RangeState): string {
  const p = RANGE_PRESETS.filter((x) => x.key === state.preset)[0];
  return p ? p.label : RANGE_PRESETS[0].label;
}

/**
 * สร้าง HTML ตัวเลือกช่วงเวลา; state = {preset, from, to}
 * ประกอบด้วย 3 ส่วน (ตรวจ UI ข้อ F1):
 *   .range-mobile  ปุ่มเดียว "ช่วงเวลา: วันนี้" → เปิดแผ่นเลือกจากขอบล่าง (จอแคบกว่า 600px)
 *   .range-full    แถวปุ่ม 7 ปุ่มแบบเดิม (จอตั้งแต่ 600px) — id / data-preset คงเดิม
 *   .dp-wrap       ปุ่มเปิดปฏิทิน เฉพาะโหมดกำหนดเอง (แสดงทุกขนาดจอ จะได้เห็น/แก้ช่วงวันที่ได้บนมือถือด้วย)
 * การซ่อน/แสดงตามความกว้างจออยู่ใน globals.css — เดิมแถวปุ่ม 7 ปุ่มกินครึ่งจอแรกบนมือถือ
 */
export function rangeControlsHtml(state: RangeState, idPrefix: string): string {
  const pills = RANGE_PRESETS.map((p) => {
    const on = state.preset === p.key;
    // aria-pressed = บอกโปรแกรมอ่านหน้าจอว่าปุ่มไหน "ถูกเลือกอยู่" (F5) — สีอย่างเดียวคนตาบอดไม่เห็น
    return '<button type="button" class="filter-btn' + (on ? ' active' : '') +
      '" data-preset="' + p.key + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + p.label + '</button>';
  }).join('');
  // โหมดกำหนดเอง: ปุ่มเดียวเปิดปฏิทินเลือกช่วง — เดิมเป็นช่อง <input type="date"> 2 ช่อง
  // ซึ่งกดยากบนมือถือ และไม่เห็นว่าช่วงที่เลือกกินกี่วันจนกว่าจะโหลดเสร็จ
  // แก้วันที่แล้ว "ยังไม่โหลด" จนกด แสดง/Enter (เปลี่ยนช่วง 1 ครั้งเคยยิงคิวรีช่วงยาว 2 รอบ)
  const label = state.from && state.to
    ? thaiDateShort(state.from) + ' – ' + thaiDateShort(state.to)
    : 'เลือกช่วงวันที่';
  const dates = state.preset === 'custom'
    ? '<div class="dp-wrap">' +
        '<button type="button" class="dp-trigger" id="' + idPrefix + '-dp" aria-haspopup="dialog"' +
          ' aria-expanded="false">' + icon('calendar', { size: 16 }) + esc(label) + '<span class="dp-caret">▾</span></button>' +
        '<div class="dp-host" id="' + idPrefix + '-dphost"></div>' +
      '</div>'
    : '';
  // หน้าตาทั้งหมดอยู่ที่ .range-mobile ใน globals.css (ไม่ใส่ .btn — กฎ display ของ .btn จะไปทับการซ่อนบนจอกว้าง)
  const mobile = '<button type="button" class="range-mobile" id="' + idPrefix + '-rm" aria-haspopup="dialog">' +
    icon('calendar', { size: 16 }) +
    // ช่องว่างระหว่าง 2 span ไม่กินที่ในกล่อง flex แต่ทำให้ชื่อปุ่มที่โปรแกรมอ่านหน้าจออ่านไม่ติดกันเป็นคำเดียว
    '<span class="rm-k">ช่วงเวลา:</span> <span class="rm-v">' + esc(rangeLabel(state)) + '</span>' +
    icon('chevron-down', { size: 16, cls: 'rm-caret' }) +
  '</button>';
  return mobile +
    '<div class="conv-filters range-full" id="' + idPrefix + '-presets" role="group" aria-label="ช่วงเวลา" style="margin-bottom:0">' +
      pills + '</div>' +
    dates;
}

/** ตั้งค่า preset ลง state (ใช้ร่วมทั้งแถวปุ่มและแผ่นมือถือ) */
function applyPreset_(state: RangeState, key: string): void {
  state.preset = key;
  if (key === 'custom' && !state.from) {
    // ใช้วันที่ตามเวลาเครื่องผู้ใช้ ไม่ใช่ UTC (toISOString จะถอยไปวันก่อนช่วงก่อน 7 โมงเช้า)
    const today = todayYmd_();
    state.from = today;
    state.to = today;
  }
}

/** state + callback ล่าสุดของแต่ละปุ่ม — ผูก listener ครั้งเดียวต่อ element แต่ใช้ค่าล่าสุดเสมอ
 *  (บางหน้าเรียก bindRangeControls ซ้ำบน DOM เดิม เดิมได้ listener ซ้อน 2 ตัว → โหลดข้อมูล 2 รอบต่อการกด 1 ครั้ง) */
interface RcBind { state: RangeState; onChange: () => void }
const rcBinds_ = new WeakMap<Element, RcBind>();

/** เลือก "กำหนดเอง" จากแผ่นมือถือ → เปิดปฏิทินให้เลยเมื่อหน้าวาดปุ่มปฏิทินเสร็จ (ถ้าวาดเสร็จเร็วพอ) */
let dpAutoOpen_: { idPrefix: string; at: number } | null = null;
// โหลดนานกว่านี้ ไม่เด้งปฏิทินใส่ — คนอาจเลื่อนไปทำอย่างอื่นแล้ว
// (เดิม 2.5 วิ แต่หน้ายอดขายบนมือถือโหลดใหม่ ~3.7 วิ ปฏิทินเลยไม่เคยเด้ง — รีวิวมือถือ 27 ก.ย. 69)
const DP_AUTO_OPEN_MS = 8000;

/** แผ่นเลือกช่วงเวลาบนมือถือ (bottom sheet ชุดเดียวกับหน้าต่างอื่นของเว็บ) */
function openRangeSheet_(b: RcBind, idPrefix: string): void {
  const st = b.state;
  // รายการเรียงลงมาแถวละตัวเลือก สูง 48px (.sheet-list / .sheet-opt ใน globals.css) — แตะง่ายกว่าชิปที่ขึ้นหลายบรรทัด
  const opts = RANGE_PRESETS.map((p) => {
    const on = st.preset === p.key;
    return '<button type="button" class="sheet-opt range-opt' + (on ? ' active' : '') + '" data-sheet-preset="' + p.key + '"' +
      ' aria-pressed="' + (on ? 'true' : 'false') + '"' + (on ? ' data-autofocus' : '') + '>' +
      '<span>' + esc(p.label) + '</span>' + (on ? icon('check', { size: 18 }) : '') + '</button>';
  }).join('');
  openModal(
    '<div class="modal-head"><h3>ช่วงเวลา</h3>' + modalCloseBtn() + '</div>' +
    '<div class="sheet-list range-sheet" role="group" aria-label="เลือกช่วงเวลา">' + opts + '</div>',
    { cls: 'modal-range' },
  );
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.querySelectorAll('[data-sheet-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const key = btn.getAttribute('data-sheet-preset') || 'today';
      closeModal();
      applyPreset_(st, key);
      dpAutoOpen_ = key === 'custom' ? { idPrefix, at: Date.now() } : null;
      b.onChange();
    });
  });
}

/** ผูก event ให้ rangeControls; onChange() ถูกเรียกเมื่อ state เปลี่ยน (โหมดกำหนดเอง = ตอนกดแสดง) */
export function bindRangeControls(
  container: HTMLElement,
  state: RangeState,
  idPrefix: string,
  onChange: () => void,
): void {
  const wrap = container.querySelector('#' + idPrefix + '-presets');
  if (!wrap) return;
  const bind: RcBind = { state, onChange };
  rcBinds_.set(wrap, bind);
  if (!wrap.getAttribute('data-rc-bound')) {
    wrap.setAttribute('data-rc-bound', '1');
    wrap.addEventListener('click', (e) => {
      const t = e.target as Element | null;
      const btn = t && t.closest ? t.closest('[data-preset]') : null;
      if (!btn || !wrap.contains(btn)) return;
      const cur = rcBinds_.get(wrap);
      if (!cur) return;
      applyPreset_(cur.state, btn.getAttribute('data-preset') || 'today');
      cur.onChange();
    });
  }
  // ปุ่มเดียวบนมือถือ → แผ่นรายการช่วงเวลา
  const mb = container.querySelector('#' + idPrefix + '-rm');
  if (mb) {
    rcBinds_.set(mb, bind);
    if (!mb.getAttribute('data-rc-bound')) {
      mb.setAttribute('data-rc-bound', '1');
      mb.addEventListener('click', () => {
        const cur = rcBinds_.get(mb);
        if (cur) openRangeSheet_(cur, idPrefix);
      });
    }
  }
  // โหมดกำหนดเอง: ปุ่มเดียวเปิดปฏิทิน — ค่าจะมีผลต่อเมื่อกด "แสดง" ในปฏิทินเท่านั้น
  // (เปลี่ยนช่วง 1 ครั้งเคยยิงคิวรีช่วงยาว 2 รอบ เพราะแก้ทีละช่อง)
  const trig = container.querySelector('#' + idPrefix + '-dp') as HTMLElement | null;
  const host = container.querySelector('#' + idPrefix + '-dphost') as HTMLElement | null;
  // หน้าวาดแถวควบคุมใหม่ (โหลดข้อมูลเสร็จ / auto-refresh) = ปุ่มกับกล่องปฏิทินกลายเป็น node ใหม่
  // ตัวที่เปิดค้างอยู่จะชี้ไป node เก่าที่หลุดจากหน้าไปแล้ว → ปฏิทินหายจากจอแต่ระบบยังคิดว่าเปิดอยู่
  // คลิกรอบถัดไปเลยกลายเป็น "สั่งปิด" แทน "เปิด" (อาการ: เปิดไม่ขึ้น ต้องกด 2 ครั้ง)
  // ย้ายไปกล่องใหม่แทนการปิดทิ้ง — ผู้ใช้ที่กำลังเลือกวันอยู่จะได้ไม่โดนปิดใส่หน้ากลางคัน
  if (dpCtx_ && dpCtx_.idPrefix === idPrefix && trig && host) {
    dpRebind_(trig, host, state, onChange);
  }
  // กันผูก event ซ้ำ: บางหน้าเรียก bindRangeControls ใหม่โดยไม่ได้สร้าง DOM ใหม่ (เช่นรอบ
  // auto-refresh) ปุ่มเดิมจะมี listener 2 ตัว → คลิกเดียวสั่ง "เปิด" แล้ว "ปิด" ต่อทันที
  // อาการคือปฏิทินเปิดไม่ขึ้นแบบสุ่ม ไล่ยากมากเพราะครั้งแรกหลังโหลดหน้าใช้ได้ปกติ
  if (trig && host) {
    rcBinds_.set(trig, bind);
    if (!trig.getAttribute('data-dp-bound')) {
      trig.setAttribute('data-dp-bound', '1');
      trig.addEventListener('click', () => {
        const cur = rcBinds_.get(trig) || bind;
        dpOpen_(trig, host, cur.state, idPrefix, cur.onChange);
      });
    }
    // มาจากแผ่นมือถือ ("กำหนดเอง") → เปิดปฏิทินให้เลย ไม่ต้องหาปุ่มแล้วกดอีกรอบ
    if (dpAutoOpen_ && dpAutoOpen_.idPrefix === idPrefix) {
      const fresh = Date.now() - dpAutoOpen_.at < DP_AUTO_OPEN_MS;
      dpAutoOpen_ = null;
      if (fresh && !dpCtx_) dpOpen_(trig, host, state, idPrefix, onChange);
    }
  }
}
