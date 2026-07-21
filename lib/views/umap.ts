/* ============================================================
   umap — หน้า 6: U Map (แอดมินอยู่ U ไหน)
   หน้าอ้างอิงกันลืม สไตล์ "เกมจับคู่": คลิกเลือกแอดมินฝั่งซ้าย
   แล้วคลิกการ์ด U ฝั่งขวาเพื่อจับคู่ — ข้อมูลเก็บใน DB (sync_state)
   มี API สาธารณะ /api/public/umap ให้ระบบภายนอกดึงไปใช้
   + โหมด 🎮 ทดสอบความจำ (ทายคู่ U ↔ ผลิตภัณฑ์) ไว้ท่องจำกันลืม
   ============================================================ */

import {
  serverCall, esc, relTime, showError, toast, openModal, closeModal, tagColor,
} from '@/lib/ui/helpers';
import { umapSkel } from '@/lib/ui/skeletons';

/* ---------------- data types (apiUMap) ---------------- */

interface UMember { id: string; name: string }
interface UUnit { u: string; product: string; admins: UMember[] }
interface UMapData {
  ok?: boolean;
  error?: string;
  units?: UUnit[];
  roster?: UMember[];
  updatedAt?: string;
  publicNeedsKey?: boolean; // server ตั้ง UMAP_PUBLIC_KEY ไว้ → ลิงก์สาธารณะต้องแนบ ?key=
}

/* ---------------- closure state ---------------- */

let lastData: UMapData | null = null;
let selected: UMember | null = null;  // แอดมินที่ถูกเลือกไว้รอจับคู่
let search = '';                      // ค้นหาแอดมินฝั่งซ้าย
let reqSeq = 0;                       // กันผลลัพธ์เก่ามาทับผลลัพธ์ใหม่
let saving = false;                   // มีคำสั่งกำลังยิงอยู่ (คิวกำลังไหล)
// คิว FIFO ของคำสั่งแก้ข้อมูล — hint บอกว่า "คลิกได้หลายการ์ดติดกัน" ดังนั้นคลิกระหว่าง
// รอ server ต้องเข้าคิวยิงตามลำดับ ไม่ใช่ถูกทิ้งเงียบๆ (server ~1-3 วิ/คำสั่ง)
const pending: Array<{ params: Record<string, unknown>; okMsg: string }> = [];

/* ---------------- ชิ้นส่วน HTML ---------------- */

/** จำนวน U ที่แอดมินแต่ละคนถืออยู่ (id → จำนวน) */
function unitCountByAdmin_(units: UUnit[]): Map<string, number> {
  const m = new Map<string, number>();
  units.forEach((x) => x.admins.forEach((a) => m.set(a.id, (m.get(a.id) || 0) + 1)));
  return m;
}

function toolbarHtml(): string {
  return '<div class="pg-controls">' +
    '<input class="input" id="u-search" placeholder="🔎 ค้นหาแอดมิน..." value="' + esc(search) + '" style="width:220px">' +
    '<button class="btn primary" id="u-add">➕ เพิ่ม U</button>' +
    '<button class="btn" id="u-quiz" title="เกมทายคู่ U ↔ ผลิตภัณฑ์ ไว้ท่องจำ">🎮 ทดสอบความจำ</button>' +
    '<div class="spacer"></div>' +
    '<button class="btn" id="u-api" title="API สาธารณะสำหรับระบบภายนอก (GET, ไม่ต้องใส่รหัสทีม)">🔗 คัดลอกลิงก์ API</button>' +
    '</div>';
}

/** id แอดมินที่ยังทำงานอยู่จริง (อยู่ใน roster) — ใช้แยก "แอดมินผี" ที่ถูกปิด/ออกไปแล้ว */
function rosterIds_(roster: UMember[]): Set<string> {
  return new Set(roster.map((a) => a.id));
}

