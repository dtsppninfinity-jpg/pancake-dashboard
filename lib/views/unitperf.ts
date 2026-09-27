// lib/views/unitperf.ts — หน้า "ผลงานรายยูนิต" (พีสั่ง 21 ก.ย. 2569)
// ยอดเดือนนี้ vs เป้า + คาดการณ์สิ้นเดือน + สัญญาณเตือนที่ระบบตรวจเจอ
// ตัวเลขทุกตัวมาจาก apiUnitPerf (lib/api/unitperf.ts) — กติกาเดียวกับหน้ายอดขายทุกช่อง
//
// หน้าตา = "ตารางจัดอันดับ" ทีมเลือกเองจาก 3 แบบที่เสนอ (21 ก.ย. 69) เหตุผลที่ให้มาคือ "ดูง่าย"
// ทุกยูนิตอยู่ในตารางเดียว เรียงได้ทุกคอลัมน์ กดชื่อยูนิตหรือปุ่มท้ายแถวเพื่อกางสัญญาณเต็ม + ตัวเลขรอง
// (ของเดิมเป็นการ์ดใบละยูนิต — เลิกใช้เพราะทีมอ่านเทียบยูนิตต่อยูนิตยาก)
//
// ตรวจ UI รอบ 3 (26 ก.ย. 69)
// - G2: การเรียงตารางย้ายไปใช้ตัวกลาง makeSortable (lib/ui/table-sort.ts) — คอลัมน์/ค่าเริ่มต้นเดิม จำการเรียงข้ามการวาดใหม่
// - B3 งบสีแดง: เดิม 20 จาก 20 ยูนิตขึ้น "ต้องแก้ทันที" สีแดงหมด ตาชินจนไม่เห็นอะไร
//   → ระดับจาก API คงเดิมทุกข้อ แต่ "สีแดง" เหลือเฉพาะกลุ่มหนักสุด (ดู computeSev) ที่เหลือเป็นส้ม
// - E2/E3: ตัวเลขผ่านตัวจัดรูปแบบกลาง สีผ่านกติกาสีกลาง (lib/ui/color-rules.ts)

import {
  serverCall, esc, THB, THBk, fmtNum, pct1, pct2, roasFmt, monthTh, dash, showError, stateHtml, infoTip,
} from '@/lib/ui/helpers';
import { icon, ICON_FOR } from '@/lib/ui/icons';
import {
  pctKind, closeRateKind, roasKind, profitKind, kindClass, closeRateLegend, LEGEND,
} from '@/lib/ui/color-rules';
import { makeSortable, sortTh } from '@/lib/ui/table-sort';
import { unitperfSkel } from '@/lib/ui/skeletons';

declare global {
  // app-core แนบ App ไว้บน global — view อ้างถึงตรงๆ (ห้าม import กัน cycle)
  // eslint-disable-next-line no-var
  var App: { switchView: (view: string) => void };
}

interface Signal { text: string; level: 'urgent' | 'watch' }
interface UnitRow {
  u: string; key: string; mapped: boolean; product: string;
  pages: number; admins: number; note: string;
  revenue: number; orders: number; spend: number; base: number; profit: number | null;
  target: number | null; attain: number | null;
  projected: number | null; projAttain: number | null; gap: number | null;
  closeRate: number | null; roas: number | null; costPerMsg: number | null; perBill: number | null;
  closeBaseSrc?: 'meta' | 'pancake';
  breakEven: number; breakEvenSet: boolean; lossStreak: number; closeStreak: number;
  signals: Signal[]; level: 'urgent' | 'watch' | 'ok';
}
interface PerfData {
  month: string; monthStart: string; monthEnd: string; lastYmd: string;
  daysElapsed: number; daysDone: number; daysInMonth: number; isCurrentMonth: boolean; closeTarget: number;
  needSalesRpc: boolean; needAdsRpc: boolean; salesFailed: boolean; adsFailed: boolean;
  beforeData: boolean; dataStart: string; lossUsable: boolean; lastDoneYmd: string; lossThroughDate: string;
  goalSheetId: string; goalYearMismatch: boolean;
  units: UnitRow[];
  totals: { revenue: number; target: number; spend: number; projected: number; profit: number; urgent: number; watch: number };
}

/* ---------------- ระดับบนจอ (B3 งบสีแดง) ----------------
   ระดับจาก API: urgent = มีเรื่องต้องแก้ทันทีอย่างน้อย 1 เรื่อง · watch = มีแต่เรื่องต้องจับตา · ok = ไม่มีสัญญาณ
   บนจอแตก urgent ออกเป็น 2 ชั้น เพื่อให้สีแดงเหลือเฉพาะเรื่องที่ "ต้องทำวันนี้และมีไม่กี่เรื่อง":
     top    หนักสุด  = ยูนิตที่มีเรื่องต้องแก้ทันที "มากที่สุด" (แดง)
     urgent ต้องแก้  = urgent ที่เหลือ (ส้มทึบ)
     watch  เฝ้าระวัง (วงส้ม) · ok ปกติ (เขียว = ดี)
   ไม่ได้เปลี่ยนกติกาตัดสินของ API สักข้อ — แค่เลือกว่าจะทาแดงให้กลุ่มไหน */
type Tier = 'top' | 'urgent' | 'watch' | 'ok';
const TIER_LABEL: Record<Tier, string> = { top: 'หนักสุด', urgent: 'ต้องแก้', watch: 'เฝ้าระวัง', ok: 'ปกติ' };
/** แดงได้ไม่เกินกี่ยูนิต — เกินนี้ (หรือเกินครึ่งตาราง) แปลว่า "หนักสุด" ไม่ใช่เรื่องไม่กี่เรื่องแล้ว จึงไม่ทาแดงเลย */
const RED_BUDGET = 5;

interface Sev { tier: Tier; nU: number; nW: number; score: number }
interface SevInfo { byKey: Record<string, Sev>; top: UnitRow[]; maxU: number }

/** key ของแถว — ต้องใช้ key ไม่ใช่ u (กองที่ยังไม่จัดกลุ่มมี u = '' ซึ่งชนกับค่าว่างของ state.open) */
const rowKey = (u: UnitRow): string => u.key || u.u || 'none';

