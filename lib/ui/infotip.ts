// lib/ui/infotip.ts — tooltip กรอบลอยอธิบาย "สูตร/ความหมาย" ของค่าต่างๆ ทุกหน้า
//
// ผูกครั้งเดียวจาก App.init() ด้วย bindInfoTips() — ใช้ event delegation ที่ document
// จึงครอบคลุม element ที่ view สร้างใหม่ผ่าน innerHTML โดยไม่ต้อง rebind
//
// เป้าหมาย = element ที่มี data-tip (แนะนำ) — เขียนสูตรชัดๆ ได้ผ่าน:
//   data-tip           ข้อความอธิบาย (บังคับ) — ตัวคั่น " • " จะขึ้นบรรทัดใหม่ให้
//   data-tip-title     หัวข้อ (ไม่บังคับ)
//   data-tip-formula   บรรทัดสูตร เช่น "ออเดอร์ ÷ ลูกค้าที่คุยทั้งหมด" (ไม่บังคับ)
//   data-tip-src       แหล่งข้อมูล เช่น "จาก Meta" (ไม่บังคับ)
//
// ของเดิมที่ใช้ title="" อยู่แล้ว: แปลงให้อัตโนมัติตอน hover ครั้งแรก (ย้าย title → data-tip
// แล้วลบ title กัน tooltip ซ้อนของเบราว์เซอร์) — ทุกคำอธิบายเดิมเลยกลายเป็นกรอบสวยทันที
//
// ปุ่ม ⓘ (.info-i — สร้างด้วย infoTip() ใน helpers) มี 2 โหมด:
//   ชี้เมาส์ (จอคอม)          → กรอบโผล่ตามเมาส์ แล้วหายเมื่อเอาเมาส์ออก (เหมือน data-tip ทั่วไป)
//   คลิก / แตะ / Enter / Space → กรอบ "ปักค้าง" ใต้ปุ่ม จนกว่าจะแตะที่อื่น กด Esc หรือเลื่อนจอ
// เหตุผล: บนมือถือไม่มี hover เลย และคนใช้คีย์บอร์ดต้องเปิดอ่านได้โดยไม่ต้องมีเมาส์ (ตรวจ UI ข้อ D3)

import { esc } from './helpers';
import { icon } from './icons';

let tipEl: HTMLElement | null = null;
let liveEl: HTMLElement | null = null;
let curTarget: Element | null = null;
/** true = กรอบถูกเปิดด้วยการคลิก/แตะ/คีย์บอร์ดที่ปุ่ม ⓘ — ไม่หายตอนเอาเมาส์ออก */
let pinned = false;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let seq = 0;

const INFO_SEL = '.info-i';

/** อุปกรณ์สัมผัส (ไม่มี hover) — เบราว์เซอร์ยิง mouseover ให้ตอนแตะ แต่ไม่มีวันยิง mouseout
    เพราะนิ้วไม่ได้ "เลื่อนออก" ไปไหน กรอบจึงค้างจนกว่าจะมีอะไรมาสั่งปิด */
const TOUCH = typeof window !== 'undefined'
  && typeof window.matchMedia === 'function'
  && window.matchMedia('(hover: none)').matches;
/** เวลาที่ปล่อยให้กรอบค้างบนอุปกรณ์สัมผัสก่อนปิดเอง (เฉพาะกรอบที่ไม่ได้ปักด้วยปุ่ม ⓘ) */
const TOUCH_AUTO_HIDE_MS = 4000;

function ensureEl(): HTMLElement {
  if (tipEl && document.body.contains(tipEl)) return tipEl;
  const el = document.createElement('div');
  el.className = 'info-tip';
  el.id = 'info-tip';
  el.setAttribute('role', 'tooltip');
  el.innerHTML = '<div class="it-content"></div><span class="it-caret"></span>';
  document.body.appendChild(el);
  tipEl = el;
  return el;
}