function statsHtml(units: UUnit[], roster: UMember[]): string {
  const ids = rosterIds_(roster);
  // นับเฉพาะแอดมินที่ยังทำงานอยู่ — คนที่ถูกปิดใช้งาน/ออกแล้วไม่ถือว่า "ประจำ"
  // (ถ้า roster ว่าง = sync ยังไม่มา ตรวจไม่ได้ ให้นับตามที่บันทึกไว้)
  const isActive = (m: UMember) => !roster.length || ids.has(m.id);
  const withAdmin = units.filter((x) => x.admins.some(isActive)).length;
  const assigned = new Set<string>();
  units.forEach((x) => x.admins.forEach((a) => assigned.add(a.id)));
  const freeAdmins = roster.filter((a) => !assigned.has(a.id)).length;
  return '<div class="umap-stats">' +
    '<div class="tile">U ทั้งหมด<b>' + units.length + '</b></div>' +
    '<div class="tile">มีแอดมินประจำแล้ว<b>' + withAdmin + ' / ' + units.length + ' U</b></div>' +
    '<div class="tile">แอดมินที่ยังไม่มี U<b>' + freeAdmins + ' คน</b></div>' +
    '</div>';
}

function hintHtml(): string {
  if (!selected) return '';
  return '<div class="umap-hint">🎯 กำลังจับคู่: <b>' + esc(selected.name) + '</b>' +
    ' — คลิกการ์ด U ฝั่งขวาเพื่อวางลง (คลิกได้หลายการ์ดติดกัน)' +
    '<button class="btn-mini" id="u-cancel-sel" style="margin-left:10px">✕ เลิกเลือก</button></div>';
}

function adminListHtml(units: UUnit[], roster: UMember[]): string {
  const counts = unitCountByAdmin_(units);
  const q = search.trim().toLowerCase();
  const list = q ? roster.filter((a) => a.name.toLowerCase().includes(q)) : roster;
  if (!roster.length) return '<div class="empty-note">ยังไม่มีรายชื่อแอดมิน (รอ sync จาก Pancake)</div>';
  if (!list.length) return '<div class="empty-note">ไม่พบแอดมินชื่อ "' + esc(search) + '"</div>';
  return list.map((a) => {
    const n = counts.get(a.id) || 0;
    const sel = selected && selected.id === a.id;
    return '<button class="admin-pick' + (sel ? ' selected' : '') + '" data-id="' + esc(a.id) + '">' +
      '<span class="pdot" style="background:' + tagColor(a.name) + '"></span>' +
      '<span class="nm">' + esc(a.name) + '</span>' +
      (n > 0
        ? '<span class="cnt">' + n + ' U</span>'
        : '<span class="cnt none">ยังไม่มี U</span>') +
      '</button>';
  }).join('');
}

function memberChip_(u: string, m: UMember, ghost: boolean): string {
  return '<span class="u-member' + (ghost ? ' ghost" title="ไม่อยู่ในรายชื่อแอดมินแล้ว (ถูกปิดใช้งาน/ออก) — กด ✕ เพื่อเอาออก' : '') + '">' +
    '<span class="pdot" style="background:' + tagColor(m.name) + '"></span>' +
    (ghost ? '⛔ ' : '') + esc(m.name) +
    '<span class="x" data-u="' + esc(u) + '" data-id="' + esc(m.id) + '" title="เอา ' +
      esc(m.name) + ' ออกจาก ' + esc(u) + '">✕</span>' +
    '</span>';
}

