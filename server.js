const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const compression = require('compression');
const { createClient } = require('@supabase/supabase-js');
const { adjustStock } = require('./lib/sync');

const { BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_ID, YANDEX_KEY } = process.env;
const BASE = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
// Har deployda havola o'zgaradi — Telegram eski sahifani keshdan ko'rsatmaydi
const VER = (process.env.RENDER_GIT_COMMIT || String(Date.now())).slice(0, 7);
const APP_URL = BASE ? `${BASE.replace(/\/$/, '')}/?v=${VER}` : null;
const SECRET = crypto.createHash('sha256').update(BOT_TOKEN || '').digest('hex').slice(0, 32);
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const BUCKET = 'media';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(compression());
// Xavfsizlik sarlavhalari (Telegram ichida ochilishiga xalaqit bermaydi)
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  next();
});
// Oddiy so'rov cheklovchi (spam va parol tanlashdan himoya)
const HITS = new Map();
function tooMany(key, max, ms) {
  const now = Date.now(), a = (HITS.get(key) || []).filter((t) => now - t < ms);
  a.push(now); HITS.set(key, a);
  if (HITS.size > 20000) for (const [k, v] of HITS) if (!v.some((t) => now - t < 3600e3)) HITS.delete(k);
  return a.length > max;
}
const clientIp = (req) => String(req.get('x-forwarded-for') || req.socket?.remoteAddress || '').split(',')[0].trim();
app.use(express.json({ limit: '20mb' }));