/** ยูนิตไหนหนักกว่า: เรื่องต้องแก้มากกว่า → เรื่องเฝ้าระวังมากกว่า → คาดการณ์ต่ำกว่า → ขาดทุนมากกว่า → ยอดมากกว่า */
function worseFirst(a: UnitRow, b: UnitRow, sev: Record<string, Sev>): number {
  const sa = sev[rowKey(a)], sb = sev[rowKey(b)];
  if (sa.score !== sb.score) return sb.score - sa.score;
  const pa = a.projAttain === null ? 1e9 : a.projAttain, pb = b.projAttain === null ? 1e9 : b.projAttain;
  if (pa !== pb) return pa - pb;
  const fa = a.profit === null ? 1e15 : a.profit, fb = b.profit === null ? 1e15 : b.profit;
  if (fa !== fb) return fa - fb;
  return b.revenue - a.revenue;
}

function computeSev(units: UnitRow[]): SevInfo {
  const byKey: Record<string, Sev> = {};
  let maxU = 0;
  units.forEach((u) => {
    const nU = u.signals.filter((s) => s.level === 'urgent').length;
    const nW = u.signals.length - nU;
    byKey[rowKey(u)] = { tier: u.level, nU, nW, score: nU * 10 + nW };
    if (nU > maxU) maxU = nU;
  });
  let top = maxU > 0 ? units.filter((u) => byKey[rowKey(u)].nU === maxU) : [];
  if (top.length > RED_BUDGET || top.length * 2 > units.length) top = [];
  top.forEach((u) => { byKey[rowKey(u)].tier = 'top'; });
  top = top.slice().sort((a, b) => worseFirst(a, b, byKey));
  return { byKey, top, maxU };
}

let lastData: PerfData | null = null;
let reqSeq = 0;
// ตัวกรองจำข้ามการ re-render (หน้านี้รีเฟรชเองหลังโหลด ตัวกรองต้องไม่รีเซ็ต) — การเรียงจำโดย makeSortable
const state = {
  month: '', q: '',
  level: 'all' as 'all' | Tier,
  open: '',                          // key ของแถวที่กางอยู่ ('' = ไม่มีแถวไหนกาง)
};
/** ชื่อจำการเรียงของตาราง (makeSortable จำไว้ในหน่วยความจำ + sessionStorage) */
const SORT_ID = 'unitperf-units';

/** ตัวเลขที่ใช้ตัดสินสี = คาดการณ์ในเดือนที่ยังไม่จบ / ยอดจริงในเดือนที่จบแล้ว */
const headPct = (u: UnitRow, d: PerfData) => (d.isCurrentMonth && u.projected !== null ? u.projAttain : u.attain);
const clampPct = (v: number) => Math.max(0, Math.min(100, v));
/** 'none' → '' (คลาสแถบ .up-bar ใช้ชื่อ good / warn / bad) */
const barCls = (k: string) => (k === 'none' ? '' : k);
/** ค่าดิบสำหรับเรียง (data-sort) — ค่าที่ไม่มี = ว่าง = อยู่ท้ายเสมอ */
const sv = (v: number | string | null | undefined) => (v === null || v === undefined ? '' : esc(String(v)));

/** ผู้ดูแลระบบเท่านั้นที่เห็นรายละเอียดเทคนิค (ชื่อไฟล์ .sql ฯลฯ) — page.tsx ใส่ data-role ไว้ที่ #app */
function isSuperadmin(): boolean {
  const app = typeof document !== 'undefined' ? document.getElementById('app') : null;
  return !!app && app.dataset.role === 'superadmin';
}

/**
 * แถบความคืบหน้า: เต็มแถบ = เป้าเดือน
 *   ทึบ = ยอดจริงถึงตอนนี้ · จาง = ส่วนที่คาดว่าจะได้เพิ่มจนสิ้นเดือน
 *   ขีด = ผ่านไปแล้วกี่ % ของเดือน (ถ้าขายสม่ำเสมอ ยอดควรถึงขีดนี้)
 * เดือนที่จบแล้วไม่มีทั้งส่วนจางและขีด
 */
function barHtml(u: UnitRow, d: PerfData, cls: string): string {
  if (!u.target) return '';
  const now = clampPct(u.attain === null ? 0 : u.attain);
  const projRaw = d.isCurrentMonth && u.projAttain !== null ? clampPct(u.projAttain) : now;
  const projW = Math.max(0, projRaw - now);
  const pace = d.isCurrentMonth ? clampPct((d.daysElapsed / d.daysInMonth) * 100) : null;
  return '<div class="up-bar">' +
    '<i class="fill ' + cls + '" style="width:' + now.toFixed(2) + '%"></i>' +
    (projW > 0 ? '<i class="proj ' + cls + '" style="left:' + now.toFixed(2) + '%;width:' + projW.toFixed(2) + '%"></i>' : '') +
    (pace !== null ? '<i class="pace" style="left:calc(' + pace.toFixed(2) + '% - 1px)"></i>' : '') +
  '</div>';
}

/* ---------------- หัวตาราง ----------------
   ค่าเริ่มต้น = %บรรลุเป้าสูงสุดลงมาต่ำสุด (ทีมสั่ง 21 ก.ย. 69) · dir = ทิศที่ "มีประโยชน์" ตอนกดครั้งแรก
   คำอธิบายสั้นอยู่ที่ data-tip (ชี้เมาส์) · 2 คอลัมน์ที่ทีมถามบ่อยมีปุ่ม ⓘ แตะดูได้บนมือถือด้วย */
