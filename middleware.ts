// middleware.ts — ประตูรหัสผ่านรวมทีม (กัน PII/ยอดขาย/อีเมลพนักงานหลุดสู่สาธารณะ)
// ป้องกันทั้งหน้าเว็บ (/) และ /api/* ทุกเส้น ยกเว้น /login, /api/login
// และ /api/public/* (API สาธารณะที่ตั้งใจเปิด — ส่งเฉพาะข้อมูลไม่อ่อนไหว เช่น U map)
// cookie 'pn_auth' = sha256(DASHBOARD_PASSWORD) — ตรวจบน Edge ด้วย Web Crypto
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(req: NextRequest) {
  const pw = process.env.DASHBOARD_PASSWORD || '';
  const isApi = req.nextUrl.pathname.startsWith('/api/');

  // ยังไม่ได้ตั้งรหัส → fail-closed (กันข้อมูลหลุดถ้าลืมตั้ง env บนเซิร์ฟเวอร์)
  if (!pw) {
    return isApi
      ? NextResponse.json({ error: 'auth not configured' }, { status: 503 })
      : new NextResponse('ยังไม่ได้ตั้ง DASHBOARD_PASSWORD บนเซิร์ฟเวอร์', { status: 503 });
  }

  const token = req.cookies.get('pn_auth')?.value;
  if (token && token === (await sha256hex(pw))) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const login = req.nextUrl.clone();
  login.pathname = '/login';
  login.search = '?next=' + encodeURIComponent(req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // ป้องกันทุกเส้นทาง ยกเว้น: static ของ Next, หน้า login, endpoint login, API สาธารณะ, favicon
  matcher: ['/((?!_next/|login|api/login|api/public/|favicon).*)'],
};