function uCardHtml(x: UUnit, ids: Set<string>, hasRoster: boolean): string {
  const droppable = !!selected && !x.admins.some((m) => m.id === selected!.id);
  const members = x.admins.length
    ? x.admins.map((m) => memberChip_(x.u, m, hasRoster && !ids.has(m.id))).join('')
    : '<span class="u-empty">ยังว่าง — ไม่มีแอดมินประจำ</span>';
  return '<div class="u-card' + (droppable ? ' droppable' : '') + '" data-u="' + esc(x.u) + '">' +
    '<div class="u-tools">' +
      '<button class="u-tool-btn" data-act="edit" data-u="' + esc(x.u) + '" title="แก้ชื่อผลิตภัณฑ์">✏️</button>' +
      '<button class="u-tool-btn" data-act="del" data-u="' + esc(x.u) + '" title="ลบ U นี้">🗑</button>' +
    '</div>' +
    '<div class="u-code">' + esc(x.u) + '</div>' +
    '<div class="u-product">' + esc(x.product || '—') + '</div>' +
    '<div class="u-members">' + members + '</div>' +
    '</div>';
}

function boardHtml(units: UUnit[], roster: UMember[]): string {
  if (!units.length) {
    return '<div class="card"><div class="empty-note">ยังไม่มี U — กด ➕ เพิ่ม U เพื่อเริ่มต้น</div></div>';
  }
  const ids = rosterIds_(roster);
  return '<div class="u-grid">' +
    units.map((x) => uCardHtml(x, ids, roster.length > 0)).join('') + '</div>';
}

function bodyHtml(data: UMapData): string {
  const units = data.units || [];
  const roster = data.roster || [];
  return toolbarHtml() +
    statsHtml(units, roster) +
    hintHtml() +
    '<div class="umap-layout">' +
      '<div class="card umap-side">' +
        '<h3>👥 แอดมิน (' + roster.length + ')</h3>' +
        '<div class="card-sub">คลิกเลือกแอดมิน แล้วคลิกการ์ด U ฝั่งขวาเพื่อจับคู่</div>' +
        '<div id="u-admin-list" class="u-admin-list">' + adminListHtml(units, roster) + '</div>' +
        '<div class="umap-upd">อัปเดตล่าสุด ' + esc(relTime(data.updatedAt)) + '</div>' +
      '</div>' +
      '<div id="u-board">' + boardHtml(units, roster) + '</div>' +
    '</div>';
}

/* ---------------- mutations ---------------- */

/** เข้าคิวคำสั่งแก้ข้อมูล — ยิงตามลำดับทีละคำสั่ง res.units คือความจริงเสมอ (server ตัดสิน) */
function mutate(container: HTMLElement, params: Record<string, unknown>, okMsg: string): void {
  // กันคำสั่งซ้ำเป๊ะที่ค้างคิวอยู่แล้ว (เช่น ดับเบิลคลิกการ์ดเดิมก่อนผลกลับ)
  const sig = JSON.stringify(params);
  if (pending.some((p) => JSON.stringify(p.params) === sig)) return;
  pending.push({ params, okMsg });
  if (!saving) drainQueue_(container);
}

function drainQueue_(container: HTMLElement): void {
  const next = pending.shift();
  if (!next) { saving = false; return; }
  saving = true;
  serverCall<UMapData>('apiUMap', next.params).then((res) => {
    if (!res || res.ok === false) {
      toast('⚠️ ' + ((res && res.error) || 'บันทึกไม่สำเร็จ'));
    } else {
      reqSeq++; // ตัด read เก่าที่ค้างกลางอากาศทิ้ง — กันข้อมูล stale มาทับผลที่เพิ่งบันทึก
      if (lastData) {
        lastData.units = res.units || [];
        lastData.updatedAt = res.updatedAt;
      }
      if (next.okMsg) toast(next.okMsg);
      render(container);
    }
    drainQueue_(container);
  }).catch((err) => {
    toast('⚠️ บันทึกไม่สำเร็จ: ' + ((err && err.message) || 'ไม่ทราบสาเหตุ'));
    drainQueue_(container);
  });
}

/* ---------------- modals: เพิ่ม / แก้ / ลบ U ---------------- */

