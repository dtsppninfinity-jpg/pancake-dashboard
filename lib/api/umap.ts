// lib/api/umap.ts — "U Map" จับคู่แอดมิน ↔ U (หน้า 6)
// เก็บทั้งชุดเป็น JSON ใน sync_state key 'u_map' — pattern เดียวกับ scoreconfig/app_settings
// (ข้อมูลเล็ก ~25 U — ไม่ต้องรัน migration เพิ่ม, seed อัตโนมัติครั้งแรกที่ถูกอ่าน)
// มุมมองสาธารณะ: publicUMapPayload() ให้ /api/public/umap ใช้ (ส่งเฉพาะชื่อ ไม่ส่ง user_id)
import { db, fetchAll } from '@/lib/db';

const KEY = 'u_map';

export interface UMember { id: string; name: string }
export interface UUnit { u: string; product: string; admins: UMember[] }
export interface UMapDoc { units: UUnit[]; updatedAt: string }

/* ---------------- seed (รายการตั้งต้นจากทีม 2026-07-21) ---------------- */

const SEED_UNITS: Array<[string, string]> = [
  ['U3', 'GLACIER Bloom'], ['U4', 'HaYeon'], ['U9', 'Venorra'], ['U10', 'VEGGY'],
  ['U11', 'Kome'], ['U12', 'Harina'], ['U13', 'MGB+'], ['U14', 'Gavista'],
  ['U15', 'So-Ar'], ['U16', 'C Biofla'], ['U17', 'Coffee'], ['U18', 'Merry'],
  ['U25', 'Cocolly'], ['U26', 'กาแฟ Cocolly'],
  ['UN1', 'Plukaow'], ['UN3', 'ดวงดรุณี'], ['UN4', 'Reno plus ไต'], ['UN5', 'Magnesium'],
  ['UN6', 'Myco prime plus'], ['UN7', 'Complete Green X45'], ['UN8', 'Probiova'],
  ['UN9', 'ProbioWa'], ['UN10', 'Vista'], ['UN11', 'Lysva'],
];

/* ---------------- validate / normalize ---------------- */

/** รหัส U: ตัวอักษร+ตัวเลข เช่น U3, UN10 — บังคับตัวพิมพ์ใหญ่ ยาวไม่เกิน 12 */
export function normCode(raw: unknown): string {
  const s = String(raw || '').trim().toUpperCase();
  return /^[A-Z0-9-]{1,12}$/.test(s) ? s : '';
}

function normProduct(raw: unknown): string {
  return String(raw || '').trim().slice(0, 120);
}

/** เรียง U แบบธรรมชาติ: prefix ตัวอักษร → เลขก้อนแรก → ส่วนที่เหลือ
 *  (U3 < U3A < U10 < UN1 < UN10 — normCode รับโค้ดอย่าง U3A ได้ ต้องเรียงให้ติดกับ U3) */
function sortKey_(u: string): [string, number, string] {
  const m = /^([A-Z-]*)(\d*)(.*)$/.exec(u);
  return m ? [m[1], m[2] ? Number(m[2]) : -1, m[3]] : [u, -1, ''];
}
function sortUnits_(units: UUnit[]): void {
  units.sort((a, b) => {
    const ka = sortKey_(a.u), kb = sortKey_(b.u);
    if (ka[0] !== kb[0]) return ka[0] < kb[0] ? -1 : 1;
    if (ka[1] !== kb[1]) return ka[1] - kb[1];
    return ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0;
  });
}

/** ตรวจโครง doc จาก DB — ทุก field ต้องอยู่ในรูปที่ถูกต้อง (JSON ใน DB อาจถูกมือแก้) */
function normalizeDoc(raw: any): UMapDoc {
  const out: UMapDoc = { units: [], updatedAt: String((raw && raw.updatedAt) || '') };
  const seen = new Set<string>();
  const arr = (raw && Array.isArray(raw.units)) ? raw.units : [];
  for (const it of arr) {
    const u = normCode(it && it.u);
    if (!u || seen.has(u)) continue;
    seen.add(u);
    const admins: UMember[] = [];
    const ids = new Set<string>();
    for (const m of (it && Array.isArray(it.admins)) ? it.admins : []) {
      const id = String((m && m.id) || '').trim().slice(0, 100);
      const name = String((m && m.name) || '').trim().slice(0, 100);
      if (!id || !name || ids.has(id)) continue;
      ids.add(id);
      admins.push({ id, name });
    }
    out.units.push({ u, product: normProduct(it && it.product), admins });
  }
  sortUnits_(out.units);
  return out;
}

/* ---------------- load / save ---------------- */