/** กล่องประกาศที่มองไม่เห็นสำหรับโปรแกรมอ่านหน้าจอ — เขียนข้อความลงไปตอนปักกรอบ ⓘ
    ทำไมไม่ประกาศจากตัวกรอบเอง: role=tooltip ไม่ถูกอ่านเมื่อเนื้อหาเปลี่ยน และการเติม aria-live
    ให้กรอบตอนจะโชว์ (ในจังหวะเดียวกับที่ใส่เนื้อหา) โปรแกรมอ่านหน้าจอหลายตัวจะไม่อ่าน
    ต้องเป็นกล่องที่มีอยู่ก่อนแล้วค่อยเปลี่ยนเนื้อหา */
function ensureLive(): HTMLElement {
  if (liveEl && document.body.contains(liveEl)) return liveEl;
  const el = document.createElement('div');
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  // ซ่อนแบบที่โปรแกรมอ่านหน้าจอยังอ่านได้ (display:none / hidden จะถูกข้ามทั้งกล่อง)
  el.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;' +
    'overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';
  document.body.appendChild(el);
  liveEl = el;
  return el;
}

/** แปลง " • " เป็นหลายบรรทัด • บรรทัดที่มี "=" ทำเป็นชิปสูตร */
function bodyHtml(text: string): string {
  return text.split(' • ').map(function (seg) {
    const s = seg.trim();
    if (!s) return '';
    if (s.indexOf('=') >= 0) return '<div class="it-formula">' + esc(s) + '</div>';
    return '<div class="it-line">' + esc(s) + '</div>';
  }).join('');
}

function contentHtml(t: Element): string {
  const tip = t.getAttribute('data-tip') || '';
  const title = t.getAttribute('data-tip-title') || '';
  const formula = t.getAttribute('data-tip-formula') || '';
  const src = t.getAttribute('data-tip-src') || '';
  let h = '';
  if (title) h += '<div class="it-title">' + esc(title) + '</div>';
  if (formula) h += '<div class="it-formula">' + esc(formula) + '</div>';
  if (tip) h += '<div class="it-body">' + bodyHtml(tip) + '</div>';
  if (src) h += '<div class="it-src">' + icon('database', { size: 12 }) + '<span>' + esc(src) + '</span></div>';
  return h;
}

/** ข้อความล้วนของกรอบ (ไว้ประกาศให้โปรแกรมอ่านหน้าจอ) */
function plainText(t: Element): string {
  return ['data-tip-title', 'data-tip-formula', 'data-tip', 'data-tip-src']
    .map(function (a) { return (t.getAttribute(a) || '').split(' • ').join(' — ').trim(); })
    .filter(Boolean).join('. ');
}

/** ย้าย title → data-tip ครั้งแรกที่เจอ (กัน tooltip พื้นฐานของเบราว์เซอร์เด้งซ้อน) */
function migrateTitle(t: Element): void {
  const title = t.getAttribute('title');
  if (title && !t.getAttribute('data-tip')) {
    t.setAttribute('data-tip', title);
    t.removeAttribute('title');
  }
}

function position(clientX: number, clientY: number, below?: number): void {
  const el = tipEl;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const pad = 10;
  const vw = window.innerWidth, vh = window.innerHeight;
  // แนวนอน: กึ่งกลางจุดอ้างอิง แล้ว clamp ไม่ให้ล้นจอ
  let left = clientX - r.width / 2;
  left = Math.max(pad, Math.min(left, vw - r.width - pad));
  // แนวตั้ง: เหนือจุดอ้างอิง ถ้าไม่พอค่อยพลิกลงล่าง (below = ขอบล่างของปุ่ม ⓘ ใช้ตอนพลิก)
  const gap = 14;
  let top = clientY - r.height - gap;
  let flip = false;
  if (top < pad) { top = (below !== undefined ? below : clientY) + gap; flip = true; }
  top = Math.min(top, vh - r.height - pad);
  el.classList.toggle('flip', flip);
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
  // ลูกศรชี้จุดอ้างอิง (สัมพัทธ์กับกล่อง)
  const caret = Math.max(12, Math.min(clientX - left, r.width - 12));
  el.style.setProperty('--caret-x', Math.round(caret) + 'px');
}

