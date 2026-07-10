// lib/api/sales.ts — พอร์ตจาก WebApi.gs::apiSales (อ่านจาก Sheet → อ่านจาก Postgres)
// server-side เท่านั้น: import { db, fetchAll } จาก @/lib/db
// เปลี่ยนแค่แหล่งอ่าน (readTable_ → fetchAll) + กรองช่วงเวลาใน query เพื่อเลี่ยง 1000-row cap
import { db, fetchAll } from '@/lib/db';
import {
  EXCLUDED_STATUSES,
  NEED_CHECK_STATUSES,
  BKK_OFFSET_MS,
  num,
  parsePancakeTime,
  fmtDateBkk,
  startOfDayBkk,
  daysAgo,
} from '@/lib/config';

type Row = Record<string, any>;

interface Range {
  start: Date;
  end: Date;
  prevStart: Date;
  prevEnd: Date;
  label: string;
}

/* ---------------- utilities (พอร์ตจาก WebApi.gs) ---------------- */

/** ค่าจาก DB อาจเป็น number/string — แปลงเป็นตัวเลขเสมอ (0 เมื่อ NaN) */
function toNum_(v: unknown): number {
  return num(v);
}

/** boolean column คืน true/false อยู่แล้ว แต่รองรับ string 'TRUE' ด้วย */
function toBool_(v: unknown): boolean {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

/** timestamptz เป็น ISO string / date เป็น 'YYYY-MM-DD' → Date (เวลาไทย) */
function toDate_(v: unknown): Date | null {
  if (v instanceof Date) return v;
  return parsePancakeTime(v);
}

function toDateStr_(v: unknown): string {
  const d = toDate_(v);
  return d ? fmtDateBkk(d) : '';
}

/** ชั่วโมงของวัน (0-23) ตามเวลาไทย — แทน Date.getHours() เดิม (GAS รันบนโซนไทย) */
function bkkHour_(d: Date): number {
  return new Date(d.getTime() + BKK_OFFSET_MS).getUTCHours();
}

/**
 * platform string → กลุ่มช่องทาง 'facebook' | 'line' | 'other'
 * ใช้กติกาเดียวกันทุกหน้า (facebook รวม instagram/messenger)
 */
function platformChannel_(pf: unknown): string {
  const s = String(pf || '').toLowerCase();
  if (s === 'line') return 'line';
  if (s === 'facebook' || s === 'instagram' || s === 'messenger') return 'facebook';
  return s ? 'other' : 'facebook';
}

/** platform ของออเดอร์ → 'facebook' | 'line' | 'other' */
function orderChannel_(o: Row): string {
  return platformChannel_(o.platform);
}

function pctChange_(cur: number, prev: number): number | null {
  if (!prev) return null;
  return Math.round(((cur - prev) / prev) * 1000) / 10;
}

function inRange_(d: Date | null, r: Range): boolean {
  return !!d && d.getTime() >= r.start.getTime() && d.getTime() <= r.end.getTime();
}

function inPrevRange_(d: Date | null, r: Range): boolean {
  return !!d && d.getTime() >= r.prevStart.getTime() && d.getTime() < r.prevEnd.getTime();
}

/** cutoff 24 ชม. สำหรับข้อมูลบทสนทนา */
function convCutoff_(): number {
  return Date.now() - 24 * 3600 * 1000;
}

/**
 * แปลง params ช่วงเวลา → {start, end, prevStart, prevEnd, label}
 * preset: today | 7d | 30d | month | custom (from/to = 'yyyy-MM-dd')
 */
function resolveRange_(params: any): Range {
  const p = params || {};
  const now = new Date();
  let start: Date;
  let end: Date = now;
  let label: string;
  switch (p.preset || 'today') {
    case '7d':
      start = daysAgo(6);
      label = '7 วันล่าสุด';
      break;
    case '30d':
      start = daysAgo(29);
      label = '30 วันล่าสุด';
      break;
    case 'month': {
      const ymd = fmtDateBkk(now); // YYYY-MM-DD (ไทย)
      start = new Date(`${ymd.slice(0, 7)}-01T00:00:00+07:00`);
      label = 'เดือนนี้';
      break;
    }
    case 'custom':
      start = parsePancakeTime((p.from || fmtDateBkk(now)) + 'T00:00:00') as Date;
      end = parsePancakeTime((p.to || fmtDateBkk(now)) + 'T23:59:59') as Date;
      if (end.getTime() > now.getTime()) end = now;
      label = (p.from || '') + ' ถึง ' + (p.to || '');
      break;
    default: // today
      start = startOfDayBkk(now);
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

/* ---------------- โหลดออเดอร์ (เฉพาะช่วงที่ต้องใช้) ---------------- */

/**
 * อ่านออเดอร์จาก Postgres แปลงชนิดข้อมูลให้พร้อมใช้ (แถวละ object)
 * กรอง inserted_at >= prevStart เพื่อลดจำนวนแถว (cur/prev/today อยู่ในช่วงนี้ทั้งหมด)
 */
async function loadOrders_(sinceIso: string): Promise<Row[]> {
  const rows = await fetchAll<Row>(() =>
    db
      .from('orders')
      .select('inserted_at,status,status_name,total_price,customer_id,ad_id,platform')
      .gte('inserted_at', sinceIso)
  );
  return rows
    .map((o) => {
      o._at = toDate_(o.inserted_at);
      o.status = toNum_(o.status);
      o.total_price = toNum_(o.total_price);
      o._excluded = EXCLUDED_STATUSES.indexOf(o.status) >= 0;
      o._needCheck = NEED_CHECK_STATUSES.indexOf(o.status) >= 0;
      return o;
    })
    .filter((o) => o._at);
}

/* ================================================================
 * apiSales
 * ================================================================ */

export async function apiSales(params: any) {
  const r = resolveRange_(params);
  const channel = (params && params.channel) || '';
  const compare = (params && params.compare) !== 'none';

  // orders ทั้งหมดที่อาจใช้อยู่ในช่วง [prevStart, now] → กรองที่ query
  const orders = await loadOrders_(r.prevStart.toISOString());

  function matchChannel(o: Row): boolean {
    return !channel || orderChannel_(o) === channel;
  }

  const cur = orders.filter((o) => inRange_(o._at, r) && !o._excluded);
  const prev = orders.filter((o) => inPrevRange_(o._at, r) && !o._excluded);
  const curCh = cur.filter(matchChannel);
  const prevCh = prev.filter(matchChannel);

  function summarize(list: Row[]) {
    const s: any = { revenue: 0, orders: list.length, customers: {}, needCheck: 0, adRevenue: 0 };
    list.forEach((o) => {
      s.revenue += o.total_price;
      if (o.customer_id) s.customers[o.customer_id] = 1;
      if (o._needCheck) s.needCheck++;
      if (o.ad_id) s.adRevenue += o.total_price;
    });
    s.customers = Object.keys(s.customers).length;
    return s;
  }

  const sCur = summarize(curCh);
  const sPrev = summarize(prevCh);

  // channel boxes (ไม่สน channel filter — โชว์ทั้ง 3 เสมอ)
  function chanSummary(ch: string) {
    const list = ch ? cur.filter((o) => orderChannel_(o) === ch) : cur;
    const listPrev = ch ? prev.filter((o) => orderChannel_(o) === ch) : prev;
    const s = summarize(list);
    const sp = summarize(listPrev);
    return {
      revenue: s.revenue,
      orders: s.orders,
      customers: s.customers,
      trend: compare ? pctChange_(s.revenue, sp.revenue) : null,
    };
  }

  // ยอดขายรายชั่วโมง (รวมทุกวันในช่วง bucket ตามชั่วโมงของวัน)
  function hourlyBuckets(list: Row[]): number[] {
    const h: number[] = [];
    for (let i = 0; i < 24; i++) h.push(0);
    list.forEach((o) => {
      h[bkkHour_(o._at)] += o.total_price;
    });
    return h.map((v) => Math.round(v));
  }

  // สถิติแชท (ตัวหาร closeRate) — chat_hourly เกิน 1000 แถวได้ → fetchAll + กรอง date
  const todayStr = fmtDateBkk(new Date());
  const chatSince = fmtDateBkk(r.start) < todayStr ? fmtDateBkk(r.start) : todayStr;
  const chatRows = await fetchAll<Row>(() =>
    db
      .from('chat_hourly')
      .select('date,platform,new_inbox_count,new_customer_count')
      .gte('date', chatSince),
    'key'
  );
  let newConvs = 0;
  const newConvsByCh: Record<string, number> = { facebook: 0, line: 0, other: 0 };
  let todayNewCust = 0;
  chatRows.forEach((c) => {
    const d = toDate_(c.date);
    if (!d) return;
    const dayStart = startOfDayBkk(d).getTime();
    if (dayStart >= startOfDayBkk(r.start).getTime() && dayStart <= r.end.getTime()) {
      const n = toNum_(c.new_inbox_count);
      newConvs += n;
      newConvsByCh[platformChannel_(c.platform)] += n;
    }
    if (toDateStr_(c.date) === todayStr) todayNewCust += toNum_(c.new_customer_count);
  });
  // ตัวหารของ % ปิดการขายต้องกรอง channel ให้ตรงกับตัวตั้ง (ออเดอร์)
  const convBase = channel ? newConvsByCh[channel] || 0 : newConvs;
  const closeRate = convBase ? Math.min(100, Math.round((sCur.orders / convBase) * 1000) / 10) : null;

  // แผงข้อมูลวันนี้ (ไม่สนฟิลเตอร์)
  const todayRange = resolveRange_({ preset: 'today' });
  const todayOrders = orders.filter((o) => inRange_(o._at, todayRange) && !o._excluded);
  const sToday = summarize(todayOrders);
  let todayFb = 0;
  let todayLine = 0;
  let todayNeedCheck = 0;
  todayOrders.forEach((o) => {
    const ch = orderChannel_(o);
    if (ch === 'line') todayLine += o.total_price;
    else if (ch === 'facebook') todayFb += o.total_price;
    if (o._needCheck) todayNeedCheck++;
  });

  // แหล่งที่มา FB / LINE / อื่นๆ
  const sources = (['facebook', 'line', 'other'] as const)
    .map((ch) => {
      const list = cur.filter((o) => orderChannel_(o) === ch);
      const s = summarize(list);
      const cRate = newConvsByCh[ch]
        ? Math.min(100, Math.round((s.orders / newConvsByCh[ch]) * 1000) / 10)
        : null;
      let status;
      if (!s.orders) status = { label: '—', cls: 'neutral' };
      else if (cRate !== null && cRate >= 20) status = { label: '✅ ดี', cls: 'ai' };
      else if (cRate !== null && cRate < 5) status = { label: '🛠 ต้องปรับ', cls: 'admin' };
      else status = { label: '👀 เฝ้าดู', cls: 'info' };
      return {
        key: ch,
        label: ch === 'facebook' ? '📘 Facebook' : ch === 'line' ? '🟢 LINE OA' : '🌐 อื่นๆ',
        revenue: Math.round(s.revenue),
        orders: s.orders,
        customers: s.customers,
        closeRate: cRate,
        status: status,
      };
    })
    .filter((s) => s.key !== 'other' || s.orders > 0);

  // สถานะออเดอร์ในช่วง (รวมที่ถูก exclude ด้วย เพื่อให้เห็นยกเลิก/ตีกลับ)
  const statusCount: Record<string, number> = {};
  orders
    .filter((o) => inRange_(o._at, r) && matchChannel(o))
    .forEach((o) => {
      const nm = String(o.status_name || o.status);
      statusCount[nm] = (statusCount[nm] || 0) + 1;
    });

  // แจ้งเตือน
  const alerts: any[] = [];
  if (todayNeedCheck > 0) {
    alerts.push({
      icon: '🧾',
      title: 'ออเดอร์รอตรวจ/รอยืนยัน',
      reason: 'วันนี้มี ' + todayNeedCheck + ' ออเดอร์ที่ยังไม่ยืนยัน',
      level: 'orange',
      view: 'sales',
    });
  }
  const alertCutoff = convCutoff_();
  // conversations เกิน 1000 แถวได้ → กรอง waiting + updated_at >= cutoff ที่ query แล้วนับ
  const cutoffIso = new Date(alertCutoff).toISOString();
  const waitingRows = await fetchAll<Row>(() =>
    db.from('conversations').select('id').eq('waiting', true).gte('updated_at', cutoffIso)
  );
  const waitingConvs = waitingRows.length;
  if (waitingConvs >= 10) {
    alerts.push({
      icon: '💬',
      title: 'แชทค้างรอตอบเยอะ',
      reason: 'มี ' + waitingConvs + ' บทสนทนาที่ลูกค้ารอการตอบกลับ',
      level: 'red',
      view: 'dashboard',
    });
  } else if (waitingConvs > 0) {
    alerts.push({
      icon: '💬',
      title: 'แชทรอตอบ',
      reason: 'มี ' + waitingConvs + ' บทสนทนารอการตอบกลับ',
      level: 'yellow',
      view: 'dashboard',
    });
  }
  const ads = await fetchAll<Row>(() =>
    db.from('ads').select('effective_status,spend,order_created,name'),
    'ad_id'
  );
  const badAds = ads.filter((a) => {
    return (
      String(a.effective_status).toUpperCase() === 'ACTIVE' &&
      toNum_(a.spend) > 800 &&
      toNum_(a.order_created) === 0
    );
  });
  if (badAds.length) {
    alerts.push({
      icon: '🕳',
      title: 'แอดจ่ายแล้วไม่มีออเดอร์',
      reason:
        badAds.length +
        ' แอดใช้เงิน >800 แต่ยังไม่มีออเดอร์ เช่น "' +
        String(badAds[0].name).slice(0, 40) +
        '"',
      level: 'red',
      view: 'contentads',
    });
  }

  return {
    rangeLabel: r.label,
    kpis: {
      revenue: Math.round(sCur.revenue),
      orders: sCur.orders,
      customers: sCur.customers,
      avgOrder: sCur.orders ? Math.round(sCur.revenue / sCur.orders) : 0,
      needCheck: sCur.needCheck,
      adRevenue: Math.round(sCur.adRevenue),
      closeRate: closeRate,
      newConvs: convBase,
    },
    trends: {
      revenue: compare ? pctChange_(sCur.revenue, sPrev.revenue) : null,
      orders: compare ? pctChange_(sCur.orders, sPrev.orders) : null,
    },
    channels: {
      all: chanSummary(''),
      facebook: chanSummary('facebook'),
      line: chanSummary('line'),
    },
    hourly: hourlyBuckets(curCh),
    hourlyPrev: compare ? hourlyBuckets(prevCh) : null,
    today: {
      revenue: Math.round(sToday.revenue),
      orders: sToday.orders,
      fb: Math.round(todayFb),
      line: Math.round(todayLine),
      newCust: todayNewCust,
      needCheck: todayNeedCheck,
      hourly: hourlyBuckets(todayOrders),
    },
    sources: sources,
    statusBreakdown: Object.keys(statusCount)
      .map((nm) => {
        return { name: nm, count: statusCount[nm] };
      })
      .sort((a, b) => b.count - a.count),
    alerts: alerts.slice(0, 3),
  };
}