async function saveDoc_(doc: UMapDoc): Promise<void> {
  doc.updatedAt = new Date().toISOString();
  const { error } = await db.from('sync_state').upsert(
    { key: KEY, value: JSON.stringify(doc), updated_at: doc.updatedAt },
    { onConflict: 'key' }
  );
  if (error) throw new Error('บันทึก U map ไม่สำเร็จ: ' + error.message);
  pubDocCache = null; // ข้อมูลเปลี่ยน — ล้าง cache สาธารณะใน lambda ตัวนี้ทันที
}

/** อ่าน doc ปัจจุบัน — seed รายการตั้งต้นเฉพาะเมื่อ "ไม่มีแถวอยู่จริง" เท่านั้น
 *  แถวที่มีอยู่แต่ JSON เสีย (ถูกมือแก้ใน Supabase) ต้อง throw — ห้าม seed ทับเด็ดขาด
 *  ไม่งั้นข้อมูลจับคู่ทั้งหมดถูกล้างเงียบๆ จาก read ใดก็ได้ (รวมถึง public GET ที่ไม่มีรหัส) */
export async function getUMapDoc(): Promise<UMapDoc> {
  const { data, error } = await db.from('sync_state').select('value').eq('key', KEY).maybeSingle();
  if (error) throw new Error('อ่าน U map ไม่สำเร็จ: ' + error.message);
  if (data) {
    let parsed: any;
    try { parsed = JSON.parse(String(data.value || '')); } catch {
      throw new Error('ข้อมูล U map ใน sync_state เสียหาย (JSON ไม่ถูกต้อง) — ' +
        'แก้ค่า หรือลบแถว key "u_map" ใน Supabase เพื่อให้ระบบ seed ใหม่');
    }
    return normalizeDoc(parsed);
  }
  const doc: UMapDoc = {
    units: SEED_UNITS.map(([u, product]) => ({ u, product, admins: [] })),
    updatedAt: '',
  };
  sortUnits_(doc.units);
  await saveDoc_(doc);
  return doc;
}

/* ---------------- roster (รายชื่อแอดมินให้เลือกจับคู่) ---------------- */

/** catch เฉพาะ "ตารางยังไม่ถูกสร้าง" — error อื่นโยนต่อ (pattern เดียวกับ admins.ts) */
function missingTable_(table: string): (e: any) => null {
  return (e: any) => {
    const m = String((e && e.message) || e || '');
    if (m.includes(table) && (m.includes('does not exist') || m.includes('schema cache'))) return null;
    throw e;
  };
}

