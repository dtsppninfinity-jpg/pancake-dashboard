-- 2026-07-27-app-users.sql — ผู้ใช้งานเว็บรายคน (แทนรหัสผ่านรวมทีมตัวเดียว)
--
-- ทำไม: เดิมทั้งทีมใช้ DASHBOARD_PASSWORD ร่วมกัน 1 ตัว → รู้ไม่ได้ว่าใครเข้า, ปิดสิทธิ์รายคนไม่ได้,
-- และแอดมินเห็นยอดขาย/ค่าแอด/ข้อมูลเพื่อนร่วมงานได้หมด ตอนนี้แยกเป็นบัญชีรายคน + ระดับสิทธิ์
--
-- role:
--   superadmin = ผู้ดูแลระบบ (ฝั่ง dev) — เห็นทุกอย่าง + จัดการผู้ใช้ได้
--   exec       = ระดับบริหาร — เห็นทุกหน้า แต่จัดการผู้ใช้ไม่ได้
--   admin      = ระดับแอดมิน (ชื่อ "ตำแหน่งงาน" ของทีมแชท ไม่ใช่ admin แบบ dev)
--                เห็นเฉพาะผลงานของตัวเอง ผูกกับ admins.user_id ผ่าน admin_user_id
--
-- password_hash รูปแบบ: scrypt$N$r$p$<saltBase64>$<hashBase64>  (ดู lib/auth.ts)
-- ใช้ scrypt ของ Node แทน bcrypt เพื่อไม่ต้องเพิ่ม dependency (ทำงานบน Vercel ได้เลย)

create table if not exists app_users (
  id             bigserial primary key,
  username       text        not null,
  password_hash  text        not null,
  name           text        not null default '',
  role           text        not null default 'admin',
  admin_user_id  text,                                  -- admins.user_id ของ Pancake (เฉพาะ role=admin)
  enabled        boolean     not null default true,
  must_change_pw boolean     not null default false,     -- true = บังคับตั้งรหัสใหม่ตอน login ครั้งแรก
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- username ต้องไม่ซ้ำแบบไม่สนตัวพิมพ์ (กัน "Somchai" กับ "somchai" เป็นคนละคน)
create unique index if not exists app_users_username_key on app_users (lower(username));
create index if not exists app_users_admin_user_id_idx on app_users (admin_user_id);
create index if not exists app_users_role_idx on app_users (role);

-- ห่อด้วย DO เพราะ `add constraint` ไม่มี `if not exists` — รันไฟล์ซ้ำจะ error ถ้าไม่ดักไว้
do $$
begin
  alter table app_users
    add constraint app_users_role_chk check (role in ('superadmin', 'exec', 'admin'))
    not valid;
exception when duplicate_object then null;
end $$;

comment on table  app_users              is 'บัญชีผู้ใช้เว็บ dashboard (รายคน) — แทนรหัสผ่านรวมทีม';
comment on column app_users.role         is 'superadmin=ผู้ดูแลระบบ | exec=ระดับบริหาร | admin=ระดับแอดมิน (เห็นเฉพาะของตัวเอง)';
comment on column app_users.admin_user_id is 'ผูกกับ admins.user_id ของ Pancake — ใช้ scope ข้อมูลให้ role=admin เห็นเฉพาะของตัวเอง';