function openAddUnit(container: HTMLElement): void {
  openModal(
    '<div class="modal-head"><h3>➕ เพิ่ม U ใหม่</h3><button class="modal-close">✕</button></div>' +
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<label style="font-size:12.5px;color:var(--text-2)">รหัส U (เช่น U27, UN12)' +
        '<input class="input" id="uadd-code" maxlength="12" placeholder="U27" style="width:100%;margin-top:5px"></label>' +
      '<label style="font-size:12.5px;color:var(--text-2)">ชื่อผลิตภัณฑ์' +
        '<input class="input" id="uadd-product" maxlength="120" placeholder="ชื่อสินค้า/แบรนด์" style="width:100%;margin-top:5px"></label>' +
    '</div>' +
    '<div class="modal-actions">' +
      '<button class="btn" id="uadd-cancel">ยกเลิก</button>' +
      '<button class="btn primary" id="uadd-save">💾 เพิ่ม</button>' +
    '</div>'
  );
  const root = document.getElementById('modal-root')!;
  const cancel = root.querySelector('#uadd-cancel');
  if (cancel) cancel.addEventListener('click', closeModal);
  const code = root.querySelector('#uadd-code') as HTMLInputElement | null;
  if (code) code.focus();
  const save = root.querySelector('#uadd-save') as HTMLButtonElement | null;
  if (save) save.addEventListener('click', () => {
    const u = ((root.querySelector('#uadd-code') as HTMLInputElement | null)?.value || '').trim().toUpperCase();
    const product = ((root.querySelector('#uadd-product') as HTMLInputElement | null)?.value || '').trim();
    if (!/^[A-Z0-9-]{1,12}$/.test(u)) { toast('⚠️ รหัส U ใช้ได้เฉพาะตัวอักษร/ตัวเลข เช่น U27, UN12'); return; }
    if (!product) { toast('⚠️ กรอกชื่อผลิตภัณฑ์ด้วย'); return; }
    closeModal();
    mutate(container, { action: 'addUnit', u, product }, '➕ เพิ่ม ' + u + ' — ' + product + ' แล้ว');
  });
}

function openEditUnit(container: HTMLElement, u: string): void {
  const unit = (lastData && lastData.units || []).find((x) => x.u === u);
  if (!unit) return;
  openModal(
    '<div class="modal-head"><h3>✏️ แก้ชื่อผลิตภัณฑ์ของ ' + esc(u) + '</h3><button class="modal-close">✕</button></div>' +
    '<input class="input" id="uedit-product" maxlength="120" value="' + esc(unit.product) + '" style="width:100%">' +
    '<div class="modal-actions">' +
      '<button class="btn" id="uedit-cancel">ยกเลิก</button>' +
      '<button class="btn primary" id="uedit-save">💾 บันทึก</button>' +
    '</div>'
  );
  const root = document.getElementById('modal-root')!;
  const cancel = root.querySelector('#uedit-cancel');
  if (cancel) cancel.addEventListener('click', closeModal);
  const save = root.querySelector('#uedit-save') as HTMLButtonElement | null;
  if (save) save.addEventListener('click', () => {
    const product = ((root.querySelector('#uedit-product') as HTMLInputElement | null)?.value || '').trim();
    if (!product) { toast('⚠️ กรอกชื่อผลิตภัณฑ์ด้วย'); return; }
    closeModal();
    mutate(container, { action: 'editUnit', u, product }, '✏️ แก้ ' + u + ' เป็น "' + product + '" แล้ว');
  });
}

