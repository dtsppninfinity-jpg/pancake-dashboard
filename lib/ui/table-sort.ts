// lib/ui/table-sort.ts — กดหัวคอลัมน์เพื่อเรียงตาราง ใช้ร่วมกันทุกหน้า (ตรวจ UI ข้อ G2)
//
// ยกแนวคิดมาจากตารางหน้าผลงานรายยูนิต (lib/views/unitperf.ts) ซึ่งเรียงจาก "ข้อมูล" แล้ววาดใหม่
// ตัวกลางนี้เรียง "แถวที่วาดแล้ว" ในที่เดิมแทน หน้าไหนก็เสียบใช้ได้โดยไม่ต้องรื้อวิธีวาดตาราง
//
// วิธีใช้ (หน้า view)
//   1) หัวคอลัมน์ที่เรียงได้: sortTh('ยอดขาย', 'rev', { num: true })  หรือเขียนเองเป็น
//      <th data-sort-key="rev" data-sort-dir="desc"><button type="button" class="th-sort">ยอดขาย</button></th>
//      (th ที่มีแค่ data-sort-key แต่ไม่มีปุ่ม จะถูกครอบปุ่มให้เอง)
//   2) ช่องข้อมูล: ใส่ค่าดิบไว้ที่ <td data-sort="123456.7"> ดีที่สุด (ข้อความบนจอเป็น "฿123K" ก็เรียงถูก)
//      ไม่ใส่ = อ่านจากตัวหนังสือในช่อง (เข้าใจ ฿ , % x K M และ — = ไม่มีข้อมูล)
//   3) หลังวาดตารางทุกครั้ง (รวมรอบรีเฟรชเองอัตโนมัติ) เรียก makeSortable(container, 'table.xxx', { id: 'sales-units' })
//      การเรียงที่ผู้ใช้เลือกจะถูกจำไว้ (หน่วยความจำ + sessionStorage) แล้วใส่กลับให้เอง ไม่เด้งกลับทุกรอบรีเฟรช
//
// แถวพิเศษ
//   - แถวรวม: ใส่ใน <tfoot> (ไม่โดนเรียงอยู่แล้ว) หรือ <tr class="tbl-total"> ใน tbody (คลาสแถวรวมกลางของ globals.css)
//     → ค้างไว้ล่างสุดเสมอ · คลาสอื่นส่งผ่าน totalsRowSelector
//   - แถวรายละเอียดที่กางใต้แถวหลัก: ใส่ data-sort-follow ที่ <tr> → ย้ายตามแถวหลักที่อยู่ก่อนหน้า
//   - ลำดับที่ (#): ใส่ <span class="sort-rank"> ในแถว → เขียนเลขใหม่ 1..n หลังเรียงให้
//   - แถวหัวกลุ่ม (ช่องเดียว colspan ทั้งแถว) เรียงรวมไม่ได้ — ตารางแบบนั้นอย่าใช้ตัวนี้ หรือใส่ data-sort-fixed
//
// ค่าที่ไม่มีข้อมูล (ว่าง / — / -) อยู่ท้ายเสมอ ไม่ว่าจะเรียงขึ้นหรือลง (กติกาเดียวกับหน้าผลงานรายยูนิต)

import { icon } from '@/lib/ui/icons';
import { esc } from '@/lib/ui/helpers';

export type SortDir = 'asc' | 'desc';
export interface SortState { key: string; dir: SortDir }
export interface SortOpts {
  /** ชื่อจำการเรียง — ตารางเดียวกันต้องใช้ชื่อเดิมทุกรอบวาด (เช่น 'sales-units') */
  id: string;
  /** เรียงตามคอลัมน์นี้ตั้งแต่เปิดหน้า (ไม่ใส่ = ลำดับตามที่วาดมา) */
  defaultKey?: string;
  defaultDir?: SortDir;
  /** แถวใน tbody ที่ต้องค้างไว้ล่างสุด นอกจาก tr.tbl-total (ค้างให้อยู่แล้ว) */
  totalsRowSelector?: string;
}

const SS_PREFIX = 'pn-sort:';
const mem_: Record<string, SortState> = {};

function valid_(s: unknown): s is SortState {
  const o = s as SortState;
  return !!o && typeof o.key === 'string' && !!o.key && (o.dir === 'asc' || o.dir === 'desc');
}

/** การเรียงที่ผู้ใช้เลือกไว้ของตารางนี้ (null = ยังไม่เคยเลือก) — หน้าที่อยากเรียงข้อมูลก่อน export ใช้ตัวนี้ได้ */
export function getSortState(id: string): SortState | null {
  if (mem_[id]) return mem_[id];
  // sessionStorage อาจใช้ไม่ได้ (โหมดส่วนตัว / ถูกบล็อก) — ต้องทำงานต่อได้แค่ไม่จำข้ามการรีเฟรชหน้า
  try {
    const raw = window.sessionStorage.getItem(SS_PREFIX + id);
    if (raw) {
      const s = JSON.parse(raw);
      if (valid_(s)) { mem_[id] = s; return s; }
    }
  } catch { /* ใช้ค่าเริ่มต้นแทน */ }
  return null;
}