const COL_COUNT = 10;
function headHtml(d: PerfData): string {
  const projTip = d.isCurrentMonth
    ? 'คาดสิ้นเดือน = ยอดเฉลี่ยของวันที่จบแล้ว × จำนวนวันทั้งเดือน • ไม่รวมวันนี้ที่ยังไม่จบ • สีตัดสินจากตัวเลขนี้'
    : 'เดือนที่จบแล้ว = ยอดจริงทั้งเดือนเทียบเป้า';
  const closeTip = '%ปิด = ออเดอร์ ÷ รวมคนทัก ของเพจ Facebook • ฐานเดียวกับหน้ายอดขาย' +
    ' • Meta: ทัก + คอมเมนต์ (ถอยไปใช้ Pancake ถ้าเดือนนั้นข้อมูล Meta ยังไม่ครบ) • เป้า ' + d.closeTarget + '%';
  return '<tr>' +
    '<th data-tip="ลำดับตามการเรียงที่เลือกอยู่ • จุดสี = ระดับสัญญาณของยูนิต">#</th>' +
    sortTh('ยูนิต', 'u', { dir: 'asc', tip: 'รหัสยูนิต + สินค้าหลัก' }) +
    sortTh('ยอด vs เป้าเดือน', 'attain', {
      dir: 'desc', tip: 'ยอดจริง / เป้าเดือน • แถบ: ทึบ = ยอดจริง • จาง = ส่วนที่คาดว่าจะได้เพิ่ม • ขีด = ผ่านไปกี่ % ของเดือน',
    }) +
    sortTh('คาดสิ้นเดือน', 'proj', { dir: 'asc', cls: 'r', after: infoTip(projTip, 'คาดสิ้นเดือน') }) +
    sortTh('%ปิด', 'close', { dir: 'asc', cls: 'r', after: infoTip(closeTip, '%ปิด') }) +
    sortTh('ROAS', 'roas', { dir: 'asc', cls: 'r', tip: 'ยอดขาย ÷ ค่าแอด • สีขึ้นเฉพาะยูนิตที่ตั้งจุดคุ้มทุนไว้แล้ว' }) +
    sortTh('ค่าแอด', 'spend', { dir: 'desc', cls: 'r', tip: 'ค่าแอดจริงจาก Meta ทั้งเดือน' }) +
    sortTh('กำไร', 'profit', { dir: 'asc', cls: 'r', tip: 'กำไรสุทธิสะสมเดือนนี้ จากชีทสรุปรายสินค้า' }) +
    sortTh('สัญญาณ', 'sig', { dir: 'desc', tip: 'จำนวนเรื่องที่ระบบตรวจพบ • เรียงจากหนักไปเบา • กด “ดู” เพื่ออ่านเต็ม' }) +
    '<th class="r"><span class="misc-vh">รายละเอียด</span></th>' +
  '</tr>';
}

/** จุดสีระดับ (แดง = หนักสุด · ส้มทึบ = ต้องแก้ · วงส้ม = เฝ้าระวัง · เขียว = ปกติ) */
const tierDot = (t: Tier, label = true) => '<span class="up-dot tier-' + t + '"' +
  (label ? ' role="img" aria-label="' + esc(TIER_LABEL[t]) + '"' : ' aria-hidden="true"') + '></span>';

