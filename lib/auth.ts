// lib/auth.ts — จัดการรหัสผ่าน + อ่าน user (Node runtime เท่านั้น — ห้าม import จาก middleware ที่รันบน Edge)
//
// รหัสผ่านแฮชด้วย scrypt ของ Node เอง (ไม่ใช้ bcrypt) เพราะ:
//   - ไม่ต้องเพิ่ม dependency (bcrypt เป็น native module ต้อง compile, bcryptjs ช้ากว่า)
//   - scrypt ต้านการเดาด้วย GPU ได้ดี (memory-hard) และอยู่ใน stdlib ตั้งแต่ Node 10
// รูปแบบที่เก็บ: scrypt$N$r$p$<saltBase64>$<hashBase64>
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { db } from '@/lib/db';
import type { Role } from '@/lib/auth-session';

const scrypt = promisify(_scrypt) as (pw: string | Buffer, salt: Buffer, len: number, opts: any) => Promise<Buffer>;

// N=2^15 ใช้ ~32MB ต่อการแฮช 1 ครั้ง — หนักพอกันเดาสุ่ม แต่ยังเร็วพอสำหรับ login (~100ms)
const PARAMS = { N: 32768, r: 8, p: 1, keylen: 64 };
const MAXMEM = 128 * PARAMS.N * PARAMS.r * 2; // ค่า default ของ Node ไม่พอสำหรับ N นี้ ต้องบอกเอง

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pw.normalize('NFKC'), salt, PARAMS.keylen, { ...PARAMS, maxmem: MAXMEM });
  return `scrypt$${PARAMS.N}$${PARAMS.r}$${PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** เทียบรหัสผ่านแบบ constant-time — คืน false เสมอถ้ารูปแบบ hash เพี้ยน (ไม่ throw ให้ผู้โจมตีเดาได้) */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const N = Number(parts[1]), r = Number(parts[2]), p = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64');
    const expect = Buffer.from(parts[5], 'base64');
    if (!N || !r || !p || !salt.length || !expect.length) return false;
    const got = await scrypt(pw.normalize('NFKC'), salt, expect.length, {
      N, r, p, maxmem: 128 * N * r * 2,
    });
    return got.length === expect.length && timingSafeEqual(got, expect);
  } catch {
    return false;
  }
}

/** สุ่มรหัสผ่านอ่านง่าย (ไม่มีตัวที่สับสน 0/O/1/l/I) — ใช้ตอนสร้างบัญชียกชุดให้ทีม */
export function randomPassword(len = 10): string {
  const abc = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const buf = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i++) out += abc[buf[i] % abc.length];
  return out;
}

export interface AppUser {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  role: Role;
  admin_user_id: string | null;
  enabled: boolean;
  must_change_pw: boolean;
}

/** หา user จาก username (ไม่สนตัวพิมพ์) — null ถ้าไม่มีหรือตารางยังไม่ถูกสร้าง */
export async function findUser(username: string): Promise<AppUser | null> {
  const u = String(username || '').trim();
  if (!u) return null;
  const { data, error } = await db
    .from('app_users')
    .select('id,username,password_hash,name,role,admin_user_id,enabled,must_change_pw')
    .ilike('username', u) // ilike ไม่มี wildcard = เทียบเท่ากันแบบไม่สนตัวพิมพ์
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as AppUser) || null;
}

/** ยังไม่มีใครในระบบเลยหรือเปล่า (ใช้ตัดสินว่าต้องบอกให้ไป seed ก่อน) */
export async function hasAnyUser(): Promise<boolean> {
  const { count, error } = await db.from('app_users').select('id', { count: 'exact', head: true });
  if (error) return false;
  return (count || 0) > 0;
}

export async function markLogin(id: number): Promise<void> {
  try {
    await db.from('app_users').update({ last_login_at: new Date().toISOString() }).eq('id', id);
  } catch { /* ไม่สำคัญพอที่จะทำให้ login ล้ม */ }
}
