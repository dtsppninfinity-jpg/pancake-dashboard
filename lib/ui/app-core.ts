/* ============================================================
   app-core — App core + view registry (port จาก JsCommon.html)
   รันบน browser เท่านั้น — client TS ESM
   - ลงทะเบียน Views ทั้ง 5 (import จาก @/lib/views/*)
   - แนบ App / VIEW_META ไว้บน globalThis เพื่อให้ไฟล์ view อ้างถึงได้ (กัน import cycle)
   - serverCall / esc / relTime / toast มาจาก helpers
   ============================================================ */

import { serverCall, esc, relTime, toast } from '@/lib/ui/helpers';
import { hideChartTip } from '@/lib/ui/charts';
import { bindInfoTips, hideInfoTip } from '@/lib/ui/infotip';
import { dashboard } from '@/lib/views/dashboard';
import { sales } from '@/lib/views/sales';
import { contentads } from '@/lib/views/contentads';
import { admins } from '@/lib/views/admins';
import { adminperf } from '@/lib/views/adminperf';
import { kpi } from '@/lib/views/kpi';
import { profit } from '@/lib/views/profit';
import { report } from '@/lib/views/report';
import { umap } from '@/lib/views/umap';
import { me } from '@/lib/views/me';
import { users } from '@/lib/views/users';

/* ---------------- types ---------------- */

interface ViewModule {
  load: (container: HTMLElement, force: boolean) => void | Promise<void>;
}

interface SyncLogEntry {
  ts: string;
  job: string;
  ok: boolean;
}

interface Bootstrap {
  lastSync?: SyncLogEntry[];
  [k: string]: unknown;
}

/* ---------------- view registry ---------------- */

// แต่ละไฟล์ view export { load } — ผูกเข้า registry ตามชื่อ key เดิม (เทียบ Views.<name> ใน GAS)
const Views: Record<string, ViewModule> = {
  dashboard,
  sales,
  contentads,
  admins,
  adminperf,
  kpi,
  profit,
  report,
  umap,
  me,
  users,
};

const VIEW_META: Record<string, { title: string; sub: string }> = {
  dashboard:  { title: 'Dashboard', sub: 'ภาพรวมแชทวันนี้ — ข้อมูลจริงจาก Pancake (sync ทุก 15 นาที)' },
  sales:      { title: 'Sales Dashboard', sub: 'ยอดขาย Facebook / LINE จาก Pancake POS' },
  contentads: { title: 'Content & Ads Performance', sub: 'แอดที่กำลังยิง + คำแนะนำจากตัวเลขจริง' },
  admins:     { title: 'Admin Management', sub: 'รายชื่อแอดมิน • สถานะออนไลน์ • สิทธิ์' },
  adminperf:  { title: 'Admin Performance', sub: 'Ranking ยอดขาย • Top 3 🥇🥈🥉' },
  kpi:        { title: 'KPI ทีมขาย', sub: 'หัวหน้า • รองหัวหน้า • แอดมิน — คะแนนจากชีท KPI ของทีม' },
  profit:     { title: 'กำไร & ตีกลับ', sub: 'กำไรสุทธิจริงรายยูนิต/เดือน/ปี + ตีกลับ — จากชีททีม' },
  report:     { title: 'รายงาน & การตลาด', sub: 'เป้า vs จริง รายวีค/เดือน/ปี • ซื้อซ้ำรายยูนิต' },
  umap:       { title: 'U Map', sub: 'แอดมินอยู่ U ไหน — จับคู่ • เพิ่ม/ลบ U • มี API ให้ระบบอื่นดึง' },
  me:         { title: 'ผลงานของฉัน', sub: 'ยอดขาย • KPI • อันดับของคุณ' },
  users:      { title: 'ผู้ใช้งาน', sub: 'บัญชีเข้าระบบ • ระดับสิทธิ์' },
};

/* ---------- สลับธีม สว่าง/มืด (จำค่าไว้ใน localStorage) ---------- */

function setTheme(theme: string): void {
  const t = theme === 'light' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('pn-theme', t); } catch (e) {}
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = t === 'light' ? '🌙' : '☀️'; // แสดงไอคอนของโหมดที่จะสลับไป
}

function toggleTheme(): void {
  const cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  setTheme(cur === 'light' ? 'dark' : 'light');
}

