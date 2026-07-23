// lib/api/contentads.ts — port ของ apiContentAds จาก WebApi.gs
// อ่านจาก Supabase (orders + ads) แล้วรวมยอด/สร้าง alerts ตาม logic เดิมทุกตัวอักษร
import { db, fetchAll } from '@/lib/db';
import { EXCLUDED_STATUSES, money_, isPlaceholderOrder, fmtDateBkk, daysAgo } from '@/lib/config';

/** ค่าจาก Postgres อาจเป็น number/string/null — แปลงเป็นเลขเสมอ (NaN → 0) */
function toNum_(v: unknown): number {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

interface OrderRow {
  ad_id: string | number | null;
  post_id?: string | null;
  page_id?: string | null;
  total_price: number | string | null;
  items_count?: number | string | null;
  status: number | string | null;
  seller_name?: string | null;
  creator_name?: string | null;
  items_json?: unknown;
  inserted_at?: string | null;
}

/** items_json อาจเป็น jsonb (array แล้ว) หรือ string — คืน array เสมอ */
function parseItems_(v: unknown): any[] {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(String(v || '[]')); } catch (e) { return []; }
}

interface AdRow {
  ad_id: string | number | null;
  name?: string | null;
  campaign_name?: string | null;
  campaign_id?: string | number | null;
  adset_id?: string | number | null;
  created_time?: string | null;
  start_time?: string | null;
  ad_account_name?: string | null;
  status?: string | null;
  effective_status?: string | null;
  spend?: number | string | null;
  impressions?: number | string | null;
  reach?: number | string | null;
  clicks?: number | string | null;
  ctr?: number | string | null;
  msgs_started?: number | string | null;
  cost_per_msg?: number | string | null;
  order_created?: number | string | null;
  order_shipped?: number | string | null;
  marketer_name?: string | null;
  updated_at?: string | null;
}

/**
 * รวมค่าแอดจาก ad_daily ตามจำนวนวันย้อนหลัง แล้วคืนรูปเดียวกับตาราง `ads` เดิม
 * (metric สะสมบวกกัน / ctr,cpm คำนวณใหม่จากยอดรวม ห้ามเฉลี่ยค่าเฉลี่ย)
 * ตารางยังไม่ถูกสร้าง → คืน [] แล้วหน้าเว็บจะบอกให้รัน migration
 */