function show(t: Element, clientX: number, clientY: number, below?: number): void {
  const el = ensureEl();
  (el.querySelector('.it-content') as HTMLElement).innerHTML = contentHtml(t);
  el.classList.remove('is-on');       // reset transition ก่อนวัดขนาด
  el.classList.toggle('is-pinned', pinned);
  // วัดขนาดจริงก่อนคำนวณตำแหน่ง
  el.style.opacity = '0';
  position(clientX, clientY, below);
  const my = ++seq;
  requestAnimationFrame(function () {
    if (my !== seq || curTarget !== t) return;   // ถูกปิด/สลับเป้าไปแล้วระหว่างรอเฟรม
    el.classList.add('is-on'); el.style.opacity = '';
  });
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (TOUCH && !pinned) hideTimer = setTimeout(hideInfoTip, TOUCH_AUTO_HIDE_MS);
}

/** ปักกรอบไว้ใต้/เหนือปุ่ม ⓘ (ไม่ตามเมาส์) */
function showPinned(btn: Element): void {
  migrateTitle(btn);   // คนใช้คีย์บอร์ดไม่เคย hover — ปุ่มที่ยังเป็น title อยู่ต้องแปลงตรงนี้
  pinned = true;
  curTarget = btn;
  const r = btn.getBoundingClientRect();
  show(btn, r.left + r.width / 2, r.top, r.bottom);
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-describedby', 'info-tip');
  // ประกาศให้โปรแกรมอ่านหน้าจอ — ล้างก่อนแล้วค่อยใส่ในเฟรมถัดไป ข้อความเดิมซ้ำจะได้ถูกอ่านอีกรอบ
  const live = ensureLive();
  live.textContent = '';
  const txt = plainText(btn);
  setTimeout(function () { if (curTarget === btn) live.textContent = txt; }, 60);
}

/** ปิดกรอบ (ทั้งแบบตามเมาส์และแบบปัก) — เรียกจากที่อื่นได้ เช่นตอนสลับหน้า/ปิดเมนู */
export function hideInfoTip(): void {
  if (curTarget && pinned) {
    curTarget.setAttribute('aria-expanded', 'false');
    curTarget.removeAttribute('aria-describedby');
  }
  curTarget = null;
  pinned = false;
  seq++;
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (tipEl) tipEl.classList.remove('is-on', 'is-pinned');
}

/** มีกรอบอธิบายเปิดอยู่ไหม — app-core ใช้ตัดสินว่า Esc ควรปิดกรอบก่อน (ไม่ใช่ปิดหน้าต่างทั้งอัน) */
export function infoTipOpen(): boolean {
  return !!curTarget;
}

