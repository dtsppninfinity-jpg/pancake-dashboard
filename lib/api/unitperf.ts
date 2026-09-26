// lib/api/unitperf.ts — หน้า "🎯 ผลงานราย Unit" (พีสั่ง 21 ก.ย. 2569)
//
// การ์ดใบละยูนิต: ยอดเดือนนี้ vs เป้า · คาดการณ์สิ้นเดือน · สัญญาณเตือนที่ระบบตรวจเจอ · จัดอันดับความเสี่ยง
//
// ที่มาของตัวเลข (ทุกก้อนรวมมาแล้วฝั่ง Postgres หรือเป็นตารางเล็ก — หน้านี้อ่านทั้งเดือน)
//   ยอดขาย/ออเดอร์  RPC sales_daily_by_page  (กติกาเดียวกับหน้า Sales เป๊ะ — ดู db/migrations/2026-09-21-sales-daily-by-page.sql)
//   ค่าแอด          RPC ads_daily_by_page    (ad_daily ทั้งเดือน = ~110,000 แถว ห้ามลากดิบ)
//   คนทัก           ฐาน Meta จาก ads_daily_by_page (ถอยไป chat_engagement_daily ถ้า Meta ไม่ครบ)
//                   — ตัวหารเดียวกับ %ปิด หน้า Sales เสมอ ห้ามให้สองหน้าใช้คนละฐาน
//   กำไร            unit_daily.profit จากชีทสรุปรายสินค้า (แหล่งเดียวกับหน้า กำไร & ตีกลับ)
//   ขาดทุนต่อเนื่อง  sync_state 'unit_loss_alerts' (งาน sync คำนวณวันละครั้ง — กติกาเดียวกับการ์ด 🚨 หน้า Sales)
//   เป้าเดือน        sync_state 'unit_goals' (ชีท KPI แท็บ เป้ายอดขาย)
import { db, fetchAll } from '@/lib/db';
import { getUMapDoc, getPageUnitMap } from '@/lib/api/umap';
import { EXCLUDED_STATUSES, NEED_CHECK_STATUSES, money_, UNIT_CLOSE_TARGET, DATA_START_YMD } from '@/lib/config';

const num_ = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