function rowHtml(u: UnitRow, rank: number, d: PerfData, sev: SevInfo): string {
  const s = sev.byKey[rowKey(u)];
  const p = headPct(u, d);
  const pk = pctKind(p);
  // ชื่อในช่องยูนิตเป็น HTML แล้ว (กองที่ยังไม่จัดกลุ่มมีไอคอนเตือนนำหน้า) — escape ที่นี่ที่เดียว
  const nameHtml = u.mapped ? esc(u.u || '')
    : '<span class="tx-warn">' + icon(ICON_FOR.alert, { size: 14 }) + '</span> ยังไม่จัดกลุ่ม';
  const projSub = !u.target ? 'ไม่มีเป้าในชีท'
    : !d.isCurrentMonth ? 'ยอดจริงทั้งเดือน'
      : u.projected === null ? 'ยังคาดไม่ได้' : THBk(u.projected);
  const roasK = roasKind(u.roas, u.breakEvenSet ? u.breakEven : null);

  const rowId = rowKey(u);
  const isOpen = state.open === rowId;
  return '<tr data-u="' + esc(u.u) + '"' + (isOpen ? ' class="up-open"' : '') + '>' +
    '<td class="up-rankcell" title="' + esc(TIER_LABEL[s.tier]) + '">' +
      tierDot(s.tier) + '<span class="up-rank sort-rank">' + rank + '</span></td>' +

    '<td data-sort="' + sv(u.mapped ? u.u : null) + '" title="' + esc((u.product || 'ยังไม่จัดกลุ่ม') +
      (u.mapped ? ' • ' + fmtNum(u.pages) + ' เพจ • ' + fmtNum(u.admins) + ' แอดมิน' : '') +
      (u.note ? ' • หมายเหตุ: ' + u.note : '')) + '">' +
      // ช่องชื่อ (ตรึงซ้าย) กดแล้วกางรายละเอียดเหมือนปุ่ม "ดู" ท้ายแถว — บนมือถือปุ่ม "ดู" อยู่สุดขวา
      // ต้องเลื่อนตารางไปหา ชื่อยูนิตอยู่ใต้นิ้วตลอด · เป็น <button> จริงเพื่อให้ Tab/Enter/Space ใช้ได้เอง
      '<button type="button" class="up-unit up-name" data-more="' + esc(rowId) + '"' +
        ' aria-expanded="' + (isOpen ? 'true' : 'false') + '"' +
        ' aria-label="' + esc((u.u || 'ยังไม่จัดกลุ่ม') + ' ' + (u.product || '') + ' — ดูรายละเอียด') + '">' +
        '<span class="up-code">' + nameHtml + '</span>' +
        // กองที่ยังไม่จัดกลุ่ม: API ใส่ชื่อสินค้าเป็น "ยังไม่จัดกลุ่ม" ซ้ำกับชื่อในช่องอยู่แล้ว — ไม่ต้องพิมพ์ 2 รอบ
        '<span class="up-prod">' + (u.mapped ? esc(u.product || '') : '') + '</span>' +
      '</button></td>' +

    '<td class="up-goal" data-sort="' + sv(u.attain) + '" title="' + esc('ยอดจริง ' + THB(u.revenue) + ' • ออเดอร์ ' + fmtNum(u.orders) +
      (u.target
        ? ' • เป้าเดือน ' + THB(u.target) + ' • ทำได้ ' + pct1(u.attain === null ? 0 : u.attain) +
          (u.gap ? ' • ขาดอีก ' + THB(u.gap) : ' • ถึงเป้าแล้ว') +
          (d.isCurrentMonth ? ' • ผ่านไปแล้ว ' + d.daysElapsed + ' จาก ' + d.daysInMonth + ' วัน' : '')
        : ' • ยังไม่มีเป้าเดือนนี้ในชีท KPI')) + '">' +
      '<div class="up-goal-top">' +
        '<span class="up-money num"><b>' + THBk(u.revenue) + '</b>' +
          (u.target ? '<span> / ' + THBk(u.target) + '</span>' : '') + '</span>' +
        // %ทำได้ถึงตอนนี้ = ข้อมูลความคืบหน้า ไม่ใช่คำตัดสิน (กลางเดือนทุกยูนิตยังไม่ถึงเป้าเต็มเดือนอยู่แล้ว)
        // สีตัดสินอยู่ที่แถบกับคอลัมน์ "คาดสิ้นเดือน" ซึ่งเทียบถูกฐาน
        '<span class="num up-attain">' + (u.attain === null ? 'ไม่มีเป้า' : pct1(u.attain)) + '</span>' +
      '</div>' + barHtml(u, d, barCls(pk)) +
    '</td>' +

    '<td class="r num" data-sort="' + sv(p) + '" title="' + esc(d.isCurrentMonth && u.projected !== null
      ? 'คาดการณ์สิ้นเดือน ' + THB(u.projected) +
        (u.projAttain === null ? ' (ยังไม่มีเป้าในชีท KPI)' : ' = ' + pct1(u.projAttain) + ' ของเป้า') +
        ' (ยอดเฉลี่ยของ ' + d.daysDone + ' วันที่จบแล้ว × ' + d.daysInMonth + ' วัน)'
      : d.isCurrentMonth ? 'วันแรกของเดือน ยังไม่มีวันที่จบแล้วให้คาดการณ์'
        : 'ยอดจริงทั้งเดือนเทียบเป้า') + '">' +
      '<div class="up-big ' + kindClass(pk) + '">' + (p === null ? dash() : pct1(p)) + '</div>' +
      '<div class="up-sub">' + esc(projSub) + '</div></td>' +

    '<td class="r num" data-sort="' + sv(u.closeRate) + '" title="' + esc('ออเดอร์ ' + fmtNum(u.orders) + ' ÷ รวมคนทัก ' + fmtNum(u.base) +
        ' • เป้า ' + d.closeTarget + '% ขึ้นไป') + '">' +
      (u.closeRate === null ? dash()
        : '<span class="' + kindClass(closeRateKind(u.closeRate, d.closeTarget)) + '">' + pct2(u.closeRate) + '</span>') + '</td>' +

    '<td class="r num" data-sort="' + sv(u.roas) + '" title="' + esc('ยอดขาย ÷ ค่าแอด ' + THB(u.spend) +
      (u.breakEvenSet ? ' • จุดคุ้มทุนของยูนิตนี้ ' + roasFmt(u.breakEven)
        : ' • ยังไม่ได้ตั้งจุดคุ้มทุน (ใช้ค่าเริ่มต้น 1x จึงไม่ทาสี)')) + '">' +
      (u.roas === null ? dash() : '<span class="' + kindClass(roasK) + '">' + roasFmt(u.roas) + '</span>') + '</td>' +

    '<td class="r num" data-sort="' + sv(u.spend) + '" title="' + esc('ค่าแอดจริงจาก Meta ทั้งเดือน ' + THB(u.spend) +
      (u.costPerMsg === null ? '' : ' • ค่าทัก ฿' + u.costPerMsg.toFixed(2) + ' ต่อคน')) + '">' +
      THBk(u.spend) + '</td>' +

    '<td class="r num" data-sort="' + sv(u.profit) + '" title="' +
      esc(u.profit === null ? 'ยังไม่มีข้อมูลกำไรของยูนิตนี้ในชีทสรุปรายสินค้า'
        : 'กำไรสุทธิสะสมเดือนนี้จากชีท ' + THB(u.profit)) + '">' +
      (u.profit === null ? dash() : '<span class="' + kindClass(profitKind(u.profit)) + '">' + THBk(u.profit) + '</span>') + '</td>' +

    // ค่าเรียง = น้ำหนักความหนัก (เรื่องต้องแก้ × 10 + เรื่องเฝ้าระวัง) → เรียงมากไปน้อย = หนักสุดขึ้นก่อน
    // ป้ายบอกจำนวนเรื่องรวม — ชี้ดูได้ว่าเป็นเรื่องต้องแก้ทันทีกี่เรื่อง (ยูนิต 4 เรื่องบางตัวแดง บางตัวเทา เพราะนับเรื่องด่วนไม่เท่ากัน)
    '<td data-sort="' + s.score + '"' + (u.signals.length
      ? ' title="' + esc('ต้องแก้ทันที ' + s.nU + ' เรื่อง • เฝ้าระวัง ' + s.nW + ' เรื่อง') + '"' : '') + '>' + (u.signals.length
      ? '<span class="up-sig tier-' + s.tier + '">' + u.signals.length + ' เรื่อง</span>'
      : '<span class="up-sig tier-ok">ไม่มี</span>') + '</td>' +

    '<td class="r"><button type="button" class="up-more btn-text" data-more="' + esc(rowId) + '"' +
      ' aria-expanded="' + (isOpen ? 'true' : 'false') + '"' +
      ' aria-label="' + esc((isOpen ? 'ปิดรายละเอียด ' : 'ดูรายละเอียด ') + (u.u || 'ยังไม่จัดกลุ่ม')) + '">' +
      (isOpen ? 'ปิด' : 'ดู') + icon(isOpen ? ICON_FOR.collapse : ICON_FOR.expand, { size: 14 }) + '</button></td>' +
  '</tr>' +
  (isOpen ? detailHtml(u, s) : '');
}

/** แถวที่กางออก — data-sort-follow = ย้ายตามแถวหลักเวลาเรียง · .up-detail-in ค้างอยู่ในช่องที่มองเห็นบนมือถือ */
function detailHtml(u: UnitRow, s: Sev): string {
  // เรื่องต้องแก้ขึ้นก่อนเรื่องเฝ้าระวัง (sort ของ JS คงลำดับเดิมเมื่อเท่ากัน)
  const sigs = u.signals.length
    ? u.signals.slice().sort((a, b) => (a.level === b.level ? 0 : a.level === 'urgent' ? -1 : 1)).map((x) => {
      const t: Tier = x.level === 'watch' ? 'watch' : (s.tier === 'top' ? 'top' : 'urgent');
      return '<span class="up-sig tier-' + t + '">' + esc(x.text) + '</span>';
    }).join('')
    : '<span class="up-sig tier-ok">ไม่พบสัญญาณผิดปกติ</span>';
  return '<tr class="up-detail" data-sort-follow><td colspan="' + COL_COUNT + '"><div class="up-detail-in">' +
    '<div class="up-sigs">' + sigs + '</div>' +
    '<div class="up-facts">' +
      '<span>ยอดขาย <b>' + THB(u.revenue) + '</b></span>' +
      '<span>คนทัก <b>' + fmtNum(u.base) + '</b></span>' +
      '<span>ออเดอร์ <b>' + fmtNum(u.orders) + '</b></span>' +
      '<span>เปอร์บิล <b>' + (u.perBill ? THB(u.perBill) : dash()) + '</b></span>' +
      '<span>ค่าทัก <b>' + (u.costPerMsg === null ? dash() : '฿' + u.costPerMsg.toFixed(2)) + '</b></span>' +
      '<span>ขาดอีก <b>' + (u.gap ? THB(u.gap) : dash()) + '</b></span>' +
      '<span>จุดคุ้มทุน <b>' + (u.breakEvenSet ? roasFmt(u.breakEven) : 'ยังไม่ตั้ง') + '</b></span>' +
      (u.mapped ? '<span>เพจ/แอดมิน <b>' + fmtNum(u.pages) + ' / ' + fmtNum(u.admins) + '</b></span>' : '') +
      (u.note ? '<span>หมายเหตุ <b>' + esc(u.note) + '</b></span>' : '') +
    '</div>' +
    (u.mapped ? '<button type="button" class="up-daily" data-u="' + esc(u.u) + '">ดูยอดรายวันของ ' + esc(u.u) + ' ›</button>' : '') +
  '</div></td></tr>';
}

