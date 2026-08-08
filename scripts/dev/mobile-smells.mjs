// scripts/dev/mobile-smells.mjs — หา "อาการบนมือถือ" ที่ไม่ใช่แค่หน้าล้น
//
// ใช้:  npm run dev  (อีกหน้าต่าง)  แล้ว  node scripts/dev/mobile-smells.mjs [กว้าง] [หน้า,หน้า]
// รายงาน 4 อย่างที่ mobile-audit จับไม่ได้:
//   1. ตัวหนังสือถูกตัด   — เนื้อหากว้างกว่ากล่องตัวเอง (ตัวเลขเงินยาวๆ ในไทล์แคบ)
//   2. ล้นออกนอกพ่อแม่    — ลูกยื่นพ้นขอบกล่องแม่ (แม่ overflow ไม่ได้ตั้งไว้)
//   3. กริดหลายคอลัมน์    — จอ <600px ยังแบ่ง ≥3 คอลัมน์ (ผิดหลัก mobile first)
//   4. ตัวอักษรเล็กเกิน   — ต่ำกว่า 11px ซึ่งวรรณยุกต์ไทยเละ
//
// ⚠️ รอจนหน้าโหลดข้อมูลจริงเสร็จก่อนวัดเสมอ (บางหน้าใช้ 45-60 วิบน dev)
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9350;
const BASE = 'http://localhost:3000';
const WIDTH = Number(process.argv[2] || 390);
const VIEWS = (process.argv[3] || 'dashboard,sales,contentads,adminperf,kpi,profit,report,admins,umap,users').split(',');

const env = Object.fromEntries(fs.readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
  .split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--user-data-dir=' + process.env.TEMP + '/cdp-smells', 'about:blank'], { stdio: 'ignore' });
let ws, msgId = 0; const pending = new Map();
const send = (m, p = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method: m, params: p })); });
const evalIn = (expr) => send('Runtime.evaluate', { expression: expr, returnByValue: true }).then((r) => r.result.value);

const PROBE = (v) => `(() => {
  const root = document.getElementById('view-${v}');
  if (!root) return JSON.stringify({ err: 'ไม่มีหน้านี้' });
  const เล่า = (el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().split(/\\s+/).slice(0, 2).join('.') : '');
  const ตัด = [], ล้นแม่ = [], กริด = [], จิ๋ว = [];
  const seen = new Set();

  root.querySelectorAll('*').forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const cs = getComputedStyle(el);

    // 1) เนื้อหากว้างกว่ากล่อง และกล่องไม่ได้ตั้งให้เลื่อนเอง
    //    ข้าม text-overflow: ellipsis — นั่นคือ "ตั้งใจตัดแล้วใส่ …" ไม่ใช่อุบัติเหตุ
    if (cs.textOverflow !== 'ellipsis'
        && el.scrollWidth > el.clientWidth + 1 && cs.overflowX !== 'auto' && cs.overflowX !== 'scroll') {
      const t = (el.textContent || '').trim();
      if (t && el.children.length === 0) {
        ตัด.push({ ที่: เล่า(el), กล่องกว้าง: el.clientWidth, เนื้อหากว้าง: el.scrollWidth, ข้อความ: t.slice(0, 26) });
      }
    }

    // 2) ยื่นพ้นขอบกล่องแม่ ทั้งที่แม่ไม่ได้ตั้ง overflow ไว้
    const p = el.parentElement;
    if (p && p !== root) {
      const pr = p.getBoundingClientRect(), pcs = getComputedStyle(p);
      // margin ติดลบ = ตั้งใจให้ล้นออกไปชนขอบการ์ด (เช่น พื้น hover ของแถว) ไม่ใช่บั๊ก
      const นับmargin = parseFloat(cs.marginRight) || 0;
      if (pcs.overflow === 'visible' && นับmargin >= 0
          && pcs.position !== 'absolute' && cs.position !== 'absolute' && cs.position !== 'fixed') {
        const เกิน = Math.round(r.right - pr.right);
        if (เกิน > 2) ล้นแม่.push({ ที่: เล่า(el), ในกล่อง: เล่า(p), เกิน, ข้อความ: (el.textContent || '').trim().slice(0, 24) });
      }
    }

    // 3) กริด ≥3 คอลัมน์บนจอแคบ
    if (cs.display === 'grid') {
      const cols = cs.gridTemplateColumns.split(' ').filter(Boolean).length;
      if (cols >= 3 && !seen.has(เล่า(el))) { seen.add(เล่า(el)); กริด.push({ ที่: เล่า(el), คอลัมน์: cols, กว้างช่อง: Math.round(r.width / cols) }); }
    }

    // 4) ตัวอักษรเล็กกว่า 11px
    if (el.children.length === 0 && (el.textContent || '').trim()) {
      const fs2 = parseFloat(cs.fontSize);
      if (fs2 && fs2 < 10.9) จิ๋ว.push({ ที่: เล่า(el), ขนาด: fs2, ข้อความ: (el.textContent || '').trim().slice(0, 20) });
    }
  });
  const ย่อ = (a, n) => a.slice(0, n);
  return JSON.stringify({ ตัด: ย่อ(ตัด, 6), ล้นแม่: ย่อ(ล้นแม่, 6), กริด: ย่อ(กริด, 6), จิ๋ว: ย่อ(จิ๋ว, 4),
    รวม: { ตัด: ตัด.length, ล้นแม่: ล้นแม่.length, กริด: กริด.length, จิ๋ว: จิ๋ว.length } });
})()`;

