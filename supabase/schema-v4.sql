-- v4: hisob dasturlari bilan integratsiya (1C, BILLZ, YesPOS, Excel)
alter table products
  add column if not exists external_id text,
  add column if not exists sku text,
  add column if not exists barcode text,
  add column if not exists stock jsonb,          -- {"M":3,"L":0} — o'lcham bo'yicha qoldiq
  add column if not exists qty integer,          -- jami qoldiq
  add column if not exists source text not null default 'manual',
  add column if not exists draft boolean not null default false, -- rasm kutayotgan yangi tovar
  add column if not exists synced_at timestamptz;
create unique index if not exists products_source_ext_uq on products(source, external_id);
create index if not exists products_sku_idx on products(lower(sku));
create index if not exists products_barcode_idx on products(barcode);
create table if not exists integration (key text primary key, value jsonb, updated_at timestamptz default now());
create table if not exists sync_log (
  id bigserial primary key, source text not null, ok boolean not null default true,
  added int default 0, updated int default 0, hidden int default 0, skipped int default 0,
  message text, created_at timestamptz default now());
alter table integration enable row level security;
alter table sync_log enable row level security;