/** แถวรวมท้ายตาราง — รวมเฉพาะยูนิตที่ตัวกรองเหลือไว้ ไม่ใช่ยอดรวมทั้งหมดเสมอ */
function footHtml(list: UnitRow[]): string {
  const sum = list.reduce((a, u) => ({
    revenue: a.revenue + u.revenue,
    target: a.target + (u.target || 0),
    spend: a.spend + u.spend,
    orders: a.orders + u.orders,
    projected: a.projected + (u.projected === null ? u.revenue : u.projected),
    profit: a.profit + (u.profit || 0),
  }), { revenue: 0, target: 0, spend: 0, orders: 0, projected: 0, profit: 0 });
  const attain = sum.target > 0 ? Math.round((sum.revenue / sum.target) * 1000) / 10 : null;
  const projAttain = sum.target > 0 ? Math.round((sum.projected / sum.target) * 1000) / 10 : null;
  return '<tr>' +
    '<td></td>' +
    '<td><b>รวม ' + fmtNum(list.length) + ' ยูนิต</b></td>' +
    '<td class="up-goal"><div class="up-goal-top">' +
      '<span class="up-money num"><b>' + THBk(sum.revenue) + '</b><span> / ' + THBk(sum.target) + '</span></span>' +
      '<span class="num up-attain">' + (attain === null ? dash() : pct1(attain)) + '</span></div>' +
      '<div class="up-sub">' + fmtNum(sum.orders) + ' ออเดอร์</div></td>' +
    '<td class="r num"><div class="up-big ' + kindClass(pctKind(projAttain)) + '">' + (projAttain === null ? dash() : pct1(projAttain)) + '</div>' +
      '<div class="up-sub">' + THBk(sum.projected) + '</div></td>' +
    '<td></td><td></td>' +
    '<td class="r num">' + THBk(sum.spend) + '</td>' +
    '<td class="r num"><span class="' + kindClass(profitKind(sum.profit)) + '">' + THBk(sum.profit) + '</span></td>' +
    '<td></td><td></td>' +
  '</tr>';
}

/** ค้นหาอย่างเดียว (ยังไม่กรองระดับ) — ใช้เป็นฐานนับจำนวนบนชิปกรอง ให้ตัวเลขตรงกับสิ่งที่จะได้เห็นจริง */
function searchOnly(units: UnitRow[]): UnitRow[] {
  const q = state.q.trim().toLowerCase();
  if (!q) return units;
  return units.filter((u) => (u.u || '').toLowerCase().indexOf(q) >= 0 || (u.product || '').toLowerCase().indexOf(q) >= 0);
}

/** กรองตามคำค้น + ระดับ — ลำดับคงตามที่ API เรียงมา (การเรียงตามคอลัมน์ makeSortable ทำหลังวาด) */
function filterList(units: UnitRow[], sev: SevInfo): UnitRow[] {
  return searchOnly(units).filter((u) => state.level === 'all' || sev.byKey[rowKey(u)].tier === state.level);
}

/**
 * รายการเดือน = 6 เดือนล่าสุดนับจาก "เดือนปัจจุบัน" เสมอ (ไม่ใช่จากเดือนที่เลือก ไม่งั้นเดินถอยหลังทางเดียว
 * แล้วกลับมาเดือนนี้ไม่ได้) · ไม่ย้อนเกินเดือนที่ระบบเริ่มมีออเดอร์จริง · เดือนที่เลือกอยู่ต้องอยู่ในรายการเสมอ
 */
function monthOptions(cur: string, dataStart: string): string {
  const now = new Date(Date.now() + 7 * 3600e3);   // เวลาไทย
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  const floor = (dataStart || '2026-05-23').slice(0, 7);
  const keys: string[] = [];
  for (let i = 0; i < 6; i++) {
    const dt = new Date(Date.UTC(y, m - 1 - i, 1));
    const key = dt.toISOString().slice(0, 7);
    if (key < floor) break;
    keys.push(key);
  }
  if (cur && keys.indexOf(cur) < 0) keys.push(cur);
  keys.sort().reverse();
  return keys.map((key) => '<option value="' + key + '"' + (key === cur ? ' selected' : '') + '>' +
    esc(monthTh(key)) + '</option>').join('');
}

/** ชิปกรองระดับ เรียงจากหนักไปเบา — จุดสีบอกระดับ ตัวเลขสีปกติ (ไม่ทาแดงตัวเลขทั้งแถว) */
function levelChips(units: UnitRow[], sev: SevInfo): string {
  const base = searchOnly(units);
  const n = (lv: string) => (lv === 'all' ? base.length : base.filter((u) => sev.byKey[rowKey(u)].tier === lv).length);
  const defs: Array<['all' | Tier, string]> = [['all', 'ทั้งหมด']];
  if (sev.top.length) defs.push(['top', TIER_LABEL.top]);
  defs.push(['urgent', TIER_LABEL.urgent], ['watch', TIER_LABEL.watch], ['ok', TIER_LABEL.ok]);
  return '<div class="up-chips" role="group" aria-label="กรองตามระดับสัญญาณ">' +
    defs.map(([k, label]) => '<button type="button" class="up-chip tier-' + k + '" data-lv="' + k + '"' +
      ' aria-pressed="' + (state.level === k ? 'true' : 'false') + '">' +
      (k === 'all' ? '' : tierDot(k as Tier, false)) +
      esc(label) + ' <b>' + fmtNum(n(k)) + '</b></button>').join('') +
  '</div>';
}

