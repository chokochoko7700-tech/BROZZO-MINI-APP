-- Brozzo mini app v3: mijozlar (rassilka uchun), sozlamalar, rassilkalar, "sotuvda yo'q", istoriya → mahsulot
create table if not exists public.users (
  tg_id bigint primary key, first_name text, username text, lang text,
  blocked boolean not null default false,
  created_at timestamptz not null default now(), last_seen timestamptz not null default now()
);
create table if not exists public.settings (key text primary key, value jsonb not null, updated_at timestamptz not null default now());
create table if not exists public.broadcasts (
  id bigint generated always as identity primary key, text text, image text,
  total int not null default 0, sent int not null default 0, failed int not null default 0,
  status text not null default 'running', created_at timestamptz not null default now()
);
alter table public.users enable row level security;
alter table public.settings enable row level security;
alter table public.broadcasts enable row level security;
alter table public.stories add column if not exists product_id bigint references public.products(id) on delete set null;
alter table public.products add column if not exists sold_out boolean not null default false;
alter table public.orders add column if not exists delivery_fee bigint not null default 0;
create index if not exists orders_created_idx on public.orders(created_at desc);
