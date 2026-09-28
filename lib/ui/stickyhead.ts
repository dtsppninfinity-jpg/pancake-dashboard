// lib/ui/stickyhead.ts — หัวตารางลอยใต้แถบบน สำหรับตารางกว้างที่เลื่อนแนวนอน (จอ <900px)
//
// ปัญหา (ตรวจมือถือ audit23 ข้อ A5 / B4): ตาราง ≥9 คอลัมน์ (.tbl-scroll-x — ยอดขายตามยูนิต, ผลงานรายยูนิต,
// เป้าหน้ารายงาน, KPI แอดมิน ฯลฯ) อยู่ในกล่องเลื่อนแนวนอน (overflow-x: auto) thead ที่ติด sticky
// จึงค้างได้แค่ในกล่องนั้น — เลื่อนหน้าลงมากลางตาราง + ปัดซ้ายขวา เห็นแต่ตัวเลข ไม่รู้ว่าคอลัมน์ไหนคืออะไร
// จอ ≥900 ใช้ .tbl-sticky (ปลด overflow ของกล่อง) ได้เพราะตารางพอดีการ์ด — จอเล็กทำแบบนั้นไม่ได้
// และห้ามทำกล่องเลื่อนแนวตั้งซ้อน (ดูดนิ้วตอนปัดเลื่อนหน้า)
//
// วิธี: ทำ "สำเนาหัวตาราง" บางๆ ลอยใต้แถบบน (position: fixed) เฉพาะตอนหัวจริงเลื่อนพ้นแถบบนไปแล้ว
//       แต่ตารางยังอยู่บนจอ · ท้ายตารางเลื่อนขึ้นมา = สำเนาถูกดันขึ้นไปมุดใต้แถบบนตาม (แบบหัวตาราง sticky ปกติ)
//  - สำเนาอยู่ถัดจากกล่องเลื่อน (แม่เดียวกัน) → โดน CSS ทุกกฎเหมือนหัวจริง (#view-x / .card / ธีมสว่าง-มืด)
//    และหายไปเองเมื่อ view วาดใหม่ด้วย innerHTML
//  - กล่องของสำเนาเลื่อนแนวนอนได้ (ซ่อนแถบเลื่อน) แล้วตั้ง scrollLeft ให้เท่ากล่องจริงทุกเฟรม
//    → คอลัมน์ที่ตรึง (sticky left) ในสำเนาตรึงตรงตำแหน่งเดียวกับของจริงเป๊ะ · ปัดบนสำเนาก็เลื่อนตารางจริงตาม
//  - ความกว้างคอลัมน์ = วัดจาก th จริง (colgroup + table-layout: fixed) · วัดใหม่เมื่อหมุนจอ / ตารางเปลี่ยนขนาด /
//    หัวจริงเปลี่ยน (กดเรียง = ลูกศรเปลี่ยน) · ตารางถูกวาดใหม่ = ติดตามตัวใหม่ ตัวเก่าล้างทิ้ง
//  - แตะหัวคอลัมน์ในสำเนา = ส่งคลิกไปที่ปุ่มเดียวกันในหัวจริง (ตัวเรียงผูกไว้ที่ thead จริง) · ปุ่ม ⓘ ปล่อยให้
//    กรอบอธิบาย (infotip) จัดการเอง กรอบจะโผล่ใต้ปุ่มในสำเนาซึ่งอยู่บนจอ
//  - สำเนาหน้าตา/ความสูงเหมือนหัวจริงทุกพิกเซล (ไม่ตัดระยะบนล่าง) → ตอนส่งต่อ สำเนาทับหัวจริงพอดี ป้ายไม่กระโดด
//    ขอบล่างตรงเส้นขอบล่างของหัวจริง · พอหัวจริงเลื่อนต่อ สำเนาค้างโดยซ่อนระยะว่างเหนือป้าย (padding-top) ไว้ใต้แถบบน
//    ส่วนที่เห็นจึงบางลง โดยปุ่มเรียงยังสูงเต็ม 44px · เงาใต้สำเนาขึ้นเฉพาะตอนแถวข้อมูลเริ่มเลื่อนมุดใต้มัน
//  - ทุกอย่างทำใน requestAnimationFrame เดียว: อ่านตำแหน่งทั้งหมดก่อน แล้วค่อยเขียน (ไม่ให้ layout คำนวณซ้ำ)
//    ตัวฟังการเลื่อนเป็น passive ทั้งหมด
//  - ซ่อนเมื่อ: จอ ≥900 (CSS ซ่อนซ้ำอีกชั้น) · มีหน้าต่าง/แผ่นล่างเปิด · view ไม่ได้แสดงอยู่ · ตารางพ้นจอ
//
// เรียกจาก app-core (queueTableScan) ทุกครั้งที่หน้าเปลี่ยน — ฟังก์ชันนี้ถูก ทำซ้ำได้ ไม่สร้างของซ้ำ

