// lib/google.ts — อ่าน Google Sheets / Drive ด้วย "บัญชีระบบ" (service account)
//
// ทำไมไม่ใช้ไลบรารี googleapis: ต้องการแค่ 3 อย่าง (ขอ token, list ไฟล์, อ่านช่วงเซลล์)
// การเซ็น JWT ใช้ crypto ที่มากับ Node อยู่แล้ว — ไม่ต้องเพิ่ม dependency ก้อนใหญ่เข้ามาใน worker
//
// ตั้งค่า: env `GOOGLE_SA_KEY` = เนื้อไฟล์ JSON ของ service account ทั้งไฟล์ (บรรทัดเดียว)
// สิทธิ์อ่านมาจากการ "แชร์ไฟล์/โฟลเดอร์ให้อีเมลของบัญชีระบบ" ไม่ได้มาจาก IAM role
import { createSign } from 'crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// ขออ่านอย่างเดียวทั้งคู่ — บัญชีนี้ไม่ควรมีสิทธิ์แก้ชีทของทีมเด็ดขาด
const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
].join(' ');

interface SaKey { client_email: string; private_key: string }

function loadKey_(): SaKey | null {
  const raw = process.env.GOOGLE_SA_KEY || '';
  if (!raw.trim()) return null;
  let j: any;
  try { j = JSON.parse(raw); } catch {
    throw new Error('GOOGLE_SA_KEY ไม่ใช่ JSON ที่ถูกต้อง — ต้องวางเนื้อไฟล์ .json ทั้งไฟล์');
  }
  if (!j.client_email || !j.private_key) throw new Error('GOOGLE_SA_KEY ขาด client_email หรือ private_key');
  // ค่าที่ผ่าน .env มักถูกแปลง \n จริงเป็นตัวอักษร \ กับ n — คืนค่ากลับให้เป็นบรรทัดใหม่จริง
  return { client_email: String(j.client_email), private_key: String(j.private_key).replace(/\\n/g, '\n') };
}

export function googleConfigured(): boolean {
  return !!(process.env.GOOGLE_SA_KEY || '').trim();
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let cached: { token: string; exp: number } | null = null;

/** access token อายุ 1 ชม. — cache ไว้ในโปรเซส ไม่ต้องขอใหม่ทุกครั้งที่ยิง API */
async function accessToken_(): Promise<string> {
  if (cached && Date.now() < cached.exp - 60_000) return cached.token;
  const key = loadKey_();
  if (!key) throw new Error('ยังไม่ได้ตั้ง GOOGLE_SA_KEY');

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: key.client_email, scope: SCOPES, aud: TOKEN_URL, iat: now, exp: now + 3600,
  }));
  const sig = b64url(createSign('RSA-SHA256').update(`${header}.${claim}`).sign(key.private_key));

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  const j: any = await res.json();
  if (!res.ok || !j.access_token) {
    throw new Error(`ขอ token จาก Google ไม่สำเร็จ: ${j.error_description || j.error || res.status}`);
  }
  cached = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000 };
  return cached.token;
}

async function get_(url: string): Promise<any> {
  const res = await fetch(url, { headers: { authorization: 'Bearer ' + await accessToken_() } });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = String(j?.error?.message || res.status);
    // ข้อความจาก Google ตรงนี้กำกวมมาก ("The caller does not have permission")
    // เติมคำอธิบายที่ทำต่อได้จริง — สาเหตุเกือบทุกครั้งคือลืมแชร์ไฟล์ให้อีเมลบัญชีระบบ
    if (res.status === 403 || res.status === 404) {
      throw new Error(`${msg} — เช็คว่าแชร์ไฟล์/โฟลเดอร์ให้อีเมลของ service account แล้วหรือยัง (สิทธิ์ Viewer)`);
    }
    throw new Error(`Google API ${res.status}: ${msg}`);
  }
  return j;
}

export interface DriveFile { id: string; name: string; mimeType: string; modifiedTime: string }

/** ไฟล์ทั้งหมดในโฟลเดอร์ (เฉพาะ Google Sheets, ไม่รวมของที่ถูกลบ) */
export async function driveListSheets(folderId: string): Promise<DriveFile[]> {
  const q = `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`;
  const out: DriveFile[] = [];
  let pageToken = '';
  do {
    const url = 'https://www.googleapis.com/drive/v3/files?' + new URLSearchParams({
      q, fields: 'nextPageToken,files(id,name,mimeType,modifiedTime)', pageSize: '100',
      supportsAllDrives: 'true', includeItemsFromAllDrives: 'true',
      ...(pageToken ? { pageToken } : {}),
    });
    const j = await get_(url);
    out.push(...((j.files || []) as DriveFile[]));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** ชื่อแท็บทั้งหมดในไฟล์ (ไม่ดึงข้อมูลในเซลล์ — เบามาก) */
export async function sheetTabs(spreadsheetId: string): Promise<string[]> {
  const j = await get_(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`);
  return (j.sheets || []).map((s: any) => String(s.properties?.title || ''));
}

/**
 * อ่านช่วงเซลล์แบบ A1 เช่น "'Com:Admin'!A1:Z500"
 * คืนเป็นอาเรย์ของแถว — แถวท้ายที่ว่างจะถูกตัดออกโดย Google เอง (แถวสั้นกว่ากันได้)
 */
export async function sheetValues(spreadsheetId: string, range: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}` +
    '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';
  const j = await get_(url);
  return (j.values || []).map((r: any[]) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
}

/** อ่านหลายช่วงพร้อมกัน (ประหยัดโควตา — 1 คำขอต่อไฟล์แทนที่จะยิงทีละแท็บ) */
export async function sheetValuesBatch(spreadsheetId: string, ranges: string[]): Promise<Record<string, string[][]>> {
  if (!ranges.length) return {};
  const qs = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING' });
  ranges.forEach((r) => qs.append('ranges', r));
  const j = await get_(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${qs}`);
  const out: Record<string, string[][]> = {};
  (j.valueRanges || []).forEach((vr: any, i: number) => {
    out[ranges[i]] = (vr.values || []).map((r: any[]) => r.map((c) => (c === null || c === undefined ? '' : String(c))));
  });
  return out;
}