/* ===== TEZLIK: index.html ichiga katalog va ikonkalar qo'shib yuboriladi (qo'shimcha so'rovsiz ochiladi) ===== */
const HTML_PATH = path.join(__dirname, 'public', 'index.html');
const HTML = fs.readFileSync(HTML_PATH, 'utf8');
// Ilovada ishlatilgan Solar ikonkalari nomlari HTML'dan avtomatik yig'iladi
const ICON_NAMES = [...new Set([...HTML.matchAll(/['"]([a-z0-9]+(?:-[a-z0-9]+)*-(?:linear|bold))['"]/g)].map((m) => m[1]))];
let ICONS = {}, iconsAt = 0;
async function loadIcons() {
  if (Date.now() - iconsAt < 5 * 60000 && Object.keys(ICONS).length) return;
  iconsAt = Date.now();
  try {
    const r = await fetch(`https://api.iconify.design/solar.json?icons=${ICON_NAMES.join(',')}`);
    const j = await r.json();
    const out = {};
    for (const [k, v] of Object.entries(j.icons || {})) out[k] = [v.body, v.width || j.width || 24, v.height || j.height || 24];
    for (const [k, v] of Object.entries(j.aliases || {})) if (out[v.parent]) out[k] = out[v.parent];
    if (Object.keys(out).length) ICONS = out;
    console.log('Ikonkalar yuklandi:', Object.keys(ICONS).length, '/', ICON_NAMES.length);
  } catch (e) { console.error('Ikonkalar yuklanmadi', e.message); }
}
loadIcons();

// Katalog keshi (20 soniya); admin o'zgartirsa darhol yangilanadi
let CAT = null, catAt = 0, catP = null;
async function getCatalog(force) {
  if (!force && CAT && Date.now() - catAt < 20000) return CAT;
  if (catP) return catP;
  catP = (async () => {
    const [c, p, b, s, r] = await Promise.all([
      db.from('categories').select('*').order('sort'),
      db.from('products').select('*').eq('active', true).eq('draft', false).order('created_at', { ascending: false }),
      db.from('banners').select('*').eq('active', true).order('sort').order('id', { ascending: false }),
      db.from('stories').select('*').eq('active', true).order('sort').order('id', { ascending: false }),
      db.from('reviews').select('product_id,rating'),
    ]);
    if (c.error || p.error) throw c.error || p.error;
    const rating = {};
    for (const x of r.data || []) { const o = (rating[x.product_id] ||= { sum: 0, n: 0 }); o.sum += x.rating; o.n++; }
    const products = (p.data || []).map(({ external_id, synced_at, ...x }) => ({
      ...x, rating: rating[x.id] ? +(rating[x.id].sum / rating[x.id].n).toFixed(1) : null, reviews: rating[x.id]?.n || 0,
    }));
    CAT = { categories: c.data || [], products, banners: b.data || [], stories: s.data || [] };
    catAt = Date.now();
    return CAT;
  })().finally(() => { catP = null; });
  return catP;
}
const dropCatalog = () => { CAT = null; };
const invalidate = (req, res, next) => { if (req.method !== 'GET') res.on('finish', () => { if (res.statusCode < 400) dropCatalog(); }); next(); };

const safeJson = (o) => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

app.get(['/', '/index.html'], async (_, res) => {
  let cat = null;
  try { cat = await getCatalog(); } catch {}
  if (!Object.keys(ICONS).length) loadIcons();
  const inject = `<script>window.__ICONS=${safeJson(ICONS)};window.__CAT=${cat ? safeJson(cat) : 'null'};</script>`;
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.type('html').send(HTML.replace('</head>', inject + '</head>'));
});
app.use(express.static('public', {
  maxAge: '1h',
  setHeaders: (res, file) => {
    if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    else if (file.includes(`${path.sep}demo${path.sep}`) || file.endsWith('logo.png')) res.setHeader('Cache-Control', 'public, max-age=604800');
  },
}));
// UptimeRobot shu manzilni tekshiradi: server uxlamaydi, Supabase ham faol qoladi
app.get('/health', async (_, res) => {
  const { error } = await db.from('categories').select('id').limit(1);
  res.status(error ? 500 : 200).send(error ? 'db error' : 'ok');
});

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
// Sozlamalar (adminlar, buyurtma guruhi, yetkazish narxi) — bazada, 30 soniya keshlanadi
const DEF = { admins: [], notify_chat: null, delivery_fee: 0, free_from: 0 };
let SET = { ...DEF }, setAt = 0;
async function settings(force) {
  if (!force && Date.now() - setAt < 30000) return SET;
  const { data } = await db.from('settings').select('key,value');
  SET = { ...DEF, ...Object.fromEntries((data || []).map((r) => [r.key, r.value])) };
  setAt = Date.now();
  return SET;
}
const adminIds = (s) => [...new Set([String(ADMIN_ID), ...(s.admins || []).map(String)])];
const seen = new Map();
function touchUser(u, lang) {
  if (!u?.id || Date.now() - (seen.get(u.id) || 0) < 10 * 60000) return;
  if (seen.size > 20000) seen.clear(); // xotira cheksiz o'smasin
  seen.set(u.id, Date.now());
  db.from('users').upsert({ tg_id: u.id, first_name: u.first_name || null, username: u.username || null, lang: lang || u.language_code || null, blocked: false, last_seen: new Date().toISOString() }).then(() => {}, () => {});
}
const auth = async (req, res, next) => {
  const u = verify(req.get('x-init-data'));
  if (!u) return res.status(401).json({ error: 'Telegram orqali oching' });
  req.user = u;
  try { req.isAdmin = adminIds(await settings()).includes(String(u.id)); } catch { req.isAdmin = String(u.id) === String(ADMIN_ID); }
  touchUser(u);
  next();
};
const notifyChats = async () => { const s = await settings(); return s.notify_chat ? [s.notify_chat] : adminIds(s); };
const adminOnly = (req, res, next) => (req.isAdmin ? next() : res.status(403).json({ error: "Ruxsat yo'q" }));
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(500).json({ error: 'Server xatosi' }); });

const str = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const isUrl = (u) => typeof u === 'string' && /^https:\/\/[^\s"'()<>]+$/.test(u);
const urls = (a) => (Array.isArray(a) ? a.filter(isUrl).slice(0, 12) : []);
const som = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + " so'm";

app.get('/api/config', async (_, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const s = await settings().catch(() => DEF);
  res.json({ yandexKey: YANDEX_KEY || '', ver: VER, delivery_fee: +s.delivery_fee || 0, free_from: +s.free_from || 0 });
});
app.get('/api/me', auth, (req, res) => res.json({ isAdmin: req.isAdmin }));

app.get('/api/catalog', wrap(async (_, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json(await getCatalog());
}));

// Buyurtma: narxlar serverda qayta hisoblanadi
app.post('/api/orders', auth, wrap(async (req, res) => {
  if (tooMany('o' + req.user.id, 6, 10 * 60000)) return res.status(429).json({ error: "Juda ko'p buyurtma. Birozdan keyin urinib ko'ring" });
  const b = req.body || {};
  const name = str(b.name, 80), phone = str(b.phone, 30);
  const delivery = b.delivery === 'pickup' ? 'pickup' : 'delivery';
  const address = str(b.address, 300);
  if (!name || !phone || !Array.isArray(b.items) || !b.items.length)
    return res.status(400).json({ error: 'Ism, telefon va mahsulot kerak' });
  if (!/^\+?[\d\s()-]{7,20}$/.test(phone)) return res.status(400).json({ error: "Telefon raqami noto'g'ri" });
  if (delivery === 'delivery' && !address) return res.status(400).json({ error: 'Manzilni kiriting' });
  if (b.agree !== true) return res.status(400).json({ error: 'Shartlarga rozilik bering' });
  let location = null;
  if (b.location && Number.isFinite(+b.location.lat) && Number.isFinite(+b.location.lng))
    location = { lat: +b.location.lat, lng: +b.location.lng };

  const ids = [...new Set(b.items.slice(0, 50).map((i) => Number(i.id)))];
  const { data: prods } = await db.from('products').select('id,name,price,image,stock,qty').in('id', ids).eq('active', true).eq('draft', false).eq('sold_out', false);
  const map = Object.fromEntries((prods || []).map((p) => [p.id, p]));
  const lines = [];
  let total = 0;
  for (const i of b.items.slice(0, 50)) {
    const p = map[Number(i.id)];
    if (!p) continue;
    const qty = Math.max(1, Math.min(20, Number(i.qty) || 1));
    const size = str(i.size, 20);
    // Qoldiq hisob dasturidan kelgan bo'lsa — tekshiramiz
    const left = p.stock && size && p.stock[size] != null ? p.stock[size] : p.qty;
    if (left != null && left < qty) return res.status(409).json({ error: left > 0 ? `"${p.name}"${size ? ' (' + size + ')' : ''} — faqat ${left} ta qoldi` : `"${p.name}"${size ? ' (' + size + ')' : ''} tugab qoldi` });
    lines.push({ id: p.id, name: p.name, price: p.price, qty, size: str(i.size, 20), image: p.image });
    total += p.price * qty;
  }
  if (!lines.length) return res.status(400).json({ error: 'Mahsulotlar topilmadi' });
  const st = await settings();
  const fee = delivery === 'delivery' && !(+st.free_from && total >= +st.free_from) ? (+st.delivery_fee || 0) : 0;
  total += fee;

  const { data: order, error } = await db.from('orders').insert({
    tg_id: req.user.id, tg_username: req.user.username || null, name, phone,
    address: delivery === 'pickup' ? "Do'kondan olib ketish" : address,
    delivery, location, comment: str(b.comment, 300), items: lines, total, delivery_fee: fee,
  }).select().single();
  if (error) throw error;
  adjustStock(db, lines, -1).then(dropCatalog, (e) => console.error('Qoldiq', e));

  const text = `🛍 Yangi buyurtma #${order.id}\n👤 ${name}\n📞 ${phone}\n` +
    (delivery === 'pickup' ? "🏬 Do'kondan olib ketadi\n" : `🚚 Yetkazish: ${address}\n`) +
    (order.comment ? `💬 ${order.comment}\n` : '') + '\n' +
    lines.map((l) => `• ${l.name}${l.size ? ' / ' + l.size : ''} × ${l.qty} = ${som(l.price * l.qty)}`).join('\n') +
    (fee ? `\n🚚 Yetkazish: ${som(fee)}` : '') +
    `\n\n💰 Jami: ${som(total)}` + (req.user.username ? `\n@${req.user.username}` : '');
  for (const chat_id of await notifyChats()) {
    bot('sendMessage', { chat_id, text }).then(() => {
      if (location) bot('sendLocation', { chat_id, latitude: location.lat, longitude: location.lng });
    });
  }
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
app.post('/api/reviews', auth, invalidate, wrap(async (req, res) => {
  if (tooMany('r' + req.user.id, 10, 10 * 60000)) return res.status(429).json({ error: "Juda ko'p urinish" });
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
const A = [auth, adminOnly, invalidate];

app.post('/api/admin/upload', A, wrap(async (req, res) => {
  const m = /^data:(image\/(webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.data || '');
  if (!m) return res.status(400).json({ error: 'Rasm formati noto\'g\'ri' });
  const buf = Buffer.from(m[3], 'base64');
  if (buf.length > 5 * 1024 * 1024) return res.status(400).json({ error: 'Rasm juda katta' });
  const ext = m[2] === 'jpeg' ? 'jpg' : m[2];
  // Kichik nusxa (480px) — katalog ro'yxatida shu yuklanadi: trafik ~6 barobar kam
  const t = /^data:(image\/(webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(req.body?.thumb || '');
  const tbuf = t && t[1] === m[1] ? Buffer.from(t[3], 'base64') : null;
  const base = `${new Date().toISOString().slice(0, 7)}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}${tbuf && tbuf.length < 600 * 1024 ? '-x' : ''}`;
  const path = `${base}.${ext}`;
  const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: m[1], cacheControl: '31536000' });
  if (error) throw error;
  if (base.endsWith('-x')) await db.storage.from(BUCKET).upload(`${base}_t.${ext}`, tbuf, { contentType: m[1], cacheControl: '31536000' });
  res.json({ url: db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl });
}));

function productRow(b) {
  const images = urls(b.images);
  return {
    name: str(b.name, 140), price: num(b.price), old_price: num(b.old_price),
    category_id: num(b.category_id), description: str(b.description, 2000),
    sizes: (Array.isArray(b.sizes) ? b.sizes : String(b.sizes || '').split(',')).map((s) => String(s).trim()).filter(Boolean).slice(0, 15),
    images, image: images[0] || null, sold_out: !!b.sold_out, sku: str(b.sku, 60), barcode: str(b.barcode, 60),
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
  if (req.body?.publish) row.draft = false;
  const { data, error } = await db.from('products').update(row).eq('id', num(req.params.id)).select().single();
  if (error) throw error;
  res.json(data);
}));
// Tezkor belgi: sotuvda bor/yo'q
app.patch('/api/admin/products/:id/flags', A, wrap(async (req, res) => {
  const { error } = await db.from('products').update({ sold_out: !!req.body?.sold_out }).eq('id', num(req.params.id));
  if (error) throw error;
  res.json({ ok: true });
}));
// Tartib (bannerlar, istoriyalar, kategoriyalar)
const SORTABLE = { banners: 'banners', stories: 'stories', categories: 'categories' };
app.post('/api/admin/reorder', A, wrap(async (req, res) => {
  const table = SORTABLE[req.body?.table];
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(num).filter(Boolean).slice(0, 200);
  if (!table || !ids.length) return res.status(400).json({ error: "Noto'g'ri so'rov" });
  await Promise.all(ids.map((id, i) => db.from(table).update({ sort: i + 1 }).eq('id', id)));
  res.json({ ok: true });
}));
app.patch('/api/admin/categories/:id', A, wrap(async (req, res) => {
  const name = str(req.body?.name, 40);
  if (!name) return res.status(400).json({ error: 'Nom kerak' });
  const { error } = await db.from('categories').update({ name }).eq('id', num(req.params.id));
  if (error) throw error;
  res.json({ ok: true });
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
  const { error } = await db.from('stories').insert({ title: str(b.title, 40), cover, images: images.length ? images : [cover], product_id: num(b.product_id), sort: num(b.sort) || 0 });
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
  const { data } = await db.from('orders').select('*').order('created_at', { ascending: false }).limit(150);
  res.json(data || []);
}));
const STATUS = { confirmed: '✅ tasdiqlandi', done: '📦 yetkazildi', cancel: '❌ bekor qilindi' };
app.patch('/api/admin/orders/:id', A, wrap(async (req, res) => {
  const status = ['new', 'confirmed', 'done', 'cancel'].includes(req.body?.status) ? req.body.status : 'new';
  const { data: prev } = await db.from('orders').select('status,items').eq('id', num(req.params.id)).single();
  const { data } = await db.from('orders').update({ status }).eq('id', num(req.params.id)).select('id,tg_id').single();
  // Bekor qilinsa — qoldiq qaytadi; qayta ochilsa — yana ayiriladi
  if (prev && (prev.status === 'cancel') !== (status === 'cancel')) adjustStock(db, prev.items || [], status === 'cancel' ? 1 : -1).catch(() => {});
  if (data && STATUS[status]) bot('sendMessage', { chat_id: data.tg_id, text: `Buyurtmangiz #${data.id} ${STATUS[status]}.` });
  res.json({ ok: true });
}));

// Sozlamalar
app.get('/api/admin/settings', A, wrap(async (_, res) => {
  const s = await settings(true);
  const { count } = await db.from('users').select('tg_id', { count: 'exact', head: true });
  res.json({ ...s, owner: String(ADMIN_ID), users: count || 0 });
}));
app.put('/api/admin/settings', A, wrap(async (req, res) => {
  const b = req.body || {};
  const rows = [
    { key: 'admins', value: (Array.isArray(b.admins) ? b.admins : []).map((x) => String(x).replace(/\D/g, '')).filter(Boolean).slice(0, 10) },
    { key: 'notify_chat', value: /^-?\d+$/.test(String(b.notify_chat || '').trim()) ? String(b.notify_chat).trim() : null },
    { key: 'delivery_fee', value: Math.max(0, num(b.delivery_fee) || 0) },
    { key: 'free_from', value: Math.max(0, num(b.free_from) || 0) },
  ].map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  const { error } = await db.from('settings').upsert(rows);
  if (error) throw error;
  res.json(await settings(true));
}));

// Statistika
app.get('/api/admin/stats', A, wrap(async (_, res) => {
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [{ data: orders }, { count: users }, { count: newUsers }] = await Promise.all([
    db.from('orders').select('total,status,items,created_at').gte('created_at', since).limit(5000),
    db.from('users').select('tg_id', { count: 'exact', head: true }),
    db.from('users').select('tg_id', { count: 'exact', head: true }).gte('created_at', new Date(Date.now() - 7 * 864e5).toISOString()),
  ]);
  const ok = (orders || []).filter((o) => o.status !== 'cancel');
  const day0 = new Date(); day0.setHours(0, 0, 0, 0);
  const sum = (arr) => ({ count: arr.length, revenue: arr.reduce((a, o) => a + Number(o.total || 0), 0) });
  const top = {};
  for (const o of ok) for (const i of o.items || []) { const t = (top[i.id] ||= { id: i.id, name: i.name, image: i.image, qty: 0 }); t.qty += i.qty; }
  res.json({
    today: sum(ok.filter((o) => new Date(o.created_at) >= day0)),
    week: sum(ok.filter((o) => Date.now() - new Date(o.created_at) < 7 * 864e5)),
    month: sum(ok),
    newOrders: (orders || []).filter((o) => o.status === 'new').length,
    users: users || 0, newUsers: newUsers || 0,
    top: Object.values(top).sort((a, b) => b.qty - a.qty).slice(0, 5),
  });
}));

// Rassilka (barcha mijozlarga xabar)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function runBroadcast(id, text, image, product) {
  const users = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from('users').select('tg_id').eq('blocked', false).range(from, from + 999);
    users.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  await db.from('broadcasts').update({ total: users.length }).eq('id', id);
  const url = product ? `${APP_URL}&p=${product}` : APP_URL;
  const reply_markup = APP_URL ? { inline_keyboard: [[{ text: "🛍 Do'konni ochish", web_app: { url } }]] } : undefined;
  let sent = 0, failed = 0;
  for (let i = 0; i < users.length; i++) {
    const chat_id = users[i].tg_id;
    const r = image
      ? await bot('sendPhoto', { chat_id, photo: image, caption: text || undefined, reply_markup })
      : await bot('sendMessage', { chat_id, text, reply_markup });
    if (r.ok) sent++;
    else {
      failed++;
      if (r.error_code === 403) await db.from('users').update({ blocked: true }).eq('tg_id', chat_id);
      if (r.error_code === 429) { await sleep(((r.parameters?.retry_after) || 3) * 1000); i--; failed--; continue; }
    }
    if (i % 25 === 24) await db.from('broadcasts').update({ sent, failed }).eq('id', id);
    await sleep(45); // Telegram limiti: ~25 xabar/soniya
  }
  await db.from('broadcasts').update({ sent, failed, status: 'done' }).eq('id', id);
}
app.post('/api/admin/broadcast', A, wrap(async (req, res) => {
  const text = str(req.body?.text, 1000), image = isUrl(req.body?.image) ? req.body.image : null;
  if (!text && !image) return res.status(400).json({ error: 'Matn yoki rasm kerak' });
  const { data, error } = await db.from('broadcasts').insert({ text, image }).select().single();
  if (error) throw error;
  runBroadcast(data.id, text, image, num(req.body?.product_id)).catch(async (e) => {
    console.error(e); await db.from('broadcasts').update({ status: 'error' }).eq('id', data.id);
  });
  res.json(data);
}));
app.get('/api/admin/broadcasts', A, wrap(async (_, res) => {
  const { data } = await db.from('broadcasts').select('*').order('id', { ascending: false }).limit(5);
  res.json(data || []);
}));

// Bot webhook
app.post(`/webhook/${SECRET}`, (req, res) => {
  if (req.get('x-telegram-bot-api-secret-token') !== SECRET) return res.sendStatus(403);
  res.sendStatus(200);
  const u = req.body || {};
  // Bot guruhga qo'shilsa — guruh ID'sini aytadi (buyurtmalar guruhi uchun)
  const mc = u.my_chat_member;
  if (mc && ['group', 'supergroup'].includes(mc.chat.type) && ['member', 'administrator'].includes(mc.new_chat_member?.status)) {
    bot('sendMessage', { chat_id: mc.chat.id, text: `Salom! Bu guruh ID'si: ${mc.chat.id}\nBuyurtmalar shu guruhga kelishi uchun ilovada Admin panel → Sozlamalar → "Buyurtmalar guruhi" ga kiriting.` });
    return;
  }
  const m = u.message;
  if (!m || !m.text) return;
  if (m.text.startsWith('/id')) return bot('sendMessage', { chat_id: m.chat.id, text: `Chat ID: ${m.chat.id}` });
  if (m.chat.type !== 'private') return;
  if (m.from) { seen.delete(m.from.id); touchUser(m.from); }
  if (m.text.startsWith('/start') && APP_URL) {
    const ru = (m.from?.language_code || '').startsWith('ru');
    bot('sendMessage', {
      chat_id: m.chat.id,
      text: ru ? "BROZZO* — премиальная мужская одежда.\nКаталог, скидки и заказ — по кнопке ниже 👇" : "BROZZO* — premium erkaklar kiyimi.\nKatalog, chegirmalar va buyurtma — pastdagi tugmada 👇",
      reply_markup: { inline_keyboard: [[{ text: ru ? '🛍 Открыть магазин' : "🛍 Do'konni ochish", web_app: { url: APP_URL } }]] },
    });
  }
});

app.listen(process.env.PORT || 3000, async () => {
  console.log('Brozzo server ishga tushdi');
  if (BASE && BOT_TOKEN) {
    await bot('setWebhook', { url: `${BASE}/webhook/${SECRET}`, secret_token: SECRET, allowed_updates: ['message', 'my_chat_member'] });
    await bot('setChatMenuButton', { menu_button: { type: 'web_app', text: "Do'kon", web_app: { url: APP_URL } } });
  }
});