/** กล่องตัวเลขสรุป (C3 .stat-box) — กล่องแรกคือหัวข้อสรุปสัญญาณ (B3: สีปกติ + บอกกลุ่มหนักสุด เรียงหนักไปเบา) */
function summaryHtml(d: PerfData, sev: SevInfo): string {
  const units = d.units || [];
  const flagged = units.filter((u) => u.level !== 'ok').length;
  const nUrgent = units.filter((u) => sev.byKey[rowKey(u)].tier === 'urgent').length;
  const nWatch = units.filter((u) => u.level === 'watch').length;
  const sigTip = 'ระบบตรวจ 4 เรื่องต่อยูนิต: ขาดทุนติดกันกี่วัน • %ปิดต่ำกว่าเป้าติดกันกี่วัน • คาดว่าจะไม่ถึงเป้าเดือนนี้ • กำไรสะสมติดลบ' +
    ' • หนักสุด = ยูนิตที่มีเรื่องต้องแก้ทันทีมากที่สุด' + (sev.maxU ? ' (ตอนนี้ ' + sev.maxU + ' เรื่อง)' : '') +
    ' ใช้สีแดงกับกลุ่มนี้เท่านั้น • ต้องแก้ = มีเรื่องต้องแก้ทันทีอย่างน้อย 1 เรื่อง (ส้ม) • เฝ้าระวัง = มีแต่เรื่องที่ต้องจับตา';
  let sub: string;
  if (sev.top.length) {
    // ชื่อยูนิตกลุ่มหนักสุด เรียงหนักไปเบา — กดแล้วพาไปแถวนั้นพร้อมกางสัญญาณ
    sub = tierDot('top', false) + 'หนักสุด ' + sev.top.length + ' ยูนิต: ' +
      sev.top.map((u) => '<button type="button" class="up-toplink" data-goto="' + esc(rowKey(u)) + '"' +
        ' aria-label="' + esc('ไปที่ ' + (u.u || 'ยังไม่จัดกลุ่ม') + ' และดูสัญญาณ') + '">' + esc(u.u || 'ยังไม่จัดกลุ่ม') + '</button>').join('');
  } else if (flagged) {
    sub = 'ต้องแก้ ' + fmtNum(nUrgent) + ' • เฝ้าระวัง ' + fmtNum(nWatch);
  } else {
    sub = 'ทุกยูนิตปกติ';
  }
  const t = d.totals;
  return '<div class="stat-boxes up-stats">' +
    '<div class="stat-box up-sigbox">' +
      '<div class="sb-label">สัญญาณเตือน' + infoTip(sigTip, 'สัญญาณเตือน') + '</div>' +
      '<div class="sb-value v-plain">' + fmtNum(flagged) + ' <span class="up-unitword">จาก ' + fmtNum(units.length) + ' ยูนิต</span></div>' +
      '<div class="sb-sub up-sigsub">' + sub + '</div>' +
    '</div>' +
    '<div class="stat-box" title="' + esc(THB(t.revenue)) + '">' +
      '<div class="sb-label">ยอดรวม' + (d.isCurrentMonth ? 'เดือนนี้' : 'ทั้งเดือน') + '</div>' +
      '<div class="sb-value v-plain">' + THBk(t.revenue) + '</div>' +
      '<div class="sb-sub">' + (t.target ? 'เป้า ' + THBk(t.target) : 'ยังไม่มีเป้าในชีท KPI') + '</div>' +
    '</div>' +
    '<div class="stat-box" title="' + esc(THB(d.isCurrentMonth ? t.projected : t.revenue)) + '">' +
      '<div class="sb-label">' + (d.isCurrentMonth ? 'คาดการณ์สิ้นเดือนรวม' : 'ยอดจริงทั้งเดือน') + '</div>' +
      '<div class="sb-value v-plain">' + THBk(d.isCurrentMonth ? t.projected : t.revenue) + '</div>' +
      '<div class="sb-sub">' + (d.isCurrentMonth ? 'จากยอดเฉลี่ยของ ' + d.daysDone + ' วันที่จบแล้ว' : 'เดือนที่จบแล้ว') + '</div>' +
    '</div>' +
  '</div>';
}

/** บรรทัดแจ้งเตือนเล็กเหนือตาราง — ภาษาคน · รายละเอียดเทคนิคเห็นเฉพาะผู้ดูแลระบบ */
function noteHtml(text: string, adminDetail?: string): string {
  return '<div class="up-note"><span class="tx-warn">' + icon(ICON_FOR.alert, { size: 16 }) + '</span><div>' + esc(text) +
    (adminDetail && isSuperadmin()
      ? '<details class="state-admin"><summary>รายละเอียดสำหรับผู้ดูแล</summary><pre>' + esc(adminDetail) + '</pre></details>'
      : '') +
  '</div></div>';
}

