// lib/api/me.ts — "ผลงานของฉัน" สำหรับผู้ใช้ระดับแอดมิน
//
// หลักคิดด้านความปลอดภัย: ตัวตนมาจาก session (header ที่ middleware เซ็ต) **ไม่ใช่จาก params**
// ผู้ใช้จึงขอดูข้อมูลของคนอื่นไม่ได้แม้จะยิง API ตรงๆ
//
// ตัวเลขทุกตัวมาจาก apiAdminPerf ตัวเดียวกับหน้า Ranking แล้วคัดเฉพาะแถวของตัวเอง —
// ทำแบบนี้เพื่อให้ "ยอดของฉัน" ตรงกับที่หัวหน้าเห็นเป๊ะ (สูตรเดียวกัน ไม่มีทางเพี้ยนคนละทาง)
// แล้ว **ตัดข้อมูลของคนอื่นทิ้งก่อนส่งออก** เหลือแค่อันดับ (ตัวเลข) กับค่าเฉลี่ยทีมเป็นตัวเทียบ
import { apiAdminPerf } from '@/lib/api/adminperf';
import { caller } from '@/lib/api/session';
import { db } from '@/lib/db';

function num_(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

export async function apiMe(params: any) {
  const c = await caller();
  if (!c.username) {
    const e: any = new Error('ยังไม่ได้เข้าสู่ระบบ');
    e.status = 401;
    throw e;
  }

  // ผู้ใช้ระดับ exec/superadmin ที่ไม่ได้ผูกแอดมิน จะเปิดหน้านี้แล้วว่าง — บอกให้ชัดแทนโชว์ 0
  let adminId = c.adminUserId;
  if (!adminId) {
    // เผื่อ cookie ออกก่อนที่ผู้ดูแลจะผูกแอดมินให้ — อ่านค่าล่าสุดจาก DB อีกที
    const { data } = await db.from('app_users').select('admin_user_id').ilike('username', c.username).maybeSingle();
    adminId = String((data && data.admin_user_id) || '');
  }
  if (!adminId) {
    return { linked: false, message: 'บัญชีนี้ยังไม่ได้ผูกกับแอดมินในระบบ — ติดต่อผู้ดูแลระบบ' };
  }

  const perf: any = await apiAdminPerf({
    preset: (params && params.preset) || 'today',
    from: params && params.from,
    to: params && params.to,
    channel: (params && params.channel) || '',
  });

  const rows: any[] = Array.isArray(perf.rows) ? perf.rows : [];
  // จัดอันดับด้วยยอดขาย (เกณฑ์เดียวกับหน้า Ranking โหมด "ยอดขายดีที่สุด")
  const ranked = rows.slice().sort((a, b) => num_(b.revenue) - num_(a.revenue));
  const idx = ranked.findIndex((r) => String(r.id) === String(adminId));
  const mine = idx >= 0 ? ranked[idx] : null;

  if (!mine) {
    return {
      linked: true,
      rangeLabel: perf.rangeLabel,
      empty: true,
      message: 'ยังไม่มีข้อมูลของคุณในช่วงเวลานี้',
    };
  }

  // ค่าเฉลี่ยทีม (ไม่เปิดเผยว่าใครได้เท่าไร) — ให้เห็นว่าตัวเองอยู่ตรงไหนโดยไม่เห็นข้อมูลเพื่อน
  const n = ranked.length || 1;
  const avg = {
    revenue: Math.round(ranked.reduce((s, r) => s + num_(r.revenue), 0) / n),
    orders: Math.round(ranked.reduce((s, r) => s + num_(r.orders), 0) / n),
    chats: Math.round(ranked.reduce((s, r) => s + num_(r.chats), 0) / n),
  };
  const closeRates = ranked.map((r) => r.closeRate).filter((v) => v !== null && v !== undefined) as number[];
  const avgClose = closeRates.length
    ? Math.round((closeRates.reduce((s, v) => s + v, 0) / closeRates.length) * 10) / 10
    : null;

  const best = ranked[0] ? num_(ranked[0].revenue) : 0;

  return {
    linked: true,
    rangeLabel: perf.rangeLabel,
    slaMins: perf.slaMins,
    // ⚠️ ส่งเฉพาะแถวของตัวเอง — ห้ามส่ง perf.rows ทั้งก้อนออกไป (จะรั่วยอดขายเพื่อนร่วมงาน)
    me: mine,
    rank: idx + 1,
    teamSize: ranked.length,
    teamAvg: { ...avg, closeRate: avgClose },
    topRevenue: best, // ไว้ทำแถบเทียบ "อันดับ 1 ทำได้เท่าไร" โดยไม่บอกว่าเป็นใคร
    targets: perf.targets || null, // เป้า KPI (ถ้าตั้งไว้)
  };
}