function save_(id: string, s: SortState): void {
  mem_[id] = s;
  try { window.sessionStorage.setItem(SS_PREFIX + id, JSON.stringify(s)); } catch { /* จำแค่ในหน่วยความจำ */ }
}

function arrowHtml_(dir: SortDir | null): string {
  // ไอคอนชุดเดียวกันทั้ง 3 สถานะ (เดิม ↕ เป็นอักขระที่บางเครื่องวาดเป็นอีโมจิสี)
  return icon(dir === 'asc' ? 'arrow-up' : dir === 'desc' ? 'arrow-down' : 'arrow-up-down', { size: 12 });
}

/**
 * HTML ของหัวคอลัมน์ที่เรียงได้
 * labelHtml ต้อง escape มาแล้ว · opts.dir = ทิศตอนกดครั้งแรก (ตัวเลขส่วนใหญ่ 'desc' = มากไปน้อย, ชื่อ 'asc')
 * opts.tip = คำอธิบายสั้น (แสดงเป็นกรอบลอยตอนชี้) · ปุ่ม ⓘ ต้องวางนอกปุ่มเรียง (ปุ่มซ้อนปุ่มไม่ได้)
 */
export function sortTh(labelHtml: string, key: string, opts?: { num?: boolean; dir?: SortDir; cls?: string; tip?: string; after?: string }): string {
  const o = opts || {};
  const cls = [o.num ? 'num' : '', o.cls || ''].filter(Boolean).join(' ');
  return '<th' + (cls ? ' class="' + cls + '"' : '') + ' data-sort-key="' + esc(key) + '"' +
    ' data-sort-dir="' + (o.dir || (o.num ? 'desc' : 'asc')) + '" aria-sort="none"' +
    (o.tip ? ' data-tip="' + esc(o.tip) + '"' : '') + '>' +
    '<button type="button" class="th-sort">' + labelHtml + '<span class="th-arrow">' + arrowHtml_(null) + '</span></button>' +
    (o.after || '') +
  '</th>';
}

/** th ที่มีแค่ data-sort-key → ครอบเนื้อหาด้วยปุ่ม (ปุ่ม ⓘ .info-i ย้ายออกไปไว้หลังปุ่มเรียง กันปุ่มซ้อนปุ่ม) */
function upgradeTh_(th: HTMLTableCellElement): void {
  let btn = th.querySelector('button.th-sort') as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'th-sort';
    const keep: Node[] = [];
    Array.from(th.childNodes).forEach((n) => {
      if (n.nodeType === 1 && (n as Element).matches('.info-i, button, a')) keep.push(n);
      else btn!.appendChild(n);
    });
    th.appendChild(btn);
    keep.forEach((n) => th.appendChild(n));
  }
  if (!btn.querySelector('.th-arrow')) {
    const s = document.createElement('span');
    s.className = 'th-arrow';
    s.innerHTML = arrowHtml_(null);
    btn.appendChild(s);
  }
  if (!th.hasAttribute('aria-sort')) th.setAttribute('aria-sort', 'none');
}

/** ตำแหน่งคอลัมน์จริงของ th (นับ colspan ของช่องก่อนหน้า) */
function colIndex_(th: HTMLTableCellElement): number {
  let idx = 0;
  for (let c = th.previousElementSibling; c; c = c.previousElementSibling) idx += (c as HTMLTableCellElement).colSpan || 1;
  return idx;
}

/** ช่องของแถวที่ครอบตำแหน่งคอลัมน์ idx (รองรับ colspan) */
function cellAt_(row: HTMLTableRowElement, idx: number): HTMLTableCellElement | null {
  let pos = 0;
  for (let i = 0; i < row.cells.length; i++) {
    const c = row.cells[i];
    const span = c.colSpan || 1;
    if (idx < pos + span) return c;
    pos += span;
  }
  return null;
}

type SortVal = number | string | null;

/** ข้อความบนจอ → ค่าที่เรียงได้: "-฿2.28M" → -2280000 · "12.90%" → 12.9 · "3.03x" → 3.03 · "—" → null */
function parseText_(t: string): SortVal {
  const s = t.replace(/\s+/g, ' ').trim();
  if (!s || /^[-—–]$/.test(s)) return null;
  const n = s.replace(/[฿,%x×\s]/g, '').replace(/^\+/, '');
  const m = n.match(/^(-?\d*\.?\d+)([KkMm])?$/);
  if (m) {
    const base = Number(m[1]);
    const mul = !m[2] ? 1 : /k/i.test(m[2]) ? 1e3 : 1e6;
    if (isFinite(base)) return base * mul;
  }
  return s;
}

function valueOf_(row: HTMLTableRowElement, idx: number): SortVal {
  const c = cellAt_(row, idx);
  if (!c) return null;
  const raw = c.getAttribute('data-sort');
  if (raw !== null) {
    const r = raw.trim();
    if (r === '') return null;
    const v = Number(r);
    return isFinite(v) ? v : r;
  }
  return parseText_(c.textContent || '');
}