/* ---------- เมนูบนมือถือ: sidebar เลื่อนเข้าจากซ้าย + ฉากหลังทึบ ---------- */

function setNavOpen(open: boolean): void {
  const app = document.getElementById('app');
  if (app) app.classList.toggle('nav-open', open);
  // ล็อกไม่ให้หน้าเลื่อนตอนเมนูเปิด (ไม่งั้นนิ้วปัดแล้วพื้นหลังไหลตาม)
  document.body.style.overflow = open ? 'hidden' : '';
}

/* ---------------- badge แจ้งเตือนบนเมนูข้าง (แบบแอปมือถือ) ---------------- */

/** วาด/ลบตัวเลขมุมแท็บ — count 0 = เอาออก */
function setNavBadge(view: string, count: number, warn?: boolean, tip?: string): void {
  const btn = document.querySelector('.nav-item[data-view="' + view + '"]') as HTMLElement | null;
  if (!btn) return;
  let b = btn.querySelector('.nav-badge') as HTMLElement | null;
  if (!count) { if (b) b.remove(); return; }
  if (!b) {
    b = document.createElement('span');
    btn.appendChild(b);
  }
  b.className = 'nav-badge' + (warn ? ' warn' : '');
  b.textContent = count > 99 ? '99+' : String(count);
  if (tip) btn.title = tip;
}

/** ดึงจำนวนเรื่องด่วนมาแปะแท็บ Sales / Content & Ads — เงียบเมื่อพลาด (badge ไม่ใช่ของสำคัญพอให้เด้ง error) */
function refreshNavBadges(): void {
  // role ที่ไม่มีสองแท็บนี้ (ระดับแอดมิน) ไม่ต้องยิง API เลย
  if (!document.querySelector('.nav-item[data-view="sales"], .nav-item[data-view="contentads"]')) return;
  serverCall<any>('apiNavBadges').then(function (b) {
    const s = (b && b.sales) || { urgent: 0, warn: 0 };
    // แดง = ขาดทุน ≥2 วันติด; ไม่มีด่วนแต่มีเฝ้าระวัง → ส้ม
    if (s.urgent > 0) setNavBadge('sales', s.urgent, false, 'ยูนิตขาดทุน ≥2 วันติด ' + s.urgent + ' ยูนิต');
    else setNavBadge('sales', s.warn, true, s.warn ? 'ยูนิตเฝ้าระวังขาดทุน ' + s.warn + ' ยูนิต' : '');
    const c = (b && b.contentads) || { urgent: 0 };
    setNavBadge('contentads', c.urgent, false, c.urgent ? 'แอดที่ควรหยุด/แก้ด่วน ' + c.urgent + ' รายการ' : '');
  }).catch(function () {});
}

/* ---------------- App core ---------------- */

