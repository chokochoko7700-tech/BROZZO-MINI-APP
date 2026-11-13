# Brozzo* mini app

Telegram mini app: katalog, savat, buyurtma, Yandex xarita, admin panel.

## Ishga tushirish (Render)
1. Fayllarni yangi GitHub repoga yuklang.
2. Render > New > Web Service > shu repo. Build: `npm install`, Start: `node server.js`.
3. Environment Variables:
   - BOT_TOKEN (BotFather'dan, yangilangan token)
   - SUPABASE_URL = https://sjrbonuivjznpazuwwhw.supabase.co
   - SUPABASE_SERVICE_KEY (Supabase > Project Settings > API > service_role)
   - ADMIN_ID = 8893295978
   - YANDEX_KEY
4. Deploy tugagach server webhook va menyu tugmasini o'zi o'rnatadi. Botga /start yozing.

## Admin
Faqat ADMIN_ID egasi mini appda "Admin" tabini ko'radi: mahsulot qo'shish/o'chirish, buyurtmalar.
Rasm hozircha havola (URL) orqali qo'shiladi.

## Eslatma
`public/index.html` ichidagi SHOP koordinatasi taxminiy, aniq joyga almashtiring.
