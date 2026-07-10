# scripts/setup/import-xlsx.py
# นำเข้าข้อมูลย้อนหลังจากชีตเดิม (export .xlsx) → Supabase โดยตรง แทนการดึง API ซ้ำ
# ใช้:
#   python scripts/setup/import-xlsx.py verify            # ตรวจ timezone + นับแถว (ไม่เขียน DB)
#   python scripts/setup/import-xlsx.py import            # import ทุกตาราง (ยกเว้น Ads ที่ว่าง)
#   python scripts/setup/import-xlsx.py import orders      # import เฉพาะบางตาราง
#
# หมายเหตุ timezone: ชีตเก็บเวลาไทยแบบไม่มีโซน (เช่น 2026-06-22T16:54:31)
# ต้องแปลง +07:00 -> UTC ให้ตรงกับแถวที่ sync worker (mappers.toIso) เขียนไว้
import os, sys, json, io, datetime, urllib.request, urllib.error
import openpyxl

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

XLSX = os.path.join(os.path.dirname(__file__), '..', '..', 'Pancake POS Dashboard.xlsx')
ENV  = os.path.join(os.path.dirname(__file__), '..', '..', '.env.local')
BKK  = datetime.timezone(datetime.timedelta(hours=7))
UTC  = datetime.timezone.utc

# ---------------- env ----------------
def load_env(path):
    env = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENVV = load_env(ENV)
URL = ENVV.get('SUPABASE_URL', '').rstrip('/')
KEY = ENVV.get('SUPABASE_SERVICE_ROLE_KEY', '')
if not URL or not KEY:
    print('ยังไม่ได้ตั้ง SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน .env.local'); sys.exit(1)

# ---------------- coercion ----------------
def to_text(v):
    if v is None: return ''
    if isinstance(v, float) and v.is_integer(): return str(int(v))
    return str(v)

def to_int(v):
    if v in (None, ''): return None
    try: return int(float(v))
    except (ValueError, TypeError): return None

def to_num(v):
    if v in (None, ''): return None
    try: return float(v)
    except (ValueError, TypeError): return None

def to_bool(v):
    if v in (None, ''): return None
    return str(v).strip().lower() in ('true', '1', 'yes', 't')

def to_json(v):
    if v in (None, ''): return None
    if isinstance(v, (list, dict)): return v
    try: return json.loads(v)
    except (ValueError, TypeError): return None

def to_ts(v):
    """เวลาไทยไม่มีโซน -> UTC ISO (ตรงกับ mappers.toIso)"""
    if v in (None, ''): return None
    if isinstance(v, datetime.datetime):
        dt = v
    else:
        s = str(v).replace(' ', 'T')
        try:
            dt = datetime.datetime.fromisoformat(s)
        except ValueError:
            return str(v)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BKK)
    return dt.astimezone(UTC).isoformat().replace('+00:00', 'Z')

def to_date(v):
    if v in (None, ''): return None
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime('%Y-%m-%d')
    return str(v)[:10]

# ---------------- table config: sheet -> (table, pk, {col: coercer}) ----------------
COUNT_COLS = ['new_customer_count','new_inbox_count','customer_inbox_count','customer_comment_count',
              'page_inbox_count','page_comment_count','inbox_interactive_count','phone_number_count',
              'uniq_phone_number_count']

TABLES = {
    'Pages': ('pages', 'page_id', {
        'has_token': to_bool, 'updated_at': to_ts,
    }),
    'Orders': ('orders', 'id', {
        'status': to_int, 'items_count': to_int, 'items_json': to_json,
        'total_price': to_num, 'cod': to_num, 'transfer_money': to_num,
        'shipping_fee': to_num, 'total_discount': to_num,
        'inserted_at': to_ts, 'updated_at': to_ts,
    }),
    'ChatHourly': ('chat_hourly', 'key', dict(
        {'date': to_date, 'hour': to_int, 'updated_at': to_ts},
        **{c: to_int for c in COUNT_COLS})),
    'Conversations': ('conversations', 'id', {
        'message_count': to_int, 'inserted_at': to_ts, 'updated_at': to_ts,
        'waiting': to_bool, 'has_phone': to_bool, 'seen': to_bool,
    }),
    'AdminChatDaily': ('admin_chat_daily', 'key', {
        'date': to_date, 'inbox_count': to_int, 'comment_count': to_int,
        'unique_inbox_count': to_int, 'private_reply_count': to_int,
        'phone_number_count': to_int, 'avg_response_ms': to_num, 'updated_at': to_ts,
    }),
    'Admins': ('admins', 'user_id', {
        'is_online': to_bool, 'page_count': to_int, 'updated_at': to_ts,
    }),
    'Ads': ('ads', 'ad_id', {
        'spend': to_num, 'impressions': to_num, 'reach': to_num, 'clicks': to_num,
        'ctr': to_num, 'cpm': to_num, 'msgs_started': to_num, 'cost_per_msg': to_num,
        'order_created': to_num, 'order_shipped': to_num,
        'created_time': to_ts, 'start_time': to_ts, 'updated_at': to_ts,
    }),
}
DEFAULT_IMPORT = ['Pages', 'Orders', 'ChatHourly', 'Conversations', 'AdminChatDaily', 'Admins']  # Ads ว่าง → ข้าม