function openRemoveUnit(container: HTMLElement, u: string): void {
  const unit = (lastData && lastData.units || []).find((x) => x.u === u);
  if (!unit) return;
  const warn = unit.admins.length
    ? '<div style="font-size:12.5px;color:var(--amber);margin-top:8px">⚠️ มีแอดมินประจำอยู่ ' +
      unit.admins.length + ' คน — การจับคู่ของ U นี้จะหายไปด้วย</div>'
    : '';
  openModal(
    '<div class="modal-head"><h3>🗑 ลบ ' + esc(u) + '?</h3><button class="modal-close">✕</button></div>' +
    '<div style="font-size:13px">' + esc(u) + ' — ' + esc(unit.product || '(ไม่มีชื่อผลิตภัณฑ์)') + '</div>' + warn +
    '<div class="modal-actions">' +
      '<button class="btn" id="udel-cancel">ยกเลิก</button>' +
      '<button class="btn primary" id="udel-yes" style="background:var(--red);border-color:var(--red)">🗑 ลบเลย</button>' +
    '</div>'
  );
  const root = document.getElementById('modal-root')!;
  const cancel = root.querySelector('#udel-cancel');
  if (cancel) cancel.addEventListener('click', closeModal);
  const yes = root.querySelector('#udel-yes');
  if (yes) yes.addEventListener('click', () => {
    closeModal();
    mutate(container, { action: 'removeUnit', u }, '🗑 ลบ ' + u + ' แล้ว');
  });
}

/* ---------------- 🎮 เกมทดสอบความจำ (client-only, ไม่แตะ DB) ---------------- */

function shuffle_<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function openQuiz(): void {
  const pool = ((lastData && lastData.units) || []).filter((x) => x.product);
  if (pool.length < 4) { toast('⚠️ ต้องมี U ที่มีชื่อผลิตภัณฑ์อย่างน้อย 4 ตัวถึงจะเล่นได้'); return; }
  const total = Math.min(10, pool.length);
  const qs = shuffle_(pool).slice(0, total);
  let idx = 0;
  let score = 0;

  openModal(
    '<div class="modal-head"><h3>🎮 ทดสอบความจำ U</h3><button class="modal-close">✕</button></div>' +
    '<div id="quiz-body"></div>'
  );
  const root = document.getElementById('modal-root')!;
  const body = root.querySelector('#quiz-body') as HTMLElement | null;
  if (!body) return;

  function renderEnd(): void {
    const pct = Math.round((score / total) * 100);
    const emoji = pct >= 90 ? '🏆 สุดยอด จำแม่นมาก!' :
      pct >= 70 ? '👍 เก่งมาก เกือบครบแล้ว' :
      pct >= 50 ? '🙂 ครึ่งๆ — เล่นอีกรอบให้จำขึ้นใจ' : '📚 ยังจำสลับอยู่ ลองอีกรอบ!';
    body!.innerHTML =
      '<div style="text-align:center;padding:18px 6px">' +
        '<div style="font-size:38px;font-weight:800">' + score + ' / ' + total + '</div>' +
        '<div style="font-size:13px;color:var(--text-2);margin-top:8px">' + emoji + '</div>' +
      '</div>' +
      '<div class="modal-actions">' +
        '<button class="btn" id="quiz-close">ปิด</button>' +
        '<button class="btn primary" id="quiz-again">🔁 เล่นอีกรอบ</button>' +
      '</div>';
    const c = body!.querySelector('#quiz-close');
    if (c) c.addEventListener('click', closeModal);
    const g = body!.querySelector('#quiz-again');
    if (g) g.addEventListener('click', () => { closeModal(); openQuiz(); });
  }

  function renderQ(): void {
    if (idx >= total) { renderEnd(); return; }
    const unit = qs[idx];
    // สลับ 2 แบบ: เห็นชื่อสินค้า→ทาย U | เห็น U→ทายชื่อสินค้า
    const askCode = Math.random() < 0.5;
    const correct = askCode ? unit.u : unit.product;
    // ตัวหลอกต้องไม่ซ้ำกันเอง และห้ามเป็นคำตอบที่ "ถูกจริง" อีกทาง
    // (สินค้าชื่อเดียวกันอยู่หลาย U — ถามชื่อสินค้านั้นแล้ว U อื่นก็ถูกด้วย ห้ามเอามาหลอก)
    const seen = new Set<string>([correct]);
    const others: string[] = [];
    for (const x of shuffle_(pool)) {
      if (x.u === unit.u) continue;
      if (askCode && x.product === unit.product) continue;
      const v = askCode ? x.u : x.product;
      if (seen.has(v)) continue;
      seen.add(v);
      others.push(v);
      if (others.length >= 3) break;
    }
    const choices = shuffle_([correct].concat(others));
    const question = askCode
      ? '«<b>' + esc(unit.product) + '</b>» อยู่ U ไหน?'
      : '<b>' + esc(unit.u) + '</b> คือผลิตภัณฑ์อะไร?';
    body!.innerHTML =
      '<div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-3);margin-bottom:10px">' +
        '<span>ข้อ ' + (idx + 1) + ' / ' + total + '</span><span>คะแนน ' + score + '</span></div>' +
      '<div style="font-size:15px;margin-bottom:6px">' + question + '</div>' +
      choices.map((c) => '<button class="quiz-opt" data-v="' + esc(c) + '">' + esc(c) + '</button>').join('');
    body!.querySelectorAll<HTMLButtonElement>('.quiz-opt').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (body!.querySelector('.quiz-opt.correct')) return; // ตอบไปแล้ว — รอข้อถัดไป
        const v = btn.getAttribute('data-v') || '';
        const right = v === correct;
        if (right) score++;
        body!.querySelectorAll<HTMLButtonElement>('.quiz-opt').forEach((b) => {
          if ((b.getAttribute('data-v') || '') === correct) b.classList.add('correct');
          b.disabled = true;
        });
        if (!right) btn.classList.add('wrong');
        idx++;
        setTimeout(renderQ, right ? 550 : 1100); // ตอบผิดให้เวลาดูเฉลยนานหน่อย
      });
    });
  }

  renderQ();
}

