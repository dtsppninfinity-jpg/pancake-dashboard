import { headers } from 'next/headers';
import DashboardClient from './DashboardClient';
import { canView, ROLE_LABEL, type Role } from '@/lib/auth-session';

// โครง HTML พอร์ตจาก Index.html (GAS) แบบตรงตัว — class / ข้อความไทย / โครงเดิมทุกตัวอักษร
// server component: render โครงนิ่ง ๆ แล้วให้ <DashboardClient/> (client) เรียก App.init()
//
// เมนู/ช่อง view ถูก render ตามสิทธิ์ของคนที่ล็อกอิน (role มาจาก header ที่ middleware เซ็ต)
// → ระดับแอดมินจะไม่มีแม้แต่ HTML ของหน้าอื่นให้แงะดู ไม่ใช่แค่ซ่อนด้วย CSS
export const dynamic = 'force-dynamic';

// ตั้งธีมจากที่เคยเลือกไว้ก่อน render เพื่อไม่ให้จอกระพริบ (default = มืด)
const themeInit = `(function () {
  try {
    var t = localStorage.getItem('pn-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();`;

type NavItem = { view: string; icon: string; title: string; sub: string };

const NAV_OVERVIEW: NavItem[] = [
  { view: 'dashboard', icon: '📊', title: 'Dashboard', sub: 'ภาพรวมแชทวันนี้' },
  { view: 'sales', icon: '💰', title: 'Sales Dashboard', sub: 'ยอดขาย FB/LINE + Ranking' },
  { view: 'contentads', icon: '🎯', title: 'Content & Ads Performance', sub: 'แอดที่กำลังยิง + คำแนะนำ' },
  { view: 'profit', icon: '💹', title: 'กำไร & ตีกลับ', sub: 'กำไรจริงรายยูนิต/เดือน/ปี' },
];
const NAV_ADMIN: NavItem[] = [
  { view: 'admins', icon: '👥', title: 'Admin Management', sub: 'รายชื่อ • สถานะ • สิทธิ์' },
  { view: 'adminperf', icon: '🏆', title: 'Admin Performance', sub: 'Ranking ยอดขาย • Top 3 🥇🥈🥉' },
  { view: 'kpi', icon: '📐', title: 'KPI ทีมขาย', sub: 'หัวหน้า • รอง • แอดมิน • ท็อปเซล' },
  { view: 'umap', icon: '🧩', title: 'U Map', sub: 'แอดมินอยู่ U ไหน • จับคู่' },
];
const NAV_ME: NavItem[] = [
  { view: 'me', icon: '🎯', title: 'ผลงานของฉัน', sub: 'ยอดขาย • KPI • อันดับ' },
];
const NAV_SYSTEM: NavItem[] = [
  { view: 'users', icon: '🔐', title: 'ผู้ใช้งาน', sub: 'บัญชี • ระดับสิทธิ์' },
];

function navButton(it: NavItem, active: boolean) {
  return (
    <button key={it.view} className={'nav-item' + (active ? ' active' : '')} data-view={it.view}>
      <span className="nav-icon">{it.icon}</span>
      <span className="nav-texts">
        <span>{it.title}</span>
        <span className="nav-label-sub">{it.sub}</span>
      </span>
    </button>
  );
}

export default async function Page() {
  const h = await headers();
  const role = (h.get('x-pn-role') || '') as Role;
  const displayName = h.get('x-pn-user') || '';

  const allow = (items: NavItem[]) => items.filter((it) => canView(role, it.view));
  const overview = allow(NAV_OVERVIEW);
  const adminSec = allow(NAV_ADMIN);
  const meSec = allow(NAV_ME);
  const system = allow(NAV_SYSTEM);

  // view แรกที่เปิดได้ = หน้าเริ่มต้น (ระดับแอดมินจะเริ่มที่ "ผลงานของฉัน")
  const ordered = [...meSec, ...overview, ...adminSec, ...system];
  const firstView = ordered.length ? ordered[0].view : '';

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      <div id="app" data-role={role} data-first-view={firstView}>
        {/* ฉากหลังทึบตอนเปิดเมนูบนมือถือ — กดแล้วปิดเมนู */}
        <div id="nav-backdrop" className="nav-backdrop"></div>

        <aside className="sidebar" id="sidebar">
          <div className="brand">
            <div className="brand-logo">PN</div>
            <div className="brand-text">
              <div className="brand-name">PN Infinity</div>
              <div className="brand-sub">Pancake POS Dashboard</div>
            </div>
          </div>

          <nav className="nav">
            {meSec.length > 0 && (
              <>
                <div className="nav-section">ของฉัน</div>
                {meSec.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
            {overview.length > 0 && (
              <>
                <div className="nav-section">1. ภาพรวม</div>
                {overview.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
            {adminSec.length > 0 && (
              <>
                <div className="nav-section">2. แอดมิน</div>
                {adminSec.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
            {system.length > 0 && (
              <>
                <div className="nav-section">3. ระบบ</div>
                {system.map((it) => navButton(it, it.view === firstView))}
              </>
            )}
          </nav>

          <div className="sidebar-footer">
            <div className="me-box">
              <div className="me-name" title={displayName}>👤 {displayName || '—'}</div>
              <div className="me-role">{ROLE_LABEL[role] || '—'}</div>
              <button id="btn-logout" className="btn btn-logout" title="ออกจากระบบ">ออกจากระบบ</button>
            </div>
            <div className="live-badge">● LIVE จาก Supabase</div>
            <div id="sidebar-sync" className="sidebar-sync"></div>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            {/* ปุ่มเมนูโผล่เฉพาะจอแคบ (ดู globals.css) */}
            <button id="btn-nav" className="btn btn-nav" aria-label="เปิดเมนู">☰</button>
            <div className="topbar-titles">
              <h1 id="topbar-title">Dashboard</h1>
              <div id="topbar-sub" className="topbar-sub">ภาพรวมแชทวันนี้</div>
            </div>
            <div className="topbar-right">
              <span id="sync-chip" className="chip" title="เวลาที่ sync ข้อมูลล่าสุด"></span>
              <button id="btn-theme" className="btn" title="สลับโหมดสว่าง / มืด">☀️</button>
              <button id="btn-refresh" className="btn" title="โหลดข้อมูลใหม่">⟳ รีเฟรช</button>
            </div>
          </header>

          {/* render เฉพาะช่องของ view ที่สิทธิ์นี้เปิดได้ */}
          {ordered.map((it) => (
            <section
              key={it.view}
              id={'view-' + it.view}
              className={'view' + (it.view === firstView ? ' active' : '')}
            ></section>
          ))}
        </main>
      </div>

      <div id="modal-root"></div>
      <div id="toast-container"></div>

      <DashboardClient />
    </>
  );
}
