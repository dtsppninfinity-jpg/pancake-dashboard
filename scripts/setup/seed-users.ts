// scripts/setup/seed-users.ts — สร้างบัญชีผู้ใช้เว็บ
//
// ใช้:
//   npx tsx scripts/setup/seed-users.ts                     → สร้าง superadmin (ถ้ายังไม่มี)
//   npx tsx scripts/setup/seed-users.ts --exec ชื่อ:username → เพิ่มบัญชีระดับบริหาร
//   npx tsx scripts/setup/seed-users.ts --admins            → สร้างบัญชีให้แอดมินทุกคนในตาราง admins
//   npx tsx scripts/setup/seed-users.ts --admins --csv out.csv
//
// รหัสผ่านทุกบัญชีถูกสุ่มและ **พิมพ์ออกมาครั้งเดียว** (เก็บไม่ได้เพราะเก็บแค่ hash)
// บัญชีที่สร้างยกชุดตั้ง must_change_pw = true → ผู้ใช้ต้องตั้งรหัสใหม่ตอนเข้าครั้งแรก
import '../../lib/env';
import { supabase } from '../../lib/supabase';
import { hashPassword, randomPassword } from '../../lib/auth';

type NewUser = { username: string; name: string; role: string; adminUserId?: string | null };

/** ชื่อไทย → username แบบอ่านออก: ใช้ local part ของอีเมลก่อน ถ้าไม่มีค่อย fallback เป็น adm<n> */
function usernameFrom(email: string, fallbackIndex: number, taken: Set<string>): string {
  let base = String(email || '').split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
  if (base.length < 3) base = 'adm' + String(fallbackIndex).padStart(2, '0');
  let u = base;
  let n = 2;
  while (taken.has(u)) u = base + n++; // กันชนกันเอง (อีเมลซ้ำ/ตัดแล้วเหมือนกัน)
  taken.add(u);
  return u;
}

async function existingUsernames(): Promise<Set<string>> {
  const { data } = await supabase.from('app_users').select('username');
  return new Set((data || []).map((r: any) => String(r.username).toLowerCase()));
}

async function createUsers(list: NewUser[], mustChange: boolean): Promise<{ username: string; name: string; role: string; password: string }[]> {
  const out: { username: string; name: string; role: string; password: string }[] = [];
  for (const u of list) {
    const password = randomPassword(10);
    const row = {
      username: u.username,
      password_hash: await hashPassword(password),
      name: u.name || u.username,
      role: u.role,
      admin_user_id: u.adminUserId || null,
      enabled: true,
      must_change_pw: mustChange,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from('app_users').insert(row);
    if (error) {
      console.log(`  ⚠ ${u.username}: ${error.message}`);
      continue;
    }
    out.push({ username: u.username, name: row.name, role: u.role, password });
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const has = (f: string) => args.indexOf(f) >= 0;
  const valOf = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : ''; };

  // ตารางมีหรือยัง
  const { error: probe } = await supabase.from('app_users').select('id').limit(1);
  if (probe) {
    console.error('❌ อ่านตาราง app_users ไม่ได้ — รัน db/migrations/2026-07-27-app-users.sql บน Supabase ก่อน');
    console.error('   (' + probe.message + ')');
    process.exit(1);
  }

  const taken = await existingUsernames();
  const created: { username: string; name: string; role: string; password: string }[] = [];

  // 1) superadmin — สร้างให้อัตโนมัติถ้ายังไม่มีใครเลย
  if (!taken.has('superadmin')) {
    console.log('▶ สร้าง superadmin');
    created.push(...(await createUsers([{ username: 'superadmin', name: 'ผู้ดูแลระบบ', role: 'superadmin' }], false)));
    taken.add('superadmin');
  } else {
    console.log('• superadmin มีอยู่แล้ว — ข้าม');
  }

  // 2) ระดับบริหาร: --exec "ชื่อ:username"
  const execArg = valOf('--exec');
  if (execArg) {
    const [name, uname] = execArg.split(':');
    const u = (uname || name || '').toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (!u || taken.has(u)) {
      console.log(`• ข้าม exec "${execArg}" (username ว่างหรือซ้ำ)`);
    } else {
      console.log(`▶ สร้างบัญชีระดับบริหาร ${u}`);
      created.push(...(await createUsers([{ username: u, name: name || u, role: 'exec' }], true)));
      taken.add(u);
    }
  }

  // 3) แอดมินยกชุดจากตาราง admins
  if (has('--admins')) {
    const { data: admins } = await supabase
      .from('admins')
      .select('user_id,name,email')
      .order('user_id');
    const rows = admins || [];

    // คนที่มีบัญชีแล้ว (ผูกด้วย admin_user_id) ไม่สร้างซ้ำ
    const { data: linked } = await supabase.from('app_users').select('admin_user_id');
    const already = new Set((linked || []).map((r: any) => String(r.admin_user_id || '')));

    const todo: NewUser[] = [];
    let i = 1;
    for (const a of rows) {
      const uid = String(a.user_id);
      if (already.has(uid)) continue;
      todo.push({
        username: usernameFrom(String(a.email || ''), i++, taken),
        name: String(a.name || ''),
        role: 'admin',
        adminUserId: uid,
      });
    }
    console.log(`▶ สร้างบัญชีแอดมิน ${todo.length} คน (จากทั้งหมด ${rows.length})`);
    created.push(...(await createUsers(todo, true)));
  }

  if (!created.length) {
    console.log('■ ไม่มีบัญชีใหม่ถูกสร้าง');
    return;
  }

  console.log(`\n■ สร้างแล้ว ${created.length} บัญชี — รหัสผ่านนี้แสดงครั้งเดียว เก็บไว้ให้ดี\n`);
  console.log('ชื่อ,username,role,รหัสผ่าน');
  created.forEach((c) => console.log(`${c.name},${c.username},${c.role},${c.password}`));

  const csvPath = valOf('--csv');
  if (csvPath) {
    const fs = await import('fs');
    const csv = 'ชื่อ,username,role,รหัสผ่าน\n' + created.map((c) => `${c.name},${c.username},${c.role},${c.password}`).join('\n');
    fs.writeFileSync(csvPath, '﻿' + csv, 'utf8'); // BOM ให้ Excel อ่านภาษาไทยถูก
    console.log(`\n💾 บันทึกไฟล์ ${csvPath} แล้ว — ⚠️ ลบทิ้งหลังแจกรหัสเสร็จ`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
