// scripts/setup/create-users-batch.ts — สร้างบัญชีชุดที่กำหนดรหัสผ่านเอง (ไม่สุ่ม)
//
// ใช้ตอนผู้ดูแลต้องการกำหนด username/รหัสเองแล้วแจกให้ทีมโดยตรง
// ต่างจาก seed-users.ts ตรงที่ตัวนั้นสุ่มรหัส + บังคับตั้งใหม่ตอนเข้าครั้งแรก
//
// อ่านรายชื่อจากไฟล์ JSON ที่ส่งมาทาง argv (ไม่ hard-code รหัสไว้ในโค้ด — ไฟล์นี้ขึ้น git)
//   npx tsx scripts/setup/create-users-batch.ts users.json
// รูปแบบไฟล์: [{ "username": "...", "password": "...", "role": "exec", "name": "...",
//               "adminUserId": "..." (เฉพาะ role=admin) }]
import '../../lib/env';
import { supabase } from '../../lib/supabase';
import { hashPassword } from '../../lib/auth';
import { readFileSync } from 'fs';

type Row = { username: string; password: string; role: string; name?: string; adminUserId?: string };

async function main() {
  const file = process.argv[2];
  if (!file) { console.error('ใช้: npx tsx scripts/setup/create-users-batch.ts <ไฟล์.json>'); process.exit(1); }
  const list: Row[] = JSON.parse(readFileSync(file, 'utf8'));

  const { data: existing } = await supabase.from('app_users').select('username');
  const taken = new Set((existing || []).map((u: any) => String(u.username).toLowerCase()));

  let ok = 0;
  for (const r of list) {
    const username = String(r.username || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) { console.log(`  ⚠ ${r.username}: username ไม่ผ่านเกณฑ์`); continue; }
    if (taken.has(username)) { console.log(`  • ${username}: มีอยู่แล้ว — ข้าม`); continue; }
    if (String(r.password || '').length < 8) { console.log(`  ⚠ ${username}: รหัสสั้นกว่า 8 ตัว`); continue; }
    if (['superadmin', 'exec', 'admin'].indexOf(r.role) < 0) { console.log(`  ⚠ ${username}: role ไม่ถูกต้อง`); continue; }
    if (r.role === 'admin' && !r.adminUserId) { console.log(`  ⚠ ${username}: role=admin ต้องผูก adminUserId`); continue; }

    const { error } = await supabase.from('app_users').insert({
      username,
      password_hash: await hashPassword(r.password),
      name: r.name || username,
      role: r.role,
      admin_user_id: r.adminUserId || null,
      enabled: true,
      // รหัสถูกกำหนดมาแล้วและจะแจกตรงให้เจ้าตัว → ไม่บังคับตั้งใหม่ตอนเข้าครั้งแรก
      // (เปลี่ยนเองได้ทีหลังผ่านปุ่ม "รีเซ็ตรหัส" ในหน้าจัดการผู้ใช้)
      must_change_pw: false,
      updated_at: new Date().toISOString(),
    });
    if (error) { console.log(`  ❌ ${username}: ${error.message}`); continue; }
    taken.add(username);
    console.log(`  ✅ ${username}  (${r.role})  ${r.name || ''}`);
    ok++;
  }
  console.log(`\n■ สร้างสำเร็จ ${ok}/${list.length} บัญชี`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
