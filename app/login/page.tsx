'use client';

import { useState } from 'react';

// หน้า login รายคน — POST /api/login แล้วเด้งกลับหน้าเดิม (?next=...)
// รองรับกรณีบัญชีที่ผู้ดูแลเพิ่งสร้าง (must_change_pw) → ฟอร์มจะขยายให้ตั้งรหัสใหม่ก่อนเข้า
export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [pw, setPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [newPw2, setNewPw2] = useState('');
  const [mustChange, setMustChange] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mustChange && newPw !== newPw2) {
      setErr('รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password: pw, newPassword: mustChange ? newPw : '' }),
      });
      const d = await r.json().catch(() => ({} as any));
      if (r.ok && d.ok) {
        const next = new URLSearchParams(window.location.search).get('next') || '/';
        // รับเฉพาะ path ภายในเว็บ — กัน open redirect ไปเว็บนอก
        window.location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
        return;
      }
      if (d.mustChangePw) setMustChange(true);
      setErr(d.error || 'เข้าสู่ระบบไม่สำเร็จ');
    } catch {
      setErr('เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ');
    }
    setBusy(false);
  }

  return (
    <div className="login-wrap">
      <form onSubmit={submit} className="card login-card">
        <div style={{ textAlign: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 34 }}>🔒</div>
          <h3 style={{ fontSize: 16 }}>PN Infinity Dashboard</h3>
          <div className="card-sub">{mustChange ? 'ตั้งรหัสผ่านใหม่ก่อนเข้าใช้งาน' : 'เข้าสู่ระบบด้วยบัญชีของคุณ'}</div>
        </div>

        <input
          className="input login-input"
          type="text"
          placeholder="ชื่อผู้ใช้"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          disabled={mustChange}
        />
        <input
          className="input login-input"
          type="password"
          placeholder={mustChange ? 'รหัสผ่านเดิม' : 'รหัสผ่าน'}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="current-password"
          disabled={mustChange}
        />

        {mustChange && (
          <>
            <input
              className="input login-input"
              type="password"
              placeholder="รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)"
              value={newPw}
              onChange={(e) => setNewPw(e.target.value)}
              autoComplete="new-password"
              autoFocus
            />
            <input
              className="input login-input"
              type="password"
              placeholder="ยืนยันรหัสผ่านใหม่"
              value={newPw2}
              onChange={(e) => setNewPw2(e.target.value)}
              autoComplete="new-password"
            />
          </>
        )}

        {err && <div className="login-err">❌ {err}</div>}

        <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'กำลังเข้า...' : mustChange ? 'ตั้งรหัสใหม่และเข้าสู่ระบบ' : 'เข้าสู่ระบบ'}
        </button>

        <div className="login-hint">ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบให้รีเซ็ตให้</div>
      </form>
    </div>
  );
}
