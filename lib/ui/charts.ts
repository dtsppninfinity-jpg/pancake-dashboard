/* ============================================================
   charts — SVG chart builders (ported จาก JsCommon.html)
   คืน HTML string (view เอาไปต่อสตริงแล้ว innerHTML)

   กติการ่วมของทุกกราฟ (ตรวจ UI ข้อ G3):
   - แกนเป็น "เลขกลม" เสมอ (0 / 25K / 50K / 75K / 100K) — เดิมแบ่งค่าสูงสุด×1.1 เป็น 4 ส่วน
     ได้เลขอย่าง 27.5k / 55.0k ซึ่งอ่านแล้วต้องคิดต่อ ตาคนจับเลขกลมได้ทันที
   - แกนเงินมี ฿ นำหน้า · แกนจำนวนมีหน่วย (เช่น "ข้อความ") เขียนไว้เหนือแกนครั้งเดียว
   - สีมาจากตัวแปรธีม (--primary / --text-3 / --track / --green) ผ่าน style="" เท่านั้น
     ไม่ใช่ hex ตรงๆ — เดิมเส้นเปรียบเทียบเป็น #5b6478 ซึ่งจมหายในโหมดมืด และสีไม่เปลี่ยนตามธีม
     (ใช้ style ไม่ใช้ attribute fill="var(..)" เพราะ var() ใน presentation attribute ไม่รับประกันทุกเบราว์เซอร์)
   - เส้นหนา 2px, หัวแท่งมน 4px, เส้น grid บาง ทึบ อยู่หลังข้อมูล
   ============================================================ */

import { esc, fmtNum, THB } from '@/lib/ui/helpers';

export interface WeekBar {
  label: string;
  total: number;
  replied: number;
}

export interface HbarItem {
  label: string;
  value: number;
  display?: string | number;
  cls?: string;
  attr?: string; // HTML attributes ดิบใส่ที่แถว (เช่น data-* ให้คลิกเจาะได้) — ผู้เรียกต้อง escape เอง
}

export interface HbarOpts {
  cls?: string;
  empty?: string;
  /** true = ห่อด้วย .hbar-wide (ช่องชื่อยืดได้ถึง 280px บนจอกว้าง) — ใช้กับรายการที่ชื่อยาว เช่น ชื่อเพจ */
  wide?: boolean;
}

export interface LineOpts {
  fmt?: 'thb' | 'num'; // รูปแบบตัวเลข (แกน + ทูลทิป) default thb
  unit?: string;       // หน่วยเมื่อ fmt=num เช่น 'ข้อความ' — เขียนเหนือแกนตั้ง + ต่อท้ายตัวเลขในทูลทิป
  prevLabel?: string;  // ชื่อเส้นเปรียบเทียบในทูลทิป (เช่น "เมื่อวาน") — ไม่ส่ง = "ช่วงก่อนหน้า"
}

export interface WeekBarsOpts {
  unit?: string;       // หน่วยของแท่ง (default 'ข้อความ')
}

export interface ScorePoint {
  label: string;       // ป้ายแกนนอน เช่น ชื่อเดือนย่อ
  value: number;       // คะแนน 0-100
}

export interface ScoreLineOpts {
  pass?: number | null; // เส้นประเกณฑ์ผ่าน (default 70) — null/0 = ไม่วาด
  unit?: string;       // หน่วยในทูลทิป (default 'คะแนน')
  empty?: string;      // ข้อความเมื่อมีจุดไม่ถึง 2 จุด
}

/* ⚠️ ตัวหนังสือใน SVG อยู่ในหน่วยของ viewBox มันย่อ/ขยายไปพร้อมกราฟ
   กราฟ viewBox 780 หน่วย พอวางในการ์ดกว้าง 342px บนมือถือ ทุกอย่างย่อลง 0.44 เท่า
   ตัวอักษรที่เขียนไว้ 11px จึงเห็นจริงแค่ ~4.8px — อ่านไม่ออก และแก้ด้วย CSS ไม่ได้
   ทางออก: บนจอแคบใช้ viewBox ที่แคบลงให้ใกล้ขนาดจริง อัตราย่อจะเข้าใกล้ 1 เท่า
   ตัวอักษรเลยเห็นเท่าที่เขียนไว้จริงๆ (และแท่ง/ระยะห่างก็ได้สัดส่วนที่เหมาะกับจอแคบไปด้วย)
   หมายเหตุ: ตัดสินตอนสร้าง HTML หมุนจอแล้วจะได้สัดส่วนใหม่ตอน render รอบถัดไป */
function vbWidth(wide: number, narrow: number): number {
  return (typeof window !== 'undefined' && window.innerWidth < 600) ? narrow : wide;
}

/* ---------------- แกนเลขกลม (ใช้ร่วมทุกกราฟ) ---------------- */

/**
 * ขั้นแกนตั้งแบบเลขกลม: niceTicks(87000) → [0, 25000, 50000, 75000, 100000]
 * เลือกขั้นจาก 1 / 2 / 2.5 / 5 × 10^n ให้ได้ราว `target` ช่อง แล้วปัดยอดขึ้นให้พ้นค่าสูงสุด
 * integer=true (ค่าเป็นจำนวนนับ) ห้ามได้ขั้นทศนิยม — ข้อความ 2.5 ข้อความไม่มีจริง
 * ค่าสูงสุด ≤ 0 (ทั้งกราฟเป็นศูนย์) → [0] เส้นฐานเส้นเดียว ไม่ประดิษฐ์ขั้นปลอมๆ อย่าง ฿1 ฿2 ขึ้นมา
 */
