// scripts/check.ts — เช็คสถานะ DB + sync ล่าสุด (เทียบเท่าเมนู "ℹ️ สถานะระบบ" ใน GAS)
// ใช้: npm run check
import '../lib/env';
import { supabase } from '../lib/supabase';

async function count(table: string): Promise<number> {
  const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
  return count || 0;
}

async function main() {
  const tables = ['pages', 'page_tokens', 'orders', 'chat_hourly', 'conversations', 'admin_chat_daily', 'admins', 'ads', 'sync_log'];
  console.log('📊 จำนวนแถวในแต่ละตาราง:');
  for (const t of tables) console.log(`   ${t.padEnd(18)} ${await count(t)}`);

  const { data: logs } = await supabase.from('sync_log')
    .select('ts, job, ok, message').order('ts', { ascending: false }).limit(8);
  if (logs && logs.length) {
    console.log('\n📝 sync ล่าสุด:');
    logs.forEach((l: any) => console.log(`   ${l.ok ? '✅' : '❌'} ${l.job} — ${l.message}`));
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