interface Entry {
  tbl: HTMLTableElement;
  box: HTMLElement;
  thead: HTMLTableSectionElement;
  view: HTMLElement | null;
  host: HTMLElement | null;      // .sth — กรอบลอย (fixed) มีพื้น + เงาใต้
  sc: HTMLElement | null;        // .sth-sc — กล่องเลื่อนแนวนอนของสำเนา
  dirty: boolean;                // ต้องสร้างสำเนาใหม่ (ความกว้าง/เนื้อหาหัวเปลี่ยน)
  on: boolean;                   // กำลังแสดงอยู่
  fl: boolean;                   // ลอยแยกจากหัวจริงแล้ว (มีเงา) — ตอนทับหัวจริงพอดีไม่มีเงา
  hh: number;                    // ความสูงสำเนาที่วัดได้จริงหลังโชว์ (0 = ยังไม่รู้ ใช้ความสูงหัวจริงแทน — CSS เดียวกัน)
  tuck: number;                  // ระยะว่างเหนือป้ายที่ซ่อนไว้ใต้แถบบนได้ตอนสำเนาค้าง (วัดตอนสร้างสำเนา)
  x: number; y: number; w: number; more: boolean;
  setL: number;                  // scrollLeft ที่เราตั้งให้สำเนาล่าสุด (ไว้แยกกับการปัดของผู้ใช้)
  touchTs: number;               // เวลาที่นิ้ว/ล้อเมาส์แตะสำเนาล่าสุด — มีแต่ตอนนั้นที่นับว่า "ผู้ใช้ปัดสำเนา"
  userTs: number;                // เวลาที่ผู้ใช้ปัดบนสำเนาล่าสุด — ช่วงนั้นกล่องจริงตามสำเนา ไม่ใช่กลับกัน
  mo: MutationObserver;
  onBox: () => void;
}

const entries: Entry[] = [];
let inited = false;
let queued = false;
let wideMq: MediaQueryList | null = null;
let ro: ResizeObserver | null = null;

function isWide(): boolean {
  return !!wideMq && wideMq.matches;
}

function schedule(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(frame);
}

function markAllDirty(): void {
  entries.forEach(function (e) { e.dirty = true; });
  schedule();
}

function init(): void {
  if (inited) return;
  inited = true;
  wideMq = window.matchMedia('(min-width: 900px)');
  const onMq = function (): void { markAllDirty(); };
  if (typeof wideMq.addEventListener === 'function') wideMq.addEventListener('change', onMq);
  else if (typeof (wideMq as MediaQueryList).addListener === 'function') (wideMq as MediaQueryList).addListener(onMq);
  window.addEventListener('scroll', schedule, { passive: true });
  // มือถือยิง resize ทุกครั้งที่แถบที่อยู่เว็บหด/โผล่ระหว่างเลื่อน (สูงเปลี่ยน กว้างเท่าเดิม) — วัดคอลัมน์ใหม่เฉพาะตอนกว้างเปลี่ยน
  let lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (window.innerWidth !== lastW) { lastW = window.innerWidth; markAllDirty(); } else schedule();
  }, { passive: true });
  window.addEventListener('orientationchange', markAllDirty, { passive: true });
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(function (list) {
      list.forEach(function (en) {
        const e = entries.find(function (x) { return x.tbl === en.target; });
        if (e) e.dirty = true;
      });
      schedule();
    });
  }
}

