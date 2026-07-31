// scripts/sync/jobs.ts — งาน sync ทั้งหมด (port จาก Sync*.gs + Setup.gs trigger entry points)
import {
  requireCredentials, daysAgo, startOfDayBkk, fmtDateBkk, parsePancakeTime, num, sleep, RETENTION_DAYS,
  EXCLUDED_STATUSES, NEED_CHECK_STATUSES, isPlaceholderOrder, money_,
} from '../../lib/config';
import {
  posFetchOrders, posFetchUsers, posFetchAds, posFetchCampaigns,
  pageChatStats, pageConversations, pageUserStats, pageUsers, pageAdStats, pageCustomerEngagements,
  pagesListPages, pagesGenerateToken,
} from '../../lib/pancake';
import { mapOrder, mapChatHour, mapConversation, mapAd, mapAdDaily, mapEngagementDaily } from '../../lib/mappers';
import {
  metaListAdAccounts, metaAccountAdInsights, metaAccountAdCreatives, metaAdCreativesByIds, metaPool,
} from '../../lib/meta';
import { supabase, upsertRows, replaceTable, setState } from '../../lib/supabase';
import { getUnitsForAlert } from '../../lib/api/umap';
import { nicknameByName } from '../../lib/api/adminsettings';
import { googleConfigured, driveListSheets, sheetTabs, sheetValuesBatch } from '../../lib/google';
import { unitFromTitle, parseSalesSummary, parseCommission } from '../../lib/productsheet';
import { parseKpiAdminMonth, parseKpiSubMonth, parseKpiHeadMonth, parseKpiAdminYear } from '../../lib/kpisheet';

/* ---------------- helper: โหลดเพจ + token จาก DB ---------------- */

async function loadPagesWithTokens(): Promise<{ pages: any[]; tokens: Record<string, string> }> {
  const { data: pages } = await supabase.from('pages').select('*');
  const { data: toks } = await supabase.from('page_tokens').select('page_id, token');
  const tokens: Record<string, string> = {};
  (toks || []).forEach((t: any) => { tokens[String(t.page_id)] = t.token; });
  const withToken = (pages || []).filter((p: any) => tokens[String(p.page_id)]);
  return { pages: withToken, tokens };
}

async function platformByPage(): Promise<Record<string, string>> {
  const { data } = await supabase.from('pages').select('page_id, platform');
  const m: Record<string, string> = {};
  (data || []).forEach((p: any) => { m[String(p.page_id)] = p.platform; });
  return m;
}

/* ---------------- แจ้งเตือน "ยูนิตขาดทุน" ---------------- */

/** จำนวนวันย้อนหลังที่ใช้ไล่นับ streak — ยาวพอเห็นแนวโน้ม ไม่ยาวจนคิวรีหนัก */
const LOSS_LOOKBACK_DAYS = 14;

/**
 * หา "ยูนิตที่ขาดทุน" รายวัน แล้วเก็บผลไว้ใน sync_state ให้หน้าเว็บอ่านทีเดียวจบ
 *
 * ⚠️ นิยาม "ขาดทุน" ที่ระบบวัดได้ = **ยอดขาย < ค่าแอด × ROAS จุดคุ้มทุนของยูนิต**
 * ไม่ใช่กำไรขาดทุนจริง เพราะต้นทุนสินค้าในระบบเป็น 0 ทุกตัว (ดูบันทึกเรื่องข้อมูลที่ขาด)
 * ค่าเริ่มต้น breakEven = 1.0 คือ "ขายได้น้อยกว่าค่าแอด" ซึ่งเป็นเพดานล่างสุด — ของจริงแย่กว่านี้
 * ทีมตั้ง breakEven ต่อยูนิตเองได้ที่หน้า Sales เพื่อให้ใกล้ความจริงขึ้น
 *
 * นับเฉพาะ "วันที่จบแล้ว" (ถึงเมื่อวาน) — วันนี้ค่าแอดเดินไปเรื่อยๆ ขณะที่ยอดขายตามมาทีหลัง
 * ถ้าเอาวันนี้มาตัดสินจะเตือนผิดทุกเช้า
 *
 * วันที่ไม่ได้ยิงแอดเลย (spend = 0) ถือว่า "ตัดสินไม่ได้" และทำให้ streak ขาด — ไม่ใช่วันขาดทุน
 */