/* ---------------- คัดลอกลิงก์ API สาธารณะ ---------------- */

function copyApiLink(): void {
  const url = location.origin + '/api/public/umap';
  // ถ้า server ตั้ง UMAP_PUBLIC_KEY ไว้ ลิงก์เปล่าๆ จะโดน 401 — บอกความจริง อย่าโม้ว่าเปิดฟรี
  const note = (lastData && lastData.publicNeedsKey)
    ? ' (ต้องแนบ ?key=<รหัส> ที่ตั้งไว้ใน UMAP_PUBLIC_KEY ด้วย)'
    : ' (ไม่ต้องใส่รหัสทีม)';
  const fallback = () => { window.prompt('คัดลอกลิงก์ API (Ctrl+C):', url); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url)
      .then(() => toast('📋 คัดลอกแล้ว — GET ' + url + note))
      .catch(fallback);
  } else fallback();
}

/* ---------------- render + events ---------------- */

function bindEvents(container: HTMLElement): void {
  // ค้นหาแอดมิน — วาดเฉพาะ list ฝั่งซ้าย ไม่ทั้งหน้า (โฟกัสช่องพิมพ์ต้องไม่หลุด)
  const searchInp = container.querySelector('#u-search') as HTMLInputElement | null;
  if (searchInp) searchInp.addEventListener('input', () => {
    search = searchInp.value;
    const list = container.querySelector('#u-admin-list') as HTMLElement | null;
    if (list && lastData) list.innerHTML = adminListHtml(lastData.units || [], lastData.roster || []);
  });

  // เลือก/เลิกเลือกแอดมิน (delegate — list ถูกวาดใหม่ได้จากช่องค้นหา)
  const adminList = container.querySelector('#u-admin-list');
  if (adminList) adminList.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.admin-pick') as HTMLElement | null;
    if (!btn || !lastData) return;
    const id = btn.getAttribute('data-id') || '';
    const a = (lastData.roster || []).find((x) => x.id === id) || null;
    selected = (selected && selected.id === id) ? null : a;
    render(container);
  });

  // กระดาน U: จับคู่ / เอาออก / แก้ / ลบ (delegate)
  const board = container.querySelector('#u-board');
  if (board) board.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const x = t.closest('.x') as HTMLElement | null;
    if (x) {
      mutate(container, { action: 'unassign', u: x.getAttribute('data-u'), userId: x.getAttribute('data-id') },
        '✂️ เอาออกจาก ' + (x.getAttribute('data-u') || '') + ' แล้ว');
      return;
    }
    const tool = t.closest('.u-tool-btn') as HTMLElement | null;
    if (tool) {
      const u = tool.getAttribute('data-u') || '';
      if (tool.getAttribute('data-act') === 'edit') openEditUnit(container, u);
      else openRemoveUnit(container, u);
      return;
    }
    const card = t.closest('.u-card') as HTMLElement | null;
    if (!card) return;
    const u = card.getAttribute('data-u') || '';
    if (!selected) { toast('👈 เลือกแอดมินฝั่งซ้ายก่อน แล้วค่อยคลิกการ์ด U'); return; }
    const unit = (lastData && lastData.units || []).find((it) => it.u === u);
    if (unit && unit.admins.some((m) => m.id === selected!.id)) {
      toast('ℹ️ ' + selected.name + ' อยู่ใน ' + u + ' อยู่แล้ว');
      return;
    }
    mutate(container, { action: 'assign', u, userId: selected.id },
      '🔗 จับคู่ ' + selected.name + ' ↔ ' + u + ' แล้ว');
  });

  const cancelSel = container.querySelector('#u-cancel-sel');
  if (cancelSel) cancelSel.addEventListener('click', () => { selected = null; render(container); });

  const add = container.querySelector('#u-add');
  if (add) add.addEventListener('click', () => openAddUnit(container));
  const quiz = container.querySelector('#u-quiz');
  if (quiz) quiz.addEventListener('click', openQuiz);
  const api = container.querySelector('#u-api');
  if (api) api.addEventListener('click', copyApiLink);
}

