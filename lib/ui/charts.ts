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

export interface LineOpts {
  fmt?: 'thb' | 'num'; // รูปแบบตัวเลขในทูลทิป (default thb)
  unit?: string;       // หน่วยต่อท้ายเมื่อ fmt=num เช่น 'ข้อความ'
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
    parts.push('<path d="' + topRoundRect(xC, baseY - hC, barW, hC, r) + '" fill="url(#gradCust)"/>');
    parts.push('<path d="' + topRoundRect(xP, baseY - hP, barW, hP, r) + '" fill="url(#gradPage)"/>');
    if (tot > 0) parts.push('<text x="' + (xC + barW / 2) + '" y="' + (baseY - hC - 5) + '" text-anchor="middle" font-size="9" font-weight="600" style="fill:var(--text-3)">' + kFmt(tot) + '</text>');
    if (rep > 0) parts.push('<text x="' + (xP + barW / 2) + '" y="' + (baseY - hP - 5) + '" text-anchor="middle" font-size="9" font-weight="700" style="fill:var(--text-2)">' + kFmt(rep) + '</text>');
    parts.push('<text x="' + cx + '" y="' + (H - 9) + '" text-anchor="middle" font-size="10.5" style="fill:var(--text-3)">' + esc(d.label) + '</text>');
    // เป้า hover ให้ทูลทิปการ์ดลอย (bindChartTips) — แทน <title> เดิม
    // ⚠️ ทั้งสองแท่งเป็น "จำนวนข้อความ" ไม่ใช่จำนวนบทสนทนา — เพจส่งสคริปต์ขายทีละหลายบับเบิล
    //    อัตราส่วนจึงอยู่ที่ 5-15 เท่าเป็นปกติ เอามาเรียก "% การตอบ" ไม่ได้ (เคยโชว์ 828%)
    //    แสดงเป็นสัดส่วน "เพจ:ลูกค้า x.x:1" แทน — ตรงกับสิ่งที่วัดได้จริง
    const ratio = tot > 0 ? (rep / tot) : null;
    parts.push('<circle class="ch-hit" cx="' + Math.round(cx) + '" cy="' + (baseY - Math.max(hC, hP)) + '" r="10" fill="transparent"' +
      ' data-title="📅 ' + esc(d.label) + '" data-fmt="num" data-unit="ข้อความ"' +
      ' data-cur="' + tot + '" data-curlabel="ลูกค้าส่ง"' +
      ' data-prev="' + rep + '" data-prevlabel="เพจส่ง"' +
      (ratio !== null
        ? ' data-pill="เพจ:ลูกค้า ' + ratio.toFixed(1) + ':1" data-pillcls="flat"'
        : ' data-pill="ยังไม่มีข้อความลูกค้า" data-pillcls="flat"') +
      '></circle>');
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

/** กราฟเส้น 24 ชั่วโมง: main/prev = array 24 ตัวเลข (opts.fmt='num' → ทูลทิปเป็นจำนวน ไม่ใช่ ฿) */
export function svgHourlyLine(main: number[], prev?: number[] | null, opts?: LineOpts): string {
  const fmtAttr = opts && opts.fmt === 'num'
    ? ' data-fmt="num"' + (opts.unit ? ' data-unit="' + esc(opts.unit) + '"' : '')
    : '';
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
  // เส้นไกด์ตั้ง + จุดโฟกัส (ซ่อนไว้ก่อน — bindChartTips เลื่อนไปยังจุดที่ hover)
  parts.push(
    '<g class="ch-cross">' +
      '<g class="ch-line-g"><line class="ch-cross-line" y1="' + padT + '" y2="' + (H - padB) + '"/></g>' +
      '<g class="ch-dot-g">' +
        '<circle class="ch-halo" r="9"/>' +
        '<circle class="ch-ring" r="5"/>' +
        '<circle class="ch-dot" r="2.5"/>' +
      '</g>' +
    '</g>'
  );
  main.forEach(function (v, i) {
    const p = pt(i, v);
    if (v > 0) {
      parts.push('<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3" fill="#6c5ce7"/>');
    }
    // เป้า hover (โปร่งใสแต่ยังรับอีเวนต์) + data-attrs ให้ทูลทิปอ่าน — แทน <title> เดิม
    parts.push('<circle class="ch-hit" cx="' + p[0] + '" cy="' + p[1] + '" r="10" fill="transparent"' +
      ' data-h="' + i + '" data-cur="' + Math.round(v) + '"' + fmtAttr +
      (prev ? ' data-prev="' + Math.round(prev[i]) + '"' : '') + '></circle>');
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

/* ============================================================
   chart hover tooltip ("holder") — ทูลทิปการ์ดลอยของกราฟเส้น (svgHourlyLine)
   การ์ดวางที่ <body> ครั้งเดียว (singleton) แล้วอัปเดตแค่ textContent/class ต่อ hover
   ไม่ผูก listener ที่ body/window (กันรั่ว) — ผูกที่วง .ch-hit ซึ่งถูกทำลายพร้อม re-render
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

/** ซ่อนทูลทิป singleton — ใช้ตอน teardown ที่ไม่มี rebind (refetch → skeleton, error, สลับหน้า) */
export function hideChartTip(): void {
  if (_raf) { cancelAnimationFrame(_raf); _raf = 0; }
  if (!_tip) return;
  _tip.classList.remove('is-on');
  _tip.setAttribute('aria-hidden', 'true');
}

/**
 * ผูกทูลทิป hover ให้กราฟเส้นใน container: การ์ดลอยเข้าธีม + เส้นไกด์ตั้ง + จุดโฟกัสใน SVG
 * ติดตามเมาส์ต่อเนื่องทั้งพื้นที่กราฟ แล้วเลือก "จุดที่ใกล้ที่สุด" — ไม่มีช่องว่างให้กระพริบตอนลากเมาส์
 * เรียกซ้ำได้ทุกครั้งที่ re-render (ทูลทิปเป็น singleton — สร้างครั้งเดียว, listener ผูกที่ <svg> ตัวเดียว)
 * กราฟที่ไม่มี .ch-hit (แท่ง/โดนัท) จะ return ทันที — เรียกแบบรวมๆ ได้อย่างปลอดภัย
 */
export function bindChartTips(container: HTMLElement): void {
  container.querySelectorAll<SVGSVGElement>('svg.chart-svg').forEach(function (svg) {
    bindOneChart_(svg);
  });
}

function bindOneChart_(svg: SVGSVGElement): void {
  const hitList = Array.from(svg.querySelectorAll<SVGCircleElement>('.ch-hit'));
  if (!hitList.length) return;
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
    els.title.textContent = c.getAttribute('data-title') || ('🕐 ' + ('0' + h).slice(-2) + ':00 น.');
    els.value.textContent = (curLabel ? curLabel + ' ' : '') + fv(cur);
    const pillTxt = c.getAttribute('data-pill');
    if (pillTxt !== null) {
      // กราฟที่กำหนด pill เอง (เช่น week bars: "ตอบแล้ว 85%") — ไม่ใช่การเทียบช่วงเวลา
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
  svgEl.addEventListener('pointerleave', onLeave);
}
