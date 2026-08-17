// lib/api/adminperf.ts — พอร์ตจาก WebApi.gs apiAdminPerf
// อ่านจาก Postgres (Supabase) แทน Google Sheet — logic รวมยอดตรงกับของเดิม
import { db, fetchAll, fetchAllSliced, fetchAllDateSliced } from '@/lib/db';
import {
  EXCLUDED_STATUSES,
  fmtDateBkk,
  fmtDateTimeBkk,
  money_,
  isPlaceholderOrder,
  parsePancakeTime,
  startOfDayBkk,
} from '@/lib/config';
import { getAppSettings } from '@/lib/api/appsettings';
import { getKpiTargets, nicknameOf } from '@/lib/api/adminsettings';
import { getUMapDoc } from '@/lib/api/umap';
import { allocateReached, allocateReachedByPage } from '@/lib/api/chat-reached';

/* ---------------- utilities (พอร์ตจาก WebApi.gs) ---------------- */

/** ค่าจาก DB อาจเป็น Date/number/string/ISO — แปลงเป็น Date เสมอ */
function toDate_(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  return parsePancakeTime(String(v));
}

function toBool_(v: any): boolean {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function toNum_(v: any): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function fmtDateTime_(d: Date): string {
  return fmtDateTimeBkk(d);
}

function startOfDay_(d: Date): Date {
  return startOfDayBkk(d);
}

/**
 * แปลง params ช่วงเวลา → {start, end, prevStart, prevEnd, label}
 * preset: today | yesterday | 3d | 7d | 30d | month | custom (from/to = 'yyyy-MM-dd')
 * ⚠️ ต้องมีครบทุก key ใน RANGE_PRESETS (lib/ui/helpers.ts) — key ที่ไม่มี case จะตกไป default = วันนี้ เงียบๆ
 */
function resolveRange_(params: any) {
  const p = params || {};
  const preset = p.preset || 'today';
  const now = new Date();
  let start: Date, end: Date = now, label: string;
  switch (preset) {
    case 'yesterday':
      // เมื่อวาน = ทั้งวัน 00:00:00.000–23:59:59.999 เวลาไทย
      // (ไม่ตัดที่ "ตอนนี้" เหมือน preset อื่น — วันมันจบไปแล้ว ต้องได้ยอดเต็มวัน)
      start = daysAgo_(1);
      end = new Date(startOfDay_(now).getTime() - 1);
      label = 'เมื่อวานนี้';
      break;
    case '3d':
      start = daysAgo_(2); // 3 วันล่าสุด "รวมวันนี้" — กติกาเดียวกับ 7d/30d
      label = '3 วันล่าสุด';
      break;
    case '7d':
      start = daysAgo_(6);
      label = '7 วันล่าสุด';
      break;
    case '30d':
      start = daysAgo_(29);
      label = '30 วันล่าสุด';
      break;
    case 'month':
      start = startOfMonthBkk_(now);
      label = 'เดือนนี้';
      break;
    case 'custom':
      start = parsePancakeTime((p.from || fmtDateBkk(now)) + 'T00:00:00')!;
      end = parsePancakeTime((p.to || fmtDateBkk(now)) + 'T23:59:59')!;
      if (end.getTime() > now.getTime()) end = now;
      label = (p.from || '') + ' ถึง ' + (p.to || '');
      break;
    default: // today
      start = startOfDay_(now);
      label = 'วันนี้';
  }
  const span = end.getTime() - start.getTime();
  // ช่วงเทียบ = ถอยหลังเท่าความยาวช่วงที่เลือก (prevStart+span จึงเท่ากับ start เหมือนเดิม)
  // ยกเว้น 'yesterday' ที่จบ 23:59:59.999 → span สั้นกว่าวันจริง 1ms ถ้าถอยเท่า span ช่วงเทียบจะเริ่ม
  // 00:00:00.001 แล้วออเดอร์เที่ยงคืนตรงของ "วันก่อนหน้าเมื่อวาน" หลุด — ถอยเต็มวันแทน
  const shiftMs = preset === 'yesterday' ? 86400000 : span;
  const prevStart = new Date(start.getTime() - shiftMs);
  return {
    start,
    end,
    prevStart,
    prevEnd: new Date(prevStart.getTime() + span),
    label,
  };
}

function daysAgo_(n: number): Date {
  return startOfDayBkk(new Date(Date.now() - n * 86400000));
}

/** ต้นเดือนนี้ตามเวลาไทย */
function startOfMonthBkk_(d: Date): Date {
  const ds = fmtDateBkk(d); // YYYY-MM-DD ของวันไทย
  return new Date(ds.slice(0, 8) + '01T00:00:00+07:00');
}

function inRange_(d: Date | null, r: { start: Date; end: Date }): boolean {
  return !!d && d.getTime() >= r.start.getTime() && d.getTime() <= r.end.getTime();
}

/**
 * platform string → กลุ่มช่องทาง 'facebook' | 'line' | 'other'
 * (facebook รวม instagram/messenger)
 */
function platformChannel_(pf: any): string {
  pf = String(pf || '').toLowerCase();
  if (pf === 'line') return 'line';
  if (pf === 'facebook' || pf === 'instagram' || pf === 'messenger') return 'facebook';
  return pf ? 'other' : 'facebook';
}

/** platform ของออเดอร์ → 'facebook' | 'line' | 'other' */
function orderChannel_(o: any): string {
  return platformChannel_(o.platform);
}

/**
 * บทสนทนาแถวนี้เป็น "คอมเมนต์" ไหม (conversations.type)
 * ค่าจริงในตาราง: INBOX / COMMENT / RATING — RATING มีแค่หลักหน่วย จึงนับรวมกับอินบ็อกซ์
 * (ไม่ใช่คอมเมนต์ใต้โพสต์ และแยกออกมาเป็นช่องที่สามก็ไม่มีใครใช้)
 */
function isComment_(c: any): boolean {
  return String(c && c.type || '').toUpperCase() === 'COMMENT';
}

/** items_json อาจเป็น jsonb (array แล้ว) หรือ string — คืน array เสมอ */
function parseItems_(v: any): any[] {
  if (Array.isArray(v)) return v;
  try {
    return JSON.parse(String(v || '[]'));
  } catch (e) {
    return [];
  }
}

/* ---------------- data loaders ---------------- */

/** อ่านออเดอร์ในช่วง แปลงชนิดข้อมูลให้พร้อมใช้ (กรองช่วงเวลาที่ query แล้ว)
 *  หั่นช่วงเป็นก้อนดึงขนาน — ช่วงยาวๆ (30 วัน = ~90k แถว) OFFSET ลึกจะช้า+ชน statement timeout */
async function loadOrders_(r: { start: Date; end: Date }) {
  const rows = await fetchAllSliced<any>((f, t) =>
    db
      .from('orders')
      // ad_id = แอดที่ออเดอร์นี้มาจาก (มีจริง ~92% ของยอด — ใช้ทำ ROAS รายแอดมิน)
      .select('inserted_at,status,total_price,platform,seller_id,seller_name,creator_name,items_json,page_id,account_name,ad_id')
      .gte('inserted_at', f)
      .lt('inserted_at', t),
    r.start, r.end
  );
  return rows
    .map((o) => {
      o._at = toDate_(o.inserted_at);
      o.status = toNum_(o.status);
      o._placeholder = isPlaceholderOrder(o); // เช็คก่อนแปลงหน่วยเงิน
      o.total_price = money_(o.total_price);
      o._excluded = EXCLUDED_STATUSES.indexOf(o.status) >= 0;
      // แตก items_json เป็น {name, qty} เล็กๆ แล้วทิ้งก้อนดิบทันที — ช่วงยาว 89k แถว
      // ถือ jsonb ดิบรวมกันหลายร้อย MB เสี่ยง OOM เงียบแบบที่ apiSales โดน
      o._items = parseItems_(o.items_json).map((it: any) => ({ name: it && it.name, qty: (it && it.qty) || 1 }));
      delete o.items_json;
      return o;
    })
    // ตัดออเดอร์เปล่าที่ Pancake สร้างอัตโนมัติจากแชทแอด — ไม่ใช่ยอดขายของแอดมิน
    .filter((o) => o._at && !o._placeholder);
}

/**
 * ค่าแอดจริงรายแอดในช่วง (ad_daily) → { ad_id: spend บาท }
 * ⚠️ ad_daily.spend เป็น "บาทจริง" (มีทศนิยม) ไม่ใช่สตางค์เหมือน orders.total_price — ห้ามหาร 100
 * คืน null เมื่อตารางยังไม่ถูกสร้าง (ยังไม่รัน migration) → หน้าเว็บต้องโชว์ "—" ไม่ใช่ 0
 */
async function loadAdSpend_(fromDate: string, toDate: string): Promise<{ byAd: Record<string, number>; pageOfAd: Record<string, string> } | null> {
  try {
    // หั่นตามวัน — ช่วงยาว ad_daily มี ~800 แอด/วัน (35 วัน = ~28k แถว) OFFSET ลึกช้า+โดนตัด
    // page_id ใช้ปันค่าแอดของ "แอดที่ยังไม่มีออเดอร์" ให้คนที่ขายในเพจเดียวกัน
    const rows = await fetchAllDateSliced<any>((f, t) =>
      db.from('ad_daily').select('date,ad_id,page_id,spend').gte('date', f).lte('date', t),
      fromDate, toDate, { orderColumn: 'date,ad_id' }
    );
    const byAd: Record<string, number> = {};
    const pageOfAd: Record<string, string> = {};
    rows.forEach((a) => {
      const id = String(a.ad_id || '');
      if (!id) return;
      byAd[id] = (byAd[id] || 0) + toNum_(a.spend);
      const pid = String(a.page_id || '');
      if (pid && !pageOfAd[id]) pageOfAd[id] = pid;
    });
    return { byAd, pageOfAd };
  } catch (e: any) {
    const m = String((e && e.message) || e || '');
    if (m.includes('ad_daily') && (m.includes('does not exist') || m.includes('schema cache'))) return null;
    throw e;
  }
}

/* ---------------- API ---------------- */

export async function apiAdminPerf(params: any) {
  const r = resolveRange_(params);
  const channel = (params && params.channel) || '';

  // สถิติแชทในช่วง (กรอง date ที่ query แล้ว)
  const chatFrom = fmtDateBkk(r.start);
  const chatTo = fmtDateBkk(r.end);
  const cutoffIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  // คนที่ถูก "ปิดใช้งาน" ในหน้า Admin Management → ไม่เข้า ranking
  // (ตาราง admin_settings อาจยังไม่ถูกสร้าง → ถือว่าเปิดใช้งานทุกคน)
  const disabledIds: Record<string, boolean> = {};
  const groupsById: Record<string, string> = {}; // กลุ่มสินค้าที่ตั้งไว้ (ใช้เป็น filter ฝั่ง client)
  const nickById: Record<string, string> = {};   // ชื่อเล่นที่พิมพ์ทับไว้ ('' = ให้เดาจากชื่อเต็ม)
  const settingsJob = (async () => {
    try {
      // nickname มาจาก migration 2026-07-27 — ฐานที่ยังไม่รันจะ error ที่คอลัมน์นี้ → ขอใหม่แบบไม่มีมัน
      let st = await db.from('admin_settings').select('user_id,enabled,product_groups,nickname');
      if (st.error && String(st.error.message || '').includes('nickname')) {
        st = await db.from('admin_settings').select('user_id,enabled,product_groups') as any;
      }
      (st.data || []).forEach((s: any) => {
        if (s.enabled === false) disabledIds[String(s.user_id)] = true;
        if (s.product_groups) groupsById[String(s.user_id)] = String(s.product_groups);
        if (s.nickname) nickById[String(s.user_id)] = String(s.nickname);
      });
    } catch { /* ยังไม่มีตาราง */ }
  })();

  // ⚡ ทุกตารางอิสระต่อกัน — ยิงขนานทีเดียว (เดิมรอทีละตาราง: ช่วงยาวๆ orders กิน 30-40s เอง
  // แล้วค่อยตามด้วยแชท/แอด/conversations จนทะลุเพดาน 60s ของ Vercel — FUNCTION_INVOCATION_TIMEOUT)
  const [
    orders, adminRows, pageRows, chatRows, engRows, nc,
    appSettings, convRows, adSpendData, snapsRes, kpiTargets, uMap, comUnitRows,
  ] = await Promise.all([
    loadOrders_(r),
    fetchAll<any>(() => db.from('admins').select('user_id,pos_user_id,name,is_online'), 'user_id'),
    fetchAll<any>(() => db.from('pages').select('page_id,name'), 'page_id'),
    fetchAll<any>(() =>
      db.from('admin_chat_daily')
        .select('date,user_id,user_name,page_id,unique_inbox_count,inbox_count,comment_count,phone_number_count,avg_response_ms')
        .gte('date', chatFrom).lte('date', chatTo),
      'key'
    ),
    // ยอด "คนทัก" (บทสนทนาอินบ็อกซ์ใหม่ + ความคิดเห็น) ระดับเพจ จาก chat_engagement_daily
    fetchAll<any>(() =>
      db.from('chat_engagement_daily')
        // order_count/old_order_count ใช้หา "ออเดอร์วันนี้กี่ % มาจากแชทที่เปิดวันก่อน"
        .select('date,page_id,new_inbox,comment,order_count,old_order_count')
        .gte('date', chatFrom).lte('date', chatTo),
      'key'
    ).catch(() => [] as any[]),
    // ไม่ catch: ตาราง chat_hourly มีแน่นอน — error จริง (503/timeout) ต้องดังให้หน้าเว็บโชว์ retry
    // ไม่ใช่แสดง "0" เนียนๆ เหมือนเป็นข้อมูลจริง
    // หั่นตามวัน — ตารางนี้แถวเยอะสุดในกลุ่มแชท (~1,200/วัน → 35 วัน = 43k แถว เคยทำ 500 ทั้งหน้า)
    fetchAllDateSliced<any>((f, t) =>
      db.from('chat_hourly')
        .select('date,hour,platform,new_customer_count,customer_inbox_count')
        .gte('date', f).lte('date', t),
      chatFrom, chatTo
    ),
    getAppSettings(),
    // ต้อง select type ด้วย — "แชทรอตอบ" ~41% เป็นคอมเมนต์ใต้โพสต์ ไม่ใช่อินบ็อกซ์
    // (คนละงานกันสำหรับแอดมิน จึงต้องแยกให้เห็น ไม่ใช่กองรวมเป็นตัวเลขเดียว)
    fetchAll<any>(() =>
      db.from('conversations').select('waiting,updated_at,assignees,platform,type').gte('updated_at', cutoffIso)
    ),
    loadAdSpend_(chatFrom, chatTo),
    // snapshot คนปิดใช้งาน (กัน "seller ผี") — คอลัมน์มาจาก migration v2 ถ้าไม่มี error ก็ข้าม
    db.from('admin_settings').select('user_id,enabled,pos_user_id,snap_name'),
    getKpiTargets(),
    // ยูนิตของแต่ละแอดมิน — มาจากหน้า U Map (sync_state 'u_map') แหล่งเดียวกับที่หน้า Sales ใช้
    // ใช้โชว์บนการ์ด "ต่ำสุด 5" ว่าคนที่ต้องดูแลอยู่ยูนิตไหน (หัวหน้ายูนิตจะได้รู้ตัว)
    getUMapDoc().catch(() => ({ units: [], updatedAt: '' })),
    // ชีทค่าคอมบอกยูนิตของแต่ละคนไว้ด้วย (คีย์ = ชื่อเล่น) — ใช้เป็นแหล่งสำรองเมื่อ U Map ยังไม่ได้จับคู่
    // ตารางเล็ก (หลักร้อยแถว) และเป็นข้อมูลที่ทีมกรอกเอง เชื่อถือได้พอๆ กับ U Map
    fetchAll<any>(() => db.from('admin_commission').select('u,month,admin'), 'key').catch(() => [] as any[]),
  ]);
  await settingsJob;

  /* ---- ยูนิตของแต่ละแอดมิน: 3 ชั้น เอาชั้นที่ "ทีมประกาศไว้" ก่อนเสมอ ----
   * 1) U Map (หน้า 6) — ทีมจับคู่เอง แม่นสุด แต่ตอนนี้ครอบคลุมแค่ 12/34 คน
   * 2) ชีทค่าคอม (admin_commission) — ทีมกรอกเองเหมือนกัน คีย์ด้วยชื่อเล่น ใช้เดือนล่าสุดของคนนั้น
   * 3) เดาจากเพจที่คนนี้ขายได้จริง (เพจ→ยูนิต จาก U Map) — ติดธง guess ให้หน้าเว็บบอกผู้ใช้ว่าเป็นการเดา
   *    ไม่งั้นการ์ด "ต่ำสุด 5" จะขึ้น "ไม่ระบุยูนิต" เกินครึ่ง จนหัวหน้ายูนิตใช้ประโยชน์ไม่ได้
   */
  const unitsById: Record<string, string[]> = {};
  const unitsByName: Record<string, string[]> = {};
  const unitByPageName: Record<string, string> = {};
  const unitOfPageId: Record<string, string> = {};   // page_id → รหัสยูนิต (ใช้คิดค่าทักต่อคนรายยูนิต)
  ((uMap && uMap.units) || []).forEach((u: any) => {
    const code = String(u.u);
    (u.admins || []).forEach((m: any) => {
      const id = String(m.id || '');
      const nm = String(m.name || '').trim();
      if (id) (unitsById[id] = unitsById[id] || []).push(code);
      if (nm) (unitsByName[nm] = unitsByName[nm] || []).push(code);
    });
    (u.pages || []).forEach((pg: any) => {
      const nm = String(pg.name || '').trim();
      if (nm && !unitByPageName[nm]) unitByPageName[nm] = code;
      const pid = String(pg.id || '').trim();
      if (pid && !unitOfPageId[pid]) unitOfPageId[pid] = code;
    });
  });

  // ชีทค่าคอม — เก็บเฉพาะเดือนล่าสุดที่คนนั้นมีข้อมูล (คนย้ายยูนิตได้ ห้ามเอาเดือนเก่ามาปน)
  const comLatestMonth: Record<string, string> = {};
  (comUnitRows || []).forEach((c: any) => {
    const nick = String(c.admin || '').trim();
    const mo = String(c.month || '');
    if (!nick || !mo) return;
    if (!comLatestMonth[nick] || mo > comLatestMonth[nick]) comLatestMonth[nick] = mo;
  });
  const unitsByNick: Record<string, string[]> = {};
  (comUnitRows || []).forEach((c: any) => {
    const nick = String(c.admin || '').trim();
    const u = String(c.u || '').trim();
    if (!nick || !u || String(c.month || '') !== comLatestMonth[nick]) return;
    const arr = (unitsByNick[nick] = unitsByNick[nick] || []);
    if (arr.indexOf(u) < 0) arr.push(u);
  });

  /** เดายูนิตจากเพจที่คนนี้ขายได้จริง — เอาเฉพาะยูนิตที่กินยอด ≥20% สูงสุด 2 ยูนิต */
  function guessUnits_(pagesByName: Record<string, number> | null): string[] {
    if (!pagesByName) return [];
    const byUnit: Record<string, number> = {};
    let total = 0;
    Object.keys(pagesByName).forEach((nm) => {
      const u = unitByPageName[nm];
      const v = toNum_(pagesByName[nm]);
      if (!u || v <= 0) return;
      byUnit[u] = (byUnit[u] || 0) + v;
      total += v;
    });
    if (!total) return [];
    return Object.keys(byUnit)
      .filter((u) => byUnit[u] / total >= 0.2)
      .sort((a, b) => byUnit[b] - byUnit[a])
      .slice(0, 2);
  }

  /** คืน [ยูนิต, เป็นการเดาไหม] ตามลำดับความน่าเชื่อถือ */
  function unitsFor_(id: string, name: string, nick: string, pages: Record<string, number> | null): [string[], boolean] {
    const declared = unitsById[id] || unitsByName[name] || unitsByNick[nick] || [];
    if (declared.length) return [declared.slice().sort(), false];
    const g = guessUnits_(pages);
    return [g, g.length > 0];
  }

  const pageNames: Record<string, string> = {};
  pageRows.forEach((p) => {
    pageNames[String(p.page_id)] = p.name;
  });

  // จัดสรร "คนทัก" รายแอดมินตามสัดส่วน unique_inbox → ตัวเลข "แชท" + ตัวหาร %ปิดที่ตรงจอ Pancake
  const reachedByUid = allocateReached(chatRows, engRows);

  /* ---- สัดส่วน "ออเดอร์จากแชทใหม่" รายเพจ (ทีมสั่ง 2026-08-17) ----
   * ปัญหาที่ทีมจับได้: %ปิด = ออเดอร์ ÷ คนทักใหม่ — ตัวเศษนับออเดอร์จากลูกค้าเก่าที่ทักไว้เมื่อวันก่อนด้วย
   * พอเพจหยุดยิงแอด คนทักใหม่หายเกือบหมดแต่ออเดอร์จากฐานลูกค้าเดิมยังมา → %ปิดพุ่งไร้ความหมาย
   * ของจริง 15 ส.ค. เพจ Cocolly: คนทัก 862→45 แต่ออเดอร์ 316→37 (ในนั้นมาจากแชทเก่า 21 = 57%) → 84%
   * แก้: ตัดออเดอร์จากแชทเก่าออกจากตัวเศษ ให้เศษกับส่วนเป็น "ของใหม่" ทั้งคู่
   * (Pancake ให้ order_count/old_order_count ระดับเพจ — เอามาเป็นสัดส่วนแล้วคูณกับออเดอร์ของแต่ละคนในเพจนั้น)
   */
  const engOrd: Record<string, { all: number; old: number }> = {};
  engRows.forEach((e: any) => {
    const pid = String(e.page_id || '');
    if (!pid) return;
    if (!engOrd[pid]) engOrd[pid] = { all: 0, old: 0 };
    engOrd[pid].all += toNum_(e.order_count);
    engOrd[pid].old += toNum_(e.old_order_count);
  });
  /** null = เพจนี้ไม่มีข้อมูล → ไม่ลดตัวเศษ (ไม่เดา) */
  function newOrderRatioOfPage_(pid: string): number | null {
    const g = engOrd[pid];
    if (!g || g.all <= 0) return null;
    return Math.max(0, Math.min(1, (g.all - g.old) / g.all));
  }
  /** ถ่วงน้ำหนักตามจำนวนออเดอร์ที่คนนี้ขายในแต่ละเพจ — คนเดียวขายหลายเพจได้ */
  function newOrderRatioOf_(pageOrders: Record<string, number> | null | undefined): number {
    if (!pageOrders) return 1;
    let w = 0;
    let acc = 0;
    Object.keys(pageOrders).forEach((pid) => {
      const n = toNum_(pageOrders[pid]);
      if (n <= 0) return;
      const ratio = newOrderRatioOfPage_(pid);
      acc += n * (ratio === null ? 1 : ratio);   // ไม่มีข้อมูล = นับเต็มไปก่อน
      w += n;
    });
    return w > 0 ? acc / w : 1;
  }

  // ลูกค้าใหม่รวมทีม + ปริมาณลูกค้าทักรายชั่วโมง (จาก chat_hourly — ระดับเพจ ไม่มีรายแอดมิน)
  let newCustomers = 0;
  const teamHourly: number[] = [];
  for (let i = 0; i < 24; i++) teamHourly.push(0);
  nc.forEach((c: any) => {
    if (channel && platformChannel_(c.platform) !== channel) return;
    newCustomers += toNum_(c.new_customer_count);
    const h = toNum_(c.hour);
    if (h >= 0 && h <= 23) teamHourly[h] += toNum_(c.customer_inbox_count);
  });

  // แชทค้าง/รอตอบ "ตอนนี้" (24 ชม.ล่าสุด — ไม่ขึ้นกับช่วงเวลาที่เลือก) + SLA proxy
  // ใช้กติกาเดียวกับหน้า Admin Management: active = ถูกมอบหมาย, overSla = ลูกค้ารอเกินเกณฑ์
  const slaMins = appSettings.slaMins;
  const activeByName: Record<string, number> = {};
  const waitingByName: Record<string, number> = {};        // รอตอบทั้งหมด (อินบ็อกซ์ + คอมเมนต์)
  const waitingCommentByName: Record<string, number> = {}; // เฉพาะคอมเมนต์ใต้โพสต์
  const overSlaByName: Record<string, number> = {};
  let overSlaTotal = 0;
  let waitingTotal = 0;
  let waitingCommentTotal = 0;
  {
    const slaCutoff = Date.now() - slaMins * 60000;
    convRows.forEach((c: any) => {
      // เคารพ filter ช่องทางเหมือน KPI อื่นบนหน้าเดียวกัน (chat_hourly/orders กรองอยู่แล้ว)
      if (channel && platformChannel_(c.platform) !== channel) return;
      const upd = toDate_(c.updated_at);
      const isWaiting = toBool_(c.waiting);
      const isComment = isComment_(c);
      const isOverSla = isWaiting && !!upd && upd.getTime() <= slaCutoff;
      if (isOverSla) overSlaTotal++;
      if (isWaiting) {
        waitingTotal++;
        if (isComment) waitingCommentTotal++;
      }
      String(c.assignees || '').split(',').forEach((nm: string) => {
        nm = nm.trim();
        if (!nm) return;
        activeByName[nm] = (activeByName[nm] || 0) + 1;
        if (isWaiting) {
          waitingByName[nm] = (waitingByName[nm] || 0) + 1;
          if (isComment) waitingCommentByName[nm] = (waitingCommentByName[nm] || 0) + 1;
        }
        if (isOverSla) overSlaByName[nm] = (overSlaByName[nm] || 0) + 1;
      });
    });
  }

  // ยอดขายในช่วง group ตาม seller
  const bySeller: Record<string, any> = {}; // key = pos_user_id หรือ 'name:xxx'
  const revByAd: Record<string, number> = {}; // ยอดขายรวมของแต่ละแอด (ทุกแอดมิน) — ตัวหารตอนปันค่าแอด
  orders.forEach((o) => {
    if (!inRange_(o._at, r) || o._excluded) return;
    if (channel && orderChannel_(o) !== channel) return;
    const k2 = String(o.seller_id || '') || ('name:' + String(o.seller_name || o.creator_name || 'ไม่ระบุ'));
    if (!bySeller[k2]) {
      bySeller[k2] = {
        name: String(o.seller_name || o.creator_name || 'ไม่ระบุ'),
        revenue: 0, orders: 0, products: {} as Record<string, number>, pages: {} as Record<string, number>,
        // จำนวนออเดอร์แยกตาม page_id — ใช้ถ่วงน้ำหนัก "สัดส่วนออเดอร์จากแชทใหม่" ของแต่ละเพจ
        pageOrders: {} as Record<string, number>,
        adRev: {} as Record<string, number>, lastOrderAt: null as number | null,
      };
    }
    const s = bySeller[k2];
    s.revenue += o.total_price;
    s.orders++;
    const pid = String(o.page_id || '');
    if (pid) s.pageOrders[pid] = (s.pageOrders[pid] || 0) + 1;
    // ยอดที่ผูกแอดได้ — เก็บรายแอดไว้ปันค่าแอดตามสัดส่วนทีหลัง (ROAS รายคน)
    const adId = String(o.ad_id || '');
    if (adId) {
      s.adRev[adId] = (s.adRev[adId] || 0) + o.total_price;
      revByAd[adId] = (revByAd[adId] || 0) + o.total_price;
    }
    (o._items || []).forEach((it: any) => {
      if (it.name) s.products[it.name] = (s.products[it.name] || 0) + (it.qty || 1);
    });
    const pg = pageNames[String(o.page_id)] || String(o.account_name || '');
    if (pg) s.pages[pg] = (s.pages[pg] || 0) + o.total_price;
    if (!s.lastOrderAt || o._at.getTime() > s.lastOrderAt) s.lastOrderAt = o._at.getTime();
  });

  // สถิติแชทในช่วง group ตาม pancake user_id
  const chatByUser: Record<string, any> = {};
  chatRows.forEach((c) => {
    const d = toDate_(c.date);
    if (!d) return;
    const t0 = startOfDay_(d).getTime();
    if (t0 < startOfDay_(r.start).getTime() || t0 > r.end.getTime()) return;
    const uid = String(c.user_id);
    if (!chatByUser[uid]) chatByUser[uid] = { chats: 0, replies: 0, phones: 0, respWSum: 0, respWeight: 0, name: String(c.user_name || '') };
    const t = chatByUser[uid];
    const inbox = toNum_(c.inbox_count);
    // t.chats = คนทักจัดสรร (ตั้งหลังลูปจาก reachedByUid) — ไม่ใช่ unique_inbox ดิบที่นับซ้ำข้ามแอดมิน
    t.replies += inbox + toNum_(c.comment_count);
    t.phones += toNum_(c.phone_number_count);
    // avg_response_ms จริงเป็น "วินาที" — ถ่วงน้ำหนักด้วยจำนวนข้อความรายเพจ (ดู lib/api/admins.ts)
    const resp = toNum_(c.avg_response_ms);
    if (resp > 0) { const w = inbox > 0 ? inbox : 1; t.respWSum += resp * w; t.respWeight += w; }
  });
  // "แชท" = คนทักจัดสรร (new_inbox+comment ระดับเพจ กระจายตามสัดส่วน unique_inbox)
  Object.keys(chatByUser).forEach((uid) => { chatByUser[uid].chats = reachedByUid[uid] || 0; });

  function topKey(map: Record<string, number>): string {
    let best = '', bestV = -1;
    Object.keys(map).forEach((k2) => {
      if (map[k2] > bestV) { bestV = map[k2]; best = k2; }
    });
    return best;
  }

  /** รวมยอดขายจากหลาย key (posId + name) ของคนเดียวกัน */
  function mergeSales(parts: any[]) {
    if (!parts.length) return null;
    const m = {
      revenue: 0, orders: 0, products: {} as Record<string, number>, pages: {} as Record<string, number>,
      pageOrders: {} as Record<string, number>,
      adRev: {} as Record<string, number>, lastOrderAt: null as number | null,
    };
    parts.forEach((p) => {
      m.revenue += p.revenue;
      m.orders += p.orders;
      Object.keys(p.products).forEach((k2) => {
        m.products[k2] = (m.products[k2] || 0) + p.products[k2];
      });
      Object.keys(p.pages).forEach((k2) => {
        m.pages[k2] = (m.pages[k2] || 0) + p.pages[k2];
      });
      Object.keys(p.pageOrders || {}).forEach((k2) => {
        m.pageOrders[k2] = (m.pageOrders[k2] || 0) + p.pageOrders[k2];
      });
      Object.keys(p.adRev || {}).forEach((k2) => {
        m.adRev[k2] = (m.adRev[k2] || 0) + p.adRev[k2];
      });
      if (p.lastOrderAt && (!m.lastOrderAt || p.lastOrderAt > m.lastOrderAt)) m.lastOrderAt = p.lastOrderAt;
    });
    return m;
  }

  /* ================================================================
   * ต้นทุนแอดรายแอดมิน — วิธี "ค่าทักต่อคน" (ทีมกำหนด 2026-08-17)
   *
   *   ค่าทักต่อคนของยูนิต = ค่าแอดของยูนิต ÷ คนทักของยูนิต
   *   ต้นทุนแอดของแอดมิน = Σ ทุกยูนิต [ ค่าทักต่อคนของยูนิตนั้น × คนทักที่เขารับในยูนิตนั้น ]
   *   ROAS               = ยอดขายรวมของแอดมิน ÷ ต้นทุนแอดของเขา
   *
   * ทำไมคิดแยกรายยูนิต: ค่าทักต่อคนต่างกัน 2-3 เท่า (วัด 16 ส.ค. U10 ฿44 vs UN5 ฿108)
   * ถ้าใช้อัตราเดียวทั้งบริษัท คนในยูนิตที่ทักถูกจะโดนคิดต้นทุนเกินจริง (Fa Tima 1.09 vs 1.97)
   *
   * ทำไมไม่ต้องมีลิสต์ว่าใครสังกัดยูนิตไหน: ปันตาม "เพจที่เขารับแชทจริง" ไม่ใช่ตามชื่อที่ผูกไว้
   * คนควบ 2-3 ยูนิตจึงได้ต้นทุนบวกกันเองจากข้อมูล
   *
   * ตัวหารของแต่ละยูนิตใช้ "คนทักที่ปันให้แอดมินแล้ว" ไม่ใช่คนทักระดับเพจดิบ —
   * เพจที่มีคนทักแต่ไม่มีแอดมินคนไหนมีแถวแชทวันนั้น จะไม่มีใครรับต้นทุน ถ้าใช้ตัวหารดิบ
   * ค่าแอดก้อนนั้นจะหายไปเงียบๆ เหมือนบั๊กรอบก่อน
   * ================================================================ */
  const spendByAd = adSpendData ? adSpendData.byAd : null;
  const pageOfAd = adSpendData ? adSpendData.pageOfAd : ({} as Record<string, string>);

  // คนทักรายแอดมิน แยกรายเพจ (ฐานเดียวกับตัวเลข "คนทัก" ที่โชว์บนการ์ด)
  const reachByUidPage = allocateReachedByPage(chatRows, engRows);
  const UNIT_UNKNOWN = '';
  const unitKeyOfPage = (pid: string): string => unitOfPageId[pid] || UNIT_UNKNOWN;

  // คนทักที่ปันแล้ว แยกตาม (แอดมิน, ยูนิต) + ผลรวมรายยูนิต
  const reachByUidUnit: Record<string, Record<string, number>> = {};
  const reachByUnit: Record<string, number> = {};
  let reachAllocTotal = 0;
  Object.keys(reachByUidPage).forEach((uid) => {
    Object.keys(reachByUidPage[uid]).forEach((pid) => {
      const v = reachByUidPage[uid][pid];
      if (!(v > 0)) return;
      const u = unitKeyOfPage(pid);
      (reachByUidUnit[uid] = reachByUidUnit[uid] || {})[u] = ((reachByUidUnit[uid] || {})[u] || 0) + v;
      reachByUnit[u] = (reachByUnit[u] || 0) + v;
      reachAllocTotal += v;
    });
  });

  // ค่าแอดรายยูนิต — แอดที่ยังไม่รู้เพจ (page_id ว่างระหว่างวัน) ลงก้อนรวม
  const spendByUnit: Record<string, number> = {};
  let spendPool = 0;   // ก้อนที่ระบุยูนิตไม่ได้ → เฉลี่ยตามสัดส่วนคนทักรวมทั้งทีม
  if (spendByAd) {
    Object.keys(spendByAd).forEach((adId) => {
      const sp = spendByAd[adId] || 0;
      if (!(sp > 0)) return;
      const pid = pageOfAd[adId] || '';
      const u = pid ? unitKeyOfPage(pid) : UNIT_UNKNOWN;
      if (u && reachByUnit[u] > 0) spendByUnit[u] = (spendByUnit[u] || 0) + sp;
      else spendPool += sp;   // ไม่รู้ยูนิต หรือยูนิตนั้นไม่มีคนทักเลย = ปันรายยูนิตไม่ได้
    });
  }

  /**
   * ต้นทุนแอดของแอดมิน 1 คน (บาท) — ผลรวมของทุกคนจะเท่ากับค่าแอดจริงทั้งช่วงพอดี
   * คืน null เมื่อยังไม่มีข้อมูลค่าแอด (ตาราง ad_daily ยังไม่มี) → หน้าเว็บโชว์ "—" ไม่ใช่ 0
   */
  function adCostOf(uid: string): number | null {
    if (!spendByAd) return null;
    const mine = reachByUidUnit[uid];
    if (!mine) return 0;
    let cost = 0;
    let myReach = 0;
    Object.keys(mine).forEach((u) => {
      const r = mine[u];
      myReach += r;
      const sp = spendByUnit[u] || 0;
      const tot = reachByUnit[u] || 0;
      if (sp > 0 && tot > 0) cost += sp * (r / tot);
    });
    if (spendPool > 0 && reachAllocTotal > 0) cost += spendPool * (myReach / reachAllocTotal);
    return cost;
  }

  /** ก้อนตัวเลข ROAS ที่ส่งขึ้นหน้าเว็บ — ตัวตั้ง = ยอดขายรวม, ตัวหาร = ต้นทุนแอดของคนนั้น */
  function roasBlock_(uid: string, revenue: number) {
    const cost = adCostOf(uid);
    if (cost === null) return { adRevenue: Math.round(revenue), adSpend: 0, roas: null as number | null };
    return {
      adRevenue: Math.round(revenue),
      adSpend: Math.round(cost),
      // ไม่มีคนทัก = ไม่มีต้นทุนแอดรองรับยอดนี้ → ห้ามเดา ให้โชว์ "—"
      roas: (cost > 0 && revenue > 0) ? Math.round((revenue / cost) * 100) / 100 : null,
    };
  }

  // รวมเป็นแถว ranking: เริ่มจากแอดมินทุกคนในตาราง admins แล้วเติมยอด
  let rows: any[] = [];
  const usedSellerKeys: Record<string, boolean> = {};

  // กัน "seller ผี": คนที่ถูกปิดใช้งานแล้วหลุดจาก roster (ออกจากทีม) จะไม่มีแถวใน admins
  // → mark seller key จาก snapshot ใน admin_settings ไว้ก่อน ไม่ให้ยอดเก่าโผล่กลับเข้า ranking
  // (คอลัมน์ snapshot มาจาก migration v2 — ถ้ายังไม่มี query จะ error ก็ข้ามส่วนนี้ไป)
  if (!snapsRes.error) {
    (snapsRes.data || []).forEach((s: any) => {
      if (s.enabled !== false) return;
      if (s.pos_user_id) usedSellerKeys[String(s.pos_user_id)] = true;
      if (s.snap_name) usedSellerKeys['name:' + String(s.snap_name)] = true;
    });
  }

  adminRows.forEach((a) => {
    const posId = String(a.pos_user_id || '');
    const name = String(a.name || '');
    const disabled = disabledIds[String(a.user_id)] === true;
    const parts: any[] = [];
    if (posId && bySeller[posId]) {
      parts.push(bySeller[posId]);
      usedSellerKeys[posId] = true; // ต้อง mark key ที่ใช้จริง ไม่งั้นยอดโผล่ซ้ำเป็นอีกแถว
    }
    if (bySeller['name:' + name]) {
      parts.push(bySeller['name:' + name]);
      usedSellerKeys['name:' + name] = true;
    }
    if (disabled) return; // mark key แล้วค่อยข้าม — กันยอดขายของคนปิดใช้งานโผล่กลับมาเป็นแถว seller ซ้ำ
    const sale = mergeSales(parts);
    const chat = chatByUser[String(a.user_id)];
    const revenue = sale ? sale.revenue : 0;
    const nOrders = sale ? sale.orders : 0;
    const chats = chat ? chat.chats : 0;
    const newOrders = nOrders * newOrderRatioOf_(sale ? sale.pageOrders : null);
    const ad = roasBlock_(String(a.user_id), revenue);
    const nick = nicknameOf(name, nickById[String(a.user_id)]); // พิมพ์ทับ > เดาจากคำแรก
    const unitInfo = unitsFor_(String(a.user_id), name, nick, sale ? sale.pages : null);
    rows.push({
      id: String(a.user_id),
      name: name,
      nickname: nick,
      online: toBool_(a.is_online),
      revenue: Math.round(revenue),
      orders: nOrders,
      chats: chats,
      replies: chat ? chat.replies : 0,
      phones: chat ? chat.phones : 0,
      closeRate: chats ? Math.min(100, Math.round(newOrders / chats * 1000) / 10) : null,
      newOrders: Math.round(newOrders * 10) / 10,  // ออเดอร์ที่มาจากแชทใหม่ (ตัวเศษของ %ปิด)
      avgRespMins: (chat && chat.respWeight) ? Math.round(chat.respWSum / chat.respWeight / 60 * 10) / 10 : null,
      avgOrder: nOrders ? Math.round(revenue / nOrders) : 0, // "เปอร์บิล" = ยอดเฉลี่ยต่อบิล
      topProduct: sale ? topKey(sale.products) : '',
      topPage: sale ? topKey(sale.pages) : '',
      lastOrderAt: (sale && sale.lastOrderAt) ? fmtDateTime_(new Date(sale.lastOrderAt)) : '',
      productGroups: groupsById[String(a.user_id)] || '',
      units: unitInfo[0],
      unitsGuess: unitInfo[1],
      adRevenue: ad.adRevenue, // ตัวตั้งของ ROAS = ยอดขายรวมของคนนี้ (ทีมกำหนด 2026-08-17)
      adSpend: ad.adSpend,     // ต้นทุนแอด = Σ (ค่าทักต่อคนของยูนิต × คนทักที่รับในยูนิตนั้น)
      roas: ad.roas,           // null = ไม่มีคนทัก/ไม่มีค่าแอดรองรับ → หน้าเว็บโชว์ "—"
      activeNow: activeByName[name] || 0,   // แชทที่ดูแล (ถูกมอบหมาย) ตอนนี้ 24 ชม. — ไม่ขึ้นกับช่วงที่เลือก
      waitingNow: waitingByName[name] || 0, // แชทที่ลูกค้ารอตอบตอนนี้ (= "แชทค้าง" ตัวจริง)
      waitingCommentNow: waitingCommentByName[name] || 0, // ในนั้นเป็นคอมเมนต์ใต้โพสต์กี่รายการ
      overSla: overSlaByName[name] || 0,    // แชทรอเกินเกณฑ์ SLA ตอนนี้ (proxy)
    });
  });

  // seller ที่มียอดขายแต่ไม่อยู่ในตาราง admins (กันข้อมูลหาย)
  Object.keys(bySeller).forEach((k2) => {
    if (usedSellerKeys[k2]) return;
    const s = bySeller[k2];
    const ad = roasBlock_('seller:' + k2, s.revenue);
    const sNick = nicknameOf(s.name, ''); // ไม่มีแถวใน admin_settings → เดาจากคำแรกอย่างเดียว
    const sUnits = unitsFor_('', s.name, sNick, s.pages);
    rows.push({
      id: 'seller:' + k2,
      name: s.name,
      nickname: sNick,
      online: false,
      revenue: Math.round(s.revenue),
      orders: s.orders,
      chats: 0, replies: 0, phones: 0,
      closeRate: null, avgRespMins: null,
      avgOrder: s.orders ? Math.round(s.revenue / s.orders) : 0,
      topProduct: topKey(s.products),
      topPage: topKey(s.pages),
      lastOrderAt: s.lastOrderAt ? fmtDateTime_(new Date(s.lastOrderAt)) : '',
      productGroups: '',
      units: sUnits[0],
      unitsGuess: sUnits[1],
      adRevenue: ad.adRevenue,
      adSpend: ad.adSpend,
      roas: ad.roas,
      activeNow: activeByName[s.name] || 0,
      waitingNow: waitingByName[s.name] || 0,
      waitingCommentNow: waitingCommentByName[s.name] || 0,
      overSla: overSlaByName[s.name] || 0,
    });
  });

  // ตัดคนที่ไม่มีทั้งยอดขาย แชท และงานที่ถืออยู่ตอนนี้ออก (ให้เหลือรายการที่มีความหมาย)
  // activeNow ต้องนับด้วย — คนถือแชทค้าง/เกิน SLA แต่ยังไม่ตอบ/ไม่ขายวันนี้ คือคนที่ต้องเห็นที่สุด
  rows = rows.filter((x) => x.revenue > 0 || x.orders > 0 || x.chats > 0 || x.replies > 0 || x.activeNow > 0);

  // สรุปทีม (นับจากตาราง admins + settings — คนปิดใช้งานแยกช่อง ไม่นับใน online/offline)
  const team = {
    total: adminRows.length,
    disabled: adminRows.filter((a) => disabledIds[String(a.user_id)]).length,
    online: adminRows.filter((a) => !disabledIds[String(a.user_id)] && toBool_(a.is_online)).length,
    offline: adminRows.filter((a) => !disabledIds[String(a.user_id)] && !toBool_(a.is_online)).length,
  };

  return {
    rangeLabel: r.label,
    rows: rows,
    team: team,
    newCustomers: newCustomers,
    teamHourly: teamHourly,   // ลูกค้าทักรายชั่วโมง (รวมทุกวันในช่วง, กรอง channel แล้ว)
    overSlaTotal: overSlaTotal, // แชทรอเกินเกณฑ์ SLA ตอนนี้ (นับ conversation ไม่ซ้ำ)
    // แชทรอตอบตอนนี้ทั้งทีม แยกอินบ็อกซ์/คอมเมนต์ (นับ conversation ไม่ซ้ำ — รายคนบวกกันแล้วเกินได้
    // เพราะ 1 บทสนทนามอบหมายได้หลายคน)
    waitingTotal: waitingTotal,
    waitingCommentTotal: waitingCommentTotal,
    slaMins: slaMins,
    kpiTargets: kpiTargets,
    // alias ชื่อสั้น — หน้า "ผลงานของฉัน" (lib/api/me.ts) อ่าน perf.targets เพื่อวาดแถบเทียบเป้า
    // ให้ใช้เป้าชุดเดียวกับหน้า Ranking (ตั้งที่เดียว ทุกหน้าตรงกัน)
    targets: kpiTargets,
    // ยังไม่ได้รัน migration ad_daily (หรือยังไม่มี sync รอบแรก) → ROAS รายคนคิดไม่ได้ทั้งกระดาน
    adSetupNeeded: adSpendData === null,
  };
}