async function loadRoster_(): Promise<UMember[]> {
  const [admins, settings] = await Promise.all([
    fetchAll<any>(() => db.from('admins').select('user_id,name'), 'user_id'),
    fetchAll<any>(() => db.from('admin_settings').select('user_id,enabled'), 'user_id')
      .catch(missingTable_('admin_settings')),
  ]);
  const disabled = new Set(
    (settings || []).filter((s: any) => s.enabled === false).map((s: any) => String(s.user_id))
  );
  return admins
    .filter((a: any) => a.user_id && String(a.name || '').trim() && !disabled.has(String(a.user_id)))
    .map((a: any) => ({ id: String(a.user_id), name: String(a.name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name, 'th'));
}

/* ---------------- API หลัก (หลังรหัสทีม) ---------------- */

export async function apiUMap(params: any) {
  const p = params || {};
  const action = String(p.action || '');

  // ---- อ่านทั้งหมด (units + roster) ----
  if (!action) {
    const [doc, roster] = await Promise.all([getUMapDoc(), loadRoster_()]);
    return {
      ok: true, units: doc.units, updatedAt: doc.updatedAt, roster,
      // ให้ UI บอกความจริงเรื่องลิงก์สาธารณะ — ถ้าตั้ง key ไว้ ลิงก์เปล่าๆ จะโดน 401
      publicNeedsKey: !!process.env.UMAP_PUBLIC_KEY,
    };
  }

  // ---- mutation: อ่าน doc ปัจจุบัน → แก้ → บันทึก → คืน doc ใหม่ ----
  // (read-modify-write ไม่มี lock — ทีมเล็ก แก้พร้อมกันน้อยมาก ยอมรับได้เช่นเดียวกับ scoreconfig)
  const doc = await getUMapDoc();
  const u = normCode(p.u);

  if (action === 'addUnit') {
    if (!u) return { ok: false, error: 'รหัส U ไม่ถูกต้อง — ใช้ตัวอักษร/ตัวเลข เช่น U27, UN12' };
    const product = normProduct(p.product);
    if (!product) return { ok: false, error: 'กรอกชื่อผลิตภัณฑ์ด้วย' };
    if (doc.units.some((x) => x.u === u)) return { ok: false, error: u + ' มีอยู่แล้ว' };
    doc.units.push({ u, product, admins: [] });
  } else if (action === 'editUnit') {
    const unit = doc.units.find((x) => x.u === u);
    if (!unit) return { ok: false, error: 'ไม่พบ ' + (u || 'U ที่ระบุ') };
    const product = normProduct(p.product);
    if (!product) return { ok: false, error: 'กรอกชื่อผลิตภัณฑ์ด้วย' };
    unit.product = product;
  } else if (action === 'removeUnit') {
    if (!doc.units.some((x) => x.u === u)) return { ok: false, error: 'ไม่พบ ' + (u || 'U ที่ระบุ') };
    doc.units = doc.units.filter((x) => x.u !== u);
  } else if (action === 'assign') {
    const unit = doc.units.find((x) => x.u === u);
    if (!unit) return { ok: false, error: 'ไม่พบ ' + (u || 'U ที่ระบุ') };
    const userId = String(p.userId || '').trim();
    if (!userId) return { ok: false, error: 'ไม่ได้ระบุแอดมิน' };
    // เอาชื่อจากตาราง admins เสมอ (ไม่เชื่อชื่อที่ client ส่งมา — กันชื่อปลอม/ชื่อเก่า)
    const { data: adm, error } = await db.from('admins').select('user_id,name')
      .eq('user_id', userId).maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!adm || !String(adm.name || '').trim()) return { ok: false, error: 'ไม่พบแอดมินคนนี้ในระบบ' };
    // ห้ามจับคู่คนที่ถูกปิดใช้งาน — roster ฝั่ง UI กรองให้อยู่แล้ว แต่ tab ที่เปิดค้าง
    // (roster เก่าได้ถึง 5 นาที) หรือ POST ตรงยังหลุดมาได้ ต้องกันที่ server ด้วย
    {
      const { data: st, error: stErr } = await db.from('admin_settings').select('enabled')
        .eq('user_id', userId).maybeSingle();
      const stMsg = String((stErr && stErr.message) || '');
      if (stErr && !(stMsg.includes('admin_settings') &&
          (stMsg.includes('does not exist') || stMsg.includes('schema cache')))) {
        return { ok: false, error: stMsg };
      }
      if (st && st.enabled === false) {
        return { ok: false, error: String(adm.name).trim() + ' ถูกปิดใช้งานอยู่ — เปิดใช้งานก่อนที่หน้า Admin Management' };
      }
    }
    if (unit.admins.some((m) => m.id === userId)) {
      return { ok: false, error: String(adm.name).trim() + ' อยู่ใน ' + u + ' อยู่แล้ว' };
    }
    unit.admins.push({ id: userId, name: String(adm.name).trim().slice(0, 100) });
  } else if (action === 'unassign') {
    const unit = doc.units.find((x) => x.u === u);
    if (!unit) return { ok: false, error: 'ไม่พบ ' + (u || 'U ที่ระบุ') };
    const userId = String(p.userId || '').trim();
    const before = unit.admins.length;
    unit.admins = unit.admins.filter((m) => m.id !== userId);
    if (unit.admins.length === before) return { ok: false, error: 'แอดมินคนนี้ไม่ได้อยู่ใน ' + u };
  } else {
    return { ok: false, error: 'ไม่รู้จักคำสั่ง: ' + action };
  }

  sortUnits_(doc.units);
  await saveDoc_(doc);
  return { ok: true, units: doc.units, updatedAt: doc.updatedAt };
}

/* ---------------- payload สาธารณะ (/api/public/umap) ---------------- */

// cache ใน memory ของ lambda ~30 วิ — CDN cache (s-maxage) กันไม่พอเพราะ key ตาม URL เต็ม
// (ยิง ?x=<สุ่ม> ทะลุ CDN ได้ทุกครั้ง) ชั้นนี้กัน DB โดนตีตรงจาก cache-busting
let pubDocCache: { at: number; doc: UMapDoc } | null = null;
const PUB_CACHE_MS = 30_000;

/** ส่งเฉพาะชื่อแอดมิน (ไม่ส่ง user_id ภายใน) — ลดข้อมูลที่หลุดสู่สาธารณะให้น้อยที่สุด */
export async function publicUMapPayload(uFilter?: string) {
  let doc: UMapDoc;
  if (pubDocCache && Date.now() - pubDocCache.at < PUB_CACHE_MS) {
    doc = pubDocCache.doc;
  } else {
    doc = await getUMapDoc();
    pubDocCache = { at: Date.now(), doc };
  }
  let units = doc.units;
  const f = normCode(uFilter || '');
  if (uFilter && !f) return { ok: false as const, error: 'invalid u code' };
  if (f) {
    units = units.filter((x) => x.u === f);
    if (!units.length) return { ok: false as const, error: 'unit not found: ' + f };
  }
  return {
    ok: true as const,
    updatedAt: doc.updatedAt,
    count: units.length,
    units: units.map((x) => ({ u: x.u, product: x.product, admins: x.admins.map((m) => m.name) })),
  };
}
