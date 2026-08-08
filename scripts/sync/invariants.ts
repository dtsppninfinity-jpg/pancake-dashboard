// scripts/sync/invariants.ts — "กฎที่ตัวเลขต้องเป็นจริงเสมอ" ตรวจหลังรอบ sync
//
// ที่มา: สัปดาห์ 3-8 ส.ค. 2026 ทีมจับบั๊กได้เอง 4 เคสติดกัน ทุกเคสรากเดียวกัน —
// งาน sync รายงานว่าสำเร็จทั้งที่ทำงานไม่ครบ แล้วไม่มีใครตรวจว่าเลขที่ได้ "สมเหตุสมผล" ไหม
// (%ปิดจากแอด 2289% / สถิติแชทหาย 60-120 เพจ / กำไรจากชีทค้าง 7 วัน / แถววันอนาคตหลุดเข้า DB)
//
// ตัวนี้ตรวจ "ผลลัพธ์" ไม่ใช่ "กระบวนการ" — งานจะขึ้นเขียวยังไงก็ตาม ถ้าเลขออกมาเป็นไปไม่ได้
// จะถูกเขียนเป็นงานล้ม (job = invariants) ลง sync_log ให้ตัวเฝ้าระวังบนหน้าเว็บฟ้องทีมทันที
//
// ตรวจจาก "เมื่อวาน" เป็นหลัก — วันนี้ยังเดินอยู่ (Meta รายงานช้า ชีทยังไม่กรอก) ตรวจแล้วจะเตือนผิดทุกเช้า
import { supabase, loadJobStats } from '../../lib/supabase';
import { coverageProblem } from '../../lib/jobstat';
import { daysAgo, fmtDateBkk, startOfDayBkk, num, money_, EXCLUDED_STATUSES, NEED_CHECK_STATUSES, isPlaceholderOrder } from '../../lib/config';

export interface Invariant {
  code: string;
  message: string;
}