async function main() {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    try { target = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())).find((t) => t.type === 'page'); }
    catch { await sleep(250); }
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 2, mobile: WIDTH < 900 });
  await send('Emulation.setTouchEmulationEnabled', { enabled: WIDTH < 900, maxTouchPoints: 5 });
  const res = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: env.TEST_LOGIN_USER, password: env.TEST_LOGIN_PASS }) });
  await send('Network.setCookies', { cookies: (res.headers.getSetCookie?.() || []).map((c) => {
    const nv = c.split(';')[0], i = nv.indexOf('='); return { name: nv.slice(0, i).trim(), value: nv.slice(i + 1), domain: 'localhost', path: '/' }; }) });
  await send('Page.navigate', { url: BASE + '/' });
  await sleep(4000);

  console.log(`\n🔎 อาการบนมือถือ — จอ ${WIDTH}px\n${'='.repeat(70)}`);
  for (const v of VIEWS) {
    await evalIn(`window.App && App.switchView(${JSON.stringify(v)})`);
    let ok = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 150000) {
      ok = await evalIn(`(() => { const c = document.getElementById('view-${v}');
        return !!c && !c.querySelector('.skel, .skel-line, .loading') && c.textContent.trim().length > 200; })()`);
      if (ok) break;
      await sleep(1000);
    }
    if (!ok) { console.log(`\n${v} — ⏭️ ข้าม (เปิดไม่ได้/โหลดไม่เสร็จ)`); continue; }
    await sleep(600);
    const d = JSON.parse(await evalIn(PROBE(v)));
    if (d.err) { console.log(`\n${v} — ${d.err}`); continue; }
    const n = d.รวม;
    const clean = !n.ตัด && !n.ล้นแม่ && !n.กริด && !n.จิ๋ว;
    console.log(`\n${v}  ${clean ? '🟢 ไม่มีอาการ' : 'ตัด ' + n.ตัด + ' | ล้นแม่ ' + n.ล้นแม่ + ' | กริด≥3คอลัมน์ ' + n.กริด + ' | ตัวจิ๋ว ' + n.จิ๋ว}`);
    d.ตัด.forEach((x) => console.log(`   ✂️  ${x.ที่} กล่อง ${x.กล่องกว้าง} < เนื้อหา ${x.เนื้อหากว้าง}  "${x.ข้อความ}"`));
    d.ล้นแม่.forEach((x) => console.log(`   ↔️  ${x.ที่} ยื่นพ้น ${x.ในกล่อง} ${x.เกิน}px  "${x.ข้อความ}"`));
    d.กริด.forEach((x) => console.log(`   ▦  ${x.ที่} ${x.คอลัมน์} คอลัมน์ ช่องละ ${x.กว้างช่อง}px`));
    d.จิ๋ว.forEach((x) => console.log(`   🔬 ${x.ที่} ${x.ขนาด}px  "${x.ข้อความ}"`));
  }
  ws.close();
}
main().then(() => { proc.kill(); process.exit(0); }).catch((e) => { console.error('FAIL', e.message); proc.kill(); process.exit(1); });
