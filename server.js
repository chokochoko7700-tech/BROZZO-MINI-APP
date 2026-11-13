const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const { BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_ID, YANDEX_KEY } = process.env;
const BASE = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
// Har deployda havola o'zgaradi — Telegram eski sahifani keshdan ko'rsatmaydi
const VER = (process.env.RENDER_GIT_COMMIT || String(Date.now())).slice(0, 7);
const APP_URL = BASE ? `${BASE.replace(/\/$/, '')}/?v=${VER}` : null;
const SECRET = crypto.createHash('sha256').update(BOT_TOKEN || '').digest('hex').slice(0, 32);
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const BUCKET = 'media';

const app = express();
app.use(express.json({ limit: '8mb' }));
app.use(express.static('public', {
  maxAge: '1h',
  setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate'); },
}));
app.get('/health', (_, res) => res.send('ok'));

const bot = (method, body) =>
  fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => ({}));

// Telegram initData tekshiruvi (HMAC)
function verify(initData) {
  if (!initData) return null;
  const p = new URLSearchParams(initData);
  const hash = p.get('hash');
  p.delete('hash');
  const str = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const key = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const calc = crypto.createHmac('sha256', key).update(str).digest('hex');
  if (!hash || calc.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calc), Buffer.from(hash))) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}
const auth = (req, res, next) => {
  const u = verify(req.get('x-init-data'));
  if (!u) return res.status(401).json({ error: 'Telegram orqali oching' });
  req.user = u;
  req.isAdmin = String(u.id) === String(ADMIN_ID);
  next();
};
const adminOnly = (req, res, next) => (req.isAdmin ? next() : res.status(403).json({ error: "Ruxsat yo'q" }));
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(500).json({ error: 'Server xatosi' }); });

const str = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const isUrl = (u) => typeof u === 'string' && /^https:\/\/[^\s"'()<>]+$/.test(u);
const urls = (a) => (Array.isArray(a) ? a.filter(isUrl).slice(0, 12) : []);
const som = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm";

app.get('/api/config', (_, res) => res.json({ yandexKey: YANDEX_KEY || '' }));
app.get('/api/me', auth, (req, res) => res.json({ isAdmin: req.isAdmin }));

app.get('/api/catalog', auth, wrap(async (_, res) => {
  const [c, p, b, s, r] = await Promise.all([
    db.from('categories').select('*').order('sort'),
    db.from('products').select('*').eq('active', true).order('created_at', { ascending: false }),
    db.from('banners').select('*').eq('active', true).order('sort').order('id', { ascending: false }),
    db.from('stories').select('*').eq('active', true).order('sort').order('id', { ascending: false }),
    db.from('reviews').select('product_id,rating'),
  ]);
  const rating = {};
  for (const x of r.data || []) {
    const o = (rating[x.product_id] ||= { sum: 0, n: 0 });
    o.sum += x.rating; o.n++;
  }
  const products = (p.data || []).map((x) => ({
    ...x,
    rating: rating[x.id] ? +(rating[x.id].sum / rating[x.id].n).toFixed(1) : null,
    reviews: rating[x.id]?.n || 0,
  }));
  res.json({ categories: c.data || [], products, banners: b.data || [], stories: s.data || [] });
}));

// Buyurtma: narxlar serverda qayta hisoblanadi
app.post('/api/orders', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 80), phone = str(b.phone, 30);
  const delivery = b.delivery === 'pickup' ? 'pickup' : 'delivery';
  const address = str(b.address, 300);
  if (!name || !phone || !Array.isArray(b.items) || !b.items.length)
    return res.status(400).json({ error: 'Ism, telefon va mahsulot kerak' });
  if (delivery === 'delivery' && !address) return res.status(400).json({ error: 'Manzilni kiriting' });
  let location = null;
  if (b.location && Number.isFinite(+b.location.lat) && Number.isFinite(+b.location.lng))
    location = { lat: +b.location.lat, lng: +b.location.lng };

  const ids = [...new Set(b.items.slice(0, 50).map((i) => Number(i.id)))];
  const { data: prods } = await db.from('products').select('id,name,price,image').in('id', ids).eq('active', true);
  const map = Object.fromEntries((prods || []).map((p) => [p.id, p]));
  const lines = [];
  let total = 0;
  for (const i of b.items.slice(0, 50)) {
    const p = map[Number(i.id)];
    if (!p) continue;
    const qty = Math.max(1, Math.min(20, Number(i.qty) || 1));
    lines.push({ id: p.id, name: p.name, price: p.price, qty, size: str(i.size, 20), image: p.image });
    total += p.price * qty;
  }
  if (!lines.length) return res.status(400).json({ error: 'Mahsulotlar topilmadi' });

  const { data: order, error } = await db.from('orders').insert({
    tg_id: req.user.id, tg_username: req.user.username || null, name, phone,
    address: delivery === 'pickup' ? "Do'kondan olib ketish" : address,
    delivery, location, comment: str(b.comment, 300), items: lines, total,
  }).select().single();
  if (error) throw error;

  const text = `🛍 Yangi buyurtma #${order.id}\n👤 ${name}\n📞 ${phone}\n` +
    (delivery === 'pickup' ? "🏬 Do'kondan olib ketadi\n" : `🚚 Yetkazish: ${address}\n`) +
    (order.comment ? `💬 ${order.comment}\n` : '') + '\n' +
    lines.map((l) => `• ${l.name}${l.size ? ' / ' + l.size : ''} × ${l.qty} = ${som(l.price * l.qty)}`).join('\n') +
    `\n\n💰 Jami: ${som(total)}` + (req.user.username ? `\n@${req.user.username}` : '');
  bot('sendMessage', { chat_id: ADMIN_ID, text }).then(() => {
    if (location) bot('sendLocation', { chat_id: ADMIN_ID, latitude: location.lat, longitude: location.lng });
  });
  bot('sendMessage', { chat_id: req.user.id, text: `✅ Buyurtmangiz #${order.id} qabul qilindi.\nJami: ${som(total)}\nTez orada siz bilan bog'lanamiz.` });
  res.json({ ok: true, id: order.id, total });
}));