function render(container: HTMLElement, d: PerfData | null): void {
  if (!d) return;
  if (d.salesFailed) {
    container.innerHTML = '<div class="card">' + stateHtml('error', {
      title: 'ดึงยอดขายรอบนี้ไม่สำเร็จ',
      body: 'ระบบตอบช้าหรือขัดข้องชั่วคราว ลองใหม่อีกครั้ง',
      actionsHtml: '<button type="button" class="btn" id="up-retry">' + icon(ICON_FOR.refresh, { size: 16 }) + 'ลองใหม่</button>',
    }) + '</div>';
    return;
  }
  // ไม่มี RPC ยอดขาย = ทั้งหน้าไม่มีตัวเลขเลย ต้องหยุดและบอกผู้ดูแลวิธีแก้
  // ส่วน RPC ค่าแอดหายไปแค่ทำให้ ROAS/ค่าทัก/ค่าแอด เป็น "—" ตัวเลขที่เหลือยังใช้ได้ จึงแค่เตือน
  if (d.needSalesRpc) {
    container.innerHTML = '<div class="card">' + stateHtml('notready', {
      title: 'หน้านี้ยังไม่พร้อมใช้งาน',
      adminDetail: 'ต้องรันไฟล์ db/migrations/2026-09-21-sales-daily-by-page.sql ใน Supabase (SQL Editor → วาง → Run) ก่อนหนึ่งครั้ง',
    }) + '</div>';
    return;
  }
  const units = d.units || [];
  const sev = computeSev(units);
  if (state.level === 'top' && !sev.top.length) state.level = 'all';   // กลุ่มหนักสุดหายไปหลังรีเฟรช/เปลี่ยนเดือน
  const list = filterList(units, sev);

  const asof = d.isCurrentMonth
    ? 'ข้อมูลถึงวันนี้ (วันที่ ' + d.daysElapsed + ' จาก ' + d.daysInMonth + ' วัน) • คาดการณ์คิดจากยอดเฉลี่ยของ ' +
      d.daysDone + ' วันที่จบแล้ว (ไม่รวมวันนี้)'
    : 'เดือนที่จบแล้ว — ตัวเลขคือยอดจริงทั้งเดือน' +
      (d.lossUsable ? '' : ' • สัญญาณ “ขาดทุนกี่วันติด” มีเฉพาะเดือนปัจจุบัน');

  // C4 แถวเครื่องมือ: ซ้าย = เดือน → ตัวกรองของหน้า (ค้นหา + ระดับ) · หน้านี้ไม่มีไฟล์ดาวน์โหลด
  const toolbar = '<div class="toolbar up-tb">' +
    '<div class="tb-range"><select class="input" id="up-month" aria-label="เลือกเดือน">' + monthOptions(d.month, d.dataStart) + '</select></div>' +
    '<div class="tb-filters up-filters">' +
      '<div class="search-box up-search">' + icon(ICON_FOR.search) +
        '<input class="input" id="up-q" placeholder="ค้นหารหัสยูนิตหรือชื่อสินค้า" aria-label="ค้นหารหัสยูนิตหรือชื่อสินค้า" value="' + esc(state.q) + '">' +
      '</div>' +
    '</div>' +
    levelChips(units, sev) +
  '</div>' +
  '<div class="data-asof">' + esc(asof) + '</div>';

  const notes =
    (d.needAdsRpc
      ? noteHtml('ค่าแอด / ROAS / ค่าทัก ยังไม่พร้อม จึงขึ้นเป็น “—” — ตัวเลขอื่นใช้ได้ตามปกติ กรุณาแจ้งผู้ดูแลระบบ',
        'ยังไม่ได้รันไฟล์ db/migrations/2026-09-21-ads-daily-by-page.sql ใน Supabase')
      : d.adsFailed
        ? noteHtml('ดึงค่าแอดรอบนี้ไม่สำเร็จ — ค่าแอด / ROAS / ค่าทัก จึงขึ้นเป็น “—” ชั่วคราว')
        : '') +
    (d.beforeData
      ? noteHtml('เดือนนี้อยู่ก่อนวันที่ระบบเริ่มเก็บออเดอร์จริง (' + d.dataStart + ') — ยอด ฿0 แปลว่า “ไม่มีข้อมูล” ไม่ใช่ขายไม่ได้')
      : '') +
    (d.goalYearMismatch ? noteHtml('ชีท KPI ที่ดึงมาเป็นของคนละปีกับเดือนที่เลือก — ตารางจึงไม่มีเป้า') : '');

  // บรรทัดอธิบายสี (E3) — สั้นบรรทัดเดียว เกณฑ์เต็มของแต่ละคอลัมน์อยู่ใน ⓘ
  const legendTip = (d.isCurrentMonth ? LEGEND.attainProjected : LEGEND.attain) + ' (แถบและคอลัมน์คาดสิ้นเดือน) • ' +
    closeRateLegend(d.closeTarget) + ' • ' + LEGEND.roas + ' • ' + LEGEND.profit;
  const legend = '<div class="color-legend up-legend">' +
    '<span class="lg lg-good">ถึงเกณฑ์</span><span class="lg lg-warn">ใกล้เกณฑ์</span><span class="lg lg-bad">ต่ำกว่าเกณฑ์</span>' +
    '<span class="up-legend-k">เกณฑ์ของแต่ละคอลัมน์' + infoTip(legendTip, 'สีในตาราง') + '</span>' +
  '</div>';

  const table = list.length
    ? '<div class="card up-card">' +
        '<div class="up-card-top">' +
          '<span class="t-label up-count" aria-live="polite">แสดง ' + fmtNum(list.length) + ' จาก ' + fmtNum(units.length) + ' ยูนิต</span>' +
          legend +
        '</div>' +
        '<div class="table-scroll up-scroll">' +
          '<table class="tbl up-tbl tbl-scroll-x" data-cards="off">' +
            '<thead>' + headHtml(d) + '</thead>' +
            '<tbody>' + list.map((u, i) => rowHtml(u, i + 1, d, sev)).join('') + '</tbody>' +
            '<tfoot>' + footHtml(list) + '</tfoot>' +
          '</table>' +
        '</div>' +
      '</div>'
    : '<div class="card">' + stateHtml('nodata', {
      title: 'ไม่มียูนิตที่ตรงกับตัวกรองนี้',
      body: 'ลองล้างคำค้นหา หรือเลือก “ทั้งหมด”',
      actionsHtml: '<button type="button" class="btn" id="up-clear">ล้างตัวกรอง</button>',
    }) + '</div>';

  const foot = '<div class="card-sub up-foot">กดหัวคอลัมน์เพื่อเรียง • กดชื่อยูนิตหรือ “ดู” ท้ายแถวเพื่ออ่านสัญญาณเต็ม' +
    infoTip('ยอดขาย / ออเดอร์ / คนทัก / ค่าแอด = กติกาเดียวกับหน้ายอดขาย (ไม่นับออเดอร์ยกเลิก ตีกลับ รอสินค้า และออเดอร์เปล่า)' +
      ' • กำไรมาจากชีทสรุปรายสินค้า • สัญญาณ “ขาดทุน / ROAS ต่ำกว่าคุ้มทุน” นับวันติดต่อกันถึง' +
      (d.lossThroughDate ? ' ' + d.lossThroughDate : 'เมื่อวาน') + ' (วันนี้ยังไม่จบ จึงยังไม่ตัดสิน)', 'ที่มาของตัวเลข') +
  '</div>';

  container.innerHTML = toolbar + summaryHtml(d, sev) + notes + table + foot;
  // G2: เรียงด้วยตัวกลาง — ใส่การเรียงที่ผู้ใช้เลือกไว้กลับให้เองทุกรอบวาด (รวมรอบรีเฟรชอัตโนมัติ)
  makeSortable(container, 'table.up-tbl', { id: SORT_ID, defaultKey: 'attain', defaultDir: 'desc' });
}

