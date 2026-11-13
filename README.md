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

## v3 (2026-11-13)
- UptimeRobot: `https://brozzo-mini-app.onrender.com/health` ni 5 daqiqada tekshirsin — server uxlamaydi, Supabase ham to'xtamaydi.
- Admin panel → Sozlamalar: qo'shimcha adminlar, buyurtmalar guruhi (botni guruhga qo'shsangiz, ID'ni o'zi yozadi; `/id` buyrug'i), yetkazish narxi va bepul yetkazish chegarasi.
- Admin panel → Rassilka: botni ishga tushirgan barcha mijozlarga xabar (rasm + "Do'konni ochish" tugmasi).
- Admin panel → Statistika: bugun / 7 / 30 kun savdo, yangi buyurtmalar, mijozlar, top mahsulotlar.
- Mahsulot: "Sotuvda yo'q" belgisi. Istoriya: mahsulotga bog'lash ("Sotib olish" tugmasi).
- Rozilik belgisi + Maxfiylik siyosati sahifasi. UZ / RU tili (Profil → Til; Telegram tili ruscha bo'lsa avtomatik).
- Demo mahsulotlar `public/demo/` rasmlari bilan (Brozzo Instagram'idan).

## Xavfsizlik
- Har bir so'rov Telegram imzosi (initData HMAC-SHA256, 24 soat) bilan tekshiriladi; admin API faqat adminlar ID'si uchun.
- Supabase: barcha jadvallarda RLS yoqilgan, tashqaridan kirish yopiq; faqat server (service key) ishlaydi. Kalitlar faqat Render muhitida.
- Narxlar serverda qayta hisoblanadi, qoldiq tekshiriladi; buyurtma spami cheklangan (10 daqiqada 6 ta).
- Telegram webhook maxfiy sarlavha bilan tekshiriladi.
- Rasm yuklash faqat JPEG/PNG/WebP (SVG/HTML yo'q), 5 MB; har rasmning 480px nusxasi katalogda (trafik tejaladi).
- Xavfsizlik sarlavhalari (nosniff, HSTS, Referrer-Policy, Permissions-Policy); barcha matnlar ekranlanadi (XSS).

## Testlar
`node tests/run.js` — internet va paketlarsiz to'liq testlar: xavfsizlik, buyurtma himoyasi, qoldiq.