/** ตารางนี้ควรมีหัวลอยไหม — ตารางกว้างที่เลื่อนแนวนอนในหน้าหลัก หัวแถวเดียว ไม่มีช่องรวบ */
function eligible(tbl: HTMLTableElement): HTMLElement | null {
  if (tbl.closest('#modal-root')) return null;            // ในหน้าต่างมีที่เลื่อนของตัวเองอยู่แล้ว
  const view = tbl.closest('.view');
  if (!view) return null;
  const thead = tbl.tHead;
  if (!thead || thead.rows.length !== 1) return null;     // หัว 2 ชั้น: วัดความกว้างรายคอลัมน์ไม่ตรง
  const cells = Array.from(thead.rows[0].cells);
  if (!cells.length || cells.some(function (c) { return c.colSpan > 1 || c.rowSpan > 1; })) return null;
  const box = tbl.parentElement;
  if (!box || !box.hasAttribute('data-sx')) return null;  // ไม่ได้อยู่ในกล่องเลื่อนแนวนอน (app-core bindScrollHint)
  // กล่องที่เลื่อนแนวตั้งในตัว (มี max-height) หัว sticky ของมันทำงานในกล่องอยู่แล้ว
  if (getComputedStyle(box).maxHeight !== 'none') return null;
  return box;
}

function track(tbl: HTMLTableElement): void {
  const box = eligible(tbl);
  if (!box) return;
  const thead = tbl.tHead as HTMLTableSectionElement;
  const e: Entry = {
    tbl, box, thead, view: tbl.closest('.view') as HTMLElement | null,
    host: null, sc: null, dirty: true, on: false, fl: false, hh: 0, tuck: 0, x: NaN, y: NaN, w: NaN, more: false,
    setL: -1, touchTs: 0, userTs: 0,
    mo: new MutationObserver(function () { e.dirty = true; schedule(); }),
    onBox: schedule,
  };
  // หัวจริงเปลี่ยน (กดเรียง = aria-sort + ลูกศร, view เติมปุ่ม) → สร้างสำเนาใหม่ในเฟรมถัดไป
  e.mo.observe(thead, { subtree: true, childList: true, attributes: true, characterData: true });
  box.addEventListener('scroll', e.onBox, { passive: true });
  if (ro) ro.observe(tbl);
  entries.push(e);
}

function drop(i: number): void {
  const e = entries[i];
  e.mo.disconnect();
  e.box.removeEventListener('scroll', e.onBox);
  if (ro) ro.unobserve(e.tbl);
  if (e.host && e.host.parentNode) e.host.parentNode.removeChild(e.host);
  entries.splice(i, 1);
}

/** สร้างกรอบลอยครั้งแรก — วางถัดจากกล่องเลื่อน (fixed = ไม่กินที่ในหน้า ไม่เปลี่ยนเลย์เอาต์) */
function makeHost(e: Entry): void {
  const host = document.createElement('div');
  host.className = 'sth';
  host.setAttribute('aria-hidden', 'true');
  const sc = document.createElement('div');
  sc.className = 'sth-sc';
  host.appendChild(sc);
  // ผู้ใช้ปัดบนสำเนา → เลื่อนตารางจริงตาม
  // นับเฉพาะช่วงที่นิ้ว/ล้อเมาส์เพิ่งแตะสำเนา (รวมช่วงไถต่อหลังปล่อยนิ้ว) — scroll event ที่เกิดจากเราตั้งค่าเอง
  // ต้องไม่ย้อนไปขยับตารางจริง ไม่งั้นสองกล่องดึงกันไปมา
  const touched = function (): void { e.touchTs = performance.now(); };
  host.addEventListener('touchstart', touched, { passive: true });
  host.addEventListener('touchend', touched, { passive: true });
  host.addEventListener('pointerdown', touched, { passive: true });
  host.addEventListener('wheel', touched, { passive: true });
  sc.addEventListener('scroll', function () {
    const l = sc.scrollLeft;
    const now = performance.now();
    if (now - e.touchTs > 2500 || Math.abs(l - e.setL) <= 0.5) return;
    e.userTs = now;
    e.setL = l;
    e.box.scrollLeft = l;
  }, { passive: true });
  host.addEventListener('click', function (ev) { forwardClick(e, ev); });
  e.box.insertAdjacentElement('afterend', host);
  e.host = host;
  e.sc = sc;
}

