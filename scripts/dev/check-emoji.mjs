// scripts/dev/check-emoji.mjs — หาอีโมจิที่หลุดเข้ามาในโค้ดหน้าเว็บ (อ่านไฟล์อย่างเดียว ไม่แตะอะไร)
//
// ใช้:  node scripts/dev/check-emoji.mjs            → รายงาน + exit 1 ถ้าเจอ
//       node scripts/dev/check-emoji.mjs --summary  → นับรายไฟล์อย่างเดียว
//
// ทำไมมีสคริปต์นี้: ตรวจ UI รอบ 2 (26 ก.ย. 69) เปลี่ยนอีโมจิ ~690 จุดเป็นไอคอนลายเส้น (lib/ui/icons.ts)
// รอบแรก (ส.ค.) นับได้ 614 แล้วงอกเพิ่มทุกครั้งที่ทำฟีเจอร์ใหม่ — ต้องมีตัวจับ ไม่งั้นกลับมาเต็มอีก
//
// ไม่นับ: บรรทัดคอมเมนต์ (// * /*) และสัญลักษณ์ทางตัวพิมพ์ที่ตั้งใจใช้ (ALLOW)
import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['lib/views', 'lib/ui', 'app'];
const EXT = /\.(ts|tsx)$/;
const SKIP = [/^app[\\/]api[\\/]/, /lib[\\/]ui[\\/]icons\.ts$/];
// ช่วงอีโมจิ + สัญลักษณ์ที่มักแสดงเป็นอีโมจิสี
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{2190}-\u{21FF}\u{2300}-\u{23FF}\u{25A0}-\u{25FF}\u{3030}\u{303D}\u{3297}\u{3299}\u{FE0F}\u{200D}]/gu;
// สัญลักษณ์ตัวพิมพ์ธรรมดาที่อนุญาต (ไม่ใช่อีโมจิสี แสดงเหมือนกันทุกเครื่อง)
const ALLOW = new Set(['▲', '▼', '▸', '▾', '◂', '▴', '→', '←', '↑', '↓', '↗', '↘', '↔', '✓', '✗', '×', '•', '·', '●', '○', '…', '–', '—', '⌄']);

const summary = process.argv.includes('--summary');
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (EXT.test(e.name) && !SKIP.some((re) => re.test(p))) files.push(p);
  }
};
ROOTS.forEach((r) => fs.existsSync(r) && walk(r));

let total = 0;
const per = [];
for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
  let n = 0;
  let inBlock = false;
  lines.forEach((line, i) => {
    const t = line.trim();
    if (inBlock) { if (t.includes('*/')) inBlock = false; return; }
    if (t.startsWith('/*') && !t.includes('*/')) { inBlock = true; return; }
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    // ตัดคอมเมนต์ท้ายบรรทัดแบบหยาบ (ไม่แตะ // ใน URL ของสตริง)
    const code = line.replace(/\s\/\/\s.*$/, '');
    const hits = (code.match(EMOJI) || []).filter((c) => !ALLOW.has(c) && c !== '️' && c !== '‍');
    if (!hits.length) return;
    n += hits.length;
    if (!summary) console.log(`${f}:${i + 1}  ${hits.join(' ')}   ${t.slice(0, 110)}`);
  });
  if (n) per.push([n, f]);
  total += n;
}
if (summary || total) {
  per.sort((a, b) => b[0] - a[0]).forEach(([n, f]) => console.log(String(n).padStart(4), f));
}
console.log(total ? `\nเจออีโมจิ ${total} จุด ใน ${per.length} ไฟล์ — ใช้ icon()/statusPill()/rankBadge() จาก lib/ui/icons.ts แทน` : 'ไม่มีอีโมจิในโค้ดหน้าเว็บ');
process.exit(total ? 1 : 0);