export async function syncUnitAlerts(): Promise<string> {
  const units = await getUnitsForAlert();
  const unitOf: Record<string, string> = {};
  units.forEach((u) => u.pages.forEach((p) => { unitOf[p] = u.u; }));
  if (!Object.keys(unitOf).length) return 'ข้าม: ยังไม่มีเพจผูกกับยูนิตเลย';

  const sinceDate = daysAgo(LOSS_LOOKBACK_DAYS);
  const sinceStr = fmtDateBkk(sinceDate);
  const todayStr = fmtDateBkk(new Date());
  // "ทั้งเดือน" ยึดเดือนของเมื่อวาน (วันที่จบแล้ววันล่าสุด) — บอสขอให้การ์ดโชว์ขาดทุนสะสมทั้งเดือน ไม่ใช่แค่ช่วง streak
  const yesterdayStr = fmtDateBkk(daysAgo(1));
  const monthStartStr = yesterdayStr.slice(0, 7) + '-01';
  const profFromStr = monthStartStr < sinceStr ? monthStartStr : sinceStr;

  // ---- ยอดขายรายวันต่อยูนิต (เฉพาะออเดอร์ที่ยืนยันแล้ว เหมือนนิยามยอดขายหลัก) ----
  const rev: Record<string, number> = {};
  {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase.from('orders')
        .select('id,inserted_at,status,total_price,items_count,page_id')
        .gte('inserted_at', sinceDate.toISOString())
        .order('id', { ascending: true }).range(from, from + 999);
      if (error) throw new Error(`อ่าน orders ล้มเหลว: ${error.message}`);
      const rows = data || [];
      for (const o of rows as any[]) {
        const st = num(o.status);
        if (EXCLUDED_STATUSES.indexOf(st) >= 0 || NEED_CHECK_STATUSES.indexOf(st) >= 0) continue;
        if (isPlaceholderOrder(o)) continue;
        const u = unitOf[String(o.page_id || '')];
        if (!u) continue;
        const d = fmtDateBkk(new Date(o.inserted_at));
        rev[`${d}|${u}`] = (rev[`${d}|${u}`] || 0) + money_(o.total_price);
      }
      if (rows.length < 1000) break;
      from += 1000;
    }
  }

  // ---- ค่าแอดรายวันต่อยูนิต ----
  const spend: Record<string, number> = {};
  {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase.from('ad_daily')
        .select('date,ad_id,page_id,spend').gte('date', sinceStr)
        .order('date', { ascending: true }).order('ad_id', { ascending: true })
        .range(from, from + 999);
      if (error) throw new Error(`อ่าน ad_daily ล้มเหลว: ${error.message}`);
      const rows = data || [];
      for (const a of rows as any[]) {
        const u = unitOf[String(a.page_id || '')];
        if (!u) continue;
        const d = String(a.date || '').slice(0, 10);
        spend[`${d}|${u}`] = (spend[`${d}|${u}`] || 0) + num(a.spend);
      }
      if (rows.length < 1000) break;
      from += 1000;
    }
  }

  // ---- กำไรสุทธิจริงรายวันต่อยูนิต (unit_daily จากชีท) ----
  // มีข้อมูล = ตัดสินด้วย "กำไรจริง < 0" ตรงๆ (ชีทหักต้นทุน+สำรองตีกลับแล้ว)
  // ROAS < breakEven เหลือเป็น fallback สำหรับวัน/ยูนิตที่ชีทไม่มี — ROAS 1.0 หลวมเกินไป
  // (ชีททีมเขียนเองว่า "ROAS รวม *ห้าม ≤ 3" — ขาย 2 เท่าของค่าแอดก็ยังขาดทุนจริง)
  const prof: Record<string, { profit: number; sales: number; ads: number }> = {};
  try {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase.from('unit_daily')
        .select('key,u,date,profit,sales,ads').gte('date', profFromStr)
        .order('key', { ascending: true }).range(from, from + 999);
      if (error) throw new Error(error.message);
      const rows = data || [];
      for (const p of rows as any[]) {
        const d = String(p.date || '').slice(0, 10);
        prof[`${d}|${String(p.u)}`] = { profit: num(p.profit), sales: num(p.sales), ads: num(p.ads) };
      }
      if (rows.length < 1000) break;
      from += 1000;
    }
  } catch { /* ยังไม่รัน migration unit_daily → ใช้ ROAS ล้วนเหมือนเดิม */ }
  const profUnits = new Set(Object.keys(prof).map((k) => k.split('|')[1]));

  // ---- ไล่ย้อนจากเมื่อวานหา streak ----
  // ยาวพอครอบทั้งเดือน — ยูนิตที่มีกำไรจริงจากชีทจะนับ streak ได้เกิน 14 วัน (เช่น "ขาดทุน 29 วันติด")
  // ยูนิตสาย ROAS ไม่มีข้อมูล orders/ads เกิน 14 วัน → streak หยุดที่ 14 เหมือนเดิม (spend ว่าง = ตัดสินไม่ได้)
  const dayCount = Math.max(LOSS_LOOKBACK_DAYS, Number(yesterdayStr.slice(8, 10)));
  const dayList: string[] = [];
  for (let i = 1; i <= dayCount; i++) dayList.push(fmtDateBkk(daysAgo(i)));   // เมื่อวาน → เก่าสุด
  const nickBy = await nicknameByName().catch(() => ({} as Record<string, string>));

  const alerts: any[] = [];
  for (const u of units) {
    // ไม่มีทั้งเพจผูก (คิด ROAS ไม่ได้) และข้อมูลชีท (คิดกำไรไม่ได้) → ข้าม
    if (!u.pages.length && !profUnits.has(u.u)) continue;
    const daily: Array<{ date: string; revenue: number; spend: number; profit: number | null }> = [];
    let streak = 0, lossRev = 0, lossSpend = 0, lossProfit = 0, broke = false;
    let usedProfit = 0, usedRoas = 0;
    for (const d of dayList) {
      const r = rev[`${d}|${u.u}`] || 0;
      const s = spend[`${d}|${u.u}`] || 0;
      const pd = prof[`${d}|${u.u}`];
      // แถวที่ทุกช่องเป็น 0 = ชีทยังไม่กรอกวันนั้น (สูตรคืนค่าว่าง) — ห้ามตีความว่า "กำไร 0 บาท"
      const hasProfit = !!pd && (pd.profit !== 0 || pd.sales > 0 || pd.ads > 0);
      if (!broke) {
        if (hasProfit) {
          // กำไรจริงตัดสินได้เสมอ — วันไม่ยิงแอดแต่ขาดทุนก็คือขาดทุน (ไม่เหมือน ROAS ที่ตัดสินไม่ได้)
          if (pd!.profit < 0) {
            streak++; lossProfit += pd!.profit; usedProfit++;
            lossRev += pd!.sales || r; lossSpend += pd!.ads || s;
          } else broke = true;
        } else if (s <= 0) broke = true;                // ไม่ได้ยิงแอด = ตัดสินไม่ได้ streak ขาด
        else if (r < s * u.breakEven) { streak++; lossRev += r; lossSpend += s; usedRoas++; }
        else broke = true;
      }
      // กราฟบนการ์ดโชว์ 14 วันพอ — dayList อาจยาวถึงทั้งเดือน (ไว้นับ streak/ยอดสะสม)
      if (daily.length < LOSS_LOOKBACK_DAYS) daily.push({
        date: d, revenue: Math.round(r), spend: Math.round(s),
        profit: hasProfit ? Math.round(pd!.profit) : null,
      });
    }
    if (!streak) continue;

    // ---- ขาดทุนสะสมทั้งเดือนของเมื่อวาน (เฉพาะวันที่ชีทกรอกแล้ว) — ที่บอสให้โชว์แทนยอดช่วง streak ----
    let monthProfit = 0, monthSales = 0, monthAds = 0, monthLossDays = 0, monthHas = false;
    for (const d of dayList) {
      if (d < monthStartStr) continue;
      const pd = prof[`${d}|${u.u}`];
      if (!pd || (pd.profit === 0 && pd.sales <= 0 && pd.ads <= 0)) continue;
      monthHas = true;
      monthProfit += pd.profit; monthSales += pd.sales; monthAds += pd.ads;
      if (pd.profit < 0) monthLossDays++;
    }
    alerts.push({
      u: u.u,
      product: u.product,
      days: streak,
      level: streak >= 2 ? 'urgent' : 'warn',
      revenue: Math.round(lossRev),
      spend: Math.round(lossSpend),
      loss: usedProfit ? Math.abs(Math.round(lossProfit)) : Math.round(lossSpend - lossRev),
      // basis บอกหน้าเว็บว่าตัวเลขนี้มาจากอะไร: กำไรจริงจากชีท หรือ ROAS โดยประมาณ
      basis: usedProfit && usedRoas ? 'mixed' : usedProfit ? 'profit' : 'roas',
      profitLoss: usedProfit ? Math.round(lossProfit) : null, // ยอดขาดทุนจริงรวม (ติดลบ)
      // สะสมทั้งเดือนนี้ (กำไรสุทธิรวมทุกวันที่ชีทกรอก รวมวันบวกด้วย) — การ์ดใช้ตัวนี้เป็นหลัก
      monthProfit: monthHas ? Math.round(monthProfit) : null,
      monthSales: monthHas ? Math.round(monthSales) : null,
      monthAds: monthHas ? Math.round(monthAds) : null,
      monthLossDays,
      roas: lossSpend > 0 ? Math.round((lossRev / lossSpend) * 100) / 100 : null,
      breakEven: u.breakEven,
      // ผู้รับผิดชอบ = แอดมินที่ผูกกับยูนิตในหน้า U Map แสดงเป็นชื่อเล่นตามที่ทีมขอ
      owners: u.admins.map((n) => nickBy[String(n).replace(/\s+/g, ' ').trim()] || n),
      daily: daily.slice().reverse(),   // เก่า → ใหม่ ให้กราฟอ่านง่าย
    });
  }
  alerts.sort((a, b) => (b.days - a.days) || (b.loss - a.loss));

  const noOwner = alerts.filter((a) => !a.owners.length).length;
  await setState('unit_loss_alerts', JSON.stringify({
    computedAt: new Date().toISOString(),
    throughDate: dayList[0],     // วันล่าสุดที่นับ (= เมื่อวาน)
    todayStr,
    alerts,
  }));
  return `unit alerts: เตือน ${alerts.length} ยูนิต (ด่วน ${alerts.filter((a) => a.level === 'urgent').length}` +
    (noOwner ? `, ไม่มีผู้รับผิดชอบ ${noOwner}` : '') + `) ถึง ${dayList[0]}`;
}

/* ---------------- ชีทสรุปรายสินค้า (กำไรจริง + ค่าคอมแอดมิน) ---------------- */

