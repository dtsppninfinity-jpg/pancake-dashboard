// lib/api/pagemedia.ts — "สื่อของแต่ละเพจที่ยิงอยู่ ดูเทียบได้ทั้งปี" (บรีฟ 2026-07-31)
//
// สื่อ = โพสต์ (post_id จาก ad_creative) — 1 โพสต์มักมีหลายแอดยิง จึงรวมเป็นแถวเดียว
// ตัวเลขค่าแอด/ทัก/ซื้อ มาจาก ad_daily (Meta ทับรายวัน) กรองทั้งปีของเพจที่เลือก
import { db, fetchAll, fetchAllDateSliced } from '@/lib/db';

const num_ = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

export async function apiPageMedia(params: any) {
  const p = params || {};
  const year = /^\d{4}$/.test(String(p.year || '')) ? String(p.year) : String(new Date().getFullYear());

  // ---- ไม่ระบุเพจ → รายชื่อเพจให้เลือก (เฉพาะที่เคยมีค่าแอดใน 60 วัน — ตัดเพจร้าง dropdown สั้นลง) ----
  if (!p.pageId) {
    const since = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
    const [pages, recent] = await Promise.all([
      fetchAll<any>(() => db.from('pages').select('page_id,name,platform'), 'page_id'),
      fetchAllDateSliced<any>((f, t) =>
        db.from('ad_daily').select('date,ad_id,page_id,spend').gt('spend', 0).gte('date', f).lte('date', t),
        since, new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10),
        { orderColumn: 'date,ad_id' }),
    ]);
    const spendByPage: Record<string, number> = {};
    recent.forEach((a) => {
      const id = String(a.page_id || '');
      if (id) spendByPage[id] = (spendByPage[id] || 0) + num_(a.spend);
    });
    const list = pages
      .filter((pg) => spendByPage[String(pg.page_id)])
      .map((pg) => ({
        id: String(pg.page_id),
        name: String(pg.name || pg.page_id),
        spend60d: Math.round(spendByPage[String(pg.page_id)]),
      }))
      .sort((a, b) => b.spend60d - a.spend60d);
    return { ok: true, year, pages: list };
  }

  // ---- เลือกเพจ → สื่อทั้งปีของเพจนั้น ----
  const pageId = String(p.pageId);
  const rows = await fetchAllDateSliced<any>((f, t) =>
    db.from('ad_daily')
      .select('date,ad_id,name,status,spend,msgs_started,meta_purchases,meta_purchase_value')
      .eq('page_id', pageId).gte('date', f).lte('date', t),
    `${year}-01-01`, `${year}-12-31`, { orderColumn: 'date,ad_id' });

  // creative ของแอดที่เกี่ยว — .in() ทีละก้อน 150 ตัว (URL ยาวเกินลิมิตถ้ายัดทีเดียว)
  const adIds = Array.from(new Set(rows.map((r) => String(r.ad_id)))).filter(Boolean);
  const creatives: Record<string, any> = {};
  for (let i = 0; i < adIds.length; i += 150) {
    const chunk = adIds.slice(i, i + 150);
    const { data, error } = await db.from('ad_creative')
      .select('ad_id,name,thumb_url,image_url,video_id,post_id,permalink,object_type')
      .in('ad_id', chunk);
    if (error) break; // ตารางยังไม่ถูกสร้าง → แสดงแบบไม่มีรูป/ไม่รวมโพสต์
    (data || []).forEach((c: any) => { creatives[String(c.ad_id)] = c; });
  }

  // รวมเป็นราย "สื่อ" (post_id — แอดที่ไม่รู้โพสต์ใช้ ad_id ตัวเอง)
  interface Media {
    key: string; title: string; thumb: string; permalink: string; isVideo: boolean;
    adIds: Set<string>; active: boolean; lastDate: string;
    spend: number; msgs: number; purchases: number; value: number;
    byMonth: number[];
  }
  const medias: Record<string, Media> = {};
  rows.forEach((r) => {
    const adId = String(r.ad_id);
    const c = creatives[adId];
    const key = (c && c.post_id) || adId;
    const m = (medias[key] = medias[key] || {
      key,
      title: String((c && c.name) || r.name || adId).slice(0, 120),
      thumb: String((c && (c.thumb_url || c.image_url)) || ''),
      permalink: String((c && c.permalink) || ''),
      isVideo: !!(c && (c.video_id || c.object_type === 'VIDEO')),
      adIds: new Set<string>(), active: false, lastDate: '',
      spend: 0, msgs: 0, purchases: 0, value: 0,
      byMonth: new Array(12).fill(0),
    });
    m.adIds.add(adId);
    const d = String(r.date).slice(0, 10);
    const spend = num_(r.spend);
    m.spend += spend;
    m.msgs += num_(r.msgs_started);
    m.purchases += num_(r.meta_purchases);
    m.value += num_(r.meta_purchase_value);
    m.byMonth[Number(d.slice(5, 7)) - 1] += spend;
    if (d > m.lastDate) m.lastDate = d;
    if (String(r.status).toUpperCase() === 'ACTIVE') m.active = true;
  });

  const today = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 10);
  const items = Object.values(medias)
    .filter((m) => m.spend > 0)
    .map((m) => ({
      key: m.key,
      title: m.title,
      thumb: m.thumb,
      permalink: m.permalink,
      isVideo: m.isVideo,
      ads: m.adIds.size,
      // "ยังยิงอยู่" = มีค่าแอดใน 3 วันล่าสุด (สถานะ ACTIVE จาก Pancake ตามหลังได้)
      running: (new Date(today).getTime() - new Date(m.lastDate).getTime()) / 86400000 <= 3,
      lastDate: m.lastDate,
      spend: Math.round(m.spend),
      msgs: m.msgs,
      costPerMsg: m.msgs > 0 ? Math.round((m.spend / m.msgs) * 100) / 100 : null,
      purchases: m.purchases,
      value: Math.round(m.value),
      roasMeta: m.spend > 0 && m.value > 0 ? Math.round((m.value / m.spend) * 100) / 100 : null,
      byMonth: m.byMonth.map((v) => Math.round(v)),
    }))
    .sort((a, b) => b.spend - a.spend);

  const LIMIT = 120;
  return {
    ok: true, year, pageId,
    total: items.length,
    truncated: Math.max(0, items.length - LIMIT), // ตัดท้ายแล้วบอกจำนวนที่ตัด — ไม่เงียบ
    items: items.slice(0, LIMIT),
    hasCreatives: Object.keys(creatives).length > 0,
  };
}