function compare_(a: SortVal, b: SortVal, dir: SortDir): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;               // ไม่มีข้อมูล อยู่ท้ายเสมอ
  if (b === null) return -1;
  const d = dir === 'asc' ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return (a - b) * d;
  return String(a).localeCompare(String(b), 'th', { numeric: true, sensitivity: 'base' }) * d;
}

/** อัปเดตสถานะบนหัวคอลัมน์ (aria-sort + ลูกศร) */
function paintHead_(tbl: HTMLTableElement, st: SortState | null): void {
  tbl.querySelectorAll('thead th[data-sort-key]').forEach((el) => {
    const th = el as HTMLTableCellElement;
    const on = !!st && th.getAttribute('data-sort-key') === st.key;
    th.setAttribute('aria-sort', on ? (st!.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    th.classList.toggle('is-sorted', on);
    const ar = th.querySelector('.th-arrow');
    if (ar) ar.innerHTML = arrowHtml_(on ? st!.dir : null);
  });
}

interface Group { main: HTMLTableRowElement; rows: HTMLTableRowElement[]; val: SortVal; i: number }

function apply_(tbl: HTMLTableElement, opts: SortOpts, st: SortState | null): void {
  paintHead_(tbl, st);
  if (!st) return;                         // ยังไม่เคยเลือก + ไม่มีค่าเริ่มต้น = ลำดับตามที่วาดมา
  const th = tbl.querySelector('thead th[data-sort-key="' + (window.CSS && CSS.escape ? CSS.escape(st.key) : st.key) + '"]') as HTMLTableCellElement | null;
  if (!th) return;                         // คอลัมน์ที่จำไว้หายไปแล้ว (เช่น สลับแท็บที่ไม่มีคอลัมน์นี้)
  const idx = colIndex_(th);
  Array.from(tbl.tBodies).forEach((tb) => {
    const groups: Group[] = [];
    const fixed: HTMLTableRowElement[] = [];
    Array.from(tb.rows).forEach((r) => {
      if (r.hasAttribute('data-sort-fixed') || r.classList.contains('tbl-total') ||
        (opts.totalsRowSelector && r.matches(opts.totalsRowSelector))) { fixed.push(r); return; }
      if (r.hasAttribute('data-sort-follow') && groups.length) { groups[groups.length - 1].rows.push(r); return; }
      groups.push({ main: r, rows: [r], val: valueOf_(r, idx), i: groups.length });
    });
    groups.sort((a, b) => compare_(a.val, b.val, st.dir) || a.i - b.i);   // เท่ากัน = คงลำดับเดิม
    const frag = document.createDocumentFragment();
    groups.forEach((g, n) => {
      g.rows.forEach((r) => frag.appendChild(r));
      g.main.querySelectorAll('.sort-rank').forEach((el) => { el.textContent = String(n + 1); });
    });
    fixed.forEach((r) => frag.appendChild(r));
    tb.appendChild(frag);
  });
}

/**
 * ทำให้ตารางที่ตรงกับ tableSelector (ใต้ root) กดหัวคอลัมน์เพื่อเรียงได้
 * เรียกซ้ำได้ทุกครั้งหลังวาดตารางใหม่ — ผูก event ครั้งเดียวต่อตาราง และใส่การเรียงที่จำไว้กลับให้เอง
 */
export function makeSortable(root: HTMLElement | null, tableSelector: string, opts: SortOpts): void {
  if (!root || !opts || !opts.id) return;
  root.querySelectorAll(tableSelector).forEach((el) => {
    const tbl = el as HTMLTableElement;
    if (tbl.tagName !== 'TABLE') return;
    const ths = tbl.querySelectorAll('thead th[data-sort-key]');
    if (!ths.length) return;
    ths.forEach((th) => upgradeTh_(th as HTMLTableCellElement));

    if (!tbl.hasAttribute('data-sort-bound')) {
      tbl.setAttribute('data-sort-bound', opts.id);
      const thead = tbl.tHead;
      if (thead) thead.addEventListener('click', (e) => {
        const btn = (e.target as Element | null)?.closest ? (e.target as Element).closest('button.th-sort') : null;
        if (!btn) return;
        const th = btn.closest('th[data-sort-key]') as HTMLTableCellElement | null;
        if (!th || !tbl.contains(th)) return;
        const key = th.getAttribute('data-sort-key') || '';
        const cur = getSortState(opts.id) || (opts.defaultKey ? { key: opts.defaultKey, dir: opts.defaultDir || 'desc' } : null);
        const next: SortState = cur && cur.key === key
          ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
          : { key, dir: (th.getAttribute('data-sort-dir') === 'asc' ? 'asc' : 'desc') };
        save_(opts.id, next);
        apply_(tbl, opts, next);
      });
    }

    const st = getSortState(opts.id) || (opts.defaultKey ? { key: opts.defaultKey, dir: opts.defaultDir || 'desc' } : null);
    apply_(tbl, opts, st);
  });
}