/** โฟลเดอร์ "สรุปยอดรายสินค้า" — รับได้ทั้งลิงก์เต็มและรหัสโฟลเดอร์เปล่าๆ */
function productFolderId_(): string {
  const raw = String(process.env.GOOGLE_DRIVE_PRODUCT_SALES_SUMMARY || '').trim();
  const m = raw.match(/\/folders\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : raw;
}

/**
 * ดึง "กำไรสุทธิรายวันต่อยูนิต" + "ค่าคอมแอดมินรายเดือน" จากชีทสรุปรายสินค้า
 *
 * ทำไมต้องเอาจากชีท: กำไรจริงคำนวณเองไม่ได้ — ต้นทุนสินค้าใน Pancake POS เป็น 0 ทุกตัว
 * ชีทของทีมหักต้นทุน + สำรองตีกลับมาแล้ว จึงเป็นแหล่งเดียวที่บอก "กำไร" ได้จริง
 *
 * 1 ไฟล์ = 1 ยูนิต โดยดูรหัสจากชื่อไฟล์ (`สร. UN3 : ...` → UN3)
 * ไฟล์ที่อ่านรหัสไม่ออกจะถูกข้ามและฟ้องชื่อไว้ท้ายข้อความ — ดีกว่าเดาแล้วยัดผิดยูนิต
 */
export async function syncProductSheets(): Promise<string> {
  if (!googleConfigured()) return 'ข้าม: ยังไม่ได้ตั้ง GOOGLE_SA_KEY';
  const folder = productFolderId_();
  if (!folder) return 'ข้าม: ยังไม่ได้ตั้ง GOOGLE_DRIVE_PRODUCT_SALES_SUMMARY';

  const files = await driveListSheets(folder);
  if (!files.length) return `ไม่พบไฟล์ในโฟลเดอร์ ${folder}`;

  const dailyRows: any[] = [];
  const comRows: any[] = [];
  const skipped: string[] = [];
  const problems: string[] = [];
  const now = new Date().toISOString();

  for (const f of files) {
    const u = unitFromTitle(f.name);
    if (!u) { skipped.push(f.name); continue; }
    // 2 แท็บ 1 คำขอ — ประหยัดโควตา Sheets API
    const batch = await sheetValuesBatch(f.id, [`'สรุปยอดขาย'!A1:BZ700`, `'Com:Admin'!A1:AZ700`]);
    const salesGrid = batch[`'สรุปยอดขาย'!A1:BZ700`] || [];
    const comGrid = batch[`'Com:Admin'!A1:AZ700`] || [];

    const daily = parseSalesSummary(salesGrid);
    if (!daily.length) problems.push(`${u}: ไม่เจอข้อมูลในแท็บ สรุปยอดขาย`);
    daily.forEach((d) => dailyRows.push({
      key: `${u}|${d.date}`, u, date: d.date, file_id: f.id,
      sales: d.sales, orders: d.orders, ads: d.ads, profit: d.profit, margin: d.margin,
      updated_at: now,
    }));

    parseCommission(comGrid).forEach((c) => comRows.push({
      key: `${u}|${c.month}|${c.admin}`, u, month: c.month, admin: c.admin,
      real_name: c.realName,
      sales: c.sales, returns: c.returns, cancel: c.cancel, remaining: c.remaining,
      com: c.com, com_sub: c.comSub, com_head: c.comHead, close_rate: c.closeRate,
      updated_at: now,
    }));
  }

  if (dailyRows.length) await upsertRows('unit_daily', dailyRows, 'key');
  // ค่าคอมใช้ replace ทั้งตาราง — parser เปลี่ยนที่มา (ตารางประเมิน) แล้ว แถวชุดเก่าที่ key
  // ไม่ตรงกับรอบใหม่จะค้างเป็นข้อมูลผีถ้า upsert เฉยๆ (ตารางนี้ derive จากชีทล้วนๆ ลบสร้างใหม่ได้)
  // ⚠️ เช็คคอลัมน์ใหม่ก่อนลบ — ถ้ายังไม่รัน migration v2 แล้ว replace จะ "ลบสำเร็จ insert พัง"
  // เหลือตารางว่างเปล่าไปจนกว่าจะรัน (ลำดับผิดพลาดที่เจ็บจริง ไม่ใช่แค่ error เฉยๆ)
  if (comRows.length) {
    const probe = await supabase.from('admin_commission').select('remaining').limit(1);
    if (probe.error) {
      return `product sheets: รายวัน ${dailyRows.length} แถวเข้าแล้ว | ⏳ ค่าคอมข้าม — ` +
        `รอรัน db/migrations/2026-07-31-admin-commission-v2.sql (${probe.error.message.slice(0, 60)})`;
    }
    await replaceTable('admin_commission', comRows, 'key');
  }

  const units = new Set(dailyRows.map((r) => r.u));
  let msg = `product sheets: ${units.size} ยูนิต | รายวัน ${dailyRows.length} แถว | ค่าคอม ${comRows.length} แถว`;
  if (skipped.length) msg += ` | อ่านรหัส U ไม่ออก ${skipped.length}: ${skipped.slice(0, 3).join(', ')}`;
  if (problems.length) msg += ` | ⚠️ ${problems.slice(0, 3).join('; ')}`;
  return msg;
}

/* ---------------- ชีท KPI กลางของทีม (คะแนน KPI ทุกตำแหน่ง) ---------------- */

/** ชีท KPI — เปลี่ยนได้ผ่าน env เผื่อทีมทำชีทปีใหม่ */
const KPI_SHEET_ID = process.env.KPI_SHEET_ID || '1J_sTV9obDUXrYuQzPK7bCyz4ZC6Fygjc8cLZrYNtgK0';
const KPI_SHEET_YEAR = 2026; // ชีทนี้คือ KPI ปี 2026 — ปีหน้าทีมสร้างชีทใหม่ค่อยอัปเดต

/**
 * ดึงคะแนน KPI รายคนรายเดือน (แอดมิน/รองหัวหน้า/หัวหน้า + สรุปปี) จากชีท KPI ของทีม
 * เก็บเป็น JSON ก้อนเดียวใน sync_state 'kpi_scores' — ไม่ต้องรัน migration
 * เราไม่คำนวณคะแนนเอง (สูตรอยู่ในชีท) — อ่านผลมาแสดงอย่างเดียว ดู lib/kpisheet.ts
 */
export async function syncKpiSheet(): Promise<string> {
  if (!googleConfigured()) return 'ข้าม: ยังไม่ได้ตั้ง GOOGLE_SA_KEY';
  const ranges = [
    `'KPI ADMIN/month'!A1:HH300`,
    `'KPI รอง ADMIN/month'!A1:HH100`,
    `'KPI หัวหน้า ADMIN/month'!A1:DZ60`,
    `'KPI ADMIN/year'!A1:AB300`,
    `'เป้ายอดขาย'!A1:P40`,
    `'0.ข้อมูล'!A1:B60`,
  ];
  const batch = await sheetValuesBatch(KPI_SHEET_ID, ranges);
  const admin = parseKpiAdminMonth(batch[ranges[0]] || []);
  const sub = parseKpiSubMonth(batch[ranges[1]] || []);
  const head = parseKpiHeadMonth(batch[ranges[2]] || []);
  const year = parseKpiAdminYear(batch[ranges[3]] || []);

  // เป้ายอดขายรายเดือน×ยูนิต (คอลัมน์ C..N = ม.ค...ธ.ค., '-' = ไม่ตั้งเป้า)
  const targets: Record<string, number[]> = {};
  for (const row of batch[ranges[4]] || []) {
    const m = String(row[1] || '').toUpperCase().match(/^(UN?\d{1,3})\b/);
    if (!m) continue;
    const arr: number[] = [];
    for (let i = 0; i < 12; i++) {
      const n = Number(String(row[2 + i] ?? '').replace(/,/g, ''));
      arr.push(isFinite(n) && n > 0 ? n : 0);
    }
    // ยูนิตซ้ำ (เช่น U4 สองแถว = สินค้าคนละตัวในยูนิตเดียว) → รวมเป้าเข้าด้วยกัน
    const prev = targets[m[1]];
    targets[m[1]] = prev ? prev.map((v, i) => v + arr[i]) : arr;
  }

  // สินค้าเทส/สถานะยูนิต จากแท็บ 0.ข้อมูล — "U7 : ครีมรกแกะ ❌" = เทสแล้วไม่ติด, ✅ = ติด, ไม่มีเครื่องหมาย = ยังไม่ตัดสิน
  const testProducts: Array<{ u: string; name: string; ok: boolean | null }> = [];
  for (const row of batch[ranges[5]] || []) {
    const s = String(row[0] || '').trim();
    const m = s.toUpperCase().match(/^(UN?\d{1,3})\s*:/);
    if (!m) continue;
    const name = s.replace(/^[^:]*:\s*/, '').replace(/[✅❌]/g, '').trim();
    const ok = s.includes('✅') ? true : s.includes('❌') ? false : null;
    testProducts.push({ u: m[1], name, ok });
  }

  const months = Object.keys(admin).map(Number).sort((a, b) => a - b);
  if (!months.length) return '⚠️ อ่านชีท KPI ไม่เจอข้อมูลเลย — โครงชีทอาจเปลี่ยน (ดู lib/kpisheet.ts)';

  await setState('kpi_scores', JSON.stringify({
    year: KPI_SHEET_YEAR, sheetId: KPI_SHEET_ID,
    admin, sub, head, adminYear: year, targets, testProducts,
    updatedAt: new Date().toISOString(),
  }));
  const last = months[months.length - 1];
  return `KPI sheet: แอดมิน ${months.length} เดือน (ล่าสุดเดือน ${last}: ${(admin[last] || []).length} แถว) | ` +
    `รอง ${(sub[last] || []).length} แถว | หัวหน้า ${(head[last] || []).length} คน | สรุปปี ${year.length} คน`;
}

/* ---------------- RETURNS (สินค้าตีกลับ — จาก Google Sheets ของทีม) ---------------- */

/** โฟลเดอร์ "สรุปตีกลับ PN 2569" — ทีมย้ายไฟล์รายเดือนมารวมไว้ที่นี่ (เปลี่ยนได้ผ่าน env) */
const RETURNS_FOLDER = process.env.RETURNS_FOLDER_ID || '1-TRsabuDqS6x9KynI7niTncbCqwMh1Pd';

/** 'd/m/yyyy' (รูปแบบที่ชีทใช้) → 'YYYY-MM-DD' — คืน null ถ้าอ่านไม่ออก */
function parseSheetDate_(s: unknown): string | null {
  const t = String(s || '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

function sheetNum_(s: unknown): number {
  const n = Number(String(s || '').replace(/,/g, '').trim());
  return isFinite(n) ? n : 0;
}

/**
 * ดึงสินค้าตีกลับจากชีทรายเดือนทั้งโฟลเดอร์ ลงตาราง `returns`
 *
 * โครงตารางในชีท: หัวตารางคือแถวที่มีทั้ง "วันที่สั่งซื้อ" และ "พนักงาน"
 * คอลัมน์ถัดจากนั้น: เลขพัสดุขาออก | ลูกค้า | เบอร์โทร | วันที่รับตีกลับ | เลขพัสดุขากลับ |
 *                    ชื่อสินค้า | ราคา | จำนวนชิ้น | พนักงาน | เดือนที่รับตีกลับ
 * ตำแหน่งคอลัมน์อ่านจากหัวตารางจริง ไม่ fix index — ทีมแทรกคอลัมน์เพิ่มได้โดยไม่พัง
 *
 * ⚠️ บางไฟล์มีแท็บที่เนื้อหาซ้ำกันเป๊ะ (ก๊อปไว้ให้ฝ่ายแพ็ค) จึงตัดซ้ำด้วยลายนิ้วมือของแถว
 * ไม่งั้นยอดตีกลับจะเบิ้ลเป็นสองเท่าแบบเงียบๆ
 */
export async function syncReturns(): Promise<string> {
  if (!googleConfigured()) return 'ข้าม: ยังไม่ได้ตั้ง GOOGLE_SA_KEY';
  const files = await driveListSheets(RETURNS_FOLDER);
  if (!files.length) return `ไม่พบไฟล์ในโฟลเดอร์ ${RETURNS_FOLDER}`;

  let total = 0;
  const parts: string[] = [];
  for (const f of files) {
    const tabs = await sheetTabs(f.id);
    const ranges = tabs.map((t) => `'${t.replace(/'/g, "''")}'!A1:R2000`);
    const batch = await sheetValuesBatch(f.id, ranges);

    const rows: any[] = [];
    const seen = new Set<string>();
    let rowNo = 0;
    for (const rangeKey of Object.keys(batch)) {
      const grid = batch[rangeKey];
      // หาแถวหัวตาราง
      let head = -1;
      const idx: Record<string, number> = {};
      for (let i = 0; i < grid.length && head < 0; i++) {
        const cells = grid[i].map((c) => String(c || '').trim());
        if (cells.indexOf('วันที่สั่งซื้อ') >= 0 && cells.indexOf('พนักงาน') >= 0) {
          head = i;
          cells.forEach((c, j) => { if (c && idx[c] === undefined) idx[c] = j; });
        }
      }
      if (head < 0) continue;

      const at = (r: string[], name: string) => {
        const j = idx[name];
        return j === undefined ? '' : String(r[j] || '').trim();
      };
      let blanks = 0;
      for (let i = head + 1; i < grid.length; i++) {
        const r = grid[i];
        const orderDate = parseSheetDate_(at(r, 'วันที่สั่งซื้อ'));
        const staff = at(r, 'พนักงาน');
        if (!orderDate || !staff) {
          if (++blanks > 30) break;   // เจอช่องว่างยาว = จบตาราง (เว้นบรรทัดคั่นกลางมีบ้าง)
          continue;
        }
        blanks = 0;
        const product = at(r, 'ชื่อสินค้า');
        const price = sheetNum_(at(r, 'ราคา'));
        const shipTracking = at(r, 'เลขพัสดุขาออก');
        // ลายนิ้วมือกันแท็บซ้ำ — ออเดอร์เดียวกันของพนักงานคนเดียวกัน สินค้าเดียวกัน ราคาเดียวกัน
        const fp = [orderDate, shipTracking, product, staff, price].join('|');
        if (seen.has(fp)) continue;
        seen.add(fp);

        const returnDate = parseSheetDate_(at(r, 'วันที่รับตีกลับ'));
        rows.push({
          key: `${f.id}#${++rowNo}`,
          file_id: f.id,
          month: (returnDate || orderDate).slice(0, 7),
          order_date: orderDate,
          ship_tracking: shipTracking,
          customer: at(r, 'ลูกค้า'),
          phone: at(r, 'เบอร์โทร'),
          return_date: returnDate,
          return_tracking: at(r, 'เลขพัสดุขากลับ'),
          product,
          price,
          qty: sheetNum_(at(r, 'จำนวนชิ้น')) || 1,
          staff,
          is_crm: /^crm/i.test(staff),
          updated_at: new Date().toISOString(),
        });
      }
    }

    // ลบของไฟล์นี้ทิ้งก่อนใส่ใหม่ — ทีมแทรก/ลบแถวกลางตารางได้ การ upsert อย่างเดียวจะเหลือขยะค้าง
    const { error: delErr } = await supabase.from('returns').delete().eq('file_id', f.id);
    if (delErr) throw new Error(`ลบ returns ของ ${f.name} ไม่สำเร็จ: ${delErr.message}`);
    if (rows.length) await upsertRows('returns', rows, 'key');
    total += rows.length;
    parts.push(`${f.name.replace(/^📦สรุปตีกลับ\s*/, '').trim()}=${rows.length}`);
  }
  return `returns: ${total} ใบ จาก ${files.length} ไฟล์ (${parts.join(', ')})`;
}

/* ---------------- PAGES ---------------- */

/**
 * ค้นเพจทั้งหมดจาก Pancake → upsert ตาราง `pages` + ออก page_access_token ให้เพจที่ยังไม่มี
 *
 * ⚠️ เดิมงานนี้อยู่แค่ใน scripts/setup/discover-pages.ts ที่ "รันมือครั้งเดียวตอน setup"
 * เพจที่เปิดใหม่หลังจากนั้นจึงไม่เคยเข้าตาราง pages เลย → ออเดอร์ของเพจพวกนั้นไม่มีชื่อ ไม่มียูนิต
 * และไม่ถูกดึงสถิติแชท (ตรวจ 2026-07-29 พบ 12 page_id มียอดขายจริงรวม ~฿134k/90 วัน แต่ไม่มีในตาราง)
 * จึงย้ายมาเป็นงานรายวัน — ทีมเปิดเพจใหม่แล้วระบบเห็นเองภายใน 1 วัน ไม่ต้องเรียกให้ใครรันมือ
 *
 * ไม่แตะคอลัมน์ในโพสต์อื่น (เช่น in_pos_shop) — upsert ของ PostgREST อัปเดตเฉพาะคอลัมน์ที่ส่งไป
 */
export async function syncPages(): Promise<string> {
  requireCredentials();
  const pages = await pagesListPages();
  if (!pages.length) throw new Error('ไม่พบเพจเลย — เช็คว่า PANCAKE_ACCESS_TOKEN ยังไม่หมดอายุ (~90 วัน)');

  const { data: existTok } = await supabase.from('page_tokens').select('page_id');
  const have = new Set((existTok || []).map((t: any) => String(t.page_id)));
  const { data: existPages } = await supabase.from('pages').select('page_id');
  const known = new Set((existPages || []).map((p: any) => String(p.page_id)));

  const rows = pages.map((p: any) => ({
    page_id: String(p.id),
    name: p.name || '',
    platform: String(p.platform || 'facebook').toLowerCase(),
    has_token: have.has(String(p.id)),
    updated_at: new Date().toISOString(),
  }));
  // pages ต้องมีก่อน page_tokens (FK อ้างอยู่)
  const { error: pErr } = await supabase.from('pages').upsert(rows, { onConflict: 'page_id' });
  if (pErr) throw new Error(`บันทึก pages ล้มเหลว: ${pErr.message}`);

  // ออก token ให้เฉพาะเพจใหม่ (เพจเก่ามี token อยู่แล้ว — ยิงซ้ำทุกวันเปลืองและเสี่ยงโดน rate limit)
  const fresh = pages.filter((p: any) => !have.has(String(p.id)));
  const tokRows: any[] = [];
  const fail: string[] = [];
  for (const p of fresh) {
    try {
      const tok = await pagesGenerateToken(String(p.id));
      tokRows.push({ page_id: String(p.id), token: tok, updated_at: new Date().toISOString() });
      await sleep(300);
    } catch { fail.push(p.name || String(p.id)); }
  }
  if (tokRows.length) {
    const { error: tErr } = await supabase.from('page_tokens').upsert(tokRows, { onConflict: 'page_id' });
    if (tErr) throw new Error(`บันทึก page_tokens ล้มเหลว: ${tErr.message}`);
    await supabase.from('pages').upsert(
      tokRows.map((t) => ({ page_id: t.page_id, has_token: true, updated_at: t.updated_at })),
      { onConflict: 'page_id' }
    );
  }
  const added = pages.filter((p: any) => !known.has(String(p.id))).length;
  return `pages: ${pages.length} เพจ (ใหม่ ${added}, ออก token ${tokRows.length}` +
    (fail.length ? `, ออกไม่ได้ ${fail.length}: ${fail.slice(0, 5).join(', ')}` : '') + ')';
}

/* ---------------- ORDERS ---------------- */

/** งานประจำ: ออเดอร์ที่อัปเดตใน 48 ชม.ล่าสุด */
export async function syncOrders(): Promise<string> {
  requireCredentials();
  const since = new Date(Date.now() - 48 * 3600 * 1000);
  const until = new Date(Date.now() + 3600 * 1000);
  // เพดาน 120 หน้า = 12,000 ออเดอร์/48 ชม. — ทีมทำ ~2,800/วัน จึงเหลือที่เผื่ออีกเท่าตัว
  // เดิมตั้งไว้ 30 หน้า (3,000 ใบ) ซึ่ง "ชนพอดี" ทุกรอบ = ออเดอร์หายเงียบทุก 15 นาที
  const raw = await posFetchOrders(since, until, 120);
  const map = await platformByPage();
  const rows = raw.map((o) => mapOrder(o, map));
  const n = await upsertRows('orders', rows, 'id');
  return `orders: ${raw.length} รายการ (upsert ${n})`;
}

/**
 * "ยอดเรียลไทม์": เฉพาะออเดอร์ที่ขยับใน N นาทีล่าสุด — เบาพอให้ยิงได้ทุก 1 นาที
 *
 * ต่างจาก syncOrders ตรงที่ตัวนั้นกวาดย้อน 48 ชม. (สูงสุด 120 หน้า ~30 วิ) ซึ่งหนักเกินรอบ 1 นาที
 * ตัวนี้ทีมทำ ~2,800 ใบ/วัน = ~40 ใบ/20 นาที → 1 หน้าเกือบทุกครั้ง จบใน ~2-3 วิ
 *
 * หน้าต่างกว้าง 20 นาที (ไม่ใช่ 1 นาทีตามคาบ) เพื่อให้รอบที่พลาด/ดีเลย์ 19 ครั้งติดยังไม่เกิดรู
 * — ถึงพลาดยาวกว่านั้น รอบ fast ทุก 15 นาที (48 ชม.) ก็ยังตามเก็บให้อยู่ดี
 */
export async function syncOrdersDelta(minutes = 20): Promise<string> {
  requireCredentials();
  const since = new Date(Date.now() - Math.max(1, minutes) * 60 * 1000);
  const until = new Date(Date.now() + 60 * 1000);
  const raw = await posFetchOrders(since, until, 20);
  const map = await platformByPage();
  const rows = raw.map((o) => mapOrder(o, map));
  const n = await upsertRows('orders', rows, 'id');
  return `delta ${minutes} นาที: ${raw.length} รายการ (upsert ${n})`;
}

/**
 * Backfill ออเดอร์ย้อนหลัง (GitHub Actions ไม่มีลิมิต 6 นาที → ทำรวดเดียวได้เลย)
 * slice ทีละ 2 วัน + เพดาน 120 หน้า (12,000 ออเดอร์/slice) — ทีมทำ ~2,800/วัน
 * ⚠️ ห้ามกลับไปใช้ slice 7 วัน + 50 หน้า (5,000 cap) — เคยทำข้อมูล 1-4 ก.ค. 2026 หายเงียบๆ มาแล้ว
 */
export async function syncOrdersBackfill(days = 30): Promise<string> {
  requireCredentials();
  const map = await platformByPage();
  let count = 0;
  const failed: string[] = [];
  for (let start = days; start > 0; start -= 2) {
    const since = daysAgo(start);
    const until = start - 2 <= 0 ? new Date(Date.now() + 3600 * 1000) : daysAgo(start - 2);
    const label = since.toISOString().slice(0, 10);

    // เน็ตสะดุดครั้งเดียว (fetch failed) ไม่ควรทิ้งงานที่ทำมาแล้ว 10-20 นาที — ลองซ้ำ 3 ครั้ง
    // ถอยเวลาเพิ่มขึ้นเรื่อยๆ แล้วค่อยข้ามไป slice ถัดไป (เก็บชื่อไว้ฟ้องตอนจบ ไม่เงียบ)
    let raw: any[] | null = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try { raw = await posFetchOrders(since, until, 120); break; }
      catch (e: any) {
        if (attempt === 3) { failed.push(label); break; }
        await sleep(attempt * 10000);
      }
    }
    if (!raw) continue;

    if (raw.length >= 12000) {
      // ชนเพดาน = มีข้อมูลถูกตัดแน่นอน — ฟ้องดังๆ ดีกว่าเงียบ
      throw new Error(`backfill slice ${label} ชนเพดาน 12,000 ออเดอร์ — ลด slice ให้เล็กลง`);
    }
    const rows = raw.map((o) => mapOrder(o, map));
    await upsertRows('orders', rows, 'id');
    count += raw.length;
  }
  if (failed.length) {
    throw new Error(`backfill ออเดอร์ ${days} วัน: ได้ ${count} รายการ แต่ ${failed.length} ช่วงล้มเหลว ` +
      `(${failed.join(', ')}) — รันซ้ำเฉพาะช่วงนั้น ข้อมูลยังไม่ครบ`);
  }
  return `backfill ออเดอร์ ${days} วัน: ${count} รายการ`;
}

/* ---------------- CHAT STATS (ChatHourly) ---------------- */

export async function syncChatStats(since: Date, until: Date): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const rows: any[] = [];
  const errors: string[] = [];
  for (const p of pages) {
    try {
      const buckets = await pageChatStats(String(p.page_id), tokens[String(p.page_id)], since, until);
      for (const b of buckets) { const row = mapChatHour(p, b); if (row) rows.push(row); }
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
    await sleep(100);
  }
  if (rows.length) await upsertRows('chat_hourly', rows, 'key');
  let msg = `chat stats: ${rows.length} ชั่วโมง จาก ${pages.length} เพจ`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} เพจ: ${errors.slice(0, 3).join('; ')}`;
  return msg;
}

export const syncChatToday = () => syncChatStats(startOfDayBkk(new Date()), new Date());

/* ---------------- CUSTOMER ENGAGEMENTS (ตัวเลขชุดเดียวกับหน้าสถิติแชท Pancake) ---------------- */

/**
 * ดึง statistics/customer_engagements ของทุกเพจ ลง chat_engagement_daily
 *
 * ทำไมต้องมีทั้งที่มี chat_hourly อยู่แล้ว: chat_hourly (statistics/pages) นับ "ข้อความ"
 * ส่วน endpoint นี้นับ "ลูกค้า" แบบตัดซ้ำ + ให้ order_count/old_order_count มาด้วย
 * → เป็นตัวหาร/ตัวตั้งของ %ปิดการขายแบบที่ Pancake โชว์ ("ยอดสั่งซื้อจากลูกค้าทั้งหมด")
 *
 * ⚠️ บางเพจตอบ HTTP 500 — จับรายเพจ ไม่ให้ล้มทั้ง job (ตรวจแล้วเป็นเพจที่ไม่มีทราฟฟิก)
 */
export async function syncEngagementsForDate(dateStr: string, skip?: Set<string>): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const since = parsePancakeTime(`${dateStr}T00:00:00`)!;
  const until = parsePancakeTime(`${dateStr}T23:59:59`)!;
  const rows: any[] = [];
  const errors: string[] = [];
  let total = 0;
  let orderCount = 0;
  for (const p of pages) {
    // backfill ส่ง set ของเพจที่ 500 มาแล้วมาให้ข้าม — ไม่งั้นเสียเวลา retry ซ้ำทุกวัน
    if (skip && skip.has(String(p.page_id))) continue;
    try {
      const s = await pageCustomerEngagements(String(p.page_id), tokens[String(p.page_id)], since, until);
      const row = mapEngagementDaily(p, s, dateStr);
      // เพจที่ไม่มีความเคลื่อนไหวเลย ไม่ต้องเขียนแถวศูนย์ให้ตารางบวม
      if (row.total || row.order_count || row.inbox) {
        rows.push(row);
        total += row.total;
        orderCount += row.order_count;
      }
    } catch (e: any) {
      errors.push(`${p.name}: ${e.message}`);
      if (skip) skip.add(String(p.page_id));
    }
    await sleep(80);
  }
  if (rows.length) await upsertRows('chat_engagement_daily', rows, 'key');
  let msg = `engagements ${dateStr}: ${rows.length} เพจ | ลูกค้า ${total} | ออเดอร์ ${orderCount}`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} เพจ: ${errors.slice(0, 2).join('; ')}`;
  return msg;
}

export const syncEngagementsToday = () => syncEngagementsForDate(fmtDateBkk(new Date()));
export const syncEngagementsYesterday = () => syncEngagementsForDate(fmtDateBkk(daysAgo(1)));

/* ---------------- CONVERSATIONS ---------------- */

export async function syncConversations(): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const until = new Date();
  const rows: any[] = [];
  const errors: string[] = [];
  for (const p of pages) {
    try {
      const convs = await pageConversations(String(p.page_id), tokens[String(p.page_id)], since, until, 2);
      convs.forEach((c) => rows.push(mapConversation(p, c)));
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
    await sleep(100);
  }
  if (rows.length) await upsertRows('conversations', rows, 'id');
  let msg = `conversations: ${rows.length} บทสนทนา จาก ${pages.length} เพจ`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} เพจ`;
  return msg;
}

/* ---------------- AD STATS รายวัน (ค่าแอดจริง) ---------------- */

/**
 * ดึงค่าแอดรายแอดของทุกเพจ ลง ad_daily (1 วัน = 1 ชุด)
 * แหล่ง: pages /statistics/ads?type=by_id — ตัวเดียวของ Pancake ที่ให้ spend
 * (POS /ads_manager/ads_v2 คืน 0 แถวเสมอ ตาราง `ads` เดิมจึงว่างมาตลอด)
 *
 * รอบจริง: ชั่วโมงละครั้ง (runHourly) — วนทุกเพจ 130+ เพจ × sleep 80ms ช้าเกินรอบ 15 นาที
 * หน้าที่หลักคือเติม page_id / ชื่อแอด / สถานะ ให้ ad_daily ส่วน spend ที่แม่นยำมาจาก
 * syncMetaAds* (Meta Marketing API) ซึ่งรันทุก 15 นาทีและทับค่า spend ทีหลัง
 */
export async function syncAdStatsForDate(dateStr: string): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const since = parsePancakeTime(`${dateStr}T00:00:00`)!;
  const until = parsePancakeTime(`${dateStr}T23:59:59`)!;
  const rows: any[] = [];
  const errors: string[] = [];
  let spend = 0;
  for (const p of pages) {
    try {
      const ads = await pageAdStats(String(p.page_id), tokens[String(p.page_id)], since, until);
      for (const a of ads) {
        const row = mapAdDaily(p, a, dateStr);
        if (row) { rows.push(row); spend += row.spend; }
      }
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
    await sleep(80);
  }
  if (rows.length) await upsertRows('ad_daily', rows, 'date,ad_id');
  let msg = `ad stats ${dateStr}: ${rows.length} แอด จาก ${pages.length} เพจ | spend ฿${spend.toFixed(2)}`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} เพจ: ${errors.slice(0, 2).join('; ')}`;
  return msg;
}

