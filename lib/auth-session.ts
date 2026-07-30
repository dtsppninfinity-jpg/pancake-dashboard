// lib/auth-session.ts — cookie session ที่เซ็นลายเซ็น (ใช้ได้ทั้ง Edge middleware และ Node API route)
//
// ทำไมไม่เก็บ session ใน DB: middleware ทำงานบน Edge ทุก request — ถ้าต้องยิง Supabase ทุกครั้ง
// จะช้าและเปลืองโควตา ใช้ cookie เซ็น HMAC แทน ตรวจได้ในตัวเองโดยไม่แตะ DB
//
// รูปแบบ: <payload base64url>.<hmac base64url>   payload = JSON {u,r,a,n,exp}
// ใช้ Web Crypto (crypto.subtle) ล้วน — Node 18+ กับ Edge runtime มีเหมือนกัน
//
// ⚠️ ผลข้างเคียงที่ต้องรู้: เปลี่ยน role หรือปิดใช้งาน user แล้ว cookie ใบเดิมยังใช้ได้จนหมดอายุ
// จึงตั้ง SESSION_DAYS ไม่ยาว และ API ที่แก้ข้อมูลสำคัญ (จัดการผู้ใช้) เช็คสิทธิ์กับ DB ซ้ำอีกชั้น

export const SESSION_COOKIE = 'pn_sess';
export const SESSION_DAYS = 7;

export type Role = 'superadmin' | 'exec' | 'admin';

export interface Session {
  u: string;   // username
  r: Role;     // role
  a: string;   // admin_user_id ที่ผูกไว้ ('' = ไม่ผูก)
  n: string;   // ชื่อที่แสดง
  exp: number; // epoch วินาที
}

/* ---------------- base64url ที่รองรับภาษาไทย ---------------- */
// btoa รับได้แค่ latin1 → ต้องแปลง UTF-8 เป็น byte string ก่อน ไม่งั้นชื่อไทยพัง

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function bytesFromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/** ความลับสำหรับเซ็น — ต้องตั้ง AUTH_SECRET; fallback เป็นรหัสทีมเดิมเพื่อไม่ให้เว็บล่มตอน deploy แรก */
function secretOf(env: Record<string, string | undefined>): string {
  return env.AUTH_SECRET || env.DASHBOARD_PASSWORD || '';
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

/** เซ็น session → string ที่เอาไปใส่ cookie ได้ */
export async function signSession(
  sess: Omit<Session, 'exp'> & { exp?: number },
  env: Record<string, string | undefined> = process.env as any
): Promise<string> {
  const secret = secretOf(env);
  if (!secret) throw new Error('ยังไม่ได้ตั้ง AUTH_SECRET (หรือ DASHBOARD_PASSWORD) บนเซิร์ฟเวอร์');
  const exp = sess.exp || Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const payload: Session = { u: sess.u, r: sess.r, a: sess.a || '', n: sess.n || '', exp };
  const body = b64urlFromBytes(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(body));
  return body + '.' + b64urlFromBytes(new Uint8Array(sig));
}

/**
 * ตรวจ cookie → Session ถ้าถูกต้องและยังไม่หมดอายุ, null ถ้าไม่ผ่าน
 * ใช้ crypto.subtle.verify (เทียบแบบ constant-time ในตัว ไม่ต้องเทียบ string เอง)
 */
export async function verifySession(
  token: string | undefined | null,
  env: Record<string, string | undefined> = process.env as any
): Promise<Session | null> {
  const secret = secretOf(env);
  if (!secret || !token) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    // cast เป็น BufferSource — TS มอง Uint8Array เป็น ArrayBufferLike ซึ่งอาจเป็น SharedArrayBuffer
    // (เกิดขึ้นไม่ได้จริงตรงนี้ เพราะเราสร้าง Uint8Array ขึ้นมาเองใน bytesFromB64url)
    const sigBytes = bytesFromB64url(sig) as unknown as BufferSource;
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), sigBytes, enc.encode(body));
    if (!ok) return null;
    const sess = JSON.parse(dec.decode(bytesFromB64url(body))) as Session;
    if (!sess || !sess.u || !sess.r) return null;
    if (!sess.exp || sess.exp * 1000 < Date.now()) return null; // หมดอายุ
    return sess;
  } catch {
    return null;
  }
}

/* ---------------- สิทธิ์ ---------------- */

export const ROLE_LABEL: Record<Role, string> = {
  superadmin: 'ผู้ดูแลระบบ',
  exec: 'ระดับบริหาร',
  admin: 'ระดับแอดมิน',
};

/** หน้าที่แต่ละ role เปิดได้ — 'me' = หน้าผลงานของฉัน (เฉพาะ role=admin) */
export const ROLE_VIEWS: Record<Role, string[]> = {
  superadmin: ['dashboard', 'sales', 'contentads', 'profit', 'admins', 'adminperf', 'kpi', 'umap', 'users'],
  exec: ['dashboard', 'sales', 'contentads', 'profit', 'admins', 'adminperf', 'kpi', 'umap'],
  admin: ['me'],
};

export function canView(role: Role | undefined | null, view: string): boolean {
  if (!role) return false;
  return (ROLE_VIEWS[role] || []).indexOf(view) >= 0;
}

/** API ที่แต่ละ role เรียกได้ (ชื่อตรงกับโฟลเดอร์ app/api/<fn>) */
const API_BY_ROLE: Record<Role, string[]> = {
  superadmin: ['*'],
  exec: [
    'apiBootstrap', 'apiDashboard', 'apiSales', 'apiContentAds', 'apiAdmins', 'apiAdminPerf',
    'apiAdminSettings', 'apiAppSettings', 'apiScoreConfig', 'apiUMap', 'apiMe', 'apiKpi', 'apiAdminCom', 'apiProfit',
  ],
  // แอดมินเห็นเฉพาะของตัวเอง — apiMe คืนข้อมูลที่ scope ด้วย admin_user_id จาก session แล้ว
  admin: ['apiBootstrap', 'apiMe'],
};

export function canCallApi(role: Role | undefined | null, fn: string): boolean {
  if (!role) return false;
  const list = API_BY_ROLE[role] || [];
  return list[0] === '*' || list.indexOf(fn) >= 0;
}
