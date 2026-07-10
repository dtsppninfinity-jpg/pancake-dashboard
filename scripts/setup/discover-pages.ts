// scripts/setup/discover-pages.ts — ค้นหาเพจ + สร้าง page_access_token → เก็บใน DB
// ใช้ครั้งเดียวตอน setup (port จาก discoverPages_ ใน Setup.gs)
import '../../lib/env';
import { requireCredentials, sleep } from '../../lib/config';
import { pagesListPages, pagesGenerateToken } from '../../lib/pancake';
import { supabase } from '../../lib/supabase';

async function main() {
  requireCredentials();
  const pages = await pagesListPages();
  if (!pages.length) throw new Error('ไม่พบเพจเลย — เช็คว่า Access Token ยังไม่หมดอายุ (~90 วัน)');

  const { data: existTok } = await supabase.from('page_tokens').select('page_id, token');
  const tokens: Record<string, string> = {};
  (existTok || []).forEach((t: any) => { tokens[String(t.page_id)] = t.token; });

  let ok = 0;
  const fail: string[] = [];
  const pageRows: any[] = [];
  for (const p of pages) {
    const pid = String(p.id);
    if (!tokens[pid]) {
      try { tokens[pid] = await pagesGenerateToken(pid); ok++; await sleep(300); }
      catch { fail.push(p.name || pid); }
    } else { ok++; }
    pageRows.push({
      page_id: pid,
      name: p.name || '',
      platform: (p.platform || 'facebook').toLowerCase(),
      in_pos_shop: '',
      has_token: !!tokens[pid],
      updated_at: new Date().toISOString(),
    });
  }

  // ต้อง upsert pages ก่อน (page_tokens มี foreign key อ้าง pages)
  const { error: pErr } = await supabase.from('pages').upsert(pageRows, { onConflict: 'page_id' });
  if (pErr) throw new Error(`บันทึก pages ล้มเหลว: ${pErr.message}`);

  const tokRows = Object.keys(tokens).filter((pid) => tokens[pid])
    .map((pid) => ({ page_id: pid, token: tokens[pid], updated_at: new Date().toISOString() }));
  const { error: tErr } = await supabase.from('page_tokens').upsert(tokRows, { onConflict: 'page_id' });
  if (tErr) throw new Error(`บันทึก page_tokens ล้มเหลว: ${tErr.message}`);

  console.log(`✅ พบ ${pages.length} เพจ | มี token ${ok} เพจ` +
    (fail.length ? ` | ❌ สร้าง token ไม่ได้: ${fail.join(', ')}` : ''));
}

main().then(() => process.exit(0)).catch((e) => { console.error('❌', e.message); process.exit(1); });