export const syncAdStatsToday = () => syncAdStatsForDate(fmtDateBkk(new Date()));
/** ยอดของ Meta ยังขยับย้อนหลังได้อีก 1-2 วัน — งานรายวันตามเก็บซ้ำ */
export const syncAdStatsYesterday = () => syncAdStatsForDate(fmtDateBkk(daysAgo(1)));

/* ---------------- META ADS (ค่าแอด "จริง" จาก Meta Marketing API) ---------------- */

/** ยิงกี่บัญชีพร้อมกัน — 125 บัญชีแบบทีละตัวใช้ ~3.5 นาที ซึ่งดันรอบ fast (15 นาที) จนเกือบชน */
const META_POOL = 4;

/**
 * ดึง spend/impressions/clicks/purchases/value ระดับแอด จาก Meta ของ "ทุกบัญชีที่ยิงจริง"
 * แล้วทับลง ad_daily (merge — คงค่า page_id/name ที่ Pancake ใส่) → ค่าแอดตรงจอ Meta เป๊ะ
 * ต้องรัน "หลัง" syncAdStats (Pancake) ในรอบเดียวกัน เพื่อให้ค่า Meta ทับค่า Pancake
 */
export async function syncMetaAdsRange(since: string, until: string): Promise<string> {
  const token = process.env.META_ACCESS_TOKEN || '';
  if (!token) return 'ข้าม: ยังไม่ได้ตั้ง META_ACCESS_TOKEN';
  const accounts = await metaListAdAccounts();
  const active = accounts.filter((a) => a.account_status === 1);
  const rows: any[] = [];
  const errors: string[] = [];
  let spend = 0;
  const now = new Date().toISOString();
  await metaPool(active, META_POOL, async (acc) => {
    try {
      const ins = await metaAccountAdInsights(acc.account_id, since, until);
      for (const it of ins) {
        if (!it.ad_id || !it.date) continue;
        rows.push({
          date: it.date, ad_id: it.ad_id, account_id: acc.account_id,
          spend: it.spend, impressions: it.impressions, clicks: it.clicks, reach: it.reach,
          meta_purchases: it.purchases, meta_purchase_value: it.purchase_value,
          updated_at: now,
        });
        spend += it.spend;
      }
    } catch (e: any) { errors.push(`${acc.account_id}: ${e.message}`); }
    await sleep(120);
  });
  if (rows.length) await upsertRows('ad_daily', rows, 'date,ad_id');
  const range = since === until ? since : `${since}..${until}`;
  let msg = `meta ads ${range}: ${rows.length} แถว จาก ${active.length}/${accounts.length} บัญชี | spend ฿${spend.toFixed(2)}`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} บัญชี: ${errors.slice(0, 2).join('; ')}`;
  return msg;
}

export const syncMetaAdsForDate = (dateStr: string) => syncMetaAdsRange(dateStr, dateStr);
export const syncMetaAdsToday = () => syncMetaAdsForDate(fmtDateBkk(new Date()));
export const syncMetaAdsYesterday = () => syncMetaAdsForDate(fmtDateBkk(daysAgo(1)));

/**
 * เติม page_id ให้แถว ad_daily ที่ Pancake ผูกเพจให้ไม่ได้ โดยอ่านจากครีเอทีฟของแอด
 *
 * ที่มาของรู: แถวจาก Meta ถูกเขียนโดยไม่มี page_id (Meta insights ไม่ได้บอกเพจ) แล้วรอ
 * syncAdStats ของ Pancake มาเติมให้ทีหลัง — แต่แอดที่ Pancake มองไม่เห็นก็ไม่มีใครเติม
 * ผลคือค่าแอดก้อนนั้นผูกยูนิตไม่ได้ (ตรวจ 2026-07-29: ฿885,725 = 9.6% ของ 30 วัน)
 *
 * ad_creative.post_id ของ Meta อยู่ในรูป "<page_id>_<post_id>" — ตัดหน้ามาใช้ได้ตรงๆ
 * ครอบคลุม 99.4% ของยอดที่ขาด (เหลือ 101 แอดที่ยังไม่มีครีเอทีฟในระบบ)
 */
export async function syncAdPageFill(days = 45): Promise<string> {
  const from = fmtDateBkk(daysAgo(days));
  const holes: any[] = [];
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from('ad_daily')
      .select('date,ad_id').eq('page_id', '').gte('date', from)
      .order('date', { ascending: true }).order('ad_id', { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`อ่าน ad_daily ล้มเหลว: ${error.message}`);
    holes.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  if (!holes.length) return 'ad page fill: ไม่มีแถวที่ขาดเพจ';

  const wanted = new Set(holes.map((h) => String(h.ad_id)));
  const pageOfAd: Record<string, string> = {};
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from('ad_creative')
      .select('ad_id,post_id').order('ad_id', { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`อ่าน ad_creative ล้มเหลว: ${error.message}`);
    (data || []).forEach((c: any) => {
      const adId = String(c.ad_id);
      if (!wanted.has(adId)) return;
      const pid = String(c.post_id || '').split('_')[0];
      if (pid) pageOfAd[adId] = pid;
    });
    if ((data || []).length < 1000) break;
  }

  const { data: pgs } = await supabase.from('pages').select('page_id,name');
  const nameOf: Record<string, string> = {};
  (pgs || []).forEach((p: any) => { nameOf[String(p.page_id)] = String(p.name || ''); });

  const rows = holes
    .filter((h) => pageOfAd[String(h.ad_id)])
    .map((h) => ({
      date: h.date, ad_id: String(h.ad_id),
      page_id: pageOfAd[String(h.ad_id)],
      page_name: nameOf[pageOfAd[String(h.ad_id)]] || '',
      updated_at: new Date().toISOString(),
    }));
  if (rows.length) await upsertRows('ad_daily', rows, 'date,ad_id');
  const stillMissing = new Set(holes.filter((h) => !pageOfAd[String(h.ad_id)]).map((h) => String(h.ad_id)));
  return `ad page fill: เติม ${rows.length}/${holes.length} แถว` +
    (stillMissing.size ? ` | ยังไม่มีครีเอทีฟ ${stillMissing.size} แอด` : '');
}

/* ---------------- AD CREATIVE (รูป/คลิป/ลิงก์โพสต์ของแอด) ---------------- */

/** เพดานต่อรอบ — กันวันที่มีแอดใหม่พรวดเดียวเป็นหมื่นแล้วงาน daily ค้างยาว (ที่เหลือไปรอบหน้า) */
const CREATIVE_CAP = 4000;

/**
 * ad_id ไม่ซ้ำที่มีใน ad_daily ตั้งแต่ N วันก่อน (วนเอง — PostgREST คืนสูงสุด 1000 แถว/ครั้ง)
 * ต้อง order ด้วย (ad_id, date) = pk เต็ม — เรียงด้วย ad_id เฉยๆ ไม่ unique แล้วแถวจะข้ามเงียบๆ ตอนแบ่งหน้า
 */
async function adIdsFromDaily_(days: number): Promise<string[]> {
  const from = fmtDateBkk(daysAgo(Math.max(0, days - 1)));
  const set: Record<string, 1> = {};
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.from('ad_daily').select('ad_id,date')
      .gte('date', from)
      .order('ad_id', { ascending: true }).order('date', { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(`อ่าน ad_daily ไม่ได้: ${error.message}`);
    const batch = data || [];
    batch.forEach((r: any) => { const id = String(r.ad_id || ''); if (id) set[id] = 1; });
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return Object.keys(set);
}

/** ad_id ที่มีครีเอทีฟแล้ว — null = ยังไม่ได้สร้างตาราง (ให้ job ข้ามแบบไม่ล้ม) */
async function existingCreativeIds_(): Promise<Record<string, 1> | null> {
  const have: Record<string, 1> = {};
  let offset = 0;
  for (;;) {
    // ad_id เป็น pk อยู่แล้ว → order ตัวเดียวก็ unique พอสำหรับแบ่งหน้า
    const { data, error } = await supabase.from('ad_creative').select('ad_id')
      .order('ad_id', { ascending: true }).range(offset, offset + 999);
    if (error) {
      const m = String(error.message || '');
      // ยังไม่ได้รัน migration → ข้ามแบบไม่ล้ม; error อื่น (เน็ต/สิทธิ์) ต้องฟ้อง ไม่ใช่กลืน
      if (m.includes('ad_creative') || m.includes('schema cache')) return null;
      throw new Error(`อ่าน ad_creative ไม่ได้: ${error.message}`);
    }
    const batch = data || [];
    batch.forEach((r: any) => { have[String(r.ad_id)] = 1; });
    if (batch.length < 1000) break;
    offset += 1000;
  }
  return have;
}

/**
 * เติมครีเอทีฟของแอดที่เรามีใน ad_daily แต่ยังไม่มีใน ad_creative
 *
 * ครีเอทีฟไม่เปลี่ยนรายวัน → รันวันละครั้งพอ และดึงเฉพาะ "ตัวที่ยังไม่มี" (รอบแรกหนัก รอบต่อไปแทบว่าง)
 * แอดที่ Meta ปฏิเสธ (ถูกลบ / token ไม่มีสิทธิ์) เขียนแถวเปล่าไว้กันวนถามซ้ำทุกวัน —
 * อยากลองใหม่ให้รัน `npm run backfill:ad-creatives <วัน> force`
 */
export async function syncAdCreatives(days = 14, refresh = false): Promise<string> {
  const token = process.env.META_ACCESS_TOKEN || '';
  if (!token) return 'ข้าม: ยังไม่ได้ตั้ง META_ACCESS_TOKEN';
  const have = await existingCreativeIds_();
  if (!have) return 'ข้าม: ยังไม่มีตาราง ad_creative (รัน db/migrations/2026-07-27-ad-creative.sql ก่อน)';

  const ids = await adIdsFromDaily_(days);
  const want = refresh ? ids : ids.filter((id) => !have[id]);
  if (!want.length) return `ad creatives: ครบแล้ว (${ids.length} แอดใน ${days} วันล่าสุด)`;
  const capped = want.slice(0, CREATIVE_CAP);

  const now = new Date().toISOString();
  const { rows, missing } = await metaAdCreativesByIds(capped);
  const payload: any[] = rows.map((r) => ({ ...r, updated_at: now }));
  // แถวเปล่าของแอดที่ดึงไม่ได้ — มีไว้เป็น "เครื่องหมายว่าเคยลองแล้ว" ไม่ให้รอบหน้าถามซ้ำ
  missing.forEach((id) => payload.push({
    ad_id: id, account_id: '', name: '', thumb_url: '', image_url: '', video_id: '',
    object_type: '', post_id: '', permalink: '', ig_permalink: '', cta: '', link_url: '',
    updated_at: now,
  }));
  const n = await upsertRows('ad_creative', payload, 'ad_id');

  const withMedia = rows.filter((r) => r.image_url || r.thumb_url).length;
  const withPost = rows.filter((r) => r.permalink || r.ig_permalink).length;
  let msg = `ad creatives: ขอ ${capped.length} แอด → ได้ ${rows.length} (upsert ${n}) | ` +
    `มีรูป ${withMedia} | มีลิงก์โพสต์ ${withPost}`;
  if (missing.length) msg += ` | ดึงไม่ได้ ${missing.length}`;
  if (want.length > capped.length) msg += ` | เหลือ ${want.length - capped.length} ไว้รอบหน้า`;
  return msg;
}

/**
 * กวาดครีเอทีฟของ "ทุกแอดในทุกบัญชี" ผ่าน /act_{id}/ads (ไม่อิง ad_daily)
 * ใช้กับ backfill ครั้งแรกเมื่ออยากได้ครบจริงๆ — ช้ากว่าแบบ by-id มาก (25k+ แอด)
 */
export async function syncAdCreativesAllAccounts(): Promise<string> {
  const token = process.env.META_ACCESS_TOKEN || '';
  if (!token) return 'ข้าม: ยังไม่ได้ตั้ง META_ACCESS_TOKEN';
  const accounts = await metaListAdAccounts();
  const active = accounts.filter((a) => a.account_status === 1);
  const now = new Date().toISOString();
  const errors: string[] = [];
  let total = 0;
  await metaPool(active, META_POOL, async (acc) => {
    try {
      const rows = await metaAccountAdCreatives(acc.account_id);
      if (rows.length) {
        await upsertRows('ad_creative', rows.map((r) => ({ ...r, updated_at: now })), 'ad_id');
        total += rows.length;
      }
    } catch (e: any) { errors.push(`${acc.account_id}: ${e.message}`); }
  });
  let msg = `ad creatives (ทุกบัญชี): ${total} แอด จาก ${active.length} บัญชี`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} บัญชี: ${errors.slice(0, 2).join('; ')}`;
  return msg;
}

