// lib/api/navbadges.ts — ตัวเลขแจ้งเตือนบนเมนูข้าง (แบบ badge แอปมือถือ) — บอสสั่ง 2026-07-30
//
// ต้องเบาพอให้ยิงซ้ำทุก 5 นาทีได้: อ่าน sync_state 1 แถว + ad_daily 7 วัน 7 คอลัมน์ (ตารางเดียว)
// ห้ามลาก orders/สถิติแชทมาที่นี่ — นั่นคืองานของ apiSales/apiContentAds
import { db, fetchAllDateSliced } from '@/lib/db';
import { fmtDateBkk, daysAgo } from '@/lib/config';

// แปลงตัวเลขแบบเดียวกับ toNum_ ใน contentads.ts (NaN = 0) — ป้ายต้องได้เลขเดียวกับหน้าเป๊ะ
const num_ = (v: unknown): number => {
  const n = Number(v);
  return isNaN(n) ? 0 : n;
};

/* ---- แคชผลในหน่วยความจำของ server 3 นาที ----
 * ทุกแท็บที่เปิดเว็บค้างไว้ยิงมาทุก 5 นาที และผลเหมือนกันทุกคน (ไม่ขึ้นกับผู้ใช้) — เดิมทุกครั้งไล่อ่าน ad_daily 7 วัน (~1 หมื่นแถว)
 * ข้อมูลต้นทางอัปเดตทุก 15 นาทีอยู่แล้ว ป้ายช้ากว่าจริงได้ไม่เกิน 3 นาที · key = วันเริ่มหน้าต่าง 7 วัน (ข้ามเที่ยงคืนแล้วไม่ใช้ของเมื่อวาน)
 * เก็บเป็น promise — คำขอที่มาพร้อมกันใช้การคำนวณเดียวกัน · พลาด = ไม่เก็บ (รอบหน้าคำนวณใหม่) */
const BADGE_TTL_MS = 3 * 60 * 1000;
let badgeCache_: { key: string; at: number; p: Promise<NavBadges> } | null = null;

interface NavBadges { sales: { urgent: number; warn: number }; contentads: { urgent: number } }

export function apiNavBadges(): Promise<NavBadges> {
  const key = fmtDateBkk(daysAgo(6));
  const now = Date.now();
  if (badgeCache_ && badgeCache_.key === key && now - badgeCache_.at < BADGE_TTL_MS) return badgeCache_.p;
  const deg = { v: false };
  const p = computeNavBadges_(key, deg);
  badgeCache_ = { key, at: now, p };
  const drop = () => { if (badgeCache_ && badgeCache_.p === p) badgeCache_ = null; };
  // พลาด หรือมีแหล่งพลาดแล้วถูกกลืนเป็น 0 = ไม่เก็บ (คำขอนี้ได้ผลแบบเดิมคนเดียว ไม่แจกเลข 0 ให้ทุกแท็บ 3 นาที)
  p.then(() => { if (deg.v) drop(); }, drop);
  return p;
}

async function computeNavBadges_(since: string, deg: { v: boolean }): Promise<NavBadges> {
  // หน้าต่างเดียวกับค่าเริ่มต้นของหน้า Content & Ads (7 วัน) เป๊ะ: [since .. พรุ่งนี้] หั่นตามวัน เรียง date,ad_id
  // (ลำดับแถวมีผลกับ "สถานะล่าสุด" ตอน updated_at เท่ากัน — ต้องเหมือน loadAdsFromDaily_ ใน contentads.ts)
  const until = fmtDateBkk(new Date(Date.now() + 86400000));
  const [alertState, adRows] = await Promise.all([
    db.from('sync_state').select('value').eq('key', 'unit_loss_alerts').maybeSingle(),
    fetchAllDateSliced<any>((f, t) => db.from('ad_daily')
      .select('date,ad_id,status,spend,meta_purchases,meta_purchase_value,updated_at')
      .gte('date', f).lte('date', t), since, until, { orderColumn: 'date,ad_id' })
      .catch(() => { deg.v = true; return [] as any[]; }),
  ]);
  if (alertState.error) deg.v = true;

  // ---- Sales: ยูนิตขาดทุน (จาก sync_state ที่งาน unit-alerts คำนวณไว้แล้ว) ----
  let salesUrgent = 0, salesWarn = 0;
  try {
    const alerts: any[] = JSON.parse(String(alertState.data?.value || '{}')).alerts || [];
    salesUrgent = alerts.filter((a) => a.level === 'urgent').length;
    salesWarn = alerts.filter((a) => a.level === 'warn').length;
  } catch { /* ยังไม่เคยรัน unit-alerts */ }

  // ---- Content & Ads: จำนวน "ด่วน" (แจ้งเตือนสีแดง) = ตัวเลขเดียวกับ summary.urgent ของ apiContentAds 7 วัน ----
  // พีสั่ง 28 ก.ย.: ป้ายเมนูต้องนับแบบเดียวกับในหน้า — เดิมกติกา "ไม่มีออเดอร์" ใช้ออเดอร์ POS แต่หน้าใช้ "ซื้อ" ของ Meta
  // และไม่ได้ปัด ROAS/ค่าแอดแบบหน้า เลขเลยไม่ตรงกัน · ทำซ้ำเฉพาะกติกา "แดง" 3 ข้อ แบบเดียวกับหน้าทุกตัวอักษร:
  //   ROAS<1 & ค่าแอด>300 | ค่าแอด>800 ไม่มี "ซื้อ" (Meta) | ROAS<0.6 & ค่าแอด>1200
  //   ROAS ปัด 2 ตำแหน่ง · ค่าแอดปัดเป็นบาท · สถานะ = แถวที่ updated_at ล่าสุด · เฉพาะแอดที่ยัง ACTIVE
  // แก้เกณฑ์ที่ apiContentAds เมื่อไหร่ต้องมาแก้ที่นี่ด้วย (เทียบ: temp/audit27/badgechk.ts)
  const byAd: Record<string, { spend: number; buys: number; metaValue: number; status: string; updatedAt: string }> = {};
  for (const r of adRows) {
    const id = String(r.ad_id || '');
    if (!id) continue;
    let a = byAd[id];
    if (!a) a = byAd[id] = { spend: 0, buys: 0, metaValue: 0, status: String(r.status || ''), updatedAt: '' };
    a.spend += num_(r.spend);
    a.buys += num_(r.meta_purchases);
    a.metaValue += num_(r.meta_purchase_value);
    const u = String(r.updated_at || '');
    if (u >= a.updatedAt) {
      a.updatedAt = u;
      if (r.status) a.status = String(r.status);
    }
  }
  let adsUrgent = 0;
  for (const id of Object.keys(byAd)) {
    const a = byAd[id];
    if (a.status.toUpperCase() !== 'ACTIVE') continue;   // แจ้งเตือนเฉพาะแอดที่ยังยิงอยู่ (เหมือน apiContentAds)
    const spend = Math.round(a.spend);
    const roas = a.spend > 0 ? Math.round((a.metaValue / a.spend) * 100) / 100 : null;
    if (roas !== null && roas < 1 && spend > 300) adsUrgent++;
    if (spend > 800 && a.buys === 0) adsUrgent++;
    if (roas !== null && roas < 0.6 && spend > 1200) adsUrgent++;
  }

  return {
    sales: { urgent: salesUrgent, warn: salesWarn },
    contentads: { urgent: adsUrgent },
  };
}