app.get('/api/my/orders', auth, wrap(async (req, res) => {
  const { data } = await db.from('orders').select('*').eq('tg_id', req.user.id).order('created_at', { ascending: false }).limit(50);
  res.json(data || []);
}));

// Sharhlar
app.get('/api/reviews/:pid', auth, wrap(async (req, res) => {
  const { data } = await db.from('reviews').select('id,name,rating,text,created_at').eq('product_id', num(req.params.pid)).order('created_at', { ascending: false }).limit(50);
  res.json(data || []);
}));
app.get('/api/my/reviews', auth, wrap(async (req, res) => {
  const { data } = await db.from('reviews').select('*').eq('tg_id', req.user.id).order('created_at', { ascending: false });
  res.json(data || []);
}));
app.post('/api/reviews', auth, wrap(async (req, res) => {
  const b = req.body || {};
  const rating = Math.max(1, Math.min(5, num(b.rating) || 5));
  const product_id = num(b.product_id);
  if (!product_id) return res.status(400).json({ error: 'Mahsulot topilmadi' });
  const name = str(b.name, 60) || req.user.first_name || 'Mijoz';
  const { data: ex } = await db.from('reviews').select('id').eq('product_id', product_id).eq('tg_id', req.user.id).maybeSingle();
  const row = { product_id, tg_id: req.user.id, name, rating, text: str(b.text, 600) };
  const q = ex ? db.from('reviews').update(row).eq('id', ex.id) : db.from('reviews').insert(row);
  const { error } = await q;
  if (error) throw error;
  res.json({ ok: true });
}));

// ===== Admin =====
const A = [auth, adminOnly];