/* ---------------- ADS (ตารางเดิม — POS endpoint ตายแล้ว) ---------------- */

export async function syncAds(): Promise<string> {
  requireCredentials();
  const campaigns: Record<string, string> = {};
  try {
    (await posFetchCampaigns(5)).forEach((c: any) => { campaigns[String(c.id)] = c.name || ''; });
  } catch { /* ไม่มีชื่อแคมเปญก็ใช้ id แทนได้ */ }
  const ads = await posFetchAds(10);
  const rows = ads.map((a) => mapAd(a, campaigns));
  // กันข้อมูลหาย: ถ้า API คืนว่าง (ล่ม/ไม่มีสิทธิ์ชั่วคราว) อย่าเขียนทับตาราง ads ด้วยของว่าง
  if (!rows.length) return 'ads: 0 แอด (ข้ามการเขียนทับ — คงข้อมูลเดิม)';
  await replaceTable('ads', rows, 'ad_id');
  return `ads: ${rows.length} แอด`;
}

/* ---------------- ADMINS (roster + online) ---------------- */

/**
 * บันทึกการเปลี่ยนสถานะออนไลน์ลง admin_online_log (ให้หน้า Admin คำนวณ
 * "ออนไลน์ X ชม. / หาย Y นาที" ของจริง) — non-fatal: ตารางยังไม่ถูกสร้างก็ไม่ล้ม sync
 */