async function loadAdsFromDaily_(days: number): Promise<{ ads: AdRow[]; daysCovered: number }> {
  // days=1 → วันนี้วันเดียว | days=7 → วันนี้ + 6 วันก่อน (วันปฏิทินไทยเต็มวัน)
  // ⚠️ ต้องเป็นหน้าต่างเดียวกับตัวกรองออเดอร์เป๊ะๆ ไม่งั้น ROAS เพี้ยน
  //    (ของเดิม gte(date, now-days) ทำให้ days=1 กินค่าแอด 2 วันปฏิทิน แต่ยอดขายแค่ 24 ชม.)
  const from = fmtDateBkk(daysAgo(days - 1));
  let rows: any[];
  try {
    rows = await fetchAll<any>(() =>
      db.from('ad_daily').select(
        'date,ad_id,page_id,page_name,name,status,account_id,spend,impressions,reach,clicks,' +
        'link_clicks,ctr,cpm,msgs_started,first_replies,phones,pos_orders,optimization_goal,updated_at'
      ).gte('date', from),
      'ad_id'
    );
  } catch (e: any) {
    const m = String((e && e.message) || e || '');
    if (m.includes('ad_daily') && (m.includes('does not exist') || m.includes('schema cache'))) {
      return { ads: [], daysCovered: 0 };
    }
    throw e;
  }

  // กี่วันในช่วงที่มีค่าแอดจริง — ถ้าน้อยกว่าช่วงที่เลือก ROAS จะสูงเกินจริง
  // (ยอดขายเต็มช่วง ÷ ค่าแอดไม่กี่วัน) หน้าเว็บต้องเตือน ไม่ใช่โชว์เฉยๆ
  const seenDates: Record<string, 1> = {};
  const byAd: Record<string, any> = {};
  rows.forEach(function (r) {
    if (r.date) seenDates[String(r.date)] = 1;
    const id = String(r.ad_id || '');
    if (!id) return;
    let a = byAd[id];
    if (!a) {
      a = byAd[id] = {
        ad_id: id, name: r.name || '', ad_account_name: String(r.account_id || ''),
        adset_id: '', campaign_name: '', campaign_id: '', marketer_name: '',
        status: r.status || '', effective_status: r.status || '',
        spend: 0, impressions: 0, reach: 0, clicks: 0, msgs_started: 0,
        order_created: 0, order_shipped: 0, ctr: 0, cost_per_msg: 0,
        created_time: null, start_time: null, updated_at: '',
        _firstDate: String(r.date || ''),
      };
    }
    a.spend += toNum_(r.spend);
    a.impressions += toNum_(r.impressions);
    a.reach += toNum_(r.reach);            // ประมาณ — reach จริงไม่บวกกันตรงๆ (คนซ้ำข้ามวัน)
    a.clicks += toNum_(r.clicks);
    a.msgs_started += toNum_(r.msgs_started);
    a.order_created += toNum_(r.pos_orders);
    const d = String(r.date || '');
    if (d && (!a._firstDate || d < a._firstDate)) a._firstDate = d;
    // สถานะ + ชื่อ ให้ยึดวันล่าสุดเสมอ
    const u = String(r.updated_at || '');
    if (u >= String(a.updated_at || '')) {
      a.updated_at = u;
      if (r.status) { a.status = r.status; a.effective_status = r.status; }
      if (r.name) a.name = r.name;
    }
  });

  const ads = Object.keys(byAd).map(function (id) {
    const a = byAd[id];
    // คำนวณใหม่จากยอดรวม — ห้ามเอา ctr/cpm รายวันมาเฉลี่ยกัน
    a.ctr = a.impressions > 0 ? Math.round((a.clicks / a.impressions) * 10000) / 100 : 0;
    a.cost_per_msg = a.msgs_started > 0 ? Math.round((a.spend / a.msgs_started) * 100) / 100 : 0;
    // ad_daily ไม่มีวันสร้างแอด — ใช้วันแรกที่เห็นแอดนี้แทน (อายุ "ตั้งแต่เริ่มเก็บข้อมูล")
    a.created_time = a._firstDate ? a._firstDate + 'T00:00:00+07:00' : null;
    return a as AdRow;
  });
  return { ads, daysCovered: Object.keys(seenDates).length };
}

