// lib/api/admincom.ts — ค่าคอมแอดมินรายเดือน (ตารางประเมินจากชีท Com:Admin) + ROAS จากระบบ
//
// บอสสั่ง (2026-07-30): หน้า Admin Performance ขอ "คงเหลือ" (ยอดจริงหลังหักตีกลับ/ยกเลิก) +
// "Commission @Admin" กรองได้ทุกเดือน พร้อม %ปิด กับ ROAS
//   • คงเหลือ/คอม/%ปิดลูกค้าใหม่ = ตัวเลขจากชีทตรงๆ (ทีมคิดเงื่อนไขคอมไว้แล้ว ห้ามคำนวณเอง)
//   • ROAS = จากระบบเรา (ชีทไม่มีรายคน) — ปันค่าแอดตามสัดส่วนยอดขายในแอด วิธีเดียวกับหน้า Ranking
import { db, fetchAll } from '@/lib/db';
import { EXCLUDED_STATUSES, isPlaceholderOrder, money_ } from '@/lib/config';
import { nicknameByName } from '@/lib/api/adminsettings';

function num_(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

const norm_ = (v: unknown) => String(v || '').replace(/\s+/g, ' ').trim();

export async function apiAdminCom(params: any) {
  const askMonth = /^\d{4}-\d{2}$/.test(String(params?.month || '')) ? String(params.month) : '';

  // ตารางเล็ก (หลักร้อยแถว) — ดึงทั้งหมดทีเดียว ได้ทั้งรายการเดือนและข้อมูลเดือนที่เลือก
  let comAll: any[];
  try {
    comAll = await fetchAll<any>(() =>
      db.from('admin_commission')
        .select('u,month,admin,real_name,sales,returns,cancel,remaining,com,com_sub,com_head,close_rate'),
      'key'
    );
  } catch (e: any) {
    const m = String((e && e.message) || e || '');
    // ยังไม่รัน migration v2 (ไม่มีคอลัมน์ remaining) หรือยังไม่มีตารางเลย → ให้หน้าเว็บบอกวิธี ไม่ใช่พังทั้งหน้า
    if (m.includes('remaining') || m.includes('close_rate') || m.includes('admin_commission')) {
      return { setupNeeded: true, months: [], month: '', rows: [], totals: null };
    }
    throw e;
  }

  const months = Array.from(new Set(comAll.map((r) => String(r.month)))).sort().reverse();
  if (!months.length) return { setupNeeded: true, months: [], month: '', rows: [], totals: null };
  const month = askMonth && months.includes(askMonth) ? askMonth : months[0];

  // map "ชื่อจริงในชีท" → ชื่อเล่น (ใช้ทุกเดือนรวมกัน — คนเดียวกันได้ nickname เดิมเสมอ)
  const realToNick: Record<string, string> = {};
  comAll.forEach((r) => {
    const rn = norm_(r.real_name);
    if (rn) realToNick[rn] = String(r.admin);
  });

  /* ---------- รวมแถวชีทของเดือนที่เลือก ต่อแอดมิน (คนเดียวขายหลายยูนิตได้) ---------- */
  const byAdmin: Record<string, any> = {};
  comAll.filter((r) => String(r.month) === month).forEach((r) => {
    const k = String(r.admin);
    if (!byAdmin[k]) {
      byAdmin[k] = {
        admin: k, realName: '', units: [] as string[],
        sales: 0, returns: 0, cancel: 0, remaining: 0, com: 0, comSub: 0, comHead: 0,
        _closeW: 0, _closeSum: 0,
      };
    }
    const a = byAdmin[k];
    if (!a.realName && r.real_name) a.realName = norm_(r.real_name);
    a.units.push(String(r.u));
    a.sales += num_(r.sales); a.returns += num_(r.returns); a.cancel += num_(r.cancel);
    a.remaining += num_(r.remaining);
    a.com += num_(r.com); a.comSub += num_(r.com_sub); a.comHead += num_(r.com_head);
    if (r.close_rate !== null && r.close_rate !== undefined) {
      const w = num_(r.sales) > 0 ? num_(r.sales) : 1; // ถ่วงด้วยยอดขาย — ยูนิตใหญ่ควรมีน้ำหนักกว่า
      a._closeW += w;
      a._closeSum += num_(r.close_rate) * w;
    }
  });

  /* ---------- ROAS รายคนของเดือนนั้นจากระบบ (orders + ad_daily) ----------
   * วิธีเดียวกับหน้า Ranking: spend_admin = Σ_ad spend(ad) × rev_admin_ad / rev_ad_total
   * เดือนก่อนพ.ค. 2026 ไม่มีออเดอร์ใน DB → ทุกคนได้ null (หน้าเว็บโชว์ "—")
   */
  const nickBy = await nicknameByName().catch(() => ({} as Record<string, string>));
  const mStart = new Date(`${month}-01T00:00:00+07:00`);
  const [y, mo] = month.split('-').map(Number);
  const mEnd = new Date(`${mo === 12 ? y + 1 : y}-${String(mo === 12 ? 1 : mo + 1).padStart(2, '0')}-01T00:00:00+07:00`);

  const [orders, adRows] = await Promise.all([
    fetchAll<any>(() =>
      db.from('orders')
        .select('inserted_at,status,total_price,items_count,seller_id,seller_name,creator_name,ad_id')
        .gte('inserted_at', mStart.toISOString())
        .lt('inserted_at', mEnd.toISOString())
    ),
    fetchAll<any>(() =>
      db.from('ad_daily').select('date,ad_id,spend').gte('date', `${month}-01`).lte('date', `${month}-31`),
      'date,ad_id'
    ).catch(() => [] as any[]),
  ]);

  const spendByAd: Record<string, number> = {};
  adRows.forEach((a) => {
    const id = String(a.ad_id || '');
    if (id) spendByAd[id] = (spendByAd[id] || 0) + num_(a.spend);
  });

  const revByAd: Record<string, number> = {};                    // ยอดรวมทุกคนต่อแอด — ตัวหารตอนปันค่าแอด
  const adRevByNick: Record<string, Record<string, number>> = {}; // nickname → {ad_id: ยอด}
  orders.forEach((o) => {
    if (EXCLUDED_STATUSES.indexOf(num_(o.status)) >= 0) return;
    if (isPlaceholderOrder(o)) return;
    const adId = String(o.ad_id || '');
    if (!adId) return;
    const price = money_(o.total_price);
    revByAd[adId] = (revByAd[adId] || 0) + price;
    const seller = norm_(o.seller_name || o.creator_name);
    const nick = nickBy[seller] || realToNick[seller] || '';
    if (!nick) return; // จับคู่ชื่อไม่ได้ → ไม่นับเข้าใคร (แต่ยังอยู่ในตัวหาร revByAd ถูกต้องแล้ว)
    if (!adRevByNick[nick]) adRevByNick[nick] = {};
    adRevByNick[nick][adId] = (adRevByNick[nick][adId] || 0) + price;
  });

  function roasOf_(adRev: Record<string, number> | undefined) {
    if (!adRev) return { roas: null as number | null, adSpend: 0, adRevenue: 0 };
    let rev = 0, spend = 0;
    Object.keys(adRev).forEach((adId) => {
      const s = spendByAd[adId] || 0;
      const total = revByAd[adId] || 0;
      if (!(s > 0) || !(total > 0)) return; // นับเฉพาะแอดที่มีค่าแอดจริง — กัน ROAS พองแบบหน้า Ranking
      rev += adRev[adId];
      spend += s * (adRev[adId] / total);
    });
    return {
      roas: spend > 0 ? Math.round((rev / spend) * 100) / 100 : null,
      adSpend: Math.round(spend),
      adRevenue: Math.round(rev),
    };
  }

  /* ---------- ประกอบแถว ---------- */
  const rows = Object.keys(byAdmin).map((k) => {
    const a = byAdmin[k];
    const ad = roasOf_(adRevByNick[k]);
    return {
      admin: a.admin,
      realName: a.realName,
      units: a.units.sort(),
      sales: Math.round(a.sales),
      returns: Math.round(a.returns),
      cancel: Math.round(a.cancel),
      remaining: Math.round(a.remaining),
      com: Math.round(a.com * 100) / 100,
      comSub: Math.round(a.comSub * 100) / 100,
      comHead: Math.round(a.comHead * 100) / 100,
      closeRate: a._closeW > 0 ? Math.round((a._closeSum / a._closeW) * 10) / 10 : null,
      roas: ad.roas,
      adSpend: ad.adSpend,
    };
  }).sort((x, b) => b.remaining - x.remaining);

  const totals = {
    sales: rows.reduce((s, r) => s + r.sales, 0),
    returns: rows.reduce((s, r) => s + r.returns, 0),
    remaining: rows.reduce((s, r) => s + r.remaining, 0),
    com: Math.round(rows.reduce((s, r) => s + r.com, 0) * 100) / 100,
    admins: rows.length,
  };

  return {
    setupNeeded: false,
    months,
    month,
    rows,
    totals,
    // เดือนที่ระบบไม่มีออเดอร์เลย (ก่อน 23 พ.ค. 2026) — ให้หน้าเว็บอธิบายว่าทำไม ROAS เป็น "—"
    hasSystemOrders: orders.length > 0,
  };
}