async function logOnlineChanges(rows: { user_id: string; is_online: boolean }[]): Promise<string> {
  if (!rows.length) return '';
  try {
    const now = new Date().toISOString();
    const { error } = await supabase.from('admin_online_log').insert(
      rows.map((r) => ({ user_id: String(r.user_id), is_online: !!r.is_online, changed_at: now }))
    );
    if (error) throw error;
    return ` | log ${rows.length} จุด`;
  } catch (e: any) {
    return ` | log ไม่สำเร็จ: ${String(e.message || e).slice(0, 80)}`;
  }
}

export async function syncAdminsRoster(): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  const byUser: Record<string, any> = {};
  const errors: string[] = [];
  const failedPages: string[] = []; // เพจที่ดึงพลาดรอบนี้ — ห้ามตัดสินว่าคนของเพจนั้นออฟไลน์/หายไป
  let okPages = 0;

  for (const p of pages) {
    try {
      const res = await pageUsers(String(p.page_id), tokens[String(p.page_id)]);
      okPages++;
      for (const u of res.users) {
        const uid = String(u.id);
        let rec = byUser[uid];
        if (!rec) {
          rec = byUser[uid] = {
            user_id: uid, pos_user_id: '', name: u.name || '', email: u.email || '',
            fb_id: u.fb_id || '', is_online: false, status_in_page: '', pagesList: [],
            permissions: '', department: '', sale_group: '', avatar_url: u.avatar_url || '',
          };
        }
        rec.pagesList.push(p.name);
        if (u.is_online) rec.is_online = true;
        if (u.status_in_page && !rec.status_in_page) rec.status_in_page = String(u.status_in_page);
        if (u.status && !rec.status_in_page) rec.status_in_page = String(u.status);
        const perms = u.page_permissions && u.page_permissions.permissions;
        if (perms && perms.length && !rec.permissions) rec.permissions = perms.join(', ').slice(0, 300);
      }
    } catch (e: any) {
      errors.push(`${p.name}: ${e.message}`);
      failedPages.push(String(p.name || p.page_id));
    }
    await sleep(150);
  }

  // เติมข้อมูลจาก POS users (แผนก / กลุ่มขาย / pos_user_id สำหรับ join กับออเดอร์)
  try {
    const posUsers = await posFetchUsers();
    const pancakeList = Object.keys(byUser).map((k) => byUser[k]);
    for (const pu of posUsers) {
      const u = pu.user || {};
      const posId = String(pu.user_id || u.id || '');
      const match = pancakeList.find((r) =>
        (u.email && r.email && u.email.toLowerCase() === r.email.toLowerCase()) ||
        (u.fb_id && r.fb_id && String(u.fb_id) === String(r.fb_id)));
      if (match) {
        match.pos_user_id = posId;
        match.department = (pu.department && pu.department.name) || '';
        match.sale_group = (pu.sale_group && pu.sale_group.name) || '';
      } else {
        byUser['pos:' + posId] = {
          user_id: 'pos:' + posId, pos_user_id: posId, name: u.name || '', email: u.email || '',
          fb_id: u.fb_id ? String(u.fb_id) : '', is_online: false, status_in_page: '',
          pagesList: [], permissions: '', department: (pu.department && pu.department.name) || '',
          sale_group: (pu.sale_group && pu.sale_group.name) || '', avatar_url: '',
        };
      }
    }
  } catch (e: any) { errors.push(`POS users: ${e.message}`); }

  // กันข้อมูลหาย: ถ้าดึงไม่สำเร็จเลยสักเพจ ห้ามเขียนทับตาราง admins
  if (pages.length && !okPages) {
    throw new Error('ดึงรายชื่อแอดมินไม่สำเร็จทุกเพจ — คงข้อมูลเดิม: ' + errors.slice(0, 3).join('; '));
  }

  const now = new Date().toISOString();
  const rows = Object.keys(byUser).map((k) => {
    const r = byUser[k];
    return {
      user_id: r.user_id, pos_user_id: r.pos_user_id, name: r.name, email: r.email, fb_id: r.fb_id,
      is_online: r.is_online, status_in_page: r.status_in_page,
      pages: r.pagesList.join(', ').slice(0, 400), page_count: r.pagesList.length,
      permissions: r.permissions, department: r.department, sale_group: r.sale_group,
      avatar_url: r.avatar_url, updated_at: now,
    };
  });

  // สถานะเดิม (อ่านทั้งแถว — ใช้ทั้งเทียบ flip, กันเพจล้ม และ carry-forward คนที่หายชั่วคราว)
  const { data: prevRows, error: prevErr } = await supabase.from('admins').select('*');
  const prevList: any[] | null = prevErr ? null : (prevRows || []);
  const newIds: Record<string, boolean> = {};
  rows.forEach((r) => { newIds[r.user_id] = true; });
  const rowById: Record<string, any> = {};
  rows.forEach((r) => { rowById[r.user_id] = r; });

  if (prevList) {
    const touchesFailed = (pr: any) =>
      failedPages.length > 0 && failedPages.some((fp) => String(pr.pages || '').includes(fp));
    for (const pr of prevList) {
      const uid = String(pr.user_id);
      if (!newIds[uid]) {
        // หายจาก roster ใหม่ — ถ้าเพจของเขาดึงพลาดรอบนี้ ให้คงแถวเดิมไว้ (กันหลุดจากระบบชั่วคราว)
        if (touchesFailed(pr)) {
          const kept = { ...pr, updated_at: now };
          rows.push(kept);
          newIds[uid] = true;
          rowById[uid] = kept;
        }
      } else if (pr.is_online === true && rowById[uid].is_online !== true && touchesFailed(pr)) {
        // เดิมออนไลน์ แต่รอบนี้สัญญาณหายเพราะเพจล้ม — คงออนไลน์ไว้ (guard เดียวกับ syncOnlineStatus)
        rowById[uid].is_online = true;
      }
    }
  }

  // flip สถานะออนไลน์ (เทียบได้ต่อเมื่ออ่าน prev สำเร็จ — ห้ามเทียบกับ baseline ว่าง เดี๋ยว log มั่ว)
  let flips: { user_id: string; is_online: boolean }[] = [];
  if (prevList) {
    const prevOnline: Record<string, boolean> = {};
    prevList.forEach((r: any) => { prevOnline[String(r.user_id)] = r.is_online === true; });
    flips = rows.filter((r) => (prevOnline[r.user_id] || false) !== (r.is_online === true))
      .map((r) => ({ user_id: r.user_id, is_online: r.is_online === true }));
    // คนที่เคยออนไลน์แล้วหายจาก roster จริงๆ (ถูกถอดจากทุกเพจ) → ปิด log เป็นออฟไลน์
    prevList.forEach((pr: any) => {
      const uid = String(pr.user_id);
      if (pr.is_online === true && !newIds[uid]) flips.push({ user_id: uid, is_online: false });
    });
  }

  // เขียนแบบไม่ให้ตารางว่าง: upsert ก่อน แล้วค่อยลบแถวที่ไม่อยู่แล้ว
  // (replaceTable เดิม delete-ทั้งตาราง-แล้ว-insert → มีจังหวะที่หน้าเว็บเห็นตารางว่าง)
  await upsertRows('admins', rows, 'user_id');
  if (rows.length) {
    const keep = rows.map((r) => '"' + String(r.user_id).replace(/"/g, '') + '"').join(',');
    const { error: delErr } = await supabase.from('admins').delete().not('user_id', 'in', '(' + keep + ')');
    if (delErr) errors.push(`ลบแถวเก่า: ${delErr.message}`);
  }

  let msg = `admins: ${rows.length} คน`;
  msg += await logOnlineChanges(flips);
  if (prevErr) msg += ' | อ่านสถานะเดิมพลาด (ข้าม log รอบนี้)';
  if (errors.length) msg += ` | ผิดพลาด: ${errors.slice(0, 3).join('; ')}`;
  return msg;
}

/** อัปเดตเฉพาะสถานะออนไลน์ (เบากว่า full roster) */
export async function syncOnlineStatus(): Promise<string> {
  requireCredentials();
  const { pages, tokens } = await loadPagesWithTokens();
  if (!pages.length) return 'ยังไม่มีเพจ';
  const { data: existing } = await supabase.from('admins').select('*');
  if (!existing || !existing.length) return syncAdminsRoster();

  const online: Record<string, boolean> = {};
  let checked = 0;
  const failedPages: string[] = [];
  for (const p of pages) {
    try {
      const res = await pageUsers(String(p.page_id), tokens[String(p.page_id)]);
      res.users.forEach((u: any) => { if (u.is_online) online[String(u.id)] = true; });
      checked++;
    } catch { failedPages.push(String(p.name || p.page_id)); }
    await sleep(100);
  }
  if (!checked) return 'เช็คสถานะออนไลน์ไม่ได้สักเพจ';

  const now = new Date().toISOString();
  const changed = existing.filter((r: any) => {
    const want = !!online[String(r.user_id)];
    const cur = r.is_online === true;
    if (want === cur) return false;
    // ปิดออนไลน์ได้ต่อเมื่อเพจของคนนั้นไม่ได้อยู่ในกลุ่มที่ดึงพลาด (กันเพจล่มชั่วคราว)
    if (!want && failedPages.length) {
      const pagesStr = String(r.pages || '');
      for (const fp of failedPages) if (pagesStr.includes(fp)) return false;
    }
    return true;
  }).map((r: any) => ({ ...r, is_online: !!online[String(r.user_id)], updated_at: now }));

  if (changed.length) await upsertRows('admins', changed, 'user_id');
  let msg = `online status: เปลี่ยน ${changed.length} คน (${Object.keys(online).length} ออนไลน์)`;
  msg += await logOnlineChanges(changed.map((r: any) => ({ user_id: r.user_id, is_online: r.is_online })));
  if (failedPages.length) msg += ` | ดึงพลาด ${failedPages.length} เพจ`;
  return msg;
}

/* ---------------- ADMIN CHAT DAILY ---------------- */

export async function syncAdminChatForDate(dateStr: string): Promise<string> {
  const { pages, tokens } = await loadPagesWithTokens();
  const from = parsePancakeTime(`${dateStr}T00:00:00`)!;
  const to = parsePancakeTime(`${dateStr}T23:59:59`)!;
  const rows: any[] = [];
  const errors: string[] = [];
  for (const p of pages) {
    try {
      const data = await pageUserStats(String(p.page_id), tokens[String(p.page_id)], from, to);
      const totals = data.users || {};
      for (const uid of Object.keys(totals)) {
        const u = totals[uid] || {};
        rows.push({
          key: `${dateStr}|${p.page_id}|${uid}`,
          date: dateStr, page_id: String(p.page_id), page_name: p.name,
          user_id: String(uid), user_name: u.user_name || '',
          inbox_count: num(u.inbox_count), comment_count: num(u.comment_count),
          unique_inbox_count: num(u.unique_inbox_count), private_reply_count: num(u.private_reply_count),
          phone_number_count: num(u.phone_number_count), avg_response_ms: num(u.average_response_time),
          updated_at: new Date().toISOString(),
        });
      }
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
    await sleep(150);
  }
  if (rows.length) await upsertRows('admin_chat_daily', rows, 'key');
  let msg = `admin chat ${dateStr}: ${rows.length} แถว`;
  if (errors.length) msg += ` | ผิดพลาด ${errors.length} เพจ`;
  return msg;
}

export const syncAdminChatToday = () => syncAdminChatForDate(fmtDateBkk(new Date()));

export async function syncAdminChatBackfill(days = 7): Promise<string> {
  const msgs: string[] = [];
  for (let i = days; i >= 1; i--) msgs.push(await syncAdminChatForDate(fmtDateBkk(daysAgo(i))));
  return msgs.join(' | ');
}

/* ---------------- DAILY: catch-up + prune ---------------- */

export const syncChatYesterday = () => syncChatStats(daysAgo(1), startOfDayBkk(new Date()));

async function deleteOlder(table: string, col: string, cutoff: string): Promise<number> {
  const { count, error } = await supabase.from(table).delete({ count: 'exact' }).lt(col, cutoff);
  if (error) throw new Error(`prune ${table}: ${error.message}`);
  return count || 0;
}

export async function prune(): Promise<string> {
  const cutIso = (d: number) => daysAgo(d).toISOString();
  const cutDate = (d: number) => fmtDateBkk(daysAgo(d));
  let removed = 0;
  removed += await deleteOlder('orders', 'inserted_at', cutIso(RETENTION_DAYS.ORDERS));
  removed += await deleteOlder('chat_hourly', 'date', cutDate(RETENTION_DAYS.CHAT_HOURLY));
  removed += await deleteOlder('conversations', 'updated_at', cutIso(RETENTION_DAYS.CONVERSATIONS));
  removed += await deleteOlder('admin_chat_daily', 'date', cutDate(RETENTION_DAYS.ADMIN_CHAT_DAILY));
  // ตารางใหม่ อาจยังไม่ถูกสร้าง — ข้ามได้โดยไม่ให้งาน prune ทั้งก้อนล้ม
  try {
    removed += await deleteOlder('admin_online_log', 'changed_at', cutIso(RETENTION_DAYS.ADMIN_ONLINE_LOG));
  } catch { /* ยังไม่มีตาราง admin_online_log */ }
  try {
    removed += await deleteOlder('ad_daily', 'date', cutDate(RETENTION_DAYS.AD_DAILY));
  } catch { /* ยังไม่มีตาราง ad_daily */ }
  try {
    removed += await deleteOlder('chat_engagement_daily', 'date', cutDate(RETENTION_DAYS.CHAT_ENGAGEMENT));
  } catch { /* ยังไม่มีตาราง chat_engagement_daily */ }
  return `ลบข้อมูลเก่า ${removed} แถว`;
}
