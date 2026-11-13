const express = require('express');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const { BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_ID, YANDEX_KEY } = process.env;
const BASE = process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
const SECRET = crypto.createHash('sha256').update(BOT_TOKEN || '').digest('hex').slice(0, 32);
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

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
  if (calc !== hash) return null;
  if (Date.now() / 1000 - Number(p.get('auth_date')) > 86400) return null;
  try { return JSON.parse(p.get('user')); } catch { return null; }
}
const auth = (req, res, next) => {
  const u = verify(req.get('x-init-data'));
  if (!u) return res.status(401).json({ error: "Telegram orqali oching" });
  req.user = u;
  req.isAdmin = String(u.id) === String(ADMIN_ID);
  next();
};
const adminOnly = (req, res, next) =>
  req.isAdmin ? next() : res.status(403).json({ error: "Ruxsat yo'q" });
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => { console.error(e); res.status(500).json({ error: 'Server xatosi' }); });

app.get('/api/config', (_, res) => res.json({ yandexKey: YANDEX_KEY || '' }));

app.get('/api/me', auth, (req, res) => res.json({ isAdmin: req.isAdmin }));

app.get('/api/catalog', auth, wrap(async (_, res) => {
  const [c, p] = await Promise.all([
    db.from('categories').select('*').order('sort'),
    db.from('products').select('*').eq('active', true).order('created_at', { ascending: false }),
  ]);
  res.json({ categories: c.data || [], products: p.data || [] });
}));

// Buyurtma: narxlar serverda qayta hisoblanadi
app.post('/api/orders', auth, wrap(async (req, res) => {
  const { name, phone, address, items } = req.body || {};
  if (!name || !phone || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: "Ism, telefon va mahsulot kerak" });
  const ids = [...new Set(items.map((i) => Number(i.id)))];
  const { data: prods } = await db.from('products').select('id,name,price').in('id', ids).eq('active', true);
  const map = Object.fromEntries((prods || []).map((p) => [p.id, p]));
  const lines = [];
  let total = 0;
  for (const i of items) {
    const p = map[Number(i.id)];
    const qty = Math.max(1, Math.min(20, Number(i.qty) || 1));
    if (!p) continue;
    lines.push({ id: p.id, name: p.name, price: p.price, qty, size: i.size || null });
    total += p.price * qty;
  }
  if (!lines.length) return res.status(400).json({ error: "Mahsulotlar topilmadi" });
  const { data: order, error } = await db.from('orders').insert({
    tg_id: req.user.id, tg_username: req.user.username || null,
    name: String(name).slice(0, 80), phone: String(phone).slice(0, 30),
    address: String(address || '').slice(0, 300), items: lines, total,
  }).select().single();
  if (error) throw error;
  const text = `🛍 Yangi buyurtma #${order.id}\n👤 ${order.name}\n📞 ${order.phone}\n📍 ${order.address || '-'}\n` +
    lines.map((l) => `• ${l.name}${l.size ? ' / ' + l.size : ''} × ${l.qty} = ${l.price * l.qty}`).join('\n') +
    `\n💰 Jami: ${total} so'm` + (req.user.username ? `\n@${req.user.username}` : '');
  bot('sendMessage', { chat_id: ADMIN_ID, text });
  res.json({ ok: true, id: order.id, total });
}));

// Admin
app.post('/api/admin/products', auth, adminOnly, wrap(async (req, res) => {
  const b = req.body || {};
  if (!b.name || !(Number(b.price) >= 0)) return res.status(400).json({ error: 'Nom va narx kerak' });
  const { data, error } = await db.from('products').insert({
    name: b.name, price: Number(b.price), old_price: b.old_price ? Number(b.old_price) : null,
    category_id: b.category_id ? Number(b.category_id) : null, image: b.image || null,
    description: b.description || null,
    sizes: (b.sizes || '').split(',').map((s) => s.trim()).filter(Boolean),
  }).select().single();
  if (error) throw error;
  res.json(data);
}));
app.delete('/api/admin/products/:id', auth, adminOnly, wrap(async (req, res) => {
  await db.from('products').update({ active: false }).eq('id', req.params.id);
  res.json({ ok: true });
}));
app.get('/api/admin/orders', auth, adminOnly, wrap(async (_, res) => {
  const { data } = await db.from('orders').select('*').order('created_at', { ascending: false }).limit(30);
  res.json(data || []);
}));
app.patch('/api/admin/orders/:id', auth, adminOnly, wrap(async (req, res) => {
  const status = ['new', 'done', 'cancel'].includes(req.body.status) ? req.body.status : 'new';
  await db.from('orders').update({ status }).eq('id', req.params.id);
  res.json({ ok: true });
}));

// Bot webhook
app.post(`/webhook/${SECRET}`, (req, res) => {
  res.sendStatus(200);
  const m = req.body.message;
  if (m && m.text && m.text.startsWith('/start') && BASE) {
    bot('sendMessage', {
      chat_id: m.chat.id,
      text: "Brozzo* — erkaklar kiyimi. Katalogni ochish uchun pastdagi tugmani bosing.",
      reply_markup: { inline_keyboard: [[{ text: "Katalogni ochish", web_app: { url: BASE } }]] },
    });
  }
});

app.listen(process.env.PORT || 3000, async () => {
  console.log('Brozzo server ishga tushdi');
  if (BASE && BOT_TOKEN) {
    await bot('setWebhook', { url: `${BASE}/webhook/${SECRET}` });
    await bot('setChatMenuButton', { menu_button: { type: 'web_app', text: 'Katalog', web_app: { url: BASE } } });
  }
});
