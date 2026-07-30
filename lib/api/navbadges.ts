// lib/api/navbadges.ts — ตัวเลขแจ้งเตือนบนเมนูข้าง (แบบ badge แอปมือถือ) — บอสสั่ง 2026-07-30
//
// ต้องเบาพอให้ยิงซ้ำทุก 5 นาทีได้: อ่าน sync_state 1 แถว + ad_daily 7 วัน (ตารางเดียว)
// ห้ามลาก orders/สถิติแชทมาที่นี่ — นั่นคืองานของ apiSales/apiContentAds
import { db, fetchAll } from '@/lib/db';
import { fmtDateBkk, daysAgo } from '@/lib/config';

const num_ = (v: unknown): number => {
  const n = Number(v);
  return isFinite(n) ? n : 0;
};

export async function apiNavBadges() {
  const [alertState, adRows] = await Promise.all([
    db.from('sync_state').select('value').eq('key', 'unit_loss_alerts').maybeSingle(),
    // หน้าต่าง 7 วันเดียวกับค่าเริ่มต้นของหน้า Content & Ads — เลขบน badge ต้องตรงกับที่เห็นเมื่อเปิดหน้า
    fetchAll<any>(() => db.from('ad_daily')
      .select('ad_id,status,spend,pos_orders,meta_purchase_value')
      .gte('date', fmtDateBkk(daysAgo(6))), 'date,ad_id')
      .catch(() => [] as any[]),
  ]);

  // ---- Sales: ยูนิตขาดทุน (จาก sync_state ที่งาน unit-alerts คำนวณไว้แล้ว) ----
  let salesUrgent = 0, salesWarn = 0;
  try {
    const alerts: any[] = JSON.parse(String(alertState.data?.value || '{}')).alerts || [];
    salesUrgent = alerts.filter((a) => a.level === 'urgent').length;
    salesWarn = alerts.filter((a) => a.level === 'warn').length;
  } catch { /* ยังไม่เคยรัน unit-alerts */ }

  // ---- Content & Ads: จำนวนแจ้งเตือนสีแดง — เกณฑ์เดียวกับ alerts ใน apiContentAds ----
  // (ทำซ้ำเฉพาะกติกา "แดง" 3 ข้อ: ROAS<1 & spend>300 | spend>800 ไม่มีออเดอร์ | ROAS<0.6 & spend>1200)
  // แก้เกณฑ์ที่ apiContentAds เมื่อไหร่ต้องมาแก้ที่นี่ด้วย ไม่งั้นเลข badge ไม่ตรงหน้า
  const byAd: Record<string, { spend: number; orders: number; metaValue: number; status: string }> = {};
  for (const r of adRows) {
    const id = String(r.ad_id || '');
    if (!id) continue;
    const a = (byAd[id] = byAd[id] || { spend: 0, orders: 0, metaValue: 0, status: '' });
    a.spend += num_(r.spend);
    a.orders += num_(r.pos_orders);
    a.metaValue += num_(r.meta_purchase_value);
    if (r.status) a.status = String(r.status).toUpperCase(); // เรียงตามวัน — ตัวท้าย = สถานะล่าสุด
  }
  let adsUrgent = 0;
  for (const id of Object.keys(byAd)) {
    const a = byAd[id];
    if (a.status !== 'ACTIVE') continue;   // แจ้งเตือนเฉพาะแอดที่ยังยิงอยู่ (เหมือน apiContentAds)
    const roas = a.spend > 0 ? a.metaValue / a.spend : null;
    if (roas !== null && roas < 1 && a.spend > 300) adsUrgent++;
    if (a.spend > 800 && a.orders === 0) adsUrgent++;
    if (roas !== null && roas < 0.6 && a.spend > 1200) adsUrgent++;
  }

  return {
    sales: { urgent: salesUrgent, warn: salesWarn },
    contentads: { urgent: adsUrgent },
  };
}
