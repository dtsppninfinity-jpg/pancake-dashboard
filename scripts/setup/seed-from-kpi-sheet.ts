// scripts/setup/seed-from-kpi-sheet.ts — seed 3 อย่างจาก "ชีท KPI" กลางของทีม (รันซ้ำได้)
//   1. ชื่อเล่นแอดมินที่ระบบยังไม่มี (แท็บ EMY: รหัส/ชื่อจริง/ชื่อเล่น ครบทุกคน)
//   2. แอดมิน↔ยูนิต เข้า u_map (แท็บ KPI ADMIN/month คอลัมน์ Unit + รองหัวหน้าจากแท็บ KPI รอง)
//   3. ผังทีม (หัวหน้า/รอง→ยูนิต) เก็บ sync_state 'team_structure' — ฐานของหน้า KPI
//
// วิธีจับคู่คนในชีท ↔ คนในระบบ: ชื่อจริงในชีท == ชื่อ Pancake (ปรับช่องว่าง) ก่อน
// ไม่เจอค่อยเทียบชื่อเล่นกับ admin_settings.nickname ที่เคย seed ไว้ — ชื่อ Pancake บางคน
// เป็นนามแฝง ("Gary C. Madsen" = ก้า) เทียบชื่อจริงตรงๆ ไม่ได้ทุกคน คนที่จับไม่ได้จะรายงานท้ายรัน
// ใช้: npx tsx scripts/setup/seed-from-kpi-sheet.ts [--dry]
import '../../lib/env';
import { supabase, setState } from '../../lib/supabase';
import { sheetValues } from '../../lib/google';

const SHEET_ID = '1J_sTV9obDUXrYuQzPK7bCyz4ZC6Fygjc8cLZrYNtgK0';
const DRY = process.argv.includes('--dry');

const norm = (s: unknown) => String(s || '').replace(/\s+/g, ' ').trim();

/** 'U16 C Biofla' / 'UN8 PROBIOVA' → 'U16' / 'UN8' */
function unitCode(s: unknown): string {
  const m = norm(s).toUpperCase().match(/^(UN?\d{1,3})\b/);
  return m ? m[1] : '';
}

interface Person { code: string; realName: string; nickname: string; position: string }

async function readEmy(): Promise<Person[]> {
  const grid = await sheetValues(SHEET_ID, `'EMY'!A1:G200`);
  const out: Person[] = [];
  for (const row of grid) {
    const code = norm(row[1]);
    if (!/^\d{4,6}$/.test(code)) continue; // แถวหัว/ว่าง
    out.push({ code, realName: norm(row[5]), nickname: norm(row[6]), position: norm(row[3]) });
  }
  return out;
}

/** แท็บ KPI รายเดือน → { empCode → Set<unitCode> } (รวมทุกเดือน — คนย้ายยูนิตให้เห็นทุกที่ที่เคยอยู่) */
async function readUnitAssign(tab: string): Promise<Record<string, Set<string>>> {
  const grid = await sheetValues(SHEET_ID, `'${tab}'!A1:H900`);
  const out: Record<string, Set<string>> = {};
  for (const row of grid) {
    const code = norm(row[2]); // C = ID (รหัสพนักงาน)
    const u = unitCode(row[6]); // G = Unit
    if (!/^\d{4,6}$/.test(code) || !u) continue;
    (out[code] = out[code] || new Set()).add(u);
  }
  return out;
}