const BKK_MS = 7 * 3600 * 1000;
const ymdBkk_ = (d: Date): string => new Date(d.getTime() + BKK_MS).toISOString().slice(0, 10);
const ymdShift_ = (ymd: string, n: number): string => {
  const d = new Date(ymd + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const bkkDayIso_ = (ymd: string): string => new Date(ymd + 'T00:00:00+07:00').toISOString();

/** ไม่มีฟังก์ชันในฐานข้อมูล (ยังไม่ได้รัน migration) ≠ มีแต่รอบนี้ล้ม — คนละข้อความบนจอ */
function isMissingFunction_(err: any): boolean {
  const code = String((err && err.code) || '');
  const msg = String((err && err.message) || err || '');
  return code === 'PGRST202' || /schema cache|does not exist|could not find the function/i.test(msg);
}

interface RpcResult { rows: any[] | null; failed: 'migration' | 'error' | null }

/**
 * PostgREST ตัดผลลัพธ์ทุกคิวรีที่ 1,000 แถว รวม RPC — ต้องแบ่งหน้าเองพร้อม order ที่ไม่กำกวม
 * (ไม่งั้นได้ข้อมูลครึ่งเดียวแบบเงียบๆ — เคยเกิดจริงกับตารางรายวัน 21 ก.ย.)
 * พลาดชั่วคราว (ตอบช้า/เน็ตสะดุด) ลองซ้ำอีกครั้งก่อนยอมแพ้ ไม่งั้นทั้งหน้าหายเพราะสะดุดรอบเดียว
 */
async function rpcAll_(fn: string, args: any, orderCols: string[]): Promise<RpcResult> {
  const PAGE = 1000;
  const out: any[] = [];
  for (let off = 0; off <= 100000; off += PAGE) {
    let lastErr: any = null;
    let got: any[] | null = null;
    for (let attempt = 0; attempt < 2 && got === null; attempt++) {
      let q: any = db.rpc(fn, args);
      orderCols.forEach((c) => { q = q.order(c, { ascending: true }); });
      const { data, error } = await q.range(off, off + PAGE - 1).abortSignal(AbortSignal.timeout(30_000));
      if (error) {
        lastErr = error;
        if (isMissingFunction_(error)) return { rows: null, failed: 'migration' };
        continue;
      }
      got = (data || []) as any[];
    }
    if (got === null) return { rows: null, failed: isMissingFunction_(lastErr) ? 'migration' : 'error' };
    out.push(...got);
    if (got.length < PAGE) break;
  }
  return { rows: out, failed: null };
}

// pBase = คนทักฝั่ง Pancake (customer_engagements) · mBase = ฝั่ง Meta (first_reply + comment)
// เก็บทั้งคู่เสมอ แล้วค่อยเลือกตอนรวมยอด — ดู metaOk ด้านล่าง (กติกาเดียวกับหน้า Sales)
interface Daily { rev: number; orders: number; spend: number; pBase: number; mBase: number; profit: number | null }

const emptyDay_ = (): Daily => ({ rev: 0, orders: 0, spend: 0, pBase: 0, mBase: 0, profit: null });

export async function apiUnitPerf(params: any) {
  const p = params || {};
  const todayYmd = ymdBkk_(new Date());
  const month = /^\d{4}-\d{2}$/.test(String(p.month || '')) ? String(p.month) : todayYmd.slice(0, 7);
  const year = Number(month.slice(0, 4));
  const mon = Number(month.slice(5, 7));
  const daysInMonth = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const monthStart = month + '-01';
  const monthEnd = month + '-' + String(daysInMonth).padStart(2, '0');
  const isCurrentMonth = month === todayYmd.slice(0, 7);
  // เดือนปัจจุบันตัดที่ "วันนี้" — วันในอนาคตไม่มีข้อมูล และต้องไม่ถูกนับเป็นวันที่ผ่านไปแล้ว
  const lastYmd = isCurrentMonth ? todayYmd : monthEnd;
  const daysElapsed = Number(lastYmd.slice(8, 10));
  // วันนี้ยังเดินอยู่ ห้ามนับเป็นวันเต็มในตัวหารของคาดการณ์ (ไม่งั้นคาดการณ์ต่ำกว่าจริงทั้งวัน
  // และเพี้ยนสุดตอนเช้า) — เดือนที่จบแล้วนับครบทุกวัน
  const daysDone = isCurrentMonth ? daysElapsed - 1 : daysInMonth;
  // วันสุดท้ายที่ "จบแล้ว" ของเดือนที่เลือก — ใช้เป็นจุดตั้งต้นของสตรีคทุกตัว
  const lastDoneYmd = isCurrentMonth ? ymdShift_(todayYmd, -1) : monthEnd;
  // ออเดอร์จริงเริ่ม 23 พ.ค. 69 — เดือนก่อนหน้านั้นไม่ใช่ "ขายไม่ได้" แต่คือไม่มีข้อมูล
  const beforeData = monthEnd < DATA_START_YMD;

  /* ---- แผนที่เพจ → ยูนิต + จำนวนเพจ/แอดมินต่อยูนิต ---- */
  const [pageUnit, doc, pagesRows] = await Promise.all([
    getPageUnitMap().catch(() => ({} as Record<string, { u: string; product: string }>)),
    getUMapDoc().catch(() => ({ units: [] as any[], updatedAt: '' })),
    fetchAll<any>(() => db.from('pages').select('page_id,platform'), 'page_id').catch(() => [] as any[]),
  ]);
  const platformOf: Record<string, string> = {};
  pagesRows.forEach((r) => { platformOf[String(r.page_id)] = String(r.platform || '').toLowerCase(); });
  const UNMAPPED = '__none__';
  const unitOfPage = (pid: string): string => {
    const um = pageUnit[String(pid || '')];
    return um ? um.u : UNMAPPED;
  };

  const meta: Record<string, { product: string; pages: number; admins: number; breakEven: number; breakEvenSet: boolean; note: string }> = {};
  (doc.units || []).forEach((u: any) => {
    meta[u.u] = {
      product: String(u.product || ''),
      pages: (u.pages || []).length,
      admins: (u.admins || []).length,
      // 0 = ทีมยังไม่ได้ตั้งจุดคุ้มทุนของยูนิตนี้ — ใช้ 1x เป็นค่าเริ่มต้นแต่ต้องบอกบนจอว่าเป็นค่าเริ่มต้น
      breakEven: Math.max(0, num_(u.breakEven)) || 1,   // กันค่าติดลบจากชีทมาพลิกเกณฑ์สี
      breakEvenSet: num_(u.breakEven) > 0,
      note: String(u.note || ''),
    };
  });

  /* ---- ยอดขาย/ออเดอร์ รายวันต่อเพจ (กติกาเดียวกับหน้า Sales) ---- */
  const salesRes = await rpcAll_('sales_daily_by_page', {
    p_from: bkkDayIso_(monthStart),
    p_to: bkkDayIso_(ymdShift_(lastYmd, 1)),
    p_excluded: EXCLUDED_STATUSES,
    p_needcheck: NEED_CHECK_STATUSES,
  }, ['d', 'page_id', 'channel']);
  const salesRows = salesRes.rows;

  /* ---- ค่าแอดรายวันต่อเพจ ---- */
  const adsRes = await rpcAll_('ads_daily_by_page', { p_from: monthStart, p_to: lastYmd }, ['d', 'page_id']);
  const adsRows = adsRes.rows;

  /* ---- คนทักรายวันต่อเพจ (เฉพาะเพจ Facebook — ตัวหารเดียวกับ %ปิด หน้า Sales) ---- */
  const engRows = await fetchAll<any>(
    () => db.from('chat_engagement_daily').select('key,date,page_id,new_inbox,comment')
      .gte('date', monthStart).lte('date', lastYmd),
    'key',
  ).catch(() => [] as any[]);

  /* ---- กำไรรายวันต่อยูนิต (ชีท) ---- */
  const profitRows = await fetchAll<any>(
    () => db.from('unit_daily').select('key,u,date,profit').gte('date', monthStart).lte('date', lastYmd),
    'key',
  ).catch(() => [] as any[]);

  /* ---- ขาดทุนต่อเนื่อง (งาน sync คำนวณไว้แล้ว) ---- */
  const lossAlerts = await (async () => {
    try {
      const { data } = await db.from('sync_state').select('value').eq('key', 'unit_loss_alerts').maybeSingle();
      if (!data || !data.value) return null;
      const j = JSON.parse(String(data.value));
      const byU: Record<string, any> = {};
      (j.alerts || []).forEach((a: any) => { byU[String(a.u)] = a; });
      return { throughDate: String(j.throughDate || ''), byU };
    } catch { return null; }
  })();

  /* ---- เป้าเดือนจากชีท KPI ---- */
  const goals = await (async () => {
    try {
      const { data } = await db.from('sync_state').select('value').eq('key', 'unit_goals').maybeSingle();
      if (!data || !data.value) return null;
      const g = JSON.parse(String(data.value));
      return { year: num_(g.year), sheetId: String(g.sheetId || ''), targets: g.targets || {} as Record<string, number[]> };
    } catch { return null; }
  })();
  const monthTargetOf = (u: string): number => {
    if (!goals || goals.year !== year) return 0;
    return num_((goals.targets[u] || [])[mon - 1]);
  };

  /* ---- ประกอบเป็น ยูนิต × วัน ---- */
  const byUnit: Record<string, Record<string, Daily>> = {};
  const touch = (u: string, ymd: string): Daily => {
    const m = byUnit[u] = byUnit[u] || {};
    return m[ymd] = m[ymd] || emptyDay_();
  };
  (salesRows || []).forEach((r) => {
    const ymd = String(r.d || '').slice(0, 10);
    if (!ymd) return;
    const c = touch(unitOfPage(r.page_id), ymd);
    c.rev += money_(r.revenue);
    c.orders += num_(r.orders);
  });
  // ตัวเลข Meta รายวันทั้งบริษัท — ใช้ตัดสินว่าเดือนนี้มีข้อมูล Meta ครบทุกวันที่ยิงแอดไหม
  const dayTot: Record<string, { spend: number; metaBase: number; pancakeBase: number }> = {};
  const touchDay_ = (ymd: string) => (dayTot[ymd] = dayTot[ymd] || { spend: 0, metaBase: 0, pancakeBase: 0 });
  (adsRows || []).forEach((r) => {
    const ymd = String(r.d || '').slice(0, 10);
    if (!ymd) return;
    const spend = num_(r.spend);
    // RPC รุ่นเก่ายังไม่คืน 2 คอลัมน์นี้ (ต้องรัน migration 2026-09-26) → undefined = 0 = ถอยไป Pancake เอง
    const mBase = num_((r as any).meta_first_replies) + num_((r as any).meta_comments);
    const c = touch(unitOfPage(r.page_id), ymd);
    c.spend += spend;                                           // ad_daily.spend เป็นบาทจริง ห้ามหาร 100
    c.mBase += mBase;
    const dd = touchDay_(ymd); dd.spend += spend; dd.metaBase += mBase;
  });
  engRows.forEach((r) => {
    const pid = String(r.page_id || '');
    if (platformOf[pid] === 'line') return;                     // ตัวหาร %ปิด นับเฉพาะเพจ Facebook
    const ymd = String(r.date || '').slice(0, 10);
    if (!ymd) return;
    const v = num_(r.new_inbox) + num_(r.comment);
    touch(unitOfPage(pid), ymd).pBase += v;
    touchDay_(ymd).pancakeBase += v;
  });

  /* ---- เลือกฐานตัวหาร: Meta ถ้าข้อมูลครบ ไม่งั้นถอยไป Pancake ----
   * ⚠️ ต้องเป็นกติกาเดียวกับ metaBaseComplete_ ใน lib/api/sales.ts เป๊ะ — สองหน้าต้องตอบเลขเดียวกัน
   *   ด่าน 1: ทุกวันที่ยิงแอดต้องมีตัวเลข Meta   ด่าน 2: ฐาน Meta ต้องไม่เล็กกว่า Pancake เกินปกติ
   *   (ด่าน 2 กันกรณีงานดึง Meta ล้มเป็นราย "บัญชีโฆษณา" ซึ่งด่าน 1 จับไม่ได้ — ดูคำอธิบายเต็มใน sales.ts)
   * (เดือนที่คาบวันก่อน backfill จะมีวันที่จ่ายเงินแต่ Meta = 0 → ทั้งเดือนใช้ Pancake) */
  const META_BASE_MIN_RATIO = 0.70;
  const META_DAY_MIN_BASE = 200;   // ต้นวันตัวเลขยังน้อย อัตราส่วนแกว่ง — ข้ามด่านรายวัน (เหมือน sales.ts)
  const metaOk = (() => {
    const ds = Object.keys(dayTot);
    if (!ds.length) return false;
    let spentDays = 0, meta = 0, pancake = 0;
    for (const d of ds) {
      const x = dayTot[d];
      meta += x.metaBase;
      pancake += x.pancakeBase;
      if (x.spend <= 0) continue;
      spentDays++;
      if (x.metaBase <= 0) return false;
      // ด่านรายวัน — วันดีเจือจางวันเสียได้ (ก.ค. 69 ทั้งเดือน 0.806 แต่ข้างในมีวันต่ำถึง 0.56)
      if (x.pancakeBase >= META_DAY_MIN_BASE && x.metaBase / x.pancakeBase < META_BASE_MIN_RATIO) return false;
    }
    if (!spentDays) return false;
    if (pancake > 0 && meta / pancake < META_BASE_MIN_RATIO) return false;
    return true;
  })();
  const baseOf_ = (c: Daily): number => (metaOk ? c.mBase : c.pBase);
  profitRows.forEach((r) => {
    const u = String(r.u || '');
    const ymd = String(r.date || '').slice(0, 10);
    if (!u || !ymd) return;
    const c = touch(u, ymd);
    c.profit = (c.profit || 0) + num_(r.profit);
  });

  /* ---- สรุปต่อยูนิต + ไล่นับ streak ---- */
  // สแนปช็อตสตรีคขาดทุนจากงาน sync เป็นของ "ช่วงล่าสุด" เสมอ — เดือนอื่นห้ามเอามาแปะ
  const lossUsable = !!lossAlerts && !!lossAlerts.throughDate && lossAlerts.throughDate.slice(0, 7) === month;
  const keys = Array.from(new Set(
    Object.keys(byUnit).concat(Object.keys(meta)).concat(goals && goals.year === year ? Object.keys(goals.targets) : []),
  ));

  const units = keys.map((k) => {
    const days = byUnit[k] || {};
    const mapped = k !== UNMAPPED;
    const m = meta[k] || { product: '', pages: 0, admins: 0, breakEven: 1, breakEvenSet: false, note: '' };
    let rev = 0, orders = 0, spend = 0, base = 0, profit = 0, hasProfit = false, revDone = 0;
    Object.keys(days).forEach((ymd) => {
      const c = days[ymd];
      rev += c.rev; orders += c.orders; spend += c.spend; base += baseOf_(c);
      if (ymd <= lastDoneYmd) revDone += c.rev;          // คาดการณ์ใช้เฉพาะวันที่จบแล้ว
      if (c.profit !== null) { profit += c.profit; hasProfit = true; }
    });
    const target = mapped ? monthTargetOf(k) : 0;
    const attain = target > 0 ? Math.round((rev / target) * 1000) / 10 : null;
    // คาดการณ์สิ้นเดือน = ยอดเฉลี่ยต่อวันของ "วันที่จบแล้ว" × จำนวนวันทั้งเดือน
    // วันที่ 1 ของเดือน (ยังไม่มีวันจบเลย) คาดไม่ได้ → null ให้หน้าเว็บโชว์ "—" ไม่ใช่เลขตกใจ
    // เดือนที่จบแล้ว = ยอดจริง ไม่ต้องคาด
    const projected = !isCurrentMonth ? Math.round(rev)
      : daysDone > 0 ? Math.round((revDone / daysDone) * daysInMonth) : null;
    const projAttain = target > 0 && projected !== null ? Math.round((projected / target) * 1000) / 10 : null;

    // ---- %ปิด ต่ำกว่าเป้าติดต่อกันกี่วัน (ไล่ย้อนจากเมื่อวาน — วันนี้ยังไม่จบ ตัดสินไม่ได้) ----
    let closeStreak = 0;
    for (let d = lastDoneYmd; d >= monthStart; d = ymdShift_(d, -1)) {
      const c = days[d];
      if (!c || baseOf_(c) <= 0) break;                // ไม่มีคนทัก = ตัดสินไม่ได้ streak ขาด
      const rate = (c.orders / baseOf_(c)) * 100;
      if (rate >= UNIT_CLOSE_TARGET) break;
      closeStreak++;
    }
    // ---- ROAS ต่ำกว่าจุดคุ้มทุนติดต่อกันกี่วัน (กติกาเดียวกับการ์ด 🚨 — งาน sync คำนวณไว้) ----
    const la = lossUsable && lossAlerts ? lossAlerts.byU[k] : null;
    const lossStreak = la ? num_(la.days || la.streak) : 0;
    // basis บอกว่าวันขาดทุนตัดสินด้วยอะไร: 'profit' = กำไรจริงจากชีท · 'roas' = ยอดขายต่ำกว่าค่าแอด × จุดคุ้มทุน
    const lossBasis = la ? String(la.basis || 'roas') : '';

    const closeRate = base > 0 ? Math.round((orders / base) * 10000) / 100 : null;
    const roas = spend > 0 ? Math.round((rev / spend) * 100) / 100 : null;
    const costPerMsg = base > 0 ? Math.round((spend / base) * 100) / 100 : null;
    const perBill = orders > 0 ? Math.round(rev / orders) : null;

    /* ---- สัญญาณเตือน + ระดับความเสี่ยง ---- */
    const signals: Array<{ text: string; level: 'urgent' | 'watch' }> = [];
    if (lossStreak >= 1) {
      // ข้อความต้องตรงกับฐานที่ใช้ตัดสินจริง ไม่งั้นการ์ดจะโชว์ ROAS เขียวคู่กับบรรทัดแดงที่บอกว่า ROAS ตก
      const how = lossBasis === 'profit' ? 'ขาดทุนจริงจากชีท '
        : lossBasis === 'mixed' ? 'ขาดทุน (กำไรชีท + ROAS ต่ำกว่าจุดคุ้มทุน) '
          : 'ROAS ต่ำกว่าจุดคุ้มทุน ';
      const beNote = lossBasis === 'profit' ? ''
        : m.breakEvenSet ? ' (จุดคุ้มทุน ' + m.breakEven + 'x)' : ' (ยังไม่ได้ตั้งจุดคุ้มทุน ใช้ค่าเริ่มต้น 1x)';
      signals.push({
        text: how + lossStreak + ' วันติด' + beNote,
        level: lossStreak >= 2 ? 'urgent' : 'watch',
      });
    }
    if (closeStreak >= 2) {
      signals.push({
        text: '%ปิดการขายต่ำกว่า ' + UNIT_CLOSE_TARGET + '% ' + closeStreak + ' วันติด',
        level: closeStreak >= 7 ? 'urgent' : 'watch',
      });
    }
    if (target > 0 && projAttain !== null && isCurrentMonth && projected !== null) {
      if (projAttain < 80) signals.push({ text: 'คาดว่าจะไม่ถึงเป้าเดือนนี้ (คาด ' + projAttain + '% ของเป้า)', level: 'urgent' });
      else if (projAttain < 100) signals.push({ text: 'คาดว่าจะเฉียดเป้า (คาด ' + projAttain + '% ของเป้า)', level: 'watch' });
    }
    if (hasProfit && profit < 0) {
      signals.push({ text: 'กำไรสะสมเดือนนี้ติดลบ', level: 'urgent' });
    }
    const level: 'urgent' | 'watch' | 'ok' =
      signals.some((s) => s.level === 'urgent') ? 'urgent' : (signals.length ? 'watch' : 'ok');

    return {
      u: mapped ? k : '',
      key: k,
      mapped,
      product: mapped ? (m.product || (pageUnit[k] && pageUnit[k].product) || '') : 'ยังไม่จัดกลุ่ม',
      pages: m.pages,
      admins: m.admins,
      note: m.note,
      revenue: Math.round(rev),
      orders,
      spend: Math.round(spend),
      base,
      closeBaseSrc: metaOk ? 'meta' : 'pancake',
      profit: hasProfit ? Math.round(profit) : null,
      target: target > 0 ? Math.round(target) : null,
      attain,
      projected,
      projAttain,
      gap: target > 0 ? Math.max(0, Math.round(target - rev)) : null,
      closeRate,
      roas,
      costPerMsg,
      perBill,
      breakEven: m.breakEven,
      breakEvenSet: m.breakEvenSet,   // ไม่ได้ตั้ง = การ์ดต้องบอกว่า "ยังไม่ตั้ง" ไม่ใช่โชว์ 1x เหมือนเป็นค่าที่ทีมตั้งเอง
      lossStreak,
      closeStreak,
      signals,
      level,
    };
  })
    // ยูนิตที่ไม่มีทั้งยอด ไม่มีค่าแอด และไม่มีเป้าในเดือนนี้ = ไม่มีอะไรให้ดู
    .filter((u) => u.revenue > 0 || u.spend > 0 || (u.target || 0) > 0);

  const rank = { urgent: 0, watch: 1, ok: 2 };
  units.sort((a, b) => {
    if (a.mapped !== b.mapped) return a.mapped ? -1 : 1;
    if (rank[a.level] !== rank[b.level]) return rank[a.level] - rank[b.level];
    const aa = a.projAttain === null ? 9999 : a.projAttain;
    const bb = b.projAttain === null ? 9999 : b.projAttain;
    if (aa !== bb) return aa - bb;
    return b.revenue - a.revenue;
  });

  const totals = units.reduce((t, u) => ({
    revenue: t.revenue + u.revenue,
    target: t.target + (u.target || 0),
    spend: t.spend + u.spend,
    projected: t.projected + (u.projected === null ? u.revenue : u.projected),
    profit: t.profit + (u.profit || 0),
    urgent: t.urgent + (u.level === 'urgent' ? 1 : 0),
    watch: t.watch + (u.level === 'watch' ? 1 : 0),
  }), { revenue: 0, target: 0, spend: 0, projected: 0, profit: 0, urgent: 0, watch: 0 });

  return {
    month,
    monthStart,
    monthEnd,
    lastYmd,
    daysElapsed,
    daysInMonth,
    isCurrentMonth,
    closeTarget: UNIT_CLOSE_TARGET,
    // null = ยังไม่ได้รัน migration ของ RPC นั้น (หน้าเว็บบอกวิธีรัน ไม่ใช่โชว์ 0)
    needSalesRpc: salesRes.failed === 'migration',
    needAdsRpc: adsRes.failed === 'migration',
    salesFailed: salesRes.failed === 'error',
    adsFailed: adsRes.failed === 'error',
    beforeData,
    dataStart: DATA_START_YMD,
    daysDone,
    lastDoneYmd,
    lossUsable,
    lossThroughDate: lossAlerts ? lossAlerts.throughDate : '',
    goalSheetId: goals ? goals.sheetId : '',
    goalYearMismatch: !!goals && goals.year !== year,
    units,
    totals,
  };
}
