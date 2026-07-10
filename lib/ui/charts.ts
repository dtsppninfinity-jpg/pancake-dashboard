/* ============================================================
   charts — SVG chart builders (ported จาก JsCommon.html)
   คืน HTML string เหมือนเดิมเป๊ะ (markup/สี/เลข)
   ============================================================ */

import { esc, fmtNum, THB, kFmt } from '@/lib/ui/helpers';

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
}

export interface HbarOpts {
  cls?: string;
  empty?: string;
}

/** กราฟแท่งคู่ 7 วัน: data = [{label, total, replied}] (ลูกค้าทัก/เพจตอบ, มุมมน) */
export function svgWeekBars(data: WeekBar[]): string {
  const W = 560, H = 208, padX = 14, bottom = 28, topPad = 26;
  const innerH = H - bottom - topPad;
  const baseY = H - bottom;
  // สเกลรวมทั้ง 2 ชุด (ลูกค้าทัก + เพจตอบ) กันไม่ให้แท่งไหนพุ่งทะลุกราฟ
  const max = Math.max(...data.map(function (d) {
    return Math.max(Number(d.total) || 0, Number(d.replied) || 0);
  }).concat([1])) * 1.18;
  const cellW = (W - padX * 2) / data.length;
  const gap = 5;                                        // ช่องว่างระหว่างแท่งคู่ในวันเดียว
  const barW = Math.max(9, Math.min(26, (cellW * 0.66 - gap) / 2));
  const pairW = barW * 2 + gap;
  const r = Math.min(7, barW / 2);
  // path สี่เหลี่ยมมนเฉพาะ 2 มุมบน (ก้นตรง วางแนบเส้นฐาน)
  function topRoundRect(x: number, y: number, w: number, h: number, rr: number): string {
    if (h <= 0.5) return '';
    rr = Math.min(rr, w / 2, h);
    return 'M' + x + ',' + (y + h) + ' L' + x + ',' + (y + rr) +
      ' Q' + x + ',' + y + ' ' + (x + rr) + ',' + y +
      ' L' + (x + w - rr) + ',' + y +
      ' Q' + (x + w) + ',' + y + ' ' + (x + w) + ',' + (y + rr) +
      ' L' + (x + w) + ',' + (y + h) + ' Z';
  }
  const parts = ['<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '">',
    '<defs>',
    '<linearGradient id="gradCust" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5aa9ff"/><stop offset="1" stop-color="#3b82f6"/></linearGradient>',
    '<linearGradient id="gradPage" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8b7cf6"/><stop offset="1" stop-color="#6c5ce7"/></linearGradient>',
    '</defs>'];
  parts.push('<line x1="' + padX + '" y1="' + baseY + '" x2="' + (W - padX) + '" y2="' + baseY + '" style="stroke:var(--track)"/>');
  data.forEach(function (d, i) {
    const cx = padX + i * cellW + cellW / 2;
    const xC = Math.round(cx - pairW / 2);    // แท่งลูกค้าทัก (ซ้าย)
    const xP = xC + barW + gap;               // แท่งเพจตอบ (ขวา)
    const tot = Number(d.total) || 0, rep = Number(d.replied) || 0;
    const hC = Math.round((tot / max) * innerH);
    const hP = Math.round((rep / max) * innerH);
    parts.push('<path d="' + topRoundRect(xC, baseY - hC, barW, hC, r) + '" fill="url(#gradCust)"><title>' + esc(d.label) + ' — ลูกค้าทัก ' + fmtNum(tot) + '</title></path>');
    parts.push('<path d="' + topRoundRect(xP, baseY - hP, barW, hP, r) + '" fill="url(#gradPage)"><title>' + esc(d.label) + ' — เพจตอบ ' + fmtNum(rep) + '</title></path>');
    if (tot > 0) parts.push('<text x="' + (xC + barW / 2) + '" y="' + (baseY - hC - 5) + '" text-anchor="middle" font-size="9" font-weight="600" style="fill:var(--text-3)">' + kFmt(tot) + '</text>');
    if (rep > 0) parts.push('<text x="' + (xP + barW / 2) + '" y="' + (baseY - hP - 5) + '" text-anchor="middle" font-size="9" font-weight="700" style="fill:var(--text-2)">' + kFmt(rep) + '</text>');
    parts.push('<text x="' + cx + '" y="' + (H - 9) + '" text-anchor="middle" font-size="10.5" style="fill:var(--text-3)">' + esc(d.label) + '</text>');
  });
  parts.push('</svg>');
  return parts.join('');
}

