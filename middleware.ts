// middleware.ts — ประตูตรวจสิทธิ์รายคน (กัน PII/ยอดขาย/อีเมลพนักงานหลุดสู่สาธารณะ)
//
// เดิมเป็นรหัสผ่านรวมทีม 1 ตัว → เปลี่ยนเป็นบัญชีรายคน + ระดับสิทธิ์ (ดู db/migrations/2026-07-27-app-users.sql)
// ตรวจจาก cookie ที่เซ็น HMAC (lib/auth-session.ts) — ไม่ต้องยิง DB ทุก request จึงเร็วพอสำหรับ Edge
//
// ป้องกันทั้งหน้าเว็บ (/) และ /api/* ทุกเส้น ยกเว้น /login, /api/login, /api/logout
// และ /api/public/* (API สาธารณะที่ตั้งใจเปิด — ส่งเฉพาะข้อมูลไม่อ่อนไหว เช่น U map)
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE, verifySession, canCallApi } from '@/lib/auth-session';

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith('/api/');
  const secret = process.env.AUTH_SECRET || process.env.DASHBOARD_PASSWORD || '';

  // ยังไม่ได้ตั้งความลับ → fail-closed (กันข้อมูลหลุดถ้าลืมตั้ง env บนเซิร์ฟเวอร์)
  if (!secret) {
    return isApi
      ? NextResponse.json({ error: 'auth not configured' }, { status: 503 })
      : new NextResponse('ยังไม่ได้ตั้ง AUTH_SECRET บนเซิร์ฟเวอร์', { status: 503 });
  }

  const sess = await verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env as any);

  if (!sess) {
    if (isApi) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const login = req.nextUrl.clone();
    login.pathname = '/login';
    login.search = '?next=' + encodeURIComponent(path + req.nextUrl.search);
    return NextResponse.redirect(login);
  }

  // ชั้นที่ 2: role ห้ามเรียก API ที่ไม่ใช่ของตัวเอง (เช่น แอดมินยิง /api/apiSales ตรงๆ)
  // ป้องกันตั้งแต่ประตู ไม่ปล่อยให้ route handler ตัดสินอย่างเดียว
  if (isApi) {
    const fn = path.split('/')[2] || '';
    if (!canCallApi(sess.r, fn)) {
      return NextResponse.json({ error: 'forbidden', detail: 'สิทธิ์ของคุณเข้าถึงส่วนนี้ไม่ได้' }, { status: 403 });
    }
  }

  // ส่งตัวตนต่อให้ route handler ผ่าน request header (อ่านด้วย headers() จาก next/headers)
  // ต้องเซ็ตบน request ไม่ใช่ response — response header จะไปโผล่ที่ browser เปล่าๆ
  const h = new Headers(req.headers);
  h.set('x-pn-user', sess.u);
  h.set('x-pn-role', sess.r);
  h.set('x-pn-admin-id', sess.a || '');
  return NextResponse.next({ request: { headers: h } });
}

export const config = {
  // ป้องกันทุกเส้นทาง ยกเว้น: static ของ Next, หน้า login, endpoint login/logout, API สาธารณะ, favicon
  matcher: ['/((?!_next/|login|api/login|api/logout|api/public/|favicon).*)'],
};