/** แตะหัวคอลัมน์ในสำเนา = คลิกปุ่มเดียวกันในหัวจริง (ตัวเรียงของ table-sort ผูกไว้ที่ thead จริง) */
function forwardClick(e: Entry, ev: MouseEvent): void {
  const t = ev.target as Element | null;
  if (!t || !t.closest) return;
  if (t.closest('.info-i')) return;          // ปุ่ม ⓘ: infotip (ฟังที่ document) เปิดกรอบใต้ปุ่มในสำเนาเอง
  const cth = t.closest('th') as HTMLTableCellElement | null;
  if (!cth) return;
  // ไม่หยุดการส่งต่อของคลิก — ตัวฟังที่ document (ปิดเมนู ⋯ / กรอบอธิบายที่ปักค้าง) ต้องเห็นว่าแตะที่อื่นแล้ว
  // (view ในเว็บนี้ไม่มีตัวฟังคลิกแบบรวมที่ container จึงไม่มีใครเรียงซ้ำ 2 รอบ — ตัวเรียงอยู่ที่ thead จริงเท่านั้น)
  ev.preventDefault();
  const realRow = e.thead.rows[0];
  const realTh = realRow ? realRow.cells[cth.cellIndex] : null;
  if (!realTh) return;
  const act = t.closest('button, a, [role="button"]') as HTMLElement | null;
  let real: HTMLElement | null = null;
  if (act && cth.contains(act)) {
    // เดินตามตำแหน่งลูก (index) จาก th ลงไปถึงปุ่มที่แตะ — โครงสร้างสำเนากับของจริงเหมือนกันทุกชั้น
    const path: number[] = [];
    for (let n: Element | null = act; n && n !== cth; n = n.parentElement) {
      const p: Element | null = n.parentElement;
      if (!p) break;
      path.unshift(Array.prototype.indexOf.call(p.children, n));
    }
    let r: Element | null = realTh;
    for (let i = 0; r && i < path.length; i++) r = r.children[path[i]] || null;
    real = (r as HTMLElement | null) || (realTh.querySelector('button.th-sort') as HTMLElement | null);
  } else {
    real = (realTh.querySelector('button.th-sort') as HTMLElement | null) || realTh;
  }
  if (!real) return;
  real.click();
  // โฟกัสย้ายไปอยู่ที่ปุ่มจริง (สำเนาจะถูกสร้างใหม่หลังเรียง ปุ่มในสำเนาที่ถือโฟกัสอยู่จะหายไป)
  const ae = document.activeElement;
  if (ae && e.host && e.host.contains(ae) && typeof real.focus === 'function') {
    try { real.focus({ preventScroll: true }); } catch (err) { /* เบราว์เซอร์เก่า: ปล่อยโฟกัสไว้ */ }
  }
}

/** วาดสำเนาใหม่จากหัวจริง — widths / tuck วัดมาแล้วในรอบอ่าน */
function build(e: Entry, widths: number[], offX: number, scrollW: number, tuck: number): void {
  if (!e.host) makeHost(e);
  const sc = e.sc as HTMLElement;
  const t = e.tbl.cloneNode(false) as HTMLTableElement;   // ได้ class + style (--pin1-w) + data-* ของจริง
  t.removeAttribute('id');
  t.classList.remove('tbl-sticky');
  // กันตัวอื่นแตะสำเนา: app-core ไม่จัดประเภทซ้ำ · makeSortable ไม่ผูกตัวเรียงซ้อน · ตัวสแกนนี้ไม่ติดตามสำเนา
  t.setAttribute('data-cards', 'off');
  t.setAttribute('data-sxc', '1');
  t.setAttribute('data-sort-bound', 'sth');
  t.setAttribute('data-sth', 'copy');
  let sum = 0;
  const cg = document.createElement('colgroup');
  widths.forEach(function (w) {
    const c = document.createElement('col');
    c.style.width = w + 'px';
    cg.appendChild(c);
    sum += w;
  });
  t.style.width = sum + 'px';
  t.style.minWidth = '0';
  t.style.maxWidth = 'none';
  t.style.tableLayout = 'fixed';
  t.style.margin = '0';
  t.style.marginLeft = offX ? offX + 'px' : '0';
  const head = e.thead.cloneNode(true) as HTMLTableSectionElement;
  head.querySelectorAll('[id]').forEach(function (n) { n.removeAttribute('id'); });
  // สำเนาเป็นของตกแต่ง (aria-hidden) — ห้ามอยู่ในลำดับ Tab ไม่งั้นคนใช้คีย์บอร์ดเจอปุ่มซ้ำ
  head.querySelectorAll('button, a[href], input, select, [tabindex]').forEach(function (n) { n.setAttribute('tabindex', '-1'); });
  t.appendChild(cg);
  t.appendChild(head);
  // ความกว้างที่เลื่อนได้ต้องเท่ากล่องจริง (scrollLeft สูงสุดเท่ากัน) — ตารางจริงอาจมีขอบ/ระยะท้าย
  const spacer = document.createElement('div');
  spacer.className = 'sth-in';
  spacer.style.width = Math.max(scrollW, sum + offX) + 'px';
  spacer.appendChild(t);
  sc.replaceChildren(spacer);
  e.setL = -1;       // เนื้อหาใหม่ = ตำแหน่งเลื่อนเริ่มใหม่ ต้องตั้งซ้ำ
  e.hh = 0;          // ความสูงวัดใหม่ในเฟรมถัดไป
  e.tuck = tuck;
  e.dirty = false;
}

