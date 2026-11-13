# BROZZO* mini app

Telegram mini app (One23 uslubida): bosh sahifa (istoriyalar, bannerlar, chegirmalar), katalog, mahsulot sahifasi (galereya, o'lcham, sharhlar), savat, rasmiylashtirish (yetkazish / olib ketish, Yandex xarita), profil (xaridlarim, sevimlilar, sharhlarim, ma'lumotlarim, manzillarim, yordam, kontaktlar) va admin panel.

## Ishga tushirish (Render)
Build: `npm install`, Start: `node server.js`. Environment Variables:
- BOT_TOKEN — BotFather'dan
- SUPABASE_URL = https://sjrbonuivjznpazuwwhw.supabase.co
- SUPABASE_SERVICE_KEY — Supabase > Project Settings > API > service_role
- ADMIN_ID = 8893295978
- YANDEX_KEY — Yandex Maps JS API kaliti

Deploydan keyin server webhook va menyu tugmasini o'zi o'rnatadi. Botga /start yozing.

## Supabase
`supabase/schema-v2.sql` — bannerlar, istoriyalar, sharhlar, `media` bucket (allaqachon qo'llangan).

## Admin
Faqat ADMIN_ID egasi Profil > Admin panel'ni ko'radi: mahsulot (telefondan rasm yuklash, avtomatik siqiladi), buyurtmalar (holat o'zgarsa mijozga xabar boradi), bannerlar, istoriyalar, kategoriyalar.

## Sozlash
`public/index.html` boshidagi `SHOP` obyektida telefon, manzil, koordinata, matnlar.
Mahsulotga to'g'ridan-to'g'ri havola: `t.me/<bot>/<app>?startapp=p_<id>`.
