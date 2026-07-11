// lib/api/adminperf.ts — พอร์ตจาก WebApi.gs apiAdminPerf
// อ่านจาก Postgres (Supabase) แทน Google Sheet — logic รวมยอดตรงกับของเดิม
import { db, fetchAll } from '@/lib/db';
import {
  EXCLUDED_STATUSES,
  fmtDateBkk,
  fmtDateTimeBkk,
  parsePancakeTime,
  startOfDayBkk,
} from '@/lib/config';

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
 * preset: today | 7d | 30d | month | custom (from/to = 'yyyy-MM-dd')
 */
function resolveRange_(params: any) {
  const p = params || {};
  const now = new Date();
  let start: Date, end: Date = now, label: string;
  switch (p.preset || 'today') {
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
  return {
    start,
    end,
    prevStart: new Date(start.getTime() - span),
    prevEnd: new Date(start.getTime()),
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

/** อ่านออเดอร์ในช่วง แปลงชนิดข้อมูลให้พร้อมใช้ (กรองช่วงเวลาที่ query แล้ว) */
async function loadOrders_(r: { start: Date; end: Date }) {
  const rows = await fetchAll<any>(() =>
    db
      .from('orders')
      .select('inserted_at,status,total_price,platform,seller_id,seller_name,creator_name,items_json,page_id,account_name')
      .gte('inserted_at', r.start.toISOString())
      .lte('inserted_at', r.end.toISOString())
  );
  return rows
    .map((o) => {
      o._at = toDate_(o.inserted_at);
      o.status = toNum_(o.status);
      o.total_price = toNum_(o.total_price);
      o._excluded = EXCLUDED_STATUSES.indexOf(o.status) >= 0;
      return o;
    })
    .filter((o) => o._at);
}

/* ---------------- API ---------------- */

export async function apiAdminPerf(params: any) {
  const r = resolveRange_(params);
  const channel = (params && params.channel) || '';

  const orders = await loadOrders_(r);

  const adminRows = await fetchAll<any>(() =>
    db.from('admins').select('user_id,pos_user_id,name,is_online'),
    'user_id'
  );

  // คนที่ถูก "ปิดใช้งาน" ในหน้า Admin Management → ไม่เข้า ranking
  // (ตาราง admin_settings อาจยังไม่ถูกสร้าง → ถือว่าเปิดใช้งานทุกคน)
  const disabledIds: Record<string, boolean> = {};
  try {
    const { data: st } = await db.from('admin_settings').select('user_id,enabled');
    (st || []).forEach((s: any) => { if (s.enabled === false) disabledIds[String(s.user_id)] = true; });
  } catch { /* ยังไม่มีตาราง */ }

  const pageNames: Record<string, string> = {};
  const pageRows = await fetchAll<any>(() => db.from('pages').select('page_id,name'), 'page_id');
  pageRows.forEach((p) => {
    pageNames[String(p.page_id)] = p.name;
  });

  // สถิติแชทในช่วง (กรอง date ที่ query แล้ว)
  const chatFrom = fmtDateBkk(r.start);
  const chatTo = fmtDateBkk(r.end);
  const chatRows = await fetchAll<any>(() =>
    db
      .from('admin_chat_daily')
      .select('date,user_id,user_name,unique_inbox_count,inbox_count,comment_count,phone_number_count,avg_response_ms')
      .gte('date', chatFrom)
      .lte('date', chatTo),
    'key'
  );

  // ลูกค้าใหม่รวมทีมในช่วง (จาก chat_hourly — ระดับเพจ ไม่มีรายแอดมิน)
  // ไม่ catch: ตาราง chat_hourly มีแน่นอน — error จริง (503/timeout) ต้องดังให้หน้าเว็บโชว์ retry
  // ไม่ใช่แสดง "0" เนียนๆ เหมือนเป็นข้อมูลจริง
  let newCustomers = 0;
  const nc = await fetchAll<any>(() =>
    db.from('chat_hourly').select('date,new_customer_count').gte('date', chatFrom).lte('date', chatTo),
    'key'
  );
  nc.forEach((c: any) => { newCustomers += toNum_(c.new_customer_count); });

  // ยอดขายในช่วง group ตาม seller
  const bySeller: Record<string, any> = {}; // key = pos_user_id หรือ 'name:xxx'
  orders.forEach((o) => {
    if (!inRange_(o._at, r) || o._excluded) return;
    if (channel && orderChannel_(o) !== channel) return;
    const k2 = String(o.seller_id || '') || ('name:' + String(o.seller_name || o.creator_name || 'ไม่ระบุ'));
    if (!bySeller[k2]) {
      bySeller[k2] = {
        name: String(o.seller_name || o.creator_name || 'ไม่ระบุ'),
        revenue: 0, orders: 0, products: {} as Record<string, number>, pages: {} as Record<string, number>, lastOrderAt: null as number | null,
      };
    }
    const s = bySeller[k2];
    s.revenue += o.total_price;
    s.orders++;
    try {
      parseItems_(o.items_json).forEach((it: any) => {
        if (it.name) s.products[it.name] = (s.products[it.name] || 0) + (it.qty || 1);
      });
    } catch (e) {}
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
    if (!chatByUser[uid]) chatByUser[uid] = { chats: 0, replies: 0, phones: 0, respSum: 0, respN: 0, name: String(c.user_name || '') };
    const t = chatByUser[uid];
    t.chats += toNum_(c.unique_inbox_count);
    t.replies += toNum_(c.inbox_count) + toNum_(c.comment_count);
    t.phones += toNum_(c.phone_number_count);
    const resp = toNum_(c.avg_response_ms);
    if (resp > 0) { t.respSum += resp; t.respN++; }
  });

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
    const m = { revenue: 0, orders: 0, products: {} as Record<string, number>, pages: {} as Record<string, number>, lastOrderAt: null as number | null };
    parts.forEach((p) => {
      m.revenue += p.revenue;
      m.orders += p.orders;
      Object.keys(p.products).forEach((k2) => {
        m.products[k2] = (m.products[k2] || 0) + p.products[k2];
      });
      Object.keys(p.pages).forEach((k2) => {
        m.pages[k2] = (m.pages[k2] || 0) + p.pages[k2];
      });
      if (p.lastOrderAt && (!m.lastOrderAt || p.lastOrderAt > m.lastOrderAt)) m.lastOrderAt = p.lastOrderAt;
    });
    return m;
  }

  // รวมเป็นแถว ranking: เริ่มจากแอดมินทุกคนในตาราง admins แล้วเติมยอด
  let rows: any[] = [];
  const usedSellerKeys: Record<string, boolean> = {};

  // กัน "seller ผี": คนที่ถูกปิดใช้งานแล้วหลุดจาก roster (ออกจากทีม) จะไม่มีแถวใน admins
  // → mark seller key จาก snapshot ใน admin_settings ไว้ก่อน ไม่ให้ยอดเก่าโผล่กลับเข้า ranking
  // (คอลัมน์ snapshot มาจาก migration v2 — ถ้ายังไม่มี query จะ error ก็ข้ามส่วนนี้ไป)
  {
    const { data: snaps, error } = await db
      .from('admin_settings')
      .select('user_id,enabled,pos_user_id,snap_name');
    if (!error) {
      (snaps || []).forEach((s: any) => {
        if (s.enabled !== false) return;
        if (s.pos_user_id) usedSellerKeys[String(s.pos_user_id)] = true;
        if (s.snap_name) usedSellerKeys['name:' + String(s.snap_name)] = true;
      });
    }
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
    rows.push({
      id: String(a.user_id),
      name: name,
      online: toBool_(a.is_online),
      revenue: Math.round(revenue),
      orders: nOrders,
      chats: chats,
      replies: chat ? chat.replies : 0,
      phones: chat ? chat.phones : 0,
      closeRate: chats ? Math.min(100, Math.round(nOrders / chats * 1000) / 10) : null,
      avgRespMins: (chat && chat.respN) ? Math.round(chat.respSum / chat.respN / 60000 * 10) / 10 : null,
      avgOrder: nOrders ? Math.round(revenue / nOrders) : 0,
      topProduct: sale ? topKey(sale.products) : '',
      topPage: sale ? topKey(sale.pages) : '',
      lastOrderAt: (sale && sale.lastOrderAt) ? fmtDateTime_(new Date(sale.lastOrderAt)) : '',
    });
  });

  // seller ที่มียอดขายแต่ไม่อยู่ในตาราง admins (กันข้อมูลหาย)
  Object.keys(bySeller).forEach((k2) => {
    if (usedSellerKeys[k2]) return;
    const s = bySeller[k2];
    rows.push({
      id: 'seller:' + k2,
      name: s.name,
      online: false,
      revenue: Math.round(s.revenue),
      orders: s.orders,
      chats: 0, replies: 0, phones: 0,
      closeRate: null, avgRespMins: null,
      avgOrder: s.orders ? Math.round(s.revenue / s.orders) : 0,
      topProduct: topKey(s.products),
      topPage: topKey(s.pages),
      lastOrderAt: s.lastOrderAt ? fmtDateTime_(new Date(s.lastOrderAt)) : '',
    });
  });

  // ตัดคนที่ไม่มีทั้งยอดขายและแชทออก (ให้เหลือรายการที่มีความหมาย)
  rows = rows.filter((x) => x.revenue > 0 || x.orders > 0 || x.chats > 0 || x.replies > 0);

  // สรุปทีม (นับจากตาราง admins + settings — คนปิดใช้งานแยกช่อง ไม่นับใน online/offline)
  const team = {
    total: adminRows.length,
    disabled: adminRows.filter((a) => disabledIds[String(a.user_id)]).length,
    online: adminRows.filter((a) => !disabledIds[String(a.user_id)] && toBool_(a.is_online)).length,
    offline: adminRows.filter((a) => !disabledIds[String(a.user_id)] && !toBool_(a.is_online)).length,
  };

  return { rangeLabel: r.label, rows: rows, team: team, newCustomers: newCustomers };
}