export function niceTicks(maxVal: number, target = 4, integer = true): number[] {
  const m = Number(maxVal) || 0;
  if (!(m > 0)) return [0];
  const raw = m / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let mult = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10;
  if (integer && mult === 2.5 && mag < 10) mult = 2;   // 2.5 × 1 = ขั้นทศนิยม → ใช้ 2 แทน
  let step = mult * mag;
  if (integer && step < 1) step = 1;
  const top = Math.ceil(m / step - 1e-9) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step * 1e-6; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** ตัวเลขบนแกนแบบสั้น: 25000 → "25K", 2500 → "2.5K", 1500000 → "1.5M" (K/M ตัวใหญ่ตามกติกา E2) */
function axisNum(v: number): string {
  const a = Math.abs(v);
  const trim = (x: number) => String(Math.round(x * 100) / 100);
  if (a >= 1e6) return trim(v / 1e6) + 'M';
  if (a >= 1e3) return trim(v / 1e3) + 'K';
  return trim(v);
}

/** ป้ายค่าบนแท่ง/จุด: ไม่ถึงหมื่นเขียนเต็ม (1,234) เกินนั้นย่อ 1 ตำแหน่ง (12.3K) — แคบพอวางบนแท่งได้ */
function valueLabel(v: number): string {
  const a = Math.abs(v);
  if (a < 10000) return fmtNum(Math.round(v));
  if (a < 1e6) return (Math.round(v / 100) / 10) + 'K';
  return (Math.round(v / 1e5) / 10) + 'M';
}

/** ความกว้างช่องซ้ายสำหรับเลขแกน — ประมาณจากจำนวนตัวอักษร (ตัวเลข 11px กว้างราว 6.6 หน่วย) */
function axisPad(labels: string[], min: number): number {
  const len = labels.reduce(function (m, s) { return Math.max(m, s.length); }, 0);
  return Math.max(min, Math.ceil(len * 6.6) + 10);
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** เส้น grid แนวนอน + เลขแกนซ้าย (เส้นบาง ทึบ สี --track · ตัวเลขสี --text-3) */
function gridY(ticks: number[], labels: string[], yOf: (v: number) => number, x1: number, x2: number): string {
  return ticks.map(function (t, i) {
    const y = r1(yOf(t));
    return '<line x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '" style="stroke:var(--track)" stroke-width="1"/>' +
      '<text x="' + (x1 - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" style="fill:var(--text-3)">' +
      esc(labels[i]) + '</text>';
  }).join('');
}

/** หน่วยของแกนตั้ง เขียนครั้งเดียวที่มุมซ้ายบน (แทนการต่อท้ายทุกขั้นซึ่งกินที่) */
function unitLabel(unit: string): string {
  return unit
    ? '<text x="2" y="11" text-anchor="start" font-size="11" style="fill:var(--text-3)">' + esc(unit) + '</text>'
    : '';
}

/** path สี่เหลี่ยมมนเฉพาะ 2 มุมบน (ก้นตรง วางแนบเส้นฐาน) */
function topRoundRect(x: number, y: number, w: number, h: number, rr: number): string {
  if (h <= 0.5) return '';
  rr = Math.min(rr, w / 2, h);
  return 'M' + x + ',' + (y + h) + ' L' + x + ',' + (y + rr) +
    ' Q' + x + ',' + y + ' ' + (x + rr) + ',' + y +
    ' L' + (x + w - rr) + ',' + y +
    ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + rr) +
    ' L' + (x + w) + ',' + (y + h) + ' Z';
}

/** เส้นไกด์ตั้ง + จุดโฟกัส (ซ่อนไว้ก่อน — bindChartTips เลื่อนไปยังจุดที่ hover) */
function crossLayer(yTop: number, yBottom: number): string {
  return '<g class="ch-cross">' +
      '<g class="ch-line-g"><line class="ch-cross-line" y1="' + yTop + '" y2="' + yBottom + '"/></g>' +
      '<g class="ch-dot-g">' +
        '<circle class="ch-halo" r="9"/>' +
        '<circle class="ch-ring" r="5"/>' +
        '<circle class="ch-dot" r="2.5"/>' +
      '</g>' +
    '</g>';
}

/**
 * กราฟแท่งคู่ 7-14 วัน (หน้าภาพรวมแชท) — data = [{label, total, replied}]
 * total = ข้อความลูกค้าส่ง (แท่งซ้าย สี --blue) · replied = ข้อความเพจส่ง รวมบอต/บรอดแคสต์ (แท่งขวา สี --primary)
 *
 * พีสั่ง 28 ก.ย.: เอาแท่ง "เพจส่ง" กลับมาแบบเดิม (รอบ 2 เคยย้ายไปอยู่ในทูลทิป + อัตราส่วนใต้วัน แล้วทีมหาไม่เจอ)
 * สองชุดอยู่สเกลเดียวกัน (ห้ามแกนตั้ง 2 สเกล — คนอ่านเทียบความสูงข้ามสเกลผิดเสมอ)
 * แท่งลูกค้าจึงเตี้ยกว่าเพจ 5-15 เท่าเป็นปกติ — ตัวเลขบนแท่งบอกค่าจริงแทน
 * ⚠️ ทั้งสองค่าเป็น "จำนวนข้อความ" ไม่ใช่บทสนทนา — อัตราส่วนเรียก "% การตอบ" ไม่ได้ (เคยโชว์ 828%) ทูลทิปโชว์เป็น "เพจ:ลูกค้า x:1"
 *
 * ป้ายตัวเลขบนแท่ง: ช่องกว้างพอ (จอคอม 7 วัน) = ทุกแท่ง · แคบ (มือถือ / 14 วัน) = เฉพาะวันล่าสุด ที่เหลือแตะดูในทูลทิป
 * ป้ายสองแท่งในวันเดียวกันชนกันได้เมื่อสูงใกล้กัน → ยกป้ายของแท่งที่สูงกว่าขึ้นจนพ้นกัน
 * ลายเซ็นเดิม svgWeekBars(week) ยังใช้ได้เหมือนเดิม — opts เป็นของเสริม
 */
export function svgWeekBars(data: WeekBar[], opts?: WeekBarsOpts): string {
  const unit = (opts && opts.unit) || 'ข้อความ';
  const n = Math.max(1, data.length);
  const W = vbWidth(560, 330);
  const cust = data.map(function (d) { return Number(d.total) || 0; });
  const page = data.map(function (d) { return Number(d.replied) || 0; });
  const ticks = niceTicks(Math.max.apply(null, cust.concat(page, [0])), 4, true);
  const top = ticks[ticks.length - 1] || 1;
  const tickLabels = ticks.map(axisNum);
  const padL = axisPad(tickLabels, 28), padR = 6, padT = 30, padB = 26;
  const H = 206;
  const baseY = H - padB;
  const innerH = baseY - padT;
  const cellW = (W - padL - padR) / n;
  const gap = 3;                                   // ช่องระหว่างแท่งคู่ในวันเดียว
  const barW = Math.max(6, Math.min(22, (cellW * 0.74 - gap) / 2));
  const rad = Math.min(4, barW / 2);
  // ป้ายวันแน่นเกิน (14 วันบนจอแคบ) → เว้นทีละวัน แต่วันล่าสุดต้องมีเสมอ
  const labelEvery = Math.max(1, Math.ceil(28 / cellW));
  const allNums = cellW >= 60;
  /** ความกว้างป้ายตัวเลขโดยประมาณ (ตัวเลข 11px ตัวหนา ~6.4 หน่วยต่อตัวอักษร) */
  const textW = (t: string) => t.length * 6.4;

  const parts = ['<svg class="chart-svg ch-week" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
    esc('กราฟ' + unit + 'รายวัน ' + data.length + ' วัน แท่งซ้าย = ลูกค้าส่ง แท่งขวา = เพจส่ง') + '">'];
  parts.push(unitLabel(unit));
  parts.push(gridY(ticks, tickLabels, function (v) { return baseY - (v / top) * innerH; }, padL, W - padR));
  data.forEach(function (d, i) {
    const cx = padL + i * cellW + cellW / 2;
    const xC = r1(cx - gap / 2 - barW);          // ลูกค้าส่ง (ซ้าย)
    const xP = r1(cx + gap / 2);                 // เพจส่ง (ขวา)
    const tot = cust[i], rep = page[i];
    const hC = r1((tot / top) * innerH);
    const hP = r1((rep / top) * innerH);
    parts.push('<path d="' + topRoundRect(xC, r1(baseY - hC), r1(barW), hC, rad) + '" style="fill:var(--blue)"/>');
    parts.push('<path d="' + topRoundRect(xP, r1(baseY - hP), r1(barW), hP, rad) + '" style="fill:var(--primary)"/>');
    const last = i === data.length - 1;
    if (allNums || last) {
      const tC = tot > 0 ? valueLabel(tot) : '', tP = rep > 0 ? valueLabel(rep) : '';
      let yC = baseY - hC - 5, yP = baseY - hP - 5;
      // ป้ายสองอันทับกันแนวนอน + สูงใกล้กัน → ยกป้ายของแท่งที่สูงกว่าขึ้นให้พ้น 12 หน่วย
      if (tC && tP && (textW(tC) + textW(tP)) / 2 > barW + gap && Math.abs(yC - yP) < 12) {
        if (yP <= yC) yP = yC - 12; else yC = yP - 12;
      }
      // ป้ายลูกค้ากว้างกว่าแท่ง — ถ้าแท่งเพจข้างๆ สูงกว่า เลื่อนป้ายไปทางซ้ายไม่ให้ทับขอบแท่งเพจ
      const xTC = hP > hC ? Math.min(xC + barW / 2, xP - 2 - textW(tC) / 2) : xC + barW / 2;
      if (tC) parts.push('<text x="' + r1(xTC) + '" y="' + r1(yC) + '" text-anchor="middle" font-size="11" font-weight="700" style="fill:var(--text-2)">' + esc(tC) + '</text>');
      // วันสุดท้ายชิดขอบขวา — ป้ายกว้างกว่าแท่งจะโดนตัดท้าย ("27.9" หาย "K") → ดันเข้ามาให้พ้นขอบ
      const xTP = Math.min(xP + barW / 2, W - 2 - textW(tP) / 2);
      if (tP) parts.push('<text x="' + r1(xTP) + '" y="' + r1(yP) + '" text-anchor="middle" font-size="11" font-weight="700" style="fill:var(--text)">' + esc(tP) + '</text>');
    }
    if (i % labelEvery === 0 || last) {
      parts.push('<text x="' + r1(cx) + '" y="' + (baseY + 17) + '" text-anchor="middle" font-size="11" style="fill:var(--text-2)">' + esc(d.label) + '</text>');
    }
    const ratio = tot > 0 ? rep / tot : null;
    const ratioTxt = ratio === null ? '' : (ratio >= 100 ? String(Math.round(ratio)) : ratio.toFixed(1)) + ':1';
    // เป้า hover ให้ทูลทิปการ์ดลอย (bindChartTips) — เลือกวันที่ใกล้เมาส์ที่สุดตามแกนนอน
    parts.push('<circle class="ch-hit" cx="' + r1(cx) + '" cy="' + r1(Math.min(baseY - 10, baseY - Math.max(hC, hP))) + '" r="12" fill="transparent"' +
      ' data-title="' + esc(d.label) + '" data-fmt="num" data-unit="' + esc(unit) + '"' +
      ' data-cur="' + tot + '" data-curlabel="ลูกค้าส่ง"' +
      ' data-prev="' + rep + '" data-prevlabel="เพจส่ง"' +
      (ratio !== null
        ? ' data-pill="เพจ:ลูกค้า ' + ratioTxt + '" data-pillcls="flat"'
        : ' data-pill="ยังไม่มีข้อความลูกค้า" data-pillcls="flat"') +
      '></circle>');
  });
  parts.push('</svg>');
  return parts.join('');
}

/** โดนัท: pct 0-100 · color = ค่า CSS (แนะนำตัวแปรธีม เช่น 'var(--green)') ไม่ส่ง = --green */
export function svgDonut(pct: number, centerTop: string | number, centerSub: string | number, color?: string): string {
  const r = 52, c = 2 * Math.PI * r;
  const arc = Math.max(0, Math.min(100, pct)) / 100 * c;
  return '<svg viewBox="0 0 130 130" style="max-width:150px" role="img" aria-label="' +
    esc(String(centerTop) + ' ' + String(centerSub)) + '">' +
    '<circle cx="65" cy="65" r="' + r + '" fill="none" style="stroke:var(--track)" stroke-width="16"/>' +
    '<circle cx="65" cy="65" r="' + r + '" fill="none" style="stroke:' + esc(color || 'var(--green)') + '" stroke-width="16" stroke-linecap="round"' +
    ' stroke-dasharray="' + arc + ' ' + (c - arc) + '" stroke-dashoffset="' + (c / 4) + '"/>' +
    '<text x="65" y="63" text-anchor="middle" font-size="22" font-weight="700" style="fill:var(--text)">' + esc(centerTop) + '</text>' +
    '<text x="65" y="80" text-anchor="middle" font-size="11" style="fill:var(--text-3)">' + esc(centerSub) + '</text></svg>';
}

/**
 * กราฟเส้น 24 ชั่วโมง: main/prev = array 24 ตัวเลข
 * opts.fmt='num' → แกน/ทูลทิปเป็นจำนวน (+ opts.unit) · ค่าเริ่มต้น = เงินบาท (แกนมี ฿)
 * opts.prevLabel → ชื่อเส้นประในทูลทิป (เดิมหน้า Sales ต้องแทรก data-prevlabel เองด้วยการตัดสตริง — ยังใช้ได้)
 */
export function svgHourlyLine(main: number[], prev?: number[] | null, opts?: LineOpts): string {
  const isNum = !!(opts && opts.fmt === 'num');
  const unit = isNum ? ((opts && opts.unit) || '') : '';
  const fmtAttr = isNum ? ' data-fmt="num"' + (unit ? ' data-unit="' + esc(unit) + '"' : '') : '';
  const prevLabelAttr = prev && opts && opts.prevLabel ? ' data-prevlabel="' + esc(opts.prevLabel) + '"' : '';
  // กว้าง 640 (เดิม 780): การ์ดกราฟบนจอคอมกว้างราว 560-800px — viewBox 780 ถูกย่อจนเลขแกน 11 เหลือ ~8px
  const W = vbWidth(640, 340), H = vbWidth(240, 200);
  const all = main.concat(prev || []);
  const ticks = niceTicks(Math.max.apply(null, all.concat([0])), 4, true);
  const top = ticks[ticks.length - 1] || 1;
  const tickLabels = ticks.map(function (t) { return (isNum ? '' : '฿') + axisNum(t); });
  const padL = axisPad(tickLabels, 30), padR = 14, padT = unit ? 24 : 14, padB = 28;
  const last = Math.max(1, main.length - 1);
  function pt(i: number, v: number): [number, number] {
    const x = padL + (i / last) * (W - padL - padR);
    const y = H - padB - (v / top) * (H - padT - padB);
    return [r1(x), r1(y)];
  }
  const parts = ['<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
    esc('กราฟรายชั่วโมง' + (unit ? ' (' + unit + ')' : isNum ? '' : ' (บาท)')) + '">'];
  parts.push(unitLabel(unit));
  parts.push(gridY(ticks, tickLabels, function (v) { return pt(0, v)[1]; }, padL, W - padR));
  // แกนนอนแบบนาฬิกา 4 จุด — เดิม 0h 2h 4h … 12 ป้ายซึ่งเบียดกันบนมือถือ และ "h" ไม่ใช่วิธีที่คนไทยอ่านเวลา
  [0, 6, 12, 18].forEach(function (hx) {
    if (hx > last) return;
    parts.push('<text x="' + pt(hx, 0)[0] + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" style="fill:var(--text-3)">' +
      (hx < 10 ? '0' : '') + hx + ':00</text>');
  });
  if (prev) {
    parts.push('<polyline fill="none" style="stroke:var(--text-3)" stroke-width="2" stroke-dasharray="6 4" stroke-linejoin="round" points="' +
      prev.map(function (v, i) { return pt(i, v).join(','); }).join(' ') + '"/>');
  }
  const pts = main.map(function (v, i) { return pt(i, v).join(','); }).join(' ');
  parts.push('<polygon style="fill:var(--primary);fill-opacity:.10" points="' + pt(0, 0).join(',') + ' ' + pts + ' ' + pt(last, 0).join(',') + '"/>');
  parts.push('<polyline fill="none" style="stroke:var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' + pts + '"/>');
  parts.push(crossLayer(padT, H - padB));
  main.forEach(function (v, i) {
    const p = pt(i, v);
    if (v > 0) parts.push('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" style="fill:var(--primary)"/>');
    // เป้า hover (โปร่งใสแต่ยังรับอีเวนต์) + data-attrs ให้ทูลทิปอ่าน
    // ⚠️ ต้องขึ้นต้น class="ch-hit" ตรงตัว — หน้า Sales ตัดสตริงนี้เพื่อแทรก data-prevlabel (hourlyChartHtml_)
    parts.push('<circle class="ch-hit" cx="' + p[0] + '" cy="' + p[1] + '" r="10" fill="transparent"' +
      ' data-h="' + i + '" data-cur="' + Math.round(v) + '"' + fmtAttr + prevLabelAttr +
      (prev ? ' data-prev="' + Math.round(prev[i] || 0) + '"' : '') + '></circle>');
  });
  parts.push('</svg>');
  return parts.join('');
}

/**
 * กราฟเส้นคะแนน 0-100 (หน้า KPI: การ์ดรายคน + ประวัติคะแนนหัวหน้า) — รวมโค้ด 2 ชุดที่เคยก๊อปกันไว้ในหน้า KPI
 * แกนตั้งคงที่ 0-100 เสมอ: เดิมยืดตามค่าต่ำสุด-สูงสุดของคนนั้น คะแนน 68→71 เลยดูเหมือนพุ่งทะลุฟ้า
 * และเทียบกราฟ 2 คนข้างกันไม่ได้ · เส้นประที่เกณฑ์ผ่าน (70) · ตัวเลขที่จุดล่าสุด
 * จุดไม่ถึง 2 จุด → คืนกล่องข้อความแทนกราฟ (ผู้เรียกเช็ค length เองได้ถ้าอยากซ่อนทั้งการ์ด)
 * hover/แตะดูค่าแต่ละเดือนได้ — หลัง innerHTML ให้เรียก bindChartTips(container)
 */
export function svgScoreLine(points: ScorePoint[], opts?: ScoreLineOpts): string {
  const o = opts || {};
  if (!points || points.length < 2) {
    return '<div class="empty-note">' + esc(o.empty || 'มีข้อมูลเดือนเดียว — กราฟขึ้นเมื่อมี 2 เดือนขึ้นไป') + '</div>';
  }
  const pass = o.pass === undefined ? 70 : o.pass;
  const unit = o.unit || 'คะแนน';
  const W = 300, H = 128, padL = 28, padR = 34, padT = 10, padB = 24;
  const n = points.length;
  const clamp = (v: number) => Math.max(0, Math.min(100, Number(v) || 0));
  const yOf = (v: number) => padT + (1 - clamp(v) / 100) * (H - padT - padB);
  const xOf = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const parts = ['<svg class="chart-svg ch-score" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' +
    esc('กราฟ' + unit + ' ' + points[0].label + ' ถึง ' + points[n - 1].label + ' ล่าสุด ' + fmtNum(points[n - 1].value) +
      (pass ? ' (เส้นประ = เกณฑ์ผ่าน ' + pass + ')' : '')) + '">'];
  parts.push(gridY([0, 50, 100], ['0', '50', '100'], yOf, padL, W - padR));
  if (pass) {
    // ป้าย "70" อยู่บนแกนซ้ายแบบขั้นแกน ไม่วางในพื้นที่กราฟ — เส้นคะแนนวิ่งผ่านแถว 70 บ่อยมาก ป้ายจะโดนเส้นทับ
    // (ความหมายของเส้นประให้หัวการ์ดบอก เช่น "เส้นประ = เกณฑ์ผ่าน 70" + อยู่ใน aria-label ด้านบนแล้ว)
    const y = r1(yOf(pass));
    parts.push('<line x1="' + padL + '" y1="' + y + '" x2="' + (W - padR) + '" y2="' + y + '" style="stroke:var(--text-3)" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="11" font-weight="600" style="fill:var(--text-2)">' + pass + '</text>');
  }
  const xy = points.map(function (p, i) { return [r1(xOf(i)), r1(yOf(p.value))]; });
  parts.push('<polyline fill="none" style="stroke:var(--primary)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="' +
    xy.map(function (p) { return p.join(','); }).join(' ') + '"/>');
  parts.push(crossLayer(padT, H - padB));
  const mid = Math.floor((n - 1) / 2);
  points.forEach(function (p, i) {
    const lastPt = i === n - 1;
    parts.push('<circle cx="' + xy[i][0] + '" cy="' + xy[i][1] + '" r="' + (lastPt ? 4 : 2.5) + '" style="fill:var(--primary)"/>');
    // ป้ายเดือน ต้น/กลาง/ท้าย พอ — ครบทุกเดือนแล้วล้นการ์ดแคบ 300px
    if (i === 0 || lastPt || i === mid) {
      const anchor = i === 0 ? 'start' : lastPt ? 'end' : 'middle';
      parts.push('<text x="' + xy[i][0] + '" y="' + (H - 6) + '" text-anchor="' + anchor + '" font-size="11" style="fill:var(--text-3)">' + esc(p.label) + '</text>');
    }
    parts.push('<circle class="ch-hit" cx="' + xy[i][0] + '" cy="' + xy[i][1] + '" r="10" fill="transparent"' +
      ' data-title="' + esc(p.label) + '" data-fmt="num" data-unit="' + esc(unit) + '" data-cur="' + (Math.round((Number(p.value) || 0) * 10) / 10) + '"></circle>');
  });
  // ตัวเลขล่าสุดวางขวาของจุดสุดท้าย (padR เผื่อที่ไว้แล้ว) — คำถามแรกของทุกคนคือ "ตอนนี้กี่คะแนน"
  const lp = xy[n - 1];
  parts.push('<text x="' + (lp[0] + 7) + '" y="' + (lp[1] + 4) + '" text-anchor="start" font-size="12" font-weight="700" style="fill:var(--text)">' +
    esc(fmtNum(Math.round((Number(points[n - 1].value) || 0) * 10) / 10)) + '</text>');
  parts.push('</svg>');
  return parts.join('');
}

/** แถว horizontal bar: items = [{label, value, display, cls}] · opts.wide = ช่องชื่อกว้าง (.hbar-wide) */
export function hbarRows(items: HbarItem[], opts?: HbarOpts): string {
  const o = opts || {};
  if (!items || !items.length) return '<div class="empty-note">' + (o.empty || 'ยังไม่มีข้อมูล') + '</div>';
  const max = Math.max(...items.map(function (it) { return it.value; }).concat([1]));
  const rows = items.map(function (it) {
    const w = Math.round((it.value / max) * 100);
    return '<div class="hbar-row' + (it.attr ? ' clickable' : '') + '"' + (it.attr ? ' ' + it.attr : '') + '>' +
      '<div class="hbar-label" title="' + esc(it.label) + '">' + esc(it.label) + '</div>' +
      '<div class="hbar-track"><div class="hbar-fill ' + (it.cls || o.cls || '') + '" style="width:' + w + '%"></div></div>' +
      '<div class="hbar-num">' + esc(it.display !== undefined ? it.display : fmtNum(it.value)) + '</div></div>';
  }).join('');
  return o.wide ? '<div class="hbar-wide">' + rows + '</div>' : rows;
}

/** แท่งจิ๋ว 24 ชั่วโมง (CSS bars) */
export function miniBars(values: number[]): string {
  const max = Math.max(...values.concat([1]));
  return '<div class="mini-bars">' + values.map(function (v, i) {
    const h = Math.max(2, Math.round((v / max) * 46));
    return '<i style="height:' + h + 'px" title="' + (i < 10 ? '0' : '') + i + ':00 — ' + THB(v) + '"></i>';
  }).join('') + '</div>';
}

/**
 * ป้ายคำอธิบายเส้น/แท่งใต้กราฟ (legend) สีจากตัวแปรธีม — แทนกล่องสี hex ที่แต่ละหน้าเขียนเองแบบ inline
 * kind: 'line' เส้นทึบ · 'dash' เส้นประ · 'bar' สี่เหลี่ยม · color ไม่ส่ง = --primary (dash = --text-3)
 * ตัวอย่าง: chartKey('line', 'ช่วงที่เลือก') + chartKey('dash', 'เมื่อวาน')
 */
export function chartKey(kind: 'line' | 'dash' | 'bar', label: string, color?: string): string {
  const c = color || (kind === 'dash' ? 'var(--text-3)' : 'var(--primary)');
  const mark = kind === 'bar'
    ? '<span aria-hidden="true" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:' + esc(c) + ';margin-right:6px;vertical-align:middle"></span>'
    : '<span aria-hidden="true" style="display:inline-block;width:18px;height:0;border-top:2px ' + (kind === 'dash' ? 'dashed' : 'solid') + ' ' + esc(c) + ';margin-right:6px;vertical-align:middle"></span>';
  return '<span class="ch-key" style="white-space:nowrap">' + mark + esc(label) + '</span>';
}

/* ============================================================
   chart hover tooltip ("holder") — ทูลทิปการ์ดลอยของกราฟ (เส้น/แท่ง/คะแนน)
   การ์ดวางที่ <body> ครั้งเดียว (singleton) แล้วอัปเดตแค่ textContent/class ต่อ hover
   ไม่ผูก listener ที่ body/window (กันรั่ว) — ผูกที่ <svg> ซึ่งถูกทำลายพร้อม re-render
   ============================================================ */

let _tip: HTMLElement | null = null;
let _els: { title: HTMLElement; value: HTMLElement; pill: HTMLElement; cmp: HTMLElement } | null = null;
let _raf = 0;
let _mx = 0;
let _my = 0;

const TIP_SHELL =
  '<span class="ct-caret" aria-hidden="true"></span>' +
  '<div class="ct-head"><span class="ct-dot" aria-hidden="true"></span><span class="ct-title"></span></div>' +
  '<div class="ct-value"></div>' +
  '<div class="ct-foot"><span class="ct-pill"></span><span class="ct-cmp"></span></div>';

function ensureTip(): void {
  if (_tip && document.body.contains(_tip)) return;
  const el = document.createElement('div');
  el.className = 'chart-tip';
  el.setAttribute('role', 'tooltip');
  el.setAttribute('aria-hidden', 'true');
  el.innerHTML = TIP_SHELL;
  document.body.appendChild(el);
  _tip = el;
  _els = {
    title: el.querySelector('.ct-title') as HTMLElement,
    value: el.querySelector('.ct-value') as HTMLElement,
    pill: el.querySelector('.ct-pill') as HTMLElement,
    cmp: el.querySelector('.ct-cmp') as HTMLElement,
  };
}

/** ตัวปิดของกราฟที่กำลังโชว์การ์ดอยู่ — มีได้ทีละอัน (การ์ดเป็น singleton) */
let _activeClose: (() => void) | null = null;
let _outsideBound = false;

/** ผูกครั้งเดียวตลอดอายุหน้า: แตะที่อื่น = ปิดการ์ดของกราฟที่เปิดอยู่
    ต้องเป็น listener ตัวเดียวระดับ document ไม่ใช่ผูกต่อกราฟ — ทุก view วาด SVG ใหม่ทุกครั้ง
    ที่รีเฟรช (ทุก 5 นาที) ถ้าผูกต่อกราฟจะสะสมไปเรื่อยๆ พร้อมอ้าง SVG ที่หลุดจาก DOM ไปแล้ว */
function bindOutsideClose_(): void {
  if (_outsideBound) return;
  _outsideBound = true;
  document.addEventListener('pointerdown', function (e) {
    const close = _activeClose;
    if (!close) return;
    const t = e.target as Element | null;
    if (!t || !t.closest || !t.closest('svg.chart-svg')) close();
  }, true);
}

/** ซ่อนทูลทิป singleton — ใช้ตอน teardown ที่ไม่มี rebind (refetch → skeleton, error, สลับหน้า) */
export function hideChartTip(): void {
  _activeClose = null;
  if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
  if (!_tip) return;
  _tip.classList.remove('is-on');
  _tip.setAttribute('aria-hidden', 'true');
}

/**
 * ผูกทูลทิป hover ให้กราฟใน container: การ์ดลอยเข้าธีม + เส้นไกด์ตั้ง + จุดโฟกัสใน SVG (ถ้ากราฟมี)
 * ติดตามเมาส์ต่อเนื่องทั้งพื้นที่กราฟ แล้วเลือก "จุดที่ใกล้ที่สุด" — ไม่มีช่องว่างให้กระพริบตอนลากเมาส์
 * เรียกซ้ำได้ทุกครั้งที่ re-render (ทูลทิปเป็น singleton — สร้างครั้งเดียว, listener ผูกที่ <svg> ตัวเดียว)
 * กราฟที่ไม่มี .ch-hit (โดนัท) จะ return ทันที — เรียกแบบรวมๆ ได้อย่างปลอดภัย
 */
export function bindChartTips(container: HTMLElement): void {
  container.querySelectorAll<SVGSVGElement>('svg.chart-svg').forEach(function (svg) {
    bindOneChart_(svg);
  });
}

function bindOneChart_(svg: SVGSVGElement): void {
  const hitList = Array.from(svg.querySelectorAll<SVGCircleElement>('.ch-hit'));
  if (!hitList.length) return;
  // กันผูกซ้ำ: บางหน้าเรียก bindChartTips ทั้ง container หลังวาดแค่บางการ์ดใหม่
  // กราฟเดิมที่ยังอยู่จะได้ listener ซ้อน 2 ชุด (อัปเดตการ์ด 2 รอบต่อการขยับเมาส์ 1 ครั้ง)
  if (svg.getAttribute('data-tip-bound') === '1') return;
  svg.setAttribute('data-tip-bound', '1');
  const svgEl: SVGSVGElement = svg; // non-null local — คง type ในคลอเชอร์ (TS ไม่ narrow ข้าม closure)
  ensureTip();
  const tip = _tip as HTMLElement;
  const els = _els!;
  hideChartTip(); // กันทูลทิปค้างจากกราฟเดิมหลัง refetch (ล้าง is-on + aria + raf)
  const lineG = svg.querySelector('.ch-line-g') as SVGGElement | null;
  const dotG = svg.querySelector('.ch-dot-g') as SVGGElement | null;
  const vbW = svgEl.viewBox.baseVal.width || 780; // กว้าง viewBox — ไว้แปลงพิกัดเมาส์ → หน่วย viewBox
  // จุดทั้งหมดเรียงตาม x (viewBox) เพื่อหาจุดที่ใกล้ตำแหน่งเมาส์ที่สุด
  const pts = hitList
    .map(function (c) { return { c: c, cx: parseFloat(c.getAttribute('cx') || '0') }; })
    .sort(function (a, b) { return a.cx - b.cx; });
  let firstShow = true;                       // กัน crosshair กวาดข้ามกราฟตอนโผล่ครั้งแรก
  let curHit: SVGCircleElement | null = null; // จุดที่กำลังแสดงอยู่ — อัปเดตเนื้อหาเฉพาะตอนเปลี่ยนจุด

  function place(): void {
    const w = tip.offsetWidth, h = tip.offsetHeight, GAP = 14, M = 8;
    let left = _mx - w / 2;
    left = Math.max(M, Math.min(left, window.innerWidth - w - M));
    let top = _my - h - GAP;
    let flip = false;
    if (top < M) { top = _my + GAP; flip = true; }
    top = Math.min(top, window.innerHeight - h - M);
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
    tip.classList.toggle('flip', flip);
    const caret = Math.max(12, Math.min(_mx - left, w - 12));
    tip.style.setProperty('--caret-x', caret + 'px');
  }

  /** จุดที่ใกล้ตำแหน่งเมาส์ (แกน x) ที่สุด — แปลง clientX → หน่วย viewBox (width:100% ไม่มี letterbox) */
  function nearest(clientX: number): SVGCircleElement {
    const rect = svgEl.getBoundingClientRect();
    const vbx = rect.width ? ((clientX - rect.left) / rect.width) * vbW : 0;
    let best = pts[0].c;
    let bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const dd = Math.abs(pts[i].cx - vbx);
      if (dd < bestD) { bestD = dd; best = pts[i].c; }
    }
    return best;
  }

  /** อัปเดตเนื้อหาการ์ด + เลื่อน crosshair ไปที่จุด c (ไม่อ่านตำแหน่งเมาส์ — place() จัดการเอง) */
  function render(c: SVGCircleElement): void {
    const h = +(c.getAttribute('data-h') || 0);
    const cur = +(c.getAttribute('data-cur') || 0);
    const hasPrev = c.hasAttribute('data-prev');
    const prev = hasPrev ? +(c.getAttribute('data-prev') || 0) : 0;
    // รูปแบบตัวเลข: default = เงินบาท | data-fmt="num" = จำนวน (+หน่วย เช่น "ข้อความ")
    const isNum = c.getAttribute('data-fmt') === 'num';
    const unit = c.getAttribute('data-unit') || '';
    const fv = (n: number) => isNum ? fmtNum(n) + (unit ? ' ' + unit : '') : THB(n);
    const curLabel = c.getAttribute('data-curlabel') || '';
    const prevLabel = c.getAttribute('data-prevlabel') || '';
    els.title.textContent = c.getAttribute('data-title') || (('0' + h).slice(-2) + ':00 น.');
    els.value.textContent = (curLabel ? curLabel + ' ' : '') + fv(cur);
    const pillTxt = c.getAttribute('data-pill');
    if (pillTxt !== null) {
      // กราฟที่กำหนด pill เอง (เช่น แท่งรายวัน: "เพจ:ลูกค้า 10.5:1") — ไม่ใช่การเทียบช่วงเวลา
      tip.classList.remove('is-bare');
      els.pill.className = 'ct-pill ' + (c.getAttribute('data-pillcls') || 'flat');
      els.pill.textContent = pillTxt;
      if (hasPrev) {
        els.cmp.textContent = (prevLabel || 'เทียบ') + ' ' + fv(prev);
        els.cmp.hidden = false;
      } else {
        els.cmp.hidden = true;
      }
    } else if (!hasPrev) {
      tip.classList.add('is-bare');
    } else {
      tip.classList.remove('is-bare');
      if (prev > 0) {
        const d = ((cur - prev) / prev) * 100;
        const flat = Math.abs(d) < 0.05;
        const up = d >= 0;
        els.pill.className = 'ct-pill ' + (flat ? 'flat' : up ? 'up' : 'down');
        els.pill.textContent = (flat ? '' : up ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + '%';
        els.cmp.textContent = 'เทียบ ' + fv(prev) + ' ' + (prevLabel || 'ช่วงก่อนหน้า');
        els.cmp.hidden = false;
      } else if (cur > 0) {
        els.pill.className = 'ct-pill up';
        els.pill.textContent = 'ใหม่';
        els.cmp.hidden = true;
      } else {
        els.pill.className = 'ct-pill flat';
        els.pill.textContent = isNum ? '0' : '0.0%';
        els.cmp.textContent = 'ไม่มียอดทั้งสองช่วง';
        els.cmp.hidden = false;
      }
    }
    const cx = c.getAttribute('cx') || '0';
    const cy = c.getAttribute('cy') || '0';
    if (lineG && dotG) {
      if (firstShow) { lineG.style.transition = 'none'; dotG.style.transition = 'none'; }
      lineG.setAttribute('transform', 'translate(' + cx + ',0)');
      dotG.setAttribute('transform', 'translate(' + cx + ',' + cy + ')');
      if (firstShow) { void svgEl.getBBox(); lineG.style.transition = ''; dotG.style.transition = ''; firstShow = false; }
    }
    svgEl.classList.add('tip-active');
    tip.setAttribute('aria-hidden', 'false');
    tip.classList.add('is-on');
    _activeClose = onLeave;   // บอก listener ระดับ document ว่าตอนนี้ต้องปิดของกราฟไหน
  }

  function onMove(e: PointerEvent): void {
    _mx = e.clientX;
    _my = e.clientY;
    const c = nearest(e.clientX);
    if (c !== curHit) {
      curHit = c;
      render(c);
      place(); // จุดเปลี่ยน → วางทันที (กันการ์ดกระพริบมุมจอตอนโผล่ครั้งแรก)
    } else if (!_raf) {
      _raf = requestAnimationFrame(function () { _raf = 0; place(); });
    }
  }

  function onLeave(): void {
    curHit = null;
    svgEl.classList.remove('tip-active');
    hideChartTip();
  }

  svgEl.addEventListener('pointermove', onMove);
  // ⚠️ นิ้วไม่เหมือนเมาส์: พอยกนิ้ว เบราว์เซอร์ทิ้ง pointer ทันทีแล้วยิง pointerleave
  //    การ์ดค่าจึงหายพร้อมกับที่ยกนิ้ว = บนมือถืออ่านตัวเลขไม่ทันเลย
  //    ปล่อยให้ค้างไว้ แล้วไปปิดตอนแตะที่อื่นแทน (bindOutsideClose_)
  svgEl.addEventListener('pointerleave', function (e) {
    if ((e as PointerEvent).pointerType === 'touch') return;
    onLeave();
  });
  svgEl.addEventListener('pointercancel', onLeave);
  // แตะนิ้วนิ่งๆ ไม่มี pointermove เลย (มีแค่ down/up) — ตัวเลขไม่ขึ้น ต้องขยับนิ้วนิดหนึ่งถึงจะขึ้น
  // click เกิดเฉพาะ "แตะจริง" ไม่เกิดตอนปัดเลื่อนหน้า (ถ้าใช้ pointerdown การ์ดจะแวบทุกครั้งที่เริ่มปัดบนกราฟ)
  svgEl.addEventListener('click', function (e) { onMove(e as PointerEvent); });
  bindOutsideClose_();
}