# ---------------- read + PostgREST ----------------
def read_sheet(wb, sheet):
    table, pk, coercers = TABLES[sheet]
    ws = wb[sheet]
    it = ws.iter_rows(values_only=True)
    header = list(next(it))
    rows = []
    for r in it:
        if not any(c is not None for c in r):
            continue
        d = {}
        for k, v in zip(header, r):
            fn = coercers.get(k, to_text)
            d[k] = fn(v)
        rows.append(d)
    return rows

def rest(method, path, body=None, extra_headers=None):
    headers = {'apikey': KEY, 'Authorization': f'Bearer {KEY}', 'Content-Type': 'application/json'}
    if extra_headers: headers.update(extra_headers)
    data = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else None
    req = urllib.request.Request(f'{URL}/rest/v1/{path}', data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, resp.read().decode('utf-8'), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8'), dict(e.headers)

def upsert(table, rows, pk):
    cols = [c.strip() for c in pk.split(',')]
    seen = {}
    for r in rows:
        seen['||'.join(str(r.get(c)) for c in cols)] = r
    uniq = list(seen.values())
    CHUNK = 500
    for i in range(0, len(uniq), CHUNK):
        batch = uniq[i:i + CHUNK]
        status, text, _ = rest('POST', f'{table}?on_conflict={pk}', batch,
                               {'Prefer': 'resolution=merge-duplicates,return=minimal'})
        if status >= 300:
            print(f'   ❌ upsert {table} [{i}:{i+len(batch)}] HTTP {status}: {text[:400]}')
            sys.exit(1)
        print(f'   ... {min(i+CHUNK, len(uniq))}/{len(uniq)}', end='\r')
    print(f'   ✅ {table}: upsert {len(uniq)} แถว' + ' ' * 20)
    return len(uniq)

def db_count(table):
    status, _, hdrs = rest('GET', f'{table}?select=*&limit=1', None,
                           {'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': '0-0'})
    cr = hdrs.get('Content-Range', '')
    return cr.split('/')[-1] if '/' in cr else '?'

# ---------------- verify timezone ----------------
def verify(wb):
    print('🔎 ตรวจสอบ timezone: เทียบ orders ในชีต กับแถวเดียวกันที่มีอยู่แล้วใน DB\n')
    rows = read_sheet(wb, 'Orders')
    by_id = {r['id']: r for r in rows}
    sample_ids = list(by_id.keys())[:50]
    id_list = ','.join(f'"{i}"' for i in sample_ids)
    status, text, _ = rest('GET', f'orders?id=in.({id_list})&select=id,inserted_at,updated_at', None)
    if status >= 300:
        print(f'   ❌ อ่าน DB ไม่ได้ HTTP {status}: {text[:300]}'); return
    db = {r['id']: r for r in json.loads(text)}
    matched = mismatched = 0
    shown = 0
    for oid in sample_ids:
        if oid not in db: continue
        want = by_id[oid]['inserted_at']
        got = db[oid]['inserted_at']
        # normalize db value to Z form for comparison
        got_n = to_ts(got) if got else None
        same = (want == got_n) or (str(want)[:19] == str(got)[:19])
        matched += same; mismatched += (not same)
        if shown < 5:
            print(f'   id={oid}  xlsx->{want}   DB={got}   {"✅ ตรง" if same else "⚠️ ต่าง"}')
            shown += 1
    overlap = matched + mismatched
    print(f'\n   สรุป: overlap {overlap} แถว | ตรง {matched} | ต่าง {mismatched}')
    if overlap == 0:
        print('   (ไม่มี id ซ้ำในตัวอย่าง — จะเทียบไม่ได้ แต่การแปลง +07:00->UTC ยังถูกต้องตาม mapper)')
    elif mismatched == 0:
        print('   ✅ timezone ตรงกับข้อมูลที่ API เขียนไว้ — import ได้เลย')
    else:
        print('   ⚠️ มีบางแถวไม่ตรง — ตรวจก่อน import')

# ---------------- main ----------------
def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'verify'
    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)

    if mode == 'verify':
        for sheet in TABLES:
            rows = read_sheet(wb, sheet)
            print(f'   {sheet:16s} xlsx={len(rows):>6}   DB={db_count(TABLES[sheet][0])}')
        print()
        verify(wb)
        return

    if mode == 'import':
        sheets = sys.argv[2:] or DEFAULT_IMPORT
        # normalize (allow lowercase table names too)
        name_map = {s.lower(): s for s in TABLES}
        for arg in sheets:
            sheet = arg if arg in TABLES else name_map.get(arg.lower())
            if not sheet:
                print(f'ไม่รู้จัก: {arg}'); continue
            table, pk, _ = TABLES[sheet]
            rows = read_sheet(wb, sheet)
            print(f'📥 {sheet} -> {table} ({len(rows)} แถว)')
            if not rows:
                print(f'   (ว่าง — ข้าม)'); continue
            upsert(table, rows, pk)
        print('\n📊 นับแถวหลัง import:')
        for sheet in (sys.argv[2:] and [name_map.get(a.lower(), a) for a in sys.argv[2:]] or DEFAULT_IMPORT):
            if sheet in TABLES:
                print(f'   {TABLES[sheet][0]:18s} {db_count(TABLES[sheet][0])}')
        return

    print(f'mode ไม่รู้จัก: {mode} (verify | import)')

if __name__ == '__main__':
    main()