const App = {
  state: { view: 'dashboard' as string, bootstrap: null as Bootstrap | null },

  init(): void {
    const self = this;
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        self.switchView(btn.getAttribute('data-view') as string);
        setNavOpen(false); // เลือกเมนูบนมือถือแล้วต้องปิดเมนูเอง ไม่งั้นบังหน้าจอ
      });
    });

    const navBtn = document.getElementById('btn-nav');
    if (navBtn) {
      navBtn.addEventListener('click', function () {
        const app = document.getElementById('app');
        setNavOpen(!(app && app.classList.contains('nav-open')));
      });
    }
    const backdrop = document.getElementById('nav-backdrop');
    if (backdrop) backdrop.addEventListener('click', function () { setNavOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') setNavOpen(false);
    });

    const logout = document.getElementById('btn-logout');
    if (logout) {
      logout.addEventListener('click', function () {
        fetch('/api/logout', { method: 'POST' })
          .then(function () { window.location.href = '/login'; })
          .catch(function () { window.location.href = '/login'; });
      });
    }
    document.getElementById('btn-refresh')!.addEventListener('click', function () {
      self.loadView(self.state.view, true);
      toast('⟳ กำลังโหลดข้อมูลใหม่...');
    });
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    bindInfoTips(); // tooltip กรอบอธิบายสูตร — ผูกครั้งเดียว ครอบทุก view
    serverCall<Bootstrap>('apiBootstrap').then(function (b) {
      self.state.bootstrap = b;
      self.renderSyncInfo(b);
    }).catch(function () {});
    // หน้าแรกขึ้นกับสิทธิ์ — page.tsx บอกมาทาง data-first-view (ระดับแอดมินเริ่มที่ "ผลงานของฉัน")
    const first = (document.getElementById('app')?.getAttribute('data-first-view')) || 'dashboard';
    this.state.view = first;
    const meta = VIEW_META[first];
    if (meta) {
      document.getElementById('topbar-title')!.textContent = meta.title;
      document.getElementById('topbar-sub')!.textContent = meta.sub;
    }
    this.loadView(first, false);
    refreshNavBadges(); // ตัวเลขเรื่องด่วนบนแท็บ Sales / Content & Ads
    // รีเฟรชหน้าปัจจุบันอัตโนมัติทุก 5 นาที — แบบเบื้องหลัง (force=false = render จาก cache
    // แล้วค่อยดึงใหม่) และข้ามรอบถ้าแท็บถูกซ่อนหรือผู้ใช้กำลังพิมพ์/เลือกค่าอยู่
    setInterval(function () {
      if (document.hidden) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return;
      self.loadView(self.state.view, false);
      refreshNavBadges();
      serverCall<Bootstrap>('apiBootstrap').then(function (b) {
        self.state.bootstrap = b;
        self.renderSyncInfo(b);
      }).catch(function () {});
    }, 5 * 60 * 1000);
  },

  renderSyncInfo(b: Bootstrap | null): void {
    const chip = document.getElementById('sync-chip')!;
    const side = document.getElementById('sidebar-sync');
    if (!b || !b.lastSync || !b.lastSync.length) {
      chip.textContent = '⏳ ยังไม่มีข้อมูล sync — ระบบซิงค์อัตโนมัติทุก 15 นาที';
      return;
    }
    const latest = b.lastSync.reduce(function (a: SyncLogEntry | null, c: SyncLogEntry) {
      return (!a || c.ts > a.ts) ? c : a;
    }, null as SyncLogEntry | null)!;
    chip.textContent = '🕐 sync ล่าสุด ' + relTime(latest.ts);
    if (side) {
      side.innerHTML = b.lastSync.slice(0, 5).map(function (l) {
        return (l.ok ? '✅' : '❌') + ' ' + esc(l.job) + ' ' + relTime(l.ts);
      }).join('<br>');
    }
  },

  switchView(view: string): void {
    if (!VIEW_META[view]) return;
    // ไม่มีช่อง view นี้ในหน้า = สิทธิ์นี้เปิดไม่ได้ (page.tsx render เฉพาะที่อนุญาต) — เงียบไว้
    if (!document.getElementById('view-' + view)) return;
    hideChartTip(); // กันทูลทิปกราฟ (body singleton) ค้างลอยข้ามหน้าเมื่อสลับ view ด้วยคีย์บอร์ด
    hideInfoTip();  // เช่นเดียวกัน — กันกรอบอธิบายค้างข้ามหน้า
    this.state.view = view;
    document.querySelectorAll('.nav-item').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-view') === view);
    });
    document.querySelectorAll('.view').forEach(function (s) {
      s.classList.toggle('active', s.id === 'view-' + view);
    });
    document.getElementById('topbar-title')!.textContent = VIEW_META[view].title;
    document.getElementById('topbar-sub')!.textContent = VIEW_META[view].sub;
    this.loadView(view, false);
  },

  loadView(view: string, force: boolean): void {
    const container = document.getElementById('view-' + view) as HTMLElement | null;
    if (!container) return; // view ที่สิทธิ์นี้เปิดไม่ได้ — ไม่มีช่องให้ render
    const v = Views[view];
    if (v && typeof v.load === 'function') {
      v.load(container, force);
    }
  },
};

// แนบไว้บน globalThis — ไฟล์ view อ้าง App / VIEW_META ตรง ๆ (ผ่าน ambient var ที่ประกาศใน view)
(globalThis as any).App = App;
(globalThis as any).VIEW_META = VIEW_META;
(globalThis as any).Views = Views;

/** entry point — เรียกครั้งเดียวจาก DashboardClient (แทน App.init() ท้าย body ของ Index.html) */
export function initApp(): void {
  App.init();
}