function render(container: HTMLElement): void {
  const data = lastData || {};
  // กัน ghost selection: แอดมินที่เลือกไว้อาจหายจาก roster (ถูกปิดใช้งาน) หลัง refetch
  if (selected && !(data.roster || []).some((a) => a.id === selected!.id)) selected = null;
  container.innerHTML = bodyHtml(data);
  bindEvents(container);
}

function fetchAndRender(container: HTMLElement): void {
  const seq = ++reqSeq;
  serverCall<UMapData>('apiUMap').then((data) => {
    if (seq !== reqSeq) return;
    lastData = data;
    // มี modal เปิดอยู่ (กำลังเล่นเกม/กรอกฟอร์ม) — อย่าวาดทับหน้า ข้อมูลใหม่รอรอบถัดไป
    const modalRoot = document.getElementById('modal-root');
    if (modalRoot && modalRoot.innerHTML) return;
    // ผู้ใช้กำลังพิมพ์ในช่องบนหน้านี้ (เช่นช่องค้นหา) — วาดทับตอนนี้จะแย่งโฟกัส/ตัวอักษรหาย
    const ae = document.activeElement;
    if (ae && container.contains(ae) &&
        (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return;
    render(container);
  }).catch((err) => {
    if (seq !== reqSeq) return;
    if (lastData) {
      toast('⚠️ โหลดข้อมูลใหม่ไม่สำเร็จ: ' + ((err && err.message) || 'ไม่ทราบสาเหตุ'));
    } else {
      showError(container, (err && err.message) || 'เรียกข้อมูลไม่สำเร็จ', () => {
        umap.load(container, true);
      });
    }
  });
}

/* ---------------- ลงทะเบียน view ---------------- */

export const umap = {
  load: async (container: HTMLElement, force?: boolean): Promise<void> => {
    if (lastData && !force) {
      render(container);               // แสดงจาก cache ทันที
      fetchAndRender(container);       // แล้วดึงข้อมูลใหม่เบื้องหลัง
    } else {
      container.innerHTML = umapSkel();
      fetchAndRender(container);
    }
  },
};
