// lib/ui/infotip.ts — tooltip กรอบลอยอธิบาย "สูตร/ความหมาย" ของค่าต่างๆ ทุกหน้า
//
// ผูกครั้งเดียวจาก App.init() ด้วย bindInfoTips() — ใช้ event delegation ที่ document
// จึงครอบคลุม element ที่ view สร้างใหม่ผ่าน innerHTML โดยไม่ต้อง rebind
//
// เป้าหมาย = element ที่มี data-tip (แนะนำ) — เขียนสูตรชัดๆ ได้ผ่าน:
//   data-tip           ข้อความอธิบาย (บังคับ) — ตัวคั่น " • " จะขึ้นบรรทัดใหม่ให้
//   data-tip-title     หัวข้อ (ไม่บังคับ)
//   data-tip-formula   บรรทัดสูตร เช่น "ออเดอร์ ÷ ลูกค้าที่คุยทั้งหมด" (ไม่บังคับ)
//   data-tip-src       แหล่งข้อมูล เช่น "จาก Meta Ads API" (ไม่บังคับ)
//
// ของเดิมที่ใช้ title="" อยู่แล้ว: แปลงให้อัตโนมัติตอน hover ครั้งแรก (ย้าย title → data-tip
// แล้วลบ title กัน tooltip ซ้อนของเบราว์เซอร์) — ทุกคำอธิบายเดิมเลยกลายเป็นกรอบสวยทันที

import { esc } from './helpers';

let tipEl: HTMLElement | null = null;
let curTarget: Element | null = null;

function ensureEl(): HTMLElement {
  if (tipEl) return tipEl;
  const el = document.createElement('div');
  el.className = 'info-tip';
  el.setAttribute('role', 'tooltip');
  el.innerHTML = '<div class="it-content"></div><span class="it-caret"></span>';
  document.body.appendChild(el);
  tipEl = el;
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
  if (src) h += '<div class="it-src">📊 ' + esc(src) + '</div>';
  return h;
}

/** ย้าย title → data-tip ครั้งแรกที่เจอ (กัน tooltip พื้นฐานของเบราว์เซอร์เด้งซ้อน) */
function migrateTitle(t: Element): void {
  const title = t.getAttribute('title');
  if (title && !t.getAttribute('data-tip')) {
    t.setAttribute('data-tip', title);
    t.removeAttribute('title');
  }
}

function position(clientX: number, clientY: number): void {
  const el = tipEl;
  if (!el) return;
  const r = el.getBoundingClientRect();
  const pad = 10;
  const vw = window.innerWidth, vh = window.innerHeight;
  // แนวนอน: กึ่งกลางเคอร์เซอร์ แล้ว clamp ไม่ให้ล้นจอ
  let left = clientX - r.width / 2;
  left = Math.max(pad, Math.min(left, vw - r.width - pad));
  // แนวตั้ง: เหนือเคอร์เซอร์ ถ้าไม่พอค่อยพลิกลงล่าง
  const gap = 14;
  let top = clientY - r.height - gap;
  let flip = false;
  if (top < pad) { top = clientY + gap; flip = true; }
  top = Math.min(top, vh - r.height - pad);
  el.classList.toggle('flip', flip);
  el.style.left = Math.round(left) + 'px';
  el.style.top = Math.round(top) + 'px';
  // ลูกศรชี้ตำแหน่งเคอร์เซอร์ (สัมพัทธ์กับกล่อง)
  const caret = Math.max(12, Math.min(clientX - left, r.width - 12));
  el.style.setProperty('--caret-x', Math.round(caret) + 'px');
}

function show(t: Element, clientX: number, clientY: number): void {
  const el = ensureEl();
  (el.querySelector('.it-content') as HTMLElement).innerHTML = contentHtml(t);
  el.classList.remove('is-on');       // reset transition ก่อนวัดขนาด
  // วัดขนาดจริงก่อนคำนวณตำแหน่ง
  el.style.opacity = '0';
  position(clientX, clientY);
  requestAnimationFrame(function () { el.classList.add('is-on'); el.style.opacity = ''; });
}

export function hideInfoTip(): void {
  curTarget = null;
  if (tipEl) tipEl.classList.remove('is-on');
}

export function bindInfoTips(): void {
  document.addEventListener('mouseover', function (e) {
    const raw = (e.target as Element | null);
    if (!raw || !raw.closest) return;
    // แปลง title ของ element ใต้เมาส์ (และ ancestor ที่ใกล้สุด) ก่อนหา data-tip
    let node: Element | null = raw;
    for (let i = 0; node && i < 4; i++) { migrateTitle(node); node = node.parentElement; }
    const t = raw.closest('[data-tip]');
    if (!t || t === curTarget) return;
    curTarget = t;
    show(t, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mousemove', function (e) {
    if (curTarget && tipEl) position((e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mouseout', function (e) {
    const to = (e as MouseEvent).relatedTarget as Element | null;
    if (curTarget && (!to || !to.closest || !to.closest('[data-tip]'))) hideInfoTip();
  });
  // ซ่อนตอนสกอลล์/สลับหน้า กันกรอบค้างลอย
  window.addEventListener('scroll', hideInfoTip, true);
}