/** โดนัท: pct 0-100 */
export function svgDonut(pct: number, centerTop: string | number, centerSub: string | number, color?: string): string {
  const r = 52, c = 2 * Math.PI * r;
  const arc = Math.max(0, Math.min(100, pct)) / 100 * c;
  return '<svg viewBox="0 0 130 130" style="max-width:150px">' +
    '<circle cx="65" cy="65" r="' + r + '" fill="none" style="stroke:var(--track)" stroke-width="16"/>' +
    '<circle cx="65" cy="65" r="' + r + '" fill="none" stroke="' + (color || '#2dd4a0') + '" stroke-width="16" stroke-linecap="round"' +
    ' stroke-dasharray="' + arc + ' ' + (c - arc) + '" stroke-dashoffset="' + (c / 4) + '"/>' +
    '<text x="65" y="63" text-anchor="middle" font-size="22" font-weight="800" style="fill:var(--text)">' + esc(centerTop) + '</text>' +
    '<text x="65" y="80" text-anchor="middle" font-size="9.5" style="fill:var(--text-3)">' + esc(centerSub) + '</text></svg>';
}

/** กราฟเส้น 24 ชั่วโมง: main/prev = array 24 ตัวเลข */
export function svgHourlyLine(main: number[], prev?: number[] | null): string {
  const W = 780, H = 260, padL = 46, padR = 14, padT = 16, padB = 28;
  const all = main.concat(prev || []);
  const max = Math.max(...all.concat([1])) * 1.1;
  function pt(i: number, v: number): [number, number] {
    const x = padL + (i / 23) * (W - padL - padR);
    const y = H - padB - (v / max) * (H - padT - padB);
    return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
  }
  const parts = ['<svg class="chart-svg" viewBox="0 0 ' + W + ' ' + H + '">'];
  for (let g = 0; g <= 4; g++) {
    const gy = padT + (g / 4) * (H - padT - padB);
    const gv = max * (1 - g / 4);
    parts.push('<line x1="' + padL + '" y1="' + gy + '" x2="' + (W - padR) + '" y2="' + gy + '" style="stroke:var(--track)"/>');
    parts.push('<text x="' + (padL - 6) + '" y="' + (gy + 3) + '" text-anchor="end" font-size="10" style="fill:var(--text-3)">' + kFmt(gv) + '</text>');
  }
  for (let hx = 0; hx < 24; hx += 2) {
    parts.push('<text x="' + pt(hx, 0)[0] + '" y="' + (H - 8) + '" text-anchor="middle" font-size="10" style="fill:var(--text-3)">' + hx + 'h</text>');
  }
  if (prev) {
    parts.push('<polyline fill="none" stroke="#5b6478" stroke-width="2" stroke-dasharray="6 4" points="' +
      prev.map(function (v, i) { return pt(i, v).join(','); }).join(' ') + '"/>');
  }
  const pts = main.map(function (v, i) { return pt(i, v).join(','); }).join(' ');
  parts.push('<polygon fill="rgba(108,92,231,.10)" points="' + pt(0, 0).join(',') + ' ' + pts + ' ' + pt(23, 0).join(',') + '"/>');
  parts.push('<polyline fill="none" stroke="#6c5ce7" stroke-width="2.6" points="' + pts + '"/>');
  main.forEach(function (v, i) {
    if (v > 0) {
      const p = pt(i, v);
      parts.push('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="#6c5ce7"/>');
    }
    const p2 = pt(i, v);
    parts.push('<circle cx="' + p2[0] + '" cy="' + p2[1] + '" r="8" fill="transparent"><title>' + i + ':00 น. — ' + THB(v) +
      (prev ? ' (เทียบ ' + THB(prev[i]) + ')' : '') + '</title></circle>');
  });
  parts.push('</svg>');
  return parts.join('');
}

/** แถว horizontal bar: items = [{label, value, display, cls}] */
export function hbarRows(items: HbarItem[], opts?: HbarOpts): string {
  const o = opts || {};
  if (!items || !items.length) return '<div class="empty-note">' + (o.empty || 'ยังไม่มีข้อมูล') + '</div>';
  const max = Math.max(...items.map(function (it) { return it.value; }).concat([1]));
  return items.map(function (it) {
    const w = Math.round((it.value / max) * 100);
    return '<div class="hbar-row">' +
      '<div class="hbar-label" title="' + esc(it.label) + '">' + esc(it.label) + '</div>' +
      '<div class="hbar-track"><div class="hbar-fill ' + (it.cls || o.cls || '') + '" style="width:' + w + '%"></div></div>' +
      '<div class="hbar-num">' + esc(it.display !== undefined ? it.display : fmtNum(it.value)) + '</div></div>';
  }).join('');
}

/** แท่งจิ๋ว 24 ชั่วโมง (CSS bars) */
export function miniBars(values: number[]): string {
  const max = Math.max(...values.concat([1]));
  return '<div class="mini-bars">' + values.map(function (v, i) {
    const h = Math.max(2, Math.round((v / max) * 46));
    return '<i style="height:' + h + 'px" title="' + i + ':00 — ' + THB(v) + '"></i>';
  }).join('') + '</div>';
}
