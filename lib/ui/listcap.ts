// lib/ui/listcap.ts — รายการยาวบนมือถือ (<600px): โชว์ 10 อันดับแรก + ปุ่ม "ดูทั้งหมด (N คน)"
//
// ยกแบบมาจาก "ตีกลับรายคน" หน้ากำไร (lib/views/profit.ts syncRetCut_ + .pf-ret-more) ให้ใช้ได้หลายรายการ
// เป้าหมาย (ตรวจมือถือ audit23): อันดับแอดมิน ~30 การ์ด ~9,300px (B8) · สรุปทั้งปี KPI 54 การ์ด ~14,000px (B3)
//
// กติกาเดียวกับของเดิม
//  - ซ่อนด้วย CSS nth-child (.lc-cut) → "10 แรก" คือ 10 แรกตามลำดับที่เรียงอยู่ตอนนั้นเสมอ
//    (กดหัวคอลัมน์เรียงใหม่ = แถวสลับที่ใน DOM → 10 แรกเปลี่ยนตามเอง ไม่ต้องคำนวณใหม่)
//  - กด "ดูทั้งหมด" = โชว์ครบ ปุ่มหายไป (เหมือนของเดิม) · จำไว้จนกว่าจะรีเฟรชหน้า — วาดใหม่/สลับแท็บ/เรียงใหม่ก็ยังโชว์ครบ
//  - จอ ≥600 ไม่ตัด ไม่มีปุ่ม (หมุนจอ/ขยายหน้าต่างแล้วตัด/เลิกตัดให้เองจาก matchMedia)
//  - ข้อมูลไม่เปลี่ยน แค่จำนวนที่เห็นก่อนแตะ
//
// เรียกจาก app-core (queueTableScan) ทุกครั้งที่หน้าเปลี่ยน — ทำซ้ำได้ ไม่สร้างปุ่มซ้ำ

import { fmtNum } from '@/lib/ui/helpers';

interface CapTarget {
  /** ชื่อจำสถานะ "กางแล้ว" */
  id: string;
  /** ตัวรายการ (ตัวที่ติด .lc-cut) */
  list: string;
  /** นับรายการ (เทียบจากตัวรายการ) — ต้องตรงกับกฎซ่อนใน globals.css */
  items: string;
  /** หน่วยบนปุ่ม */
  unit: string;
  /** ตัวที่ปุ่มวางต่อท้าย — ตาราง: กล่องห่อตาราง (.table-scroll) · ลิสต์ div: ตัวลิสต์เอง */
  anchor: (list: Element) => Element;
  /** จำนวน "ทั้งหมด" บนปุ่ม ถ้าไม่เท่าจำนวนในรายการ (ไม่ใส่ = นับจากรายการ) */
  total?: (list: Element, n: number) => number;
}

const CAP = 10;

const TARGETS: CapTarget[] = [
  {
    id: 'adminperf-rank', list: '#view-adminperf .rank-list', items: ':scope > .rank-card', unit: 'คน',
    anchor: function (el) { return el; },
    // แท็บท็อป 3 + พับอันดับ 1-3 ไว้: ลิสต์เริ่มที่อันดับ 4 (คนบนแท่นอยู่ข้างบน) — ปุ่มต้องบอกจำนวนทั้งอันดับ
    // ไม่งั้นตัวเลขเปลี่ยนตามแท็บ/การพับ (30 ↔ 33) ทั้งที่เป็นอันดับชุดเดียวกัน
    total: function (el, n) {
      if (!el.querySelector(':scope > .rk-top-toggle[aria-expanded="false"]')) return n;
      const wrap = el.parentElement;
      return n + (wrap ? wrap.querySelectorAll(':scope > .top3-grid > .top3-card').length : 0);
    },
  },
  {
    id: 'kpi-year', list: '#view-kpi table.kpi-year', items: ':scope > tbody > tr:not(.tbl-total)', unit: 'คน',
    anchor: function (el) { return el.parentElement && el.parentElement.classList.contains('table-scroll') ? el.parentElement : el; },
  },
];

const shown: Record<string, boolean> = {};
let mq: MediaQueryList | null = null;

function isWide(): boolean {
  if (!mq) {
    mq = window.matchMedia('(min-width: 600px)');
    const again = function (): void { scanListCaps(); };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', again);
    else if (typeof mq.addListener === 'function') mq.addListener(again);
  }
  return mq.matches;
}

function sync(list: HTMLElement, t: CapTarget, wide: boolean): void {
  const n = list.querySelectorAll(t.items).length;
  const cut = !wide && !shown[t.id] && n > CAP;
  // สลับ class เฉพาะตอนเปลี่ยนจริง — app-core มีตัวเฝ้า class ทั้งหน้า (ปุ่มกรอง) ไม่อยากปลุกมันเปล่าๆ
  if (list.classList.contains('lc-cut') !== cut) list.classList.toggle('lc-cut', cut);
  const anchor = t.anchor(list);
  let btn = anchor.nextElementSibling as HTMLButtonElement | null;
  if (!btn || !btn.classList.contains('list-more') || btn.getAttribute('data-lc') !== t.id) btn = null;
  if (!btn) {
    if (!cut) return;              // ไม่ต้องตัด = ไม่ต้องมีปุ่ม
    btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn list-more';
    btn.setAttribute('data-lc', t.id);
    btn.addEventListener('click', function () { expand(list, t); });
    anchor.insertAdjacentElement('afterend', btn);
  }
  if (btn.hidden !== !cut) btn.hidden = !cut;
  const label = 'ดูทั้งหมด (' + fmtNum(t.total ? t.total(list, n) : n) + ' ' + t.unit + ')';
  if (btn.textContent !== label) btn.textContent = label;
}

/** กดดูทั้งหมด: โชว์ครบ ปุ่มหาย แล้วส่งโฟกัสไปที่รายการแรกที่เพิ่งโผล่ (ไม่ให้โฟกัสหล่นไปที่ body
    — คนใช้คีย์บอร์ด/โปรแกรมอ่านหน้าจออ่านต่อจากตรงที่เพิ่งกางได้เลย) */
function expand(list: HTMLElement, t: CapTarget): void {
  shown[t.id] = true;
  const btn = t.anchor(list).nextElementSibling as HTMLElement | null;
  const hadFocus = !!btn && document.activeElement === btn;
  sync(list, t, isWide());
  const next = list.querySelectorAll(t.items)[CAP] as HTMLElement | undefined;
  if (next && hadFocus) {
    if (!next.hasAttribute('tabindex')) next.setAttribute('tabindex', '-1');
    try { next.focus({ preventScroll: true }); } catch (e) { /* เบราว์เซอร์เก่า: ข้าม */ }
  }
}

/** ตัด/เลิกตัดทุกรายการที่อยู่ในหน้าตอนนี้ — เรียกซ้ำได้ทุกครั้งที่หน้าเปลี่ยน */
export function scanListCaps(): void {
  if (typeof window === 'undefined') return;
  const wide = isWide();
  TARGETS.forEach(function (t) {
    document.querySelectorAll(t.list).forEach(function (el) {
      try { sync(el as HTMLElement, t, wide); } catch (e) { /* รายการแปลกๆ = โชว์ครบตามเดิม */ }
    });
  });
}