/** วาดใหม่แล้วคืนโฟกัสให้ปุ่ม/ช่องที่เพิ่งใช้ — ไม่งั้นโฟกัสตกไปที่ body และหน้าเด้งขึ้นบนสุด */
function rerender(container: HTMLElement, focusSel: string, caret?: number): void {
  render(container, lastData);
  bind(container);
  const el = container.querySelector(focusSel) as HTMLInputElement | null;
  if (!el) return;
  el.focus({ preventScroll: true });
  if (caret !== undefined && el.setSelectionRange) el.setSelectionRange(caret, caret);
}

/** กดชื่อยูนิตในกลุ่มหนักสุด → ล้างตัวกรองที่ซ่อนแถวนั้นอยู่ กางสัญญาณ แล้วเลื่อนไปให้เห็น */
function gotoUnit(container: HTMLElement, key: string): void {
  const d = lastData;
  if (!d) return;
  const u = (d.units || []).filter((x) => rowKey(x) === key)[0];
  if (!u) return;
  const sev = computeSev(d.units || []);
  if (filterList(d.units || [], sev).indexOf(u) < 0) { state.level = 'all'; state.q = ''; }
  state.open = key;
  const sel = '.up-name[data-more="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]';
  rerender(container, sel);
  const btn = container.querySelector(sel);
  const row = btn && btn.closest('tr');
  if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function bind(container: HTMLElement): void {
  const q = container.querySelector('#up-q') as HTMLInputElement | null;
  if (q) q.addEventListener('input', function () {
    const pos = q.selectionStart === null ? q.value.length : q.selectionStart;
    state.q = q.value;
    rerender(container, '#up-q', pos);
  });
  container.querySelectorAll('.up-chip').forEach(function (c) {
    c.addEventListener('click', function () {
      state.level = ((c as HTMLElement).dataset.lv || 'all') as 'all' | Tier;
      rerender(container, '.up-chip[data-lv="' + state.level + '"]');
    });
  });
  // ปุ่ม "ดู" ท้ายแถว + ปุ่มชื่อยูนิต (ช่องตรึงซ้าย) ใช้ตัวจัดการเดียวกัน — คืนโฟกัสให้ปุ่มชนิดที่เพิ่งกด
  // ไม่งั้นคนที่กดชื่อด้วยคีย์บอร์ดจะโดนดีดโฟกัสไปปุ่ม "ดู" สุดขวา แล้วตารางเลื่อนตามไปเอง
  container.querySelectorAll('.up-more, .up-name').forEach(function (b) {
    b.addEventListener('click', function () {
      const u = (b as HTMLElement).dataset.more || '';
      const cls = (b as HTMLElement).classList.contains('up-name') ? '.up-name' : '.up-more';
      state.open = state.open === u ? '' : u;
      rerender(container, cls + '[data-more="' + (window.CSS && CSS.escape ? CSS.escape(u) : u) + '"]');
    });
  });
  container.querySelectorAll('.up-toplink').forEach(function (b) {
    b.addEventListener('click', function () { gotoUnit(container, (b as HTMLElement).dataset.goto || ''); });
  });
  container.querySelectorAll('.up-daily').forEach(function (b) {
    b.addEventListener('click', function () { openDaily((b as HTMLElement).dataset.u || ''); });
  });
  const clear = container.querySelector('#up-clear');
  if (clear) clear.addEventListener('click', function () {
    state.q = '';
    state.level = 'all';
    rerender(container, '#up-q');
  });
  const retry = container.querySelector('#up-retry');
  if (retry) retry.addEventListener('click', function () {
    container.innerHTML = unitperfSkel();
    fetchData(container);
  });
  const mo = container.querySelector('#up-month') as HTMLSelectElement | null;
  if (mo) mo.addEventListener('change', function () {
    state.month = mo.value;
    state.open = '';
    container.innerHTML = unitperfSkel();
    fetchData(container);
  });
}

/**
 * "ดูยอดรายวันของ Uxx" — สลับไปหน้ายอดขายแล้วพาไปที่ตารางยอดขายรายวัน พร้อมไฮไลต์คอลัมน์ของยูนิตนั้น
 * หน้ายอดขายยังทยอยวาดการ์ดด้านบนหลังสลับหน้า ตารางจึงถูกดันลงเรื่อยๆ ต้องเลื่อนตามจนตำแหน่งนิ่ง
 * (วัดบน prod: เลื่อนครั้งเดียวแล้วจบ ตารางอยู่ต่ำกว่าขอบจอ 4,429px) และหยุดทันทีถ้าผู้ใช้เลื่อนเอง
 */
function openDaily(u: string): void {
  App.switchView('sales');
  const t0 = Date.now();
  let stop = false;
  const cancel = function () { stop = true; };
  ['wheel', 'touchstart', 'keydown'].forEach(function (e) { window.addEventListener(e, cancel, { once: true, passive: true }); });
  const clear = function () { ['wheel', 'touchstart', 'keydown'].forEach(function (e) { window.removeEventListener(e, cancel); }); };

  const tick = function () {
    if (stop) { clear(); return; }
    const card = document.getElementById('sr-daily');
    if (card) {
      if (u) {
        card.querySelectorAll('[data-u]').forEach(function (el) {
          el.classList.toggle('ds-hl', (el as HTMLElement).dataset.u === u);
        });
      }
      let last = -1e9;
      const follow = function (left: number) {
        if (stop) { clear(); return; }
        const top = Math.round(card.getBoundingClientRect().top);
        if (Math.abs(top - last) > 4 || Math.abs(top) > 8) {
          last = top;
          card.scrollIntoView({ block: 'start', behavior: 'smooth' });
        } else { clear(); return; }
        if (left > 0) setTimeout(function () { follow(left - 1); }, 600);
        else clear();
      };
      follow(10);
      return;
    }
    if (Date.now() - t0 < 30000) setTimeout(tick, 400);
    else clear();
  };
  setTimeout(tick, 300);
}

function fetchData(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<PerfData>('apiUnitPerf', state.month ? { month: state.month } : {}).then(function (d) {
    if (seq !== reqSeq) return;
    lastData = d;
    state.month = d.month;
    render(container, d);
    bind(container);
  }).catch(function (err) {
    if (seq !== reqSeq) return;
    showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', function () {
      container.innerHTML = unitperfSkel();
      fetchData(container);
    });
  });
}

export const unitperf = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container, lastData);
      bind(container);
      fetchData(container);
      return;
    }
    container.innerHTML = unitperfSkel();
    fetchData(container);
  },
};