async function main() {
  const [people, adminUnits, subUnits] = await Promise.all([
    readEmy(), readUnitAssign('KPI ADMIN/month'), readUnitAssign('KPI รอง ADMIN/month'),
  ]);
  console.log(`EMY ${people.length} คน | แอดมินมียูนิต ${Object.keys(adminUnits).length} | รองมียูนิต ${Object.keys(subUnits).length}`);

  // ---- คนในระบบ ----
  const { data: admins, error: e1 } = await supabase.from('admins').select('user_id,name');
  if (e1) throw new Error(e1.message);
  const { data: settings, error: e2 } = await supabase.from('admin_settings').select('user_id,nickname,enabled');
  if (e2) throw new Error(e2.message);
  const byRealName = new Map<string, string>();   // ชื่อ Pancake (norm) → user_id
  (admins || []).forEach((a: any) => byRealName.set(norm(a.name), String(a.user_id)));
  const byNick = new Map<string, string[]>();     // nickname → [user_id]
  (settings || []).forEach((s: any) => {
    if (s.nickname) {
      const k = norm(s.nickname);
      byNick.set(k, [...(byNick.get(k) || []), String(s.user_id)]);
    }
  });
  const nameById = new Map<string, string>();
  (admins || []).forEach((a: any) => nameById.set(String(a.user_id), norm(a.name)));

  const resolve = (p: Person): string => {
    const byName = byRealName.get(norm(p.realName));
    if (byName) return byName;
    const cands = byNick.get(norm(p.nickname)) || [];
    return cands.length === 1 ? cands[0] : ''; // ชื่อเล่นซ้ำหลายคน = ไม่เดา
  };

  // ---- 1. เติมชื่อเล่นที่ขาด ----
  const nickById = new Map<string, string>();
  (settings || []).forEach((s: any) => { if (s.nickname) nickById.set(String(s.user_id), String(s.nickname)); });
  const toSetNick: Array<{ user_id: string; nickname: string }> = [];
  const unmatched: string[] = [];
  for (const p of people) {
    if (!p.nickname) continue;
    const uid = resolve(p);
    if (!uid) { unmatched.push(`${p.nickname}(${p.realName})`); continue; }
    if (!nickById.get(uid)) toSetNick.push({ user_id: uid, nickname: p.nickname });
  }
  console.log(`เติมชื่อเล่นใหม่ ${toSetNick.length} คน | จับคู่ไม่ได้ ${unmatched.length}: ${unmatched.slice(0, 8).join(', ')}${unmatched.length > 8 ? '…' : ''}`);
  if (!DRY) {
    for (const r of toSetNick) {
      // upsert เฉพาะคอลัมน์ nickname — แถวที่มีอยู่คงค่า enabled/role เดิม
      const { error } = await supabase.from('admin_settings')
        .upsert({ user_id: r.user_id, nickname: r.nickname }, { onConflict: 'user_id' });
      if (error) throw new Error(`ตั้งชื่อเล่น ${r.nickname}: ${error.message}`);
    }
  }

  // ---- 2. แอดมิน (+รองหัวหน้า) ↔ ยูนิต เข้า u_map ----
  const byCode = new Map(people.map((p) => [p.code, p]));
  const unitMembers: Record<string, Map<string, string>> = {}; // u → (user_id → ชื่อ Pancake)
  let cantAssign: string[] = [];
  for (const src of [adminUnits, subUnits]) {
    for (const code of Object.keys(src)) {
      const p = byCode.get(code);
      if (!p) { cantAssign.push(code); continue; }
      const uid = resolve(p);
      if (!uid) { cantAssign.push(`${p.nickname}(${p.realName})`); continue; }
      for (const u of src[code]) {
        (unitMembers[u] = unitMembers[u] || new Map()).set(uid, nameById.get(uid) || p.realName);
      }
    }
  }
  cantAssign = Array.from(new Set(cantAssign));
  const { data: umapRow, error: e3 } = await supabase.from('sync_state').select('value').eq('key', 'u_map').maybeSingle();
  if (e3) throw new Error(e3.message);
  const doc = umapRow ? JSON.parse(String(umapRow.value || '{}')) : { units: [] };
  let added = 0, unitTouched = 0, unknownUnits: string[] = [];
  for (const u of Object.keys(unitMembers)) {
    const unit = (doc.units || []).find((x: any) => String(x.u).toUpperCase() === u);
    if (!unit) { unknownUnits.push(u); continue; }
    unit.admins = Array.isArray(unit.admins) ? unit.admins : [];
    const have = new Set(unit.admins.map((m: any) => String(m.id)));
    let touched = false;
    for (const [id, name] of unitMembers[u]) {
      if (have.has(id)) continue;
      unit.admins.push({ id, name });
      added++; touched = true;
    }
    if (touched) unitTouched++;
  }
  console.log(`u_map: เพิ่มการจับคู่ ${added} รายการใน ${unitTouched} ยูนิต` +
    (unknownUnits.length ? ` | ยูนิตที่ไม่มีใน U Map: ${unknownUnits.join(', ')}` : '') +
    (cantAssign.length ? ` | จับคนไม่ได้: ${cantAssign.slice(0, 8).join(', ')}${cantAssign.length > 8 ? '…' : ''}` : ''));
  if (!DRY && added) {
    doc.updatedAt = new Date().toISOString();
    const { error } = await supabase.from('sync_state')
      .upsert({ key: 'u_map', value: JSON.stringify(doc), updated_at: doc.updatedAt }, { onConflict: 'key' });
    if (error) throw new Error('บันทึก u_map: ' + error.message);
  }

  // ---- 3. ผังทีม ----
  const heads = people.filter((p) => p.position.includes('หัวหน้า') && !p.position.includes('รอง'));
  const subs = people.filter((p) => p.position.includes('รอง'));
  const structure = {
    head: heads.map((p) => ({ code: p.code, nickname: p.nickname, realName: p.realName })),
    subs: subs.map((p) => ({
      code: p.code, nickname: p.nickname, realName: p.realName,
      units: Array.from(subUnits[p.code] || []),
    })),
    source: 'ชีท KPI ' + SHEET_ID,
    updatedAt: new Date().toISOString(),
  };
  console.log('ผังทีม: หัวหน้า', structure.head.map((h) => h.nickname).join(','),
    '| รอง', structure.subs.map((s) => `${s.nickname}→${s.units.join('/')}`).join(' '));
  if (!DRY) await setState('team_structure', JSON.stringify(structure));

  console.log(DRY ? '(dry-run — ยังไม่เขียนอะไร)' : '✅ เขียนครบ');
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