export function bindInfoTips(): void {
  document.addEventListener('mouseover', function (e) {
    const raw = (e.target as Element | null);
    if (!raw || !raw.closest) return;
    if (pinned) return;   // มีกรอบปักอยู่ — ไม่ให้การขยับเมาส์ผ่านที่อื่นมาแย่ง/ปิดกรอบนั้น
    // เมนูข้าง: ปล่อยให้เป็น tooltip ธรรมดาของเบราว์เซอร์ (มีหน่วงเวลาในตัว)
    // ไม่งั้นลากเมาส์ผ่านเมนู 12 อันแล้วกรอบเด้งตามทุกอัน รกตา
    if (raw.closest('.sidebar')) return;
    // แปลง title ของ element ใต้เมาส์ (และ ancestor ที่ใกล้สุด) ก่อนหา data-tip
    let node: Element | null = raw;
    for (let i = 0; node && i < 4; i++) { migrateTitle(node); node = node.parentElement; }
    const t = raw.closest('[data-tip]');
    if (!t || t === curTarget) return;
    // อุปกรณ์สัมผัส: ถ้าสิ่งที่แตะเป็นปุ่ม/ลิงก์อยู่แล้ว อย่าเด้งกรอบอธิบายขึ้นมา
    // นิ้วแตะเพื่อ "สั่งงาน" ไม่ใช่เพื่อ "ขอคำอธิบาย" — และพอปุ่มนั้นหายไป (เช่น เมนูปิด)
    // ก็ไม่มี mouseout มาสั่งปิด กรอบเลยค้างกลางจอ (ปุ่ม ⓘ เปิดผ่าน click ข้างล่างแทน)
    if (TOUCH && raw.closest('button, a[href], input, select, [role="button"]')) return;
    curTarget = t;
    show(t, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mousemove', function (e) {
    if (curTarget && tipEl && !pinned) position((e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mouseout', function (e) {
    if (pinned) return;
    const to = (e as MouseEvent).relatedTarget as Element | null;
    if (curTarget && (!to || !to.closest || !to.closest('[data-tip]'))) hideInfoTip();
  });

  // คลิก/แตะ/Enter/Space ที่ปุ่ม ⓘ = ปัก/ถอดกรอบ (ปุ่ม <button> แปลง Enter/Space เป็น click ให้เอง)
  document.addEventListener('click', function (e) {
    const t = e.target as Element | null;
    const btn = t && t.closest ? t.closest(INFO_SEL) : null;
    if (!btn) return;
    // ปุ่ม ⓘ มักวางอยู่ในหัวคอลัมน์ที่กดเรียงได้ / การ์ดที่กดเจาะได้ — กดดูคำอธิบายต้องไม่ไปสั่งงานเหล่านั้นด้วย
    e.preventDefault();
    e.stopPropagation();
    if (pinned && curTarget === btn) { hideInfoTip(); return; }
    hideInfoTip();
    showPinned(btn);
  }, true);
  // ⓘ ที่ไม่ใช่ <button> (เช่น span tabindex=0) ต้องรับ Enter/Space เอง
  document.addEventListener('keydown', function (e) {
    const k = (e as KeyboardEvent).key;
    if (k !== 'Enter' && k !== ' ') return;
    const t = e.target as Element | null;
    if (!t || !t.matches || !t.matches(INFO_SEL) || t.tagName === 'BUTTON') return;
    e.preventDefault();
    if (pinned && curTarget === t) hideInfoTip(); else { hideInfoTip(); showPinned(t); }
  });

  // ซ่อนตอนสกอลล์ (ทั้งหน้าและกล่องเลื่อนข้างใน) กันกรอบค้างลอยห่างจากของที่มันอธิบาย
  window.addEventListener('scroll', function () { if (curTarget) hideInfoTip(); }, true);
  // แตะที่อื่น = ปิด (บนมือถือนี่คือทางเดียวที่ผู้ใช้จะสั่งปิดได้ เพราะไม่มี "เอาเมาส์ออก")
  // แตะในตัวกรอบเอง (เช่น ลากเลือกข้อความสูตร) ไม่นับเป็น "ที่อื่น"
  document.addEventListener('pointerdown', function (e) {
    if (!curTarget) return;
    const t = e.target as Element | null;
    if (t && tipEl && tipEl.contains(t)) return;
    if (!t || typeof t.closest !== 'function' || t.closest('[data-tip]') !== curTarget) hideInfoTip();
  }, true);
  // Esc ปิดกรอบ — capture + preventDefault เพื่อบอกตัวจัดการ Esc อื่น (app-core ปิดหน้าต่าง/เมนู)
  // ว่า "กดครั้งนี้ใช้ไปแล้ว" หน้าต่างที่กรอบลอยอยู่ข้างบนจะไม่ถูกปิดตามไปด้วย
  document.addEventListener('keydown', function (e) {
    if ((e as KeyboardEvent).key !== 'Escape' || !curTarget) return;
    const wasPinned = pinned;
    const btn = curTarget as HTMLElement;
    hideInfoTip();
    e.preventDefault();
    if (wasPinned && btn && typeof btn.focus === 'function' && btn.isConnected) btn.focus();
  }, true);
}
