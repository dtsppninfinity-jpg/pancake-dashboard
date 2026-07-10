/* ============================================================
   app-core — App core + view registry (port จาก JsCommon.html)
   รันบน browser เท่านั้น — client TS ESM
   - ลงทะเบียน Views ทั้ง 5 (import จาก @/lib/views/*)
   - แนบ App / VIEW_META ไว้บน globalThis เพื่อให้ไฟล์ view อ้างถึงได้ (กัน import cycle)
   - serverCall / esc / relTime / toast มาจาก helpers
   ============================================================ */

import { serverCall, esc, relTime, toast } from '@/lib/ui/helpers';
import { dashboard } from '@/lib/views/dashboard';
import { sales } from '@/lib/views/sales';
import { contentads } from '@/lib/views/contentads';
import { admins } from '@/lib/views/admins';
import { adminperf } from '@/lib/views/adminperf';

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
};

const VIEW_META: Record<string, { title: string; sub: string }> = {
  dashboard:  { title: 'Dashboard', sub: 'ภาพรวมแชทวันนี้ — ข้อมูลจริงจาก Pancake (sync ทุก 15 นาที)' },
  sales:      { title: 'Sales Dashboard', sub: 'ยอดขาย Facebook / LINE จาก Pancake POS' },
  contentads: { title: 'Content & Ads Performance', sub: 'แอดที่กำลังยิง + คำแนะนำจากตัวเลขจริง' },
  admins:     { title: 'Admin Management', sub: 'รายชื่อแอดมิน • สถานะออนไลน์ • สิทธิ์' },
  adminperf:  { title: 'Admin Performance', sub: 'Ranking ยอดขาย • Top 3 🥇🥈🥉' },
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

/* ---------------- App core ---------------- */

const App = {
  state: { view: 'dashboard' as string, bootstrap: null as Bootstrap | null },

  init(): void {
    const self = this;
    document.querySelectorAll('.nav-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        self.switchView(btn.getAttribute('data-view') as string);
      });
    });
    document.getElementById('btn-refresh')!.addEventListener('click', function () {
      self.loadView(self.state.view, true);
      toast('⟳ กำลังโหลดข้อมูลใหม่...');
    });
    const themeBtn = document.getElementById('btn-theme');
    if (themeBtn) themeBtn.addEventListener('click', toggleTheme);
    setTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    serverCall<Bootstrap>('apiBootstrap').then(function (b) {
      self.state.bootstrap = b;
      self.renderSyncInfo(b);
    }).catch(function () {});
    this.loadView('dashboard', false);
    // รีเฟรชหน้าปัจจุบันอัตโนมัติทุก 5 นาที — แบบเบื้องหลัง (force=false = render จาก cache
    // แล้วค่อยดึงใหม่) และข้ามรอบถ้าแท็บถูกซ่อนหรือผู้ใช้กำลังพิมพ์/เลือกค่าอยู่
    setInterval(function () {
      if (document.hidden) return;
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'SELECT' || ae.tagName === 'TEXTAREA')) return;
      self.loadView(self.state.view, false);
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
    const container = document.getElementById('view-' + view) as HTMLElement;
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
