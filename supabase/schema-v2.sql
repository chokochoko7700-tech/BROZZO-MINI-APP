-- Brozzo mini app v2: rasmlar galereyasi, bannerlar, istoriyalar, sharhlar, rasm saqlash
alter table public.products add column if not exists images text[] not null default '{}';

alter table public.orders add column if not exists delivery text not null default 'delivery';
alter table public.orders add column if not exists location jsonb;
alter table public.orders add column if not exists comment text;

create table if not exists public.banners (
  id bigint generated always as identity primary key,
  image text not null,
  product_id bigint references public.products(id) on delete set null,
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.stories (
  id bigint generated always as identity primary key,
  title text not null,
  cover text not null,
  images text[] not null default '{}',
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.reviews (
  id bigint generated always as identity primary key,
  product_id bigint not null references public.products(id) on delete cascade,
  tg_id bigint not null,
  name text not null,
  rating int not null check (rating between 1 and 5),
  text text,
  created_at timestamptz not null default now()
);
create index if not exists reviews_product_idx on public.reviews(product_id);
create index if not exists orders_tg_idx on public.orders(tg_id);

-- Faqat server (service_role) kiradi: RLS yoqilgan, ochiq siyosat yo'q
alter table public.banners enable row level security;
alter table public.stories enable row level security;
alter table public.reviews enable row level security;

-- Rasmlar uchun ochiq (faqat o'qish) bucket; yuklash faqat server orqali
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 5242880, array['image/webp','image/jpeg','image/png'])
on conflict (id) do nothing;
