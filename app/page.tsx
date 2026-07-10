import DashboardClient from './DashboardClient';

// โครง HTML พอร์ตจาก Index.html (GAS) แบบตรงตัว — class / ข้อความไทย / โครงเดิมทุกตัวอักษร
// server component: render โครงนิ่ง ๆ แล้วให้ <DashboardClient/> (client) เรียก App.init()
export const dynamic = 'force-dynamic';

// ตั้งธีมจากที่เคยเลือกไว้ก่อน render เพื่อไม่ให้จอกระพริบ (default = มืด)
const themeInit = `(function () {
  try {
    var t = localStorage.getItem('pn-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();`;

export default function Page() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      <div id="app">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-logo">PN</div>
            <div className="brand-text">
              <div className="brand-name">PN Infinity</div>
              <div className="brand-sub">Pancake POS Dashboard</div>
            </div>
          </div>

          <nav className="nav">
            <div className="nav-section">1. ภาพรวม</div>
            <button className="nav-item active" data-view="dashboard">
              <span className="nav-icon">📊</span>
              <span className="nav-texts"><span>Dashboard</span>
              <span className="nav-label-sub">ภาพรวมแชทวันนี้</span></span>
            </button>
            <button className="nav-item" data-view="sales">
              <span className="nav-icon">💰</span>
              <span className="nav-texts"><span>Sales Dashboard</span>
              <span className="nav-label-sub">ยอดขาย FB/LINE + Ranking</span></span>
            </button>
            <button className="nav-item" data-view="contentads">
              <span className="nav-icon">🎯</span>
              <span className="nav-texts"><span>Content &amp; Ads Performance</span>
              <span className="nav-label-sub">แอดที่กำลังยิง + คำแนะนำ</span></span>
            </button>

            <div className="nav-section">2. แอดมิน</div>
            <button className="nav-item" data-view="admins">
              <span className="nav-icon">👥</span>
              <span className="nav-texts"><span>Admin Management</span>
              <span className="nav-label-sub">รายชื่อ • สถานะ • สิทธิ์</span></span>
            </button>
            <button className="nav-item" data-view="adminperf">
              <span className="nav-icon">🏆</span>
              <span className="nav-texts"><span>Admin Performance</span>
              <span className="nav-label-sub">Ranking ยอดขาย • Top 3 🥇🥈🥉</span></span>
            </button>
          </nav>

          <div className="sidebar-footer">
            <div className="live-badge">● LIVE จาก Supabase</div>
            <div id="sidebar-sync" className="sidebar-sync"></div>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <div>
              <h1 id="topbar-title">Dashboard</h1>
              <div id="topbar-sub" className="topbar-sub">ภาพรวมแชทวันนี้</div>
            </div>
            <div className="topbar-right">
              <span id="sync-chip" className="chip" title="เวลาที่ sync ข้อมูลล่าสุด"></span>
              <button id="btn-theme" className="btn" title="สลับโหมดสว่าง / มืด">☀️</button>
              <button id="btn-refresh" className="btn" title="โหลดข้อมูลใหม่">⟳ รีเฟรช</button>
            </div>
          </header>

          <section id="view-dashboard" className="view active"></section>
          <section id="view-sales" className="view"></section>
          <section id="view-contentads" className="view"></section>
          <section id="view-admins" className="view"></section>
          <section id="view-adminperf" className="view"></section>
        </main>
      </div>

      <div id="modal-root"></div>
      <div id="toast-container"></div>

      <DashboardClient />
    </>
  );
}
