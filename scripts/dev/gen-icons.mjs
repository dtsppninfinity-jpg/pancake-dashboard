// สร้าง lib/ui/icons.ts จาก lucide-static + simple-icons
// เตรียมแพ็กเกจครั้งแรก (ไม่ลงเป็น dependency ของโปรเจกต์):
//   mkdir -p temp/icon-pkgs && cd temp/icon-pkgs && npm pack lucide-static simple-icons
//   mkdir lucide si && tar -xzf lucide-static-*.tgz -C lucide && tar -xzf simple-icons-*.tgz -C si
// แล้วเติมชื่อไอคอนใน NAMES และรัน: node scripts/dev/gen-icons.mjs
import fs from 'node:fs';
const L = 'temp/icon-pkgs/lucide/package/icons/';
const S = 'temp/icon-pkgs/si/package/icons/';
const NAMES = `
layout-dashboard chart-column chart-bar chart-line chart-pie chart-no-axes-column trending-up trending-down activity
megaphone wallet target crosshair file-chart-column file-text file-spreadsheet file-down files users user user-round
user-plus user-check user-x user-cog users-round trophy award medal crown gauge network waypoints shield shield-check
shield-alert id-card contact briefcase store building-2 globe
menu sun moon refresh-cw refresh-ccw rotate-ccw log-out log-in x plus minus check check-check chevron-down chevron-up
chevron-left chevron-right chevrons-up-down arrow-up arrow-down arrow-left arrow-right arrow-up-right arrow-down-right
arrow-up-down arrow-down-wide-narrow external-link download upload save pencil trash-2 settings sliders-horizontal
funnel pause play square circle-stop key-round lock lock-open eye eye-off search copy clipboard clipboard-list
clipboard-check list list-ordered list-checks table-2 columns-3 layers grid-3x3 link unlink
calendar calendar-days calendar-clock clock clock-3 timer hourglass alarm-clock history bell bell-ring
triangle-alert circle-alert octagon-alert info circle-help circle-check circle-x circle-dot circle ban
message-circle message-square messages-square message-circle-reply mail inbox send phone
shopping-cart shopping-bag package package-check package-x receipt credit-card banknote coins piggy-bank hand-coins
percent hash sigma calculator scale
zap flame star sparkles sparkle brain bot lightbulb rocket repeat undo-2 redo-2 loader-circle
thumbs-up thumbs-down heart smile frown meh puzzle compass flag pin map-pin tag tags image video film
gift party-popper badge-check badge-alert hand mouse-pointer-click pointer keyboard camera music
sprout leaf moon-star coffee bed plug database server wifi-off cloud-off power
maximize-2 minimize-2 move grip-vertical ellipsis ellipsis-vertical
arrow-down-a-z arrow-down-1-0 arrow-up-1-0 scan-eye
truck wand-sparkles notebook-pen book-open newspaper presentation
headset
`.split(/\s+/).filter(Boolean);
const uniq = [...new Set(NAMES)];
const missing = uniq.filter((n) => !fs.existsSync(L + n + '.svg'));
if (missing.length) { console.error('MISSING', missing.join(' ')); process.exit(1); }
const inner = (svg) => svg.replace(/<!--[\s\S]*?-->/g, '').replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '')
  .replace(/\s*\n\s*/g, '').replace(/\s+\/>/g, '/>').trim();
const icons = {};
for (const n of uniq) icons[n] = inner(fs.readFileSync(L + n + '.svg', 'utf8'));
const brand = {};
for (const [k, file, hex, title] of [['facebook', 'facebook', '#0866FF', 'Facebook'], ['line', 'line', '#00C300', 'LINE'],
  ['messenger', 'messenger', '#0866FF', 'Messenger'], ['instagram', 'instagram', '#FF0069', 'Instagram'],
  ['tiktok', 'tiktok', 'currentColor', 'TikTok'], ['shopee', 'shopee', '#EE4D2D', 'Shopee']]) {
  const s = fs.readFileSync(S + file + '.svg', 'utf8');
  const d = (s.match(/<path d="([^"]+)"/) || [])[1];
  if (!d) { console.error('no path', k); process.exit(1); }
  brand[k] = { d, hex, title };
}
const tpl = fs.readFileSync('scripts/dev/icons.template.ts', 'utf8');
const body = tpl.replace('/*__PATHS__*/{}', JSON.stringify(icons, null, 1)).replace('/*__BRANDS__*/{}', JSON.stringify(brand, null, 1));
fs.writeFileSync('lib/ui/icons.ts', body);
console.log('icons', Object.keys(icons).length, 'brands', Object.keys(brand).length, 'bytes', body.length);
