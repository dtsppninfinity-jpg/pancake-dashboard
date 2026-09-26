'use client';

import { useState } from 'react';
import { icon } from '@/lib/ui/icons';
import { logoMark } from '@/lib/ui/helpers';

// หน้า login รายคน — POST /api/login แล้วเด้งกลับหน้าเดิม (?next=...)
// รองรับกรณีบัญชีที่ผู้ดูแลเพิ่งสร้าง (must_change_pw) → ฟอร์มจะขยายให้ตั้งรหัสใหม่ก่อนเข้า

/** ไอคอนจาก lib/ui/icons.ts เป็น HTML string (ทั้งเว็บเป็นแบบนี้) — ห่อด้วย span เพื่อใช้ใน React ได้ */
function Ico({ html, className }: { html: string; className?: string }) {
  return <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * ช่องรหัสผ่าน + ปุ่มแสดง/ซ่อน
 * ทำไมต้องมี: พิมพ์รหัสบนมือถือพลาดง่ายมาก และตัวอักษรถูกปิดเป็นจุดหมด พิมพ์ผิดแล้วไม่รู้ว่าผิดตรงไหน
 * ปุ่มเป็น type="button" — ถ้าเป็นค่าเริ่มต้น (submit) กดดูรหัสแล้วฟอร์มจะส่งทันที
 */
function PasswordInput(props: {
  id: string; label: string; value: string; onChange: (v: string) => void;
  autoComplete: string; disabled?: boolean; autoFocus?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <>
      <label htmlFor={props.id} className="login-label">{props.label}</label>
      <div className="pw-field">
        <input
          id={props.id}
          className="input login-input"
          type={show ? 'text' : 'password'}
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          autoComplete={props.autoComplete}
          autoCapitalize="none"
          spellCheck={false}
          disabled={props.disabled}
          autoFocus={props.autoFocus}
        />
        <button
          type="button"
          className="pw-toggle"
          aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          title={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
          aria-pressed={show}
          aria-controls={props.id}
          disabled={props.disabled}
          onClick={() => setShow((v) => !v)}
        >
          <Ico html={icon(show ? 'eye-off' : 'eye', { size: 18 })} />
        </button>
      </div>
    </>
  );
}

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
        // # ของหน้า (เช่น /#sales จากลิงก์ที่ส่งต่อกัน) เบราว์เซอร์พามาถึงหน้า login ด้วย แต่ ?next= ไม่มี
        // → ต่อท้ายให้ ไม่งั้นล็อกอินเสร็จแล้วไปโผล่หน้าแรกแทนหน้าที่ลิงก์ชี้ (next เป็น path ในเว็บเสมอ จึงต่อ # ได้ปลอดภัย)
        const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/';
        const hash = /^#[a-z]+$/.test(window.location.hash) && safe.indexOf('#') < 0 ? window.location.hash : '';
        window.location.href = safe + hash;
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
        <div className="login-brand">
          {/* โลโก้วาดเป็นรูปทรงล้วน ไม่พึ่งฟอนต์ — หน้าตาเหมือนกันทุกเครื่อง (ดู logoMark ใน lib/ui/helpers.ts) */}
          <Ico className="login-logo" html={logoMark(52)} />
          <h1 className="login-title">PN Infinity</h1>
          <div className="card-sub">{mustChange ? 'ตั้งรหัสผ่านใหม่ก่อนเข้าใช้งาน' : 'เข้าสู่ระบบด้วยบัญชีของคุณ'}</div>
        </div>

        {/* ป้ายชื่อช่องอยู่เหนือช่องตลอดเวลา — placeholder อย่างเดียวหายไปทันทีที่เริ่มพิมพ์ แล้วลืมว่าช่องไหนคืออะไร */}
        <label htmlFor="login-user" className="login-label">ชื่อผู้ใช้</label>
        <input
          id="login-user"
          className="input login-input"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          disabled={mustChange}
        />
        <PasswordInput
          id="login-pw"
          label={mustChange ? 'รหัสผ่านเดิม' : 'รหัสผ่าน'}
          value={pw}
          onChange={setPw}
          autoComplete="current-password"
          disabled={mustChange}
        />

        {mustChange && (
          <>
            <PasswordInput
              id="login-newpw"
              label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)"
              value={newPw}
              onChange={setNewPw}
              autoComplete="new-password"
              autoFocus
            />
            <PasswordInput
              id="login-newpw2"
              label="ยืนยันรหัสผ่านใหม่"
              value={newPw2}
              onChange={setNewPw2}
              autoComplete="new-password"
            />
          </>
        )}

        {err && (
          <div className="login-err" role="alert">
            <Ico html={icon('circle-alert', { size: 16 })} />
            <span>{err}</span>
          </div>
        )}

        <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
          {busy ? 'กำลังเข้า...' : mustChange ? 'ตั้งรหัสใหม่และเข้าสู่ระบบ' : 'เข้าสู่ระบบ'}
        </button>

        <div className="login-hint">ลืมรหัสผ่าน? ติดต่อผู้ดูแลระบบให้รีเซ็ตให้</div>
      </form>
    </div>
  );
}
