// scripts/dev/check-meta-token.ts — ตรวจ META_ACCESS_TOKEN ว่าใช้ได้จริงไหม / หมดอายุเมื่อไหร่
//
// ใช้ตอนต่ออายุโทเค็น: ทีมส่งโทเค็นมาให้ ใส่ลง .env.local แล้วรันตัวนี้ก่อน
// จะได้รู้ทันทีว่าเป็น "ตัวใหม่จริง" หรือเผลอส่งตัวเก่ามาซ้ำ (เกิดขึ้นแล้ว 2026-08-27)
//
// ใช้: npx tsx scripts/dev/check-meta-token.ts
//
// ⚠️ ไม่พิมพ์ตัวโทเค็นออกจอเด็ดขาด — พิมพ์แค่ข้อมูลกำกับ (อายุ/สิทธิ์/เจ้าของ/จำนวนบัญชี)
//    เพราะ log ของเซสชันอาจถูกเก็บไว้ และ repo นี้เป็น public
import '../../lib/env';
import { createHash } from 'crypto';

const V = 'v21.0';
const BASE = `https://graph.facebook.com/${V}`;

const fmtTime = (sec: number) =>
  new Date(sec * 1000).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' });

async function main() {
  const token = process.env.META_ACCESS_TOKEN || '';
  if (!token) { console.error('❌ ยังไม่ได้ตั้ง META_ACCESS_TOKEN ใน .env.local'); process.exit(1); }
  // ลายนิ้วมือแบบไม่เปิดเผยตัวโทเค็น — ใช้เทียบว่า "ตัวเดิมหรือตัวใหม่" ได้โดยไม่ต้องเห็นของจริง
  const fp = createHash('sha256').update(token).digest('hex').slice(0, 12);
  console.log(`โทเค็นยาว ${token.length} ตัวอักษร | ลายนิ้วมือ ${fp}`);

  const r = await fetch(`${BASE}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`);
  const j = await r.json();
  if (j.error) { console.error('❌ โทเค็นใช้ไม่ได้:', j.error.message); process.exit(1); }
  const d = j.data || {};

  console.log(`ใช้งานได้    : ${d.is_valid ? '✅ ใช่' : '❌ ไม่'}`);
  console.log(`ชนิด         : ${d.type || '-'}`);
  console.log(`แอป          : ${d.application || '-'} (${d.app_id || '-'})`);
  if (d.expires_at === 0 || d.expires_at === undefined) {
    console.log('วันหมดอายุ   : ♾️  ไม่มีวันหมดอายุ (System User token — ตัวที่ควรใช้)');
  } else {
    const left = Math.round((d.expires_at * 1000 - Date.now()) / 86400000);
    console.log(`วันหมดอายุ   : ${fmtTime(d.expires_at)}  (อีก ${left} วัน)${left <= 7 ? '  ⚠️ ใกล้หมด' : ''}`);
  }
  if (d.data_access_expires_at) console.log(`สิทธิ์อ่านหมด : ${fmtTime(d.data_access_expires_at)}`);
  const scopes: string[] = d.scopes || [];
  console.log(`สิทธิ์        : ${scopes.join(', ') || '-'}`);
  for (const need of ['ads_read', 'ads_management', 'business_management']) {
    console.log(`   ${scopes.includes(need) ? '✅' : '⚠️ '} ${need}${need === 'business_management' ? ' (ไม่บังคับ)' : ''}`);
  }

  // เห็นกี่บัญชีโฆษณา — ตัวเลขนี้ต้องได้ 165 ถึงจะเท่าของเดิม
  const a = await fetch(`${BASE}/me/adaccounts?fields=account_id,account_status&limit=200&access_token=${encodeURIComponent(token)}`);
  const aj = await a.json();
  if (aj.error) { console.log(`บัญชีโฆษณา   : ❌ อ่านไม่ได้ — ${aj.error.message}`); process.exit(1); }
  const list = aj.data || [];
  const byStatus = new Map<number, number>();
  list.forEach((x: any) => byStatus.set(Number(x.account_status), (byStatus.get(Number(x.account_status)) || 0) + 1));
  const more = aj.paging && aj.paging.next ? ' (ยังมีหน้าถัดไป)' : '';
  console.log(`บัญชีโฆษณา   : ${list.length} บัญชี${more} — ` +
    [...byStatus].sort((x, y) => x[0] - y[0]).map(([s, n]) => `status ${s}: ${n}`).join(' | '));
}

main().catch((e) => { console.error('❌', e.message); process.exit(1); });
