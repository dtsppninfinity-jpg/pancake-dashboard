// lib/api/contentads.ts — port ของ apiContentAds จาก WebApi.gs
// อ่านจาก Supabase (orders + ads) แล้วรวมยอด/สร้าง alerts ตาม logic เดิมทุกตัวอักษร
import { db, fetchAll } from '@/lib/db';
import { EXCLUDED_STATUSES } from '@/lib/config';

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

export async function apiContentAds(_params?: unknown) {
  // ยอดขายที่ผูกกับแต่ละ ad_id (จากออเดอร์ทั้งชีต ~90 วัน)
  // กรอง ad_id ที่ไม่ว่างใน query เพื่อลดจำนวนแถว แล้วค่อยรวมยอดใน JS ตาม logic เดิม
  const orders = await fetchAll<OrderRow>(() =>
    db.from('orders').select('ad_id,page_id,total_price,status,seller_name,creator_name,items_json')
      .not('ad_id', 'is', null).neq('ad_id', '').not('inserted_at', 'is', null)
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
    if (excluded || !o.ad_id) return;
    const id = String(o.ad_id);
    revByAd[id] = (revByAd[id] || 0) + toNum_(o.total_price);
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

  const ads = await fetchAll<AdRow>(() =>
    db.from('ads').select(
      'ad_id,name,campaign_name,campaign_id,adset_id,ad_account_name,status,effective_status,spend,impressions,reach,clicks,ctr,msgs_started,cost_per_msg,order_created,order_shipped,marketer_name,created_time,start_time,updated_at'
    ),
    'ad_id'
  );

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
    db.from('orders').select('post_id,page_id,total_price,status,seller_name,creator_name,inserted_at')
      .not('post_id', 'is', null).neq('post_id', '')
      .or('ad_id.is.null,ad_id.eq.')
      .not('inserted_at', 'is', null)
  );
  const byPost: Record<string, {
    revenue: number; orders: number;
    pages: Record<string, number>; sellers: Record<string, number>; lastAt: string;
  }> = {};
  organicOrders.forEach(function (o) {
    const status = toNum_(o.status);
    if (EXCLUDED_STATUSES.indexOf(status) >= 0) return;
    const pid = String(o.post_id || '');
    if (!pid) return;
    if (!byPost[pid]) byPost[pid] = { revenue: 0, orders: 0, pages: {}, sellers: {}, lastAt: '' };
    const p = byPost[pid];
    p.revenue += toNum_(o.total_price);
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
    note: 'Spend/แชท/ออเดอร์ที่สร้าง = ค่าสะสมของแอดจาก POS • ยอดขาย = ออเดอร์ใน 90 วันที่ผูก ad_id • แถว 🌱 Organic = ยอดจากโพสต์ที่ไม่ได้ยิงแอด (แสดง 50 โพสต์ยอดสูงสุด)'
  };
}