interface Plan {
  e: Entry;
  show: boolean;
  x: number; y: number; w: number; sl: number; more: boolean; fl: boolean;
  widths: number[] | null; offX: number; scrollW: number; tuck: number;
}

function frame(): void {
  queued = false;
  // ตารางที่ถูก view เขียนทับไปแล้ว — เลิกติดตาม
  for (let i = entries.length - 1; i >= 0; i--) if (!entries[i].tbl.isConnected) drop(i);
  if (!entries.length) return;
  const wide = isWide();
  const modal = !!document.querySelector('#modal-root .modal-overlay');
  const topbar = document.querySelector('.topbar') as HTMLElement | null;

  // ---- รอบอ่าน (ไม่มีการเขียนแทรก) ----
  const topH = topbar ? topbar.getBoundingClientRect().bottom : 0;
  const plans: Plan[] = [];
  entries.forEach(function (e) {
    const p: Plan = { e, show: false, x: 0, y: 0, w: 0, sl: 0, more: false, fl: false, widths: null, offX: 0, scrollW: 0, tuck: 0 };
    plans.push(p);
    if (wide || modal || !e.view || !e.view.classList.contains('active')) return;
    const hr = e.thead.getBoundingClientRect();
    if (!hr.height || hr.top >= topH) return;              // หัวจริงยังอยู่บนจอ (หรือตารางถูกซ่อน)
    const tr = e.tbl.getBoundingClientRect();
    if (tr.bottom <= topH) return;                          // ตารางเลื่อนพ้นแถบบนไปทั้งตัวแล้ว
    const rebuild = e.dirty || !e.host;
    // ความสูงสำเนา = ความสูงหัวจริง (CSS ชุดเดียวกัน ความกว้างเท่ากัน) · โชว์อยู่แล้วใช้ค่าที่วัดจากสำเนาจริง
    // (ห้ามใช้ offsetHeight ตอนสำเนายังซ่อน = 0 · สร้างใหม่ในเฟรมนี้ = ค่าเก่าใช้ไม่ได้ → ใช้หัวจริง แล้วเฟรมหน้าวัดซ้ำ)
    if (e.on && e.host && !rebuild && !e.hh) e.hh = e.host.offsetHeight;
    const hh = (!rebuild && e.hh) || hr.height;
    const br = e.box.getBoundingClientRect();
    if (rebuild) {
      const cells = Array.from(e.thead.rows[0].cells);
      p.widths = cells.map(function (c) { return c.getBoundingClientRect().width; });
      p.offX = tr.left - br.left - e.box.clientLeft + e.box.scrollLeft;
      p.scrollW = e.box.scrollWidth;
      // ซ่อนได้แค่ระยะว่างเหนือเนื้อหาของช่องหัว (padding-top ที่น้อยสุด) และส่วนที่เห็นต้องสูง ≥40px
      // (หัวที่ไม่มีปุ่มเรียงเตี้ยอยู่แล้ว = ไม่ซ่อน ป้ายไม่เบียดขอบแถบบน · ปุ่มเรียงไม่โดนบังเหลือต่ำกว่า 44px)
      let pad = Infinity;
      cells.forEach(function (c) { pad = Math.min(pad, parseFloat(getComputedStyle(c).paddingTop) || 0); });
      p.tuck = Math.max(0, Math.min(isFinite(pad) ? pad : 0, hr.height - 40));
    }
    const tuck = rebuild ? p.tuck : e.tuck;
    p.show = true;
    p.x = br.left + e.box.clientLeft;
    p.w = e.box.clientWidth;
    // ช่วงส่งต่อ: สำเนาทับหัวจริงพอดี (y = หัวจริง) จนระยะว่างเหนือป้ายมุดใต้แถบบน แล้วค้างไว้ตรงนั้น
    // ท้ายตาราง: ขอบล่างสำเนาชนท้ายตาราง ดันสำเนาขึ้นไปมุดใต้แถบบนตาม (แบบหัว sticky ปกติ)
    p.y = Math.min(Math.max(hr.top, topH - tuck), tr.bottom - hh);
    p.fl = Math.abs(p.y - hr.top) > 0.5;
    p.sl = e.box.scrollLeft;
    p.more = e.box.classList.contains('sx-more');
  });

  // ---- รอบเขียน ----
  let again = false;
  plans.forEach(function (p) {
    const e = p.e;
    if (!p.show) {
      if (e.on && e.host) { e.host.removeAttribute('data-on'); e.on = false; }
      return;
    }
    if (p.widths) { build(e, p.widths, p.offX, p.scrollW, p.tuck); again = true; }
    const host = e.host as HTMLElement;
    const sc = e.sc as HTMLElement;
    // เพิ่งโชว์/เพิ่งสร้างใหม่: ตำแหน่งเฟรมนี้คิดจากความสูงหัวจริง — ขอเฟรมถัดไปอีกเฟรมเพื่อวัดสำเนาจริงแล้วแก้ y
    // (ไม่รอ scroll ครั้งหน้า — ถ้านิ้วหยุดพอดีเฟรมนี้ ตำแหน่งต้องไม่ค้างผิด)
    if (!e.on) { host.setAttribute('data-on', '1'); e.on = true; e.setL = -1; e.hh = 0; again = true; }
    if (p.fl !== e.fl) {
      if (p.fl) host.setAttribute('data-fl', '1'); else host.removeAttribute('data-fl');
      e.fl = p.fl;
    }
    if (p.x !== e.x || p.y !== e.y) {
      host.style.transform = 'translate3d(' + p.x + 'px,' + p.y + 'px,0)';
      e.x = p.x; e.y = p.y;
    }
    if (p.w !== e.w) { host.style.width = p.w + 'px'; e.w = p.w; }
    if (p.more !== e.more) {   // ขอบขวาจาง + ลูกศร › เหมือนกล่องจริง (CSS .sth[data-more])
      if (p.more) host.setAttribute('data-more', '1'); else host.removeAttribute('data-more');
      e.more = p.more;
    }
    // ผู้ใช้กำลังปัดบนสำเนาอยู่ → กล่องจริงตามสำเนา อย่าดึงสำเนากลับไปค่าเก่า (จะกระตุกสู้กัน)
    // เทียบกับค่าที่จำไว้ ไม่อ่าน sc.scrollLeft (อ่านหลังเขียน = บังคับคำนวณ layout ทุกเฟรม)
    if (performance.now() - e.userTs > 150 && Math.abs(p.sl - e.setL) > 0.5) {
      e.setL = p.sl;
      sc.scrollLeft = p.sl;
    }
  });
  if (again) schedule();
}

/** ติดตามตารางกว้างตัวใหม่ๆ + ล้างตัวที่หายไป — เรียกซ้ำได้ทุกครั้งที่หน้าเปลี่ยน */
export function scanStickyHeads(): void {
  if (typeof window === 'undefined') return;
  init();
  document.querySelectorAll('.view table.tbl.tbl-scroll-x:not([data-sth])').forEach(function (t) {
    t.setAttribute('data-sth', '1');
    try { track(t as HTMLTableElement); } catch (err) { /* ตารางแปลกๆ ไม่มีหัวลอย ก็ยังใช้ตารางได้ */ }
  });
  schedule();
}
