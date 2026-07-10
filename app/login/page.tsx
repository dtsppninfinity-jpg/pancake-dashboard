'use client';

import { useState } from 'react';

// หน้า login รหัสผ่านทีม — POST /api/login แล้วเด้งกลับหน้าเดิม (?next=...)
export default function LoginPage() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (r.ok) {
        const next = new URLSearchParams(window.location.search).get('next') || '/';
        window.location.href = next.startsWith('/') ? next : '/';
        return;
      }
      const d = await r.json().catch(() => ({}));
      setErr(d.error || 'เข้าสู่ระบบไม่สำเร็จ');
    } catch {
      setErr('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
    }
    setBusy(false);
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <form onSubmit={submit} className="card" style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 34 }}>🔒</div>
          <h3 style={{ fontSize: 16 }}>PN Infinity Dashboard</h3>
          <div className="card-sub">ใส่รหัสผ่านทีมเพื่อเข้าใช้งาน</div>
        </div>
        <input
          className="input"
          type="password"
          placeholder="รหัสผ่าน"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoFocus
          style={{ width: '100%', marginBottom: 10 }}
        />
        {err && <div style={{ color: 'var(--red)', fontSize: 12, marginBottom: 10 }}>❌ {err}</div>}
        <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'กำลังเข้า...' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </div>
  );
}