/** อ่านทั้งตารางแบบแบ่งหน้า (PostgREST คืนสูงสุด 1000 แถว/ครั้ง) */
async function scan_<T>(
  build: () => any, orderCol: string
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().order(orderCol, { ascending: true }).range(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

const pct_ = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);
const baht_ = (n: number) => '฿' + Math.round(n).toLocaleString('en-US');

/**
 * ตรวจกฎทั้งหมด — คืนรายการที่ผิด (ว่าง = ปกติ)
 *
 * ทุกกฎห่อ try เดี่ยว: ตารางที่ยังไม่ได้สร้าง/คิวรีพลาด ต้องไม่ทำให้กฎข้ออื่นไม่ได้ตรวจ
 */
export async function checkInvariants(): Promise<{ ok: boolean; message: string; problems: Invariant[] }> {
  const problems: Invariant[] = [];
  const notes: string[] = [];
  const add = (code: string, message: string) => problems.push({ code, message });

  const yStr = fmtDateBkk(daysAgo(1));
  const todayStr = fmtDateBkk(new Date());
  const yStart = startOfDayBkk(daysAgo(1));
  const yEnd = startOfDayBkk(new Date());

  /* ---- 1) ออเดอร์ของเมื่อวาน: ต้องมี + เก็บว่ามาจากเพจไหนบ้าง (ใช้ต่อในข้อ 2) ---- */
  const orderPages = new Set<string>();
  let orderCount = 0;
  let orderSales = 0;
  try {
    const rows = await scan_<any>(
      () => supabase.from('orders').select('id,page_id,status,total_price,items_count')
        .gte('inserted_at', yStart.toISOString()).lt('inserted_at', yEnd.toISOString()),
      'id'
    );
    for (const o of rows) {
      const st = num(o.status);
      if (EXCLUDED_STATUSES.indexOf(st) >= 0 || NEED_CHECK_STATUSES.indexOf(st) >= 0) continue;
      if (isPlaceholderOrder(o)) continue;
      orderCount++;
      orderSales += money_(o.total_price);
      const pid = String(o.page_id || '');
      if (pid) orderPages.add(pid);
    }
    if (!orderCount) add('orders-empty', `ไม่มีออเดอร์ที่ยืนยันของ ${yStr} เลยสักใบ — งาน orders น่าจะดึงไม่เข้า`);
    else notes.push(`ออเดอร์ ${orderCount} ใบ/${baht_(orderSales)}`);
  } catch (e: any) {
    add('orders-read', `อ่านตาราง orders ไม่ได้: ${String(e.message || e).slice(0, 90)}`);
  }

  /* ---- 2) สถิติแชท: ต้องครอบคลุมเพจที่มีออเดอร์ + %ปิดต้องไม่เกิน 100% ----
   * เคสจริง: Pancake หมุน page_access_token เอง ทุกงานจับเป็น "เพจพลาด" เงียบๆ
   * เหลือ engagement แค่ 21 จาก 73 เพจที่มีออเดอร์ → %ปิดการขายต่ำกว่าจริง 8 จุดอยู่ 1 สัปดาห์ */
  try {
    const rows = await scan_<any>(
      () => supabase.from('chat_engagement_daily').select('page_id,total,order_count').eq('date', yStr),
      'page_id'
    );
    const engPages = new Set(rows.map((r) => String(r.page_id || '')));
    let total = 0, orders = 0;
    rows.forEach((r) => { total += num(r.total); orders += num(r.order_count); });

    if (orderPages.size >= 10) {
      const covered = Array.from(orderPages).filter((p) => engPages.has(p)).length;
      const ratio = covered / orderPages.size;
      if (ratio < 0.7) {
        add('engagement-coverage',
          `สถิติแชท ${yStr} ครอบคลุมแค่ ${covered} จาก ${orderPages.size} เพจที่มีออเดอร์ ` +
          `(${pct_(covered, orderPages.size)}%) — %ปิดการขายจะต่ำกว่าจริง`);
      } else notes.push(`สถิติแชทครอบคลุม ${pct_(covered, orderPages.size)}% ของเพจที่มีออเดอร์`);
    }
    if (total > 0 && orders > total) {
      add('close-rate-over-100',
        `%ปิดการขาย ${yStr} = ${pct_(orders, total)}% (ออเดอร์ ${orders} > ลูกค้า ${total}) — ตัวหารขาด`);
    }
  } catch (e: any) {
    add('engagement-read', `อ่าน chat_engagement_daily ไม่ได้: ${String(e.message || e).slice(0, 90)}`);
  }

  /* ---- 3) ค่าแอด Meta: มีเงินออกต้องมีคนทัก และ %ปิดจากแอดต้องไม่เกิน 100% ----
   * เคสจริง: sync ดึง msgs มาแล้วลืมเขียนคอลัมน์ ค่าเลยค้างของเก่า → 745 ซื้อ / 29 ทัก = 2289% */
  try {
    const rows = await scan_<any>(
      () => supabase.from('ad_daily').select('ad_id,spend,msgs_started,meta_purchases').eq('date', yStr),
      'ad_id'
    );
    let spend = 0, msgs = 0, purch = 0;
    rows.forEach((r) => { spend += num(r.spend); msgs += num(r.msgs_started); purch += num(r.meta_purchases); });

    if (!rows.length || spend <= 0) {
      add('ads-empty', `ไม่มีค่าแอดของ ${yStr} เลย (${rows.length} แถว) — เช็ค META_ACCESS_TOKEN ว่าหมดอายุหรือยัง`);
    } else {
      notes.push(`ค่าแอด ${baht_(spend)}/ทัก ${msgs}`);
      if (msgs <= 0) {
        add('ads-no-msgs', `มีค่าแอด ${baht_(spend)} ของ ${yStr} แต่ "คนทัก" เป็น 0 — คอลัมน์ msgs_started ไม่ถูกเขียน`);
      } else if (purch / msgs > 1.5) {
        add('ad-close-rate-over-100',
          `%ปิดจากแอด ${yStr} = ${pct_(purch, msgs)}% (ซื้อ ${purch} / ทัก ${msgs}) — ตัวหารเก่าค้างอยู่`);
      }
    }
  } catch (e: any) {
    add('ads-read', `อ่าน ad_daily ไม่ได้: ${String(e.message || e).slice(0, 90)}`);
  }

  /* ---- 3ก) %ปิดจากแอด "ของวันนี้" — จับเคสตัวหารค้างได้ตั้งแต่วันนั้นเลย ไม่ต้องรอข้ามคืน
   * ระหว่างวัน Meta รายงาน "คนทัก" ไวกว่า "ซื้อ" อัตราส่วนจึงควรต่ำ ไม่ใช่สูง
   * ตั้งพื้นที่ทัก 100 ครั้ง กันช่วงหลังเที่ยงคืนที่ตัวเลขน้อยจนอัตราส่วนแกว่ง */
  try {
    const rows = await scan_<any>(
      () => supabase.from('ad_daily').select('ad_id,msgs_started,meta_purchases').eq('date', todayStr),
      'ad_id'
    );
    let msgs = 0, purch = 0;
    rows.forEach((r) => { msgs += num(r.msgs_started); purch += num(r.meta_purchases); });
    if (msgs >= 100 && purch / msgs > 1.5) {
      add('ad-close-rate-today',
        `%ปิดจากแอดของวันนี้ = ${pct_(purch, msgs)}% (ซื้อ ${purch} / ทัก ${msgs}) — ตัวหารไม่อัปเดต`);
    }
  } catch { /* ตรวจของเมื่อวานไปแล้ว วันนี้พลาดได้ */ }

  /* ---- 4) กำไรจากชีท: ต้องสดพอ และห้ามมีแถววันอนาคต ----
   * เคสจริง (สองเรื่องในข้อเดียว): งานอ่านชีทข้ามตัวเองเงียบ 7 วัน + แถวสูตรวันอนาคตของชีท
   * หลุดเข้า DB เป็นวันขาดทุนปลอม ทำให้การ์ดแจ้งเตือน U3 บอก "ขาดทุน 2 วันติด" ทั้งที่กำไร */
  try {
    const { data: latest, error } = await supabase.from('unit_daily')
      .select('date').order('date', { ascending: false }).limit(1);
    if (error) throw new Error(error.message);
    const maxDate = latest && latest.length ? String(latest[0].date).slice(0, 10) : '';
    if (!maxDate) {
      add('sheet-empty', 'ไม่มีข้อมูลกำไรจากชีทเลย (ตาราง unit_daily ว่าง)');
    } else {
      const lagDays = Math.round((Date.parse(todayStr) - Date.parse(maxDate)) / 86400000);
      if (lagDays > 2) {
        add('sheet-stale', `กำไรจากชีทค้างอยู่ที่ ${maxDate} (${lagDays} วันแล้ว) — งาน product-sheets ไม่ได้เขียนข้อมูลใหม่`);
      } else notes.push(`ชีทกำไรถึง ${maxDate}`);
    }
    const { count } = await supabase.from('unit_daily')
      .select('key', { count: 'exact', head: true }).gt('date', todayStr);
    if (count && count > 0) {
      add('sheet-future-rows', `มีแถวกำไร "วันอนาคต" ${count} แถว (หลัง ${todayStr}) — แถวสูตรของชีทหลุดเข้ามา จะทำให้แจ้งเตือนขาดทุนหลอน`);
    }
  } catch (e: any) {
    add('sheet-read', `อ่าน unit_daily ไม่ได้: ${String(e.message || e).slice(0, 90)}`);
  }

  /* ---- 5) ใบรายงานผลของแต่ละงาน: เพจพลาดเกิน 1 ใน 3 / ข้ามตัวเอง / แถวหายเกินครึ่ง ---- */
  try {
    const stats = await loadJobStats();
    Object.keys(stats).sort().forEach((job) => {
      const p = coverageProblem(stats[job]);
      if (p) add('job-coverage', `${job}: ${p}`);
    });
  } catch (e: any) {
    add('stat-read', `อ่านสถิติงานไม่ได้: ${String(e.message || e).slice(0, 90)}`);
  }

  const ok = !problems.length;
  // sync_log ตัดข้อความที่ 1000 ตัวอักษร — เอาแค่ 5 เรื่องแรกพอ (ที่เหลือดูใน log ของ worker)
  const shown = problems.slice(0, 5).map((p) => p.message).join(' ⁃ ');
  const more = problems.length > 5 ? ` ⁃ …และอีก ${problems.length - 5} เรื่อง` : '';
  const message = ok
    ? `ตรวจแล้วปกติ (${notes.join(' | ')})`
    : `พบ ${problems.length} เรื่องผิดปกติ — ${shown}${more}`;
  return { ok, message, problems };
}