export async function apiContentAds(params?: any) {
  // ช่วงวันที่ย้อนหลัง (วัน) — เดิมไม่มีตัวกรองเวลาเลย ทุกตัวเลขเป็นยอดสะสมตั้งแต่ต้น
  // จึงเทียบกับ Pancake ที่ดูรายวัน/รายสัปดาห์ไม่ได้เลย
  const days = Math.min(95, Math.max(1, Math.round(Number((params && params.days)) || 7)));
  // นับเป็น "วันปฏิทินไทยเต็มวัน" เหมือนหน้า Sales และเหมือน Pancake
  // (days=1 = ตั้งแต่เที่ยงคืนวันนี้) — ต้องตรงกับหน้าต่างของ loadAdsFromDaily_
  const sinceIso = daysAgo(days - 1).toISOString();
  // ยอดขายที่ผูกกับแต่ละ ad_id — จำกัดตามช่วงที่เลือก ให้เทียบกับค่าแอดช่วงเดียวกันได้
  const orders = await fetchAll<OrderRow>(() =>
    db.from('orders').select('ad_id,page_id,total_price,items_count,status,seller_name,creator_name,items_json')
      .not('ad_id', 'is', null).neq('ad_id', '')
      .gte('inserted_at', sinceIso)
  );

  // ชื่อเพจ (ให้ dropdown "ทุกเพจ" ใช้ชื่อจริงแทน page_id)
  const pageNames: Record<string, string> = {};
  {
    const pageRows = await fetchAll<any>(() => db.from('pages').select('page_id,name'), 'page_id');
    pageRows.forEach(function (p: any) { pageNames[String(p.page_id)] = String(p.name || ''); });
  }

  const revByAd: Record<string, number> = {};
  const cntByAd: Record<string, number> = {};
  const sellerByAd: Record<string, Record<string, number>> = {}; // ใครปิดขายจากแอดนี้บ้าง (นับออเดอร์)
  const pageByAd: Record<string, Record<string, number>> = {};   // แอดนี้ยอดมาจากเพจไหนบ้าง (นับออเดอร์)
  const prodByAd: Record<string, Record<string, number>> = {};   // สินค้าที่ขายผ่านแอดนี้ (นับชิ้น)
  orders.forEach(function (o) {
    const status = toNum_(o.status);
    const excluded = EXCLUDED_STATUSES.indexOf(status) >= 0;
    // ออเดอร์เปล่าจาก Pancake ผูก ad_id มาด้วยเสมอ — ถ้าไม่ตัด จำนวนออเดอร์ต่อแอดจะพองมาก
    if (excluded || !o.ad_id || isPlaceholderOrder(o)) return;
    const id = String(o.ad_id);
    revByAd[id] = (revByAd[id] || 0) + money_(o.total_price);
    cntByAd[id] = (cntByAd[id] || 0) + 1;
    const seller = String(o.seller_name || o.creator_name || '').trim();
    if (seller) {
      if (!sellerByAd[id]) sellerByAd[id] = {};
      sellerByAd[id][seller] = (sellerByAd[id][seller] || 0) + 1;
    }
    const pid = String(o.page_id || '');
    if (pid) {
      if (!pageByAd[id]) pageByAd[id] = {};
      pageByAd[id][pid] = (pageByAd[id][pid] || 0) + 1;
    }
    parseItems_(o.items_json).forEach(function (it: any) {
      const nm = String((it && it.name) || '').trim();
      if (!nm) return;
      if (!prodByAd[id]) prodByAd[id] = {};
      prodByAd[id][nm] = (prodByAd[id][nm] || 0) + (toNum_(it.qty) || 1);
    });
  });

  /** key ที่มีค่ามากสุดใน map — '' เมื่อไม่มี */
  function topKey_(m: Record<string, number> | undefined): string {
    if (!m) return '';
    let best = '', bestN = 0;
    Object.keys(m).forEach(function (k) { if (m[k] > bestN) { bestN = m[k]; best = k; } });
    return best;
  }

  /** รายชื่อสินค้าของแอด เรียงตามจำนวนชิ้น (สูงสุด 5 ชื่อ — ใช้กรอง + โชว์บนการ์ด) */
  function topProducts_(adId: string): string[] {
    const m = prodByAd[adId];
    if (!m) return [];
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).slice(0, 5);
  }

  /** แอดมินที่ปิดขายมากสุดของแอด — "ชื่อ (n)" หรือ '' เมื่อไม่มี */
  function topSeller_(adId: string): string {
    const m = sellerByAd[adId];
    if (!m) return '';
    let best = '', bestN = 0;
    Object.keys(m).forEach(function (k) { if (m[k] > bestN) { bestN = m[k]; best = k; } });
    return best ? best + ' (' + bestN + ')' : '';
  }

  // ค่าแอดจริงจาก ad_daily (รวมตามช่วงวันที่เลือก) — ตาราง `ads` เดิมว่างเปล่าถาวร
  // เพราะ POS /ads_manager/ads_v2 คืน 0 แถวเสมอ
  const { ads, daysCovered: adDaysCovered } = await loadAdsFromDaily_(days);

  const items = ads.map(function (a) {
    const adId = String(a.ad_id);
    const spend = toNum_(a.spend);
    const msgs = toNum_(a.msgs_started);
    const orderCreated = toNum_(a.order_created);
    const revenue = Math.round(revByAd[adId] || 0);
    const posOrders = cntByAd[adId] || 0;
    const effOrders = Math.max(orderCreated, posOrders);
    const roas = spend > 0 ? Math.round((revenue / spend) * 100) / 100 : null;
    const costPerOrder = (spend > 0 && effOrders > 0) ? Math.round(spend / effOrders) : null;
    const closeRate = msgs > 0 ? Math.min(100, Math.round(effOrders / msgs * 1000) / 10) : null;
    const effStatus = String(a.effective_status || a.status || '').toUpperCase();
    const active = effStatus === 'ACTIVE';

    // สถานะแบบเดียวกับ mockup
    let status;
    if (!active && spend > 0) status = { key: 'paused', label: '⏸ Paused', cls: 'neutral' };
    else if (spend > 0 && roas !== null && roas >= 3) status = { key: 'winning', label: '🏆 Winning', cls: 'ai' };
    else if (roas !== null && roas < 1 && spend > 800) status = { key: 'losing', label: '📉 Losing', cls: 'urgent' };
    else if ((roas !== null && roas < 1.5) || (costPerOrder !== null && costPerOrder > 400)) status = { key: 'needs_fix', label: '🛠 Needs Fix', cls: 'admin' };
    else if (msgs > 30 && closeRate !== null && closeRate < 10) status = { key: 'watch', label: '👀 Watch', cls: 'info' };
    else if (spend > 0) status = { key: 'active', label: '▶ Active', cls: 'ai' };
    else if (active) status = { key: 'organic', label: '▶ Active (Organic)', cls: 'neutral' };
    else status = { key: 'paused', label: '⏸ Paused', cls: 'neutral' }; // ไม่ active + ไม่มี spend = หยุดแล้ว ไม่ใช่ organic

    // อายุคอนเทนต์ (วัน) จากวันที่สร้าง/เริ่มยิงแอด — null เมื่อไม่มีข้อมูลเวลา
    const createdRaw = a.created_time || a.start_time || null;
    let ageDays: number | null = null;
    if (createdRaw) {
      const ct = new Date(String(createdRaw)).getTime();
      if (!isNaN(ct)) ageDays = Math.max(0, Math.floor((Date.now() - ct) / 86400000));
    }

    const topPageId = topKey_(pageByAd[adId]);
    return {
      adId: adId,
      name: String(a.name || ''),
      campaign: String(a.campaign_name || a.campaign_id || ''),
      adsetId: String(a.adset_id || ''),
      ageDays: ageDays,
      topSeller: topSeller_(adId),
      pageId: topPageId,
      pageName: pageNames[topPageId] || '',
      products: topProducts_(adId),
      organicPost: false,
      account: String(a.ad_account_name || ''),
      effStatus: effStatus,
      active: active,
      spend: Math.round(spend),
      impressions: toNum_(a.impressions),
      reach: toNum_(a.reach),
      clicks: toNum_(a.clicks),
      ctr: toNum_(a.ctr),
      msgs: msgs,
      costPerMsg: toNum_(a.cost_per_msg),
      orderCreated: orderCreated,
      orderShipped: toNum_(a.order_shipped),
      orders: effOrders,
      revenue: revenue,
      roas: roas,
      costPerOrder: costPerOrder,
      closeRate: closeRate,
      marketer: String(a.marketer_name || ''),
      status: status,
      updatedAt: String(a.updated_at || '')
    };
  });

  // ---- แถว Organic: ออเดอร์ที่ผูกโพสต์ (post_id) แต่ไม่ได้มาจากแอด ----
  // revenue/orders เป็นของจริง — spend/คลิก/แชทของโพสต์ไม่มีข้อมูล (ไม่ใช่ 0) หน้าเว็บโชว์ "-"
  const organicOrders = await fetchAll<OrderRow>(() =>
    db.from('orders').select('post_id,page_id,total_price,items_count,status,seller_name,creator_name,inserted_at')
      .not('post_id', 'is', null).neq('post_id', '')
      .or('ad_id.is.null,ad_id.eq.')
      .gte('inserted_at', sinceIso)
  );
  const byPost: Record<string, {
    revenue: number; orders: number;
    pages: Record<string, number>; sellers: Record<string, number>; lastAt: string;
  }> = {};
  organicOrders.forEach(function (o) {
    const status = toNum_(o.status);
    if (EXCLUDED_STATUSES.indexOf(status) >= 0 || isPlaceholderOrder(o)) return;
    const pid = String(o.post_id || '');
    if (!pid) return;
    if (!byPost[pid]) byPost[pid] = { revenue: 0, orders: 0, pages: {}, sellers: {}, lastAt: '' };
    const p = byPost[pid];
    p.revenue += money_(o.total_price);
    p.orders++;
    const pg = String(o.page_id || '');
    if (pg) p.pages[pg] = (p.pages[pg] || 0) + 1;
    const seller = String(o.seller_name || o.creator_name || '').trim();
    if (seller) p.sellers[seller] = (p.sellers[seller] || 0) + 1;
    const at = String(o.inserted_at || '');
    if (at > p.lastAt) p.lastAt = at;
  });
  const organicItems: any[] = Object.keys(byPost)
    .map(function (pid) {
      const p = byPost[pid];
      const pageId = topKey_(p.pages);
      const pageName = pageNames[pageId] || '';
      const sellerTop = topKey_(p.sellers);
      // post_id รูปแบบ {page_id}_{post} — โชว์ท้าย id พอให้แยกโพสต์ได้ (เราไม่มีข้อความโพสต์)
      const shortId = pid.indexOf('_') >= 0 ? pid.slice(pid.indexOf('_') + 1) : pid;
      return {
        adId: 'post:' + pid,
        name: (pageName || 'ไม่ระบุเพจ') + ' — โพสต์ …' + shortId.slice(-8),
        campaign: 'Organic (ไม่ใช้งบแอด)',
        adsetId: '',
        ageDays: null as number | null,
        topSeller: sellerTop ? sellerTop + ' (' + p.sellers[sellerTop] + ')' : '',
        pageId: pageId,
        pageName: pageName,
        products: [] as string[],
        organicPost: true,
        account: '',
        effStatus: '',
        active: false,
        spend: 0, impressions: 0, reach: 0, clicks: 0, ctr: 0,
        msgs: 0, costPerMsg: 0, orderCreated: 0, orderShipped: 0,
        orders: p.orders,
        revenue: Math.round(p.revenue),
        roas: null as number | null,
        costPerOrder: null as number | null,
        closeRate: null as number | null,
        marketer: '',
        status: { key: 'organic', label: '🌱 Organic (โพสต์)', cls: 'neutral' },
        updatedAt: p.lastAt,
      };
    })
    .sort(function (a, b) { return b.revenue - a.revenue; })
    .slice(0, 50); // กันหน้าบวม — เฉพาะโพสต์ทำยอดสูงสุด 50 โพสต์ (ที่เหลือดูใน CSV ไม่ได้ — บอกใน note)

  // Alert rules (ปรับจาก mockup ให้ใช้ข้อมูลจริงที่มี)
  const alerts: Array<{
    id: string; level: string; icon: string; title: string;
    reason: string; nums: string; recommend: string; adId: string;
  }> = [];
  items.forEach(function (it) {
    if (!it.active) return;
    const nums = 'Spend ฿' + it.spend + ' • ' + it.orders + ' ออเดอร์ • ยอดขาย ฿' + it.revenue;
    if (it.roas !== null && it.roas < 1.5 && it.spend > 300) {
      alerts.push({
        id: 'AL-' + it.adId + '-roas', level: it.roas < 1 ? 'red' : 'orange', icon: '📉',
        title: 'ROAS ต่ำกว่าเกณฑ์', reason: '"' + it.name.slice(0, 40) + '" ROAS ' + it.roas, nums: nums,
        recommend: it.roas < 1 ? 'พิจารณาหยุดแอด หรือลดงบ 50% แล้วเปลี่ยนครีเอทีฟ' : 'เปลี่ยน Hook + กลุ่มเป้าหมาย แล้ววัดผล 3 วัน',
        adId: it.adId
      });
    }
    if (it.costPerOrder !== null && it.costPerOrder > 400) {
      alerts.push({
        id: 'AL-' + it.adId + '-cpo', level: 'orange', icon: '💸',
        title: 'Cost per Order สูง', reason: '"' + it.name.slice(0, 40) + '" ฿' + it.costPerOrder + '/ออเดอร์', nums: nums,
        recommend: 'แคบกลุ่มเป้าหมาย + ใส่ราคาบนภาพเพื่อกรองคนก่อนทัก', adId: it.adId
      });
    }
    if (it.spend > 800 && it.orders === 0) {
      alerts.push({
        id: 'AL-' + it.adId + '-zero', level: 'red', icon: '🕳',
        title: 'Spend สูงแต่ไม่มีออเดอร์', reason: '"' + it.name.slice(0, 40) + '" ใช้ไป ฿' + it.spend, nums: nums,
        recommend: 'หยุดแอดชั่วคราว เช็คสคริปต์แอดมิน + เทียบราคากับคู่แข่ง', adId: it.adId
      });
    }
    if (it.msgs > 30 && it.closeRate !== null && it.closeRate < 10) {
      alerts.push({
        id: 'AL-' + it.adId + '-close', level: 'orange', icon: '💬',
        title: 'แชทเยอะแต่ปิดขายต่ำ', reason: '"' + it.name.slice(0, 40) + '" ' + it.msgs + ' แชท ปิดได้ ' + it.closeRate + '%', nums: nums,
        recommend: 'ปรับสคริปต์ปิดการขาย + เช็คว่าราคาที่โฆษณาตรงกับที่แจ้งในแชท', adId: it.adId
      });
    }
    if (it.roas !== null && it.roas >= 4) {
      alerts.push({
        id: 'AL-' + it.adId + '-scale', level: 'green', icon: '🏆',
        title: 'แอดติด — ควร Scale', reason: '"' + it.name.slice(0, 40) + '" ROAS ' + it.roas, nums: nums,
        recommend: 'เพิ่มงบ 20-30% ทุก 2 วัน + เตรียมครีเอทีฟสำรอง', adId: it.adId
      });
    }
    if (it.roas !== null && it.roas < 0.6 && it.spend > 1200) {
      alerts.push({
        id: 'AL-' + it.adId + '-stop', level: 'red', icon: '🛑',
        title: 'แอดแย่ — ควรหยุด', reason: '"' + it.name.slice(0, 40) + '" ROAS ' + it.roas + ' ใช้ไป ฿' + it.spend, nums: nums,
        recommend: 'ปิดแอดแล้วย้ายงบไปตัวที่ ROAS ≥ 2', adId: it.adId
      });
    }
  });
  const levelOrder: Record<string, number> = { red: 0, orange: 1, yellow: 2, green: 3 };
  alerts.sort(function (a, b) { return levelOrder[a.level] - levelOrder[b.level]; });

  return {
    summary: {
      urgent: alerts.filter(function (a) { return a.level === 'red'; }).length,
      adjust: alerts.filter(function (a) { return a.level === 'orange'; }).length,
      scale: alerts.filter(function (a) { return a.level === 'green'; }).length
    },
    alerts: alerts.slice(0, 30),
    items: (items as any[]).concat(organicItems),
    days,
    needAdSetup: ads.length === 0,   // ยังไม่ได้รัน migration ad_daily (หรือยังไม่มี sync รอบแรก)
    // ค่าแอดครอบคลุมกี่วันจากที่เลือก — น้อยกว่า days = ROAS สูงเกินจริง หน้าเว็บต้องเตือน
    adDaysCovered,
    adDaysWarning: (ads.length > 0 && adDaysCovered < days)
      ? 'ค่าแอดมีข้อมูลแค่ ' + adDaysCovered + ' วันจาก ' + days + ' วันที่เลือก — ROAS จะสูงเกินจริง ' +
        '(รัน `npm run backfill:ads ' + days + '` เพื่อเติมย้อนหลัง)'
      : null,
    note: 'ทุกตัวเลขเป็นของ ' + (days === 1 ? 'วันนี้' : days + ' วันล่าสุด') +
      ' (วันปฏิทินไทยเต็มวัน — หน้าต่างเดียวกับหน้า Sales) • ค่าแอด/คลิก/แชท = ข้อมูลจริงจาก Pancake ' +
      '(pages/statistics/ads) • ยอดขาย = ออเดอร์ในช่วงเดียวกันที่ผูก ad_id • ' +
      'แถว 🌱 Organic = ยอดจากโพสต์ที่ไม่ได้ยิงแอด (แสดง 50 โพสต์ยอดสูงสุด)'
  };
}