app.post('/api/admin/upload', A, wrap(async (req, res) => {
  const m = /^data:(image\/(webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.data || '');
  if (!m) return res.status(400).json({ error: 'Rasm formati noto\'g\'ri' });
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Rasm juda katta' });
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  const path = `${new Date().toISOString().slice(0, 7)}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: m[1], cacheControl: '31536000' });
  if (error) throw error;
  res.json({ url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
}));

function productRow(b) {
  const images = urls(b.images);
  return {
    name: str(b.name, 140), price: num(b.price), old_price: num(b.old_price),
    category_id: num(b.category_id), description: str(b.description, 2000),
    sizes: (Array.isArray(b.sizes) ? b.sizes : String(b.sizes || '').split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 15),
    images, image: images[0] || null,
  };
}
app.post('/api/admin/products', A, wrap(async (req, res) => {
  const row = productRow(req.body || {});
  if (!row.name || !(row.price >= 0)) return res.status(400).json({ error: 'Nom va narx kerak' });
  const { data, error } = await db.from('products').insert(row).select().single();
  if (error) throw error;
  res.json(data);
}));
app.patch('/api/admin/products/:id', A, wrap(async (req, res) => {
  const row = productRow(req.body || {});
  if (!row.name || !(row.price >= 0)) return res.status(400).json({ error: 'Nom va narx kerak' });
  const { data, error } = await db.from('products').update(row).eq('id', num(req.params.id)).select().single();
  if (error) throw error;
  res.json(data);
}));
app.delete('/api/admin/products/:id', A, wrap(async (req, res) => {
  await db.from('products').update({ active: false }).eq('id', num(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/admin/banners', A, wrap(async (req, res) => {
  const b = req.body || {};
  if (!isUrl(b.image)) return res.status(400).json({ error: 'Rasm kerak' });
  const { error } = await db.from('banners').insert({ image: b.image, product_id: num(b.product_id), sort: num(b.sort) || 0 });
  if (error) throw error;
  res.json({ ok: true });
}));
app.delete('/api/admin/banners/:id', A, wrap(async (req, res) => {
  await db.from('banners').delete().eq('id', num(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/admin/stories', A, wrap(async (req, res) => {
  const b = req.body || {};
  const images = urls(b.images);
  const cover = isUrl(b.cover) ? b.cover : images[0];
  if (!str(b.title, 40) || !cover) return res.status(400).json({ error: 'Nom va rasm kerak' });
  const { error } = await db.from('stories').insert({ title: str(b.title, 40), cover, images: images.length ? images : [cover], sort: num(b.sort) || 0 });
  if (error) throw error;
  res.json({ ok: true });
}));
app.delete('/api/admin/stories/:id', A, wrap(async (req, res) => {
  await db.from('stories').delete().eq('id', num(req.params.id));
  res.json({ ok: true });
}));

app.post('/api/admin/categories', A, wrap(async (req, res) => {
  const name = str(req.body?.name, 40);
  if (!name) return res.status(400).json({ error: 'Nom kerak' });
  const { error } = await db.from('categories').insert({ name, sort: num(req.body.sort) || 99 });
  if (error) throw error;
  res.json({ ok: true });
}));
app.delete('/api/admin/categories/:id', A, wrap(async (req, res) => {
  const id = num(req.params.id);
  await db.from('products').update({ category_id: null }).eq('category_id', id);
  await db.from('categories').delete().eq('id', id);
  res.json({ ok: true });
}));

app.get('/api/admin/orders', A, wrap(async (_, res) => {
  const { data } = await db.from('orders').select('*').order('created_at', { ascending: false }).limit(50);
  res.json(data || []);
}));
const STATUS = { confirmed: '✅ tasdiqlandi', done: '📦 yetkazildi', cancel: '❌ bekor qilindi' };
app.patch('/api/admin/orders/:id', A, wrap(async (req, res) => {
  const status = ['new', 'confirmed', 'done', 'cancel'].includes(req.body?.status) ? req.body.status : 'new';
  const { data } = await db.from('orders').update({ status }).eq('id', num(req.params.id)).select('id,tg_id').single();
  if (data && STATUS[status]) bot('sendMessage', { chat_id: data.tg_id, text: `Buyurtmangiz #${data.id} ${STATUS[status]}.` });
  res.json({ ok: true });
}));

// Bot webhook
app.post(`/webhook/${SECRET}`, (req, res) => {
  res.sendStatus(200);
  const m = req.body.message;
  if (m && m.text && m.text.startsWith('/start') && BASE) {
    bot('sendMessage', {
      chat_id: m.chat.id,
      text: "BROZZO* — premium erkaklar kiyimi.\nKatalog, chegirmalar va buyurtma — pastdagi tugmada 👇",
      reply_markup: { inline_keyboard: [[{ text: "🛍 Do'konni ochish", web_app: { url: APP_URL } }]] },
    });
  }
});

app.listen(process.env.PORT || 3000, async () => {
  console.log('Brozzo server ishga tushdi');
  if (BASE && BOT_TOKEN) {
    await bot('setWebhook', { url: `${BASE}/webhook/${SECRET}` });
    await bot('setChatMenuButton', { menu_button: { type: 'web_app', text: "Do'kon", web_app: { url: APP_URL } } });
  }
});
