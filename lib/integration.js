// Integratsiya: sozlamalar, avtomatik sinxronlash, Excel import va 1C manzili
const crypto = require('crypto');
const express = require('express');
const { applySync } = require('./sync');
const { parseTable } = require('./table');
const { billzFetch, billzShops, apiFetch } = require('./connectors');
const { onecHandler } = require('./onec');

const TYPES = ['none', 'excel', 'onec', 'billz', 'yespos'];
const SOURCE = { excel: 'excel', onec: 'onec', billz: 'billz', yespos: 'yespos' };
const DEF = {
  type: 'none', interval: 15, auto_publish: false, update_names: false, update_prices: true, hide_missing: true, create_categories: true,
  billz_token: '', billz_shop_id: '', billz_shop_name: '', onec_login: '', onec_password: '', onec_price_type: '',
  yespos_mode: 'excel', api_url: '', api_token: '', api_header: '',
};
const mask = (s) => (s ? '••••' + String(s).slice(-4) : '');

module.exports = function integration({ app, db, A, wrap, dropCatalog, bot, notifyChats, BASE, BUCKET, tooMany, clientIp }) {
  let CFG = null, cfgAt = 0;
  const getKey = async (k) => (await db.from('integration').select('value').eq('key', k).maybeSingle()).data?.value ?? null;
  const setKey = (k, value) => db.from('integration').upsert({ key: k, value, updated_at: new Date().toISOString() });
  async function getCfg(force) {
    if (!force && CFG && Date.now() - cfgAt < 15000) return CFG;
    CFG = { ...DEF, ...((await getKey('config')) || {}) }; cfgAt = Date.now();
    return CFG;
  }
  const opts = (c) => ({ auto_publish: !!c.auto_publish, update_names: !!c.update_names, update_prices: c.update_prices !== false, hide_missing: c.hide_missing !== false, create_categories: c.create_categories !== false });

  let lastOk = true;
  async function log(ok, message, st = {}, source) {
    const c = await getCfg();
    await db.from('sync_log').insert({ source: source || c.type, ok, message: String(message || '').slice(0, 500), added: st.added || 0, updated: st.updated || 0, hidden: st.hidden || 0, skipped: st.skipped || 0 });
    if (!ok && lastOk) for (const chat_id of await notifyChats()) bot('sendMessage', { chat_id, text: `⚠️ Integratsiya xatosi (${source || c.type}):\n${message}\n\nAdmin panel → Integratsiya bo'limini tekshiring.` });
    lastOk = ok;
  }
  async function apply(source, items, extra = {}) {
    const c = await getCfg();
    const st = await applySync(db, source, items, { ...opts(c), ...extra });
    if (!extra.dry) { dropCatalog(); await log(true, extra.note || 'Sinxronlandi', st, source); }
    return st;
  }

  // Avtomatik (BILLZ va YesPOS API) — har N daqiqada
  let running = null;
  async function runNow(manual) {
    if (running) return running;
    running = (async () => {
      const c = await getCfg(true);
      try {
        let items;
        if (c.type === 'billz') items = await billzFetch(c);
        else if (c.type === 'yespos' && c.yespos_mode === 'api') items = await apiFetch(c);
        else throw new Error("Bu turdagi integratsiya avtomatik tortilmaydi");
        const st = await apply(c.type, items, { full: true, note: manual ? "Qo'lda ishga tushirildi" : 'Avtomatik' });
        await setKey('last_run', Date.now());
        return st;
      } catch (e) {
        await setKey('last_run', Date.now());
        await log(false, e.message, {}, c.type);
        throw e;
      } finally { running = null; }
    })();
    return running;
  }
  setInterval(async () => {
    try {
      const c = await getCfg();
      const auto = (c.type === 'billz' && c.billz_token) || (c.type === 'yespos' && c.yespos_mode === 'api' && c.api_url);
      if (!auto || running) return;
      const last = (await getKey('last_run')) || 0;
      if (Date.now() - last >= Math.max(5, +c.interval || 15) * 60000) runNow(false).catch(() => {});
    } catch {}
  }, 60000);

  // ===== 1C =====
  const onec = onecHandler({
    db, getCfg, getKey, setKey, tooMany, clientIp,
    runApply: (items, o) => apply('onec', items, { ...o, note: '1C almashuvi' }),
    log: (ok, m) => log(ok, m, {}, 'onec'),
    uploadImage: async (name, buf) => {
      const ext = (/\.(jpe?g|png|webp|gif)$/i.exec(name)?.[1] || 'jpg').toLowerCase().replace('jpeg', 'jpg');
      const path = `1c/${crypto.createHash('md5').update(name).digest('hex')}.${ext}`;
      const { error } = await db.storage.from(BUCKET).upload(path, buf, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: true, cacheControl: '31536000' });
      if (error) throw error;
      return db.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    },
  });
  app.all('/1c_exchange', express.raw({ type: () => true, limit: '25mb' }), onec);

  // ===== Admin API =====
  app.get('/api/admin/integration', A, wrap(async (_, res) => {
    const c = await getCfg(true);
    const [{ data: logs }, { count: drafts }, { data: linked }, last] = await Promise.all([
      db.from('sync_log').select('*').order('id', { ascending: false }).limit(8),
      db.from('products').select('id', { count: 'exact', head: true }).eq('draft', true).eq('active', true),
      db.from('products').select('source').eq('active', true).neq('source', 'manual').limit(5000),
      getKey('last_run'),
    ]);
    const bySource = {};
    for (const p of linked || []) bySource[p.source] = (bySource[p.source] || 0) + 1;
    res.json({
      cfg: { ...c, billz_token: mask(c.billz_token), api_token: mask(c.api_token) },
      onec_url: `${(BASE || '').replace(/\/$/, '')}/1c_exchange`, logs: logs || [], drafts: drafts || 0, linked: bySource, last_run: last, running: !!running,
    });
  }));
  app.put('/api/admin/integration', A, wrap(async (req, res) => {
    const b = req.body || {}, old = await getCfg(true);
    const s = (v, n = 300) => String(v ?? '').trim().slice(0, n);
    const keep = (v, prev) => (String(v || '').startsWith('••••') ? prev : s(v, 600));
    const c = {
      ...old,
      type: TYPES.includes(b.type) ? b.type : old.type,
      interval: Math.min(1440, Math.max(5, Math.round(+b.interval || old.interval || 15))),
      auto_publish: !!b.auto_publish, update_names: !!b.update_names, update_prices: b.update_prices !== false, hide_missing: b.hide_missing !== false, create_categories: b.create_categories !== false,
      billz_token: keep(b.billz_token, old.billz_token), billz_shop_id: s(b.billz_shop_id, 80), billz_shop_name: s(b.billz_shop_name, 120),
      onec_login: s(b.onec_login, 60), onec_password: s(b.onec_password, 80), onec_price_type: s(b.onec_price_type, 80),
      yespos_mode: b.yespos_mode === 'api' ? 'api' : 'excel', api_url: s(b.api_url, 500), api_token: keep(b.api_token, old.api_token), api_header: s(b.api_header, 60),
    };
    if (c.type === 'onec') { c.onec_login ||= 'brozzo'; c.onec_password ||= crypto.randomBytes(6).toString('hex'); }
    if (c.api_url && !/^https:\/\//.test(c.api_url)) return res.status(400).json({ error: 'API manzili https:// bilan boshlansin' });
    await setKey('config', c); CFG = c; cfgAt = Date.now();
    if (c.type !== old.type || c.billz_token !== old.billz_token) await setKey('last_run', 0);
    res.json({ ok: true });
  }));
  app.post('/api/admin/integration/test', A, wrap(async (req, res) => {
    const c = await getCfg(true);
    try {
      if (c.type === 'billz') { const shops = await billzShops(c.billz_token); return res.json({ ok: true, message: `Ulandi ✓ Do'konlar: ${shops.length}`, shops }); }
      if (c.type === 'yespos' && c.yespos_mode === 'api') { const items = await apiFetch(c); return res.json({ ok: true, message: `Ulandi ✓ ${items.length} ta mahsulot topildi` }); }
      res.json({ ok: true, message: 'Bu tur uchun tekshiruv kerak emas' });
    } catch (e) { res.status(400).json({ error: e.message }); }
  }));
  app.post('/api/admin/integration/run', A, wrap(async (_, res) => {
    try { res.json(await runNow(true)); } catch (e) { res.status(400).json({ error: e.message }); }
  }));
  app.post('/api/admin/import', A, wrap(async (req, res) => {
    const b = req.body || {};
    const b64 = String(b.data || '').replace(/^data:[^,]*,/, '');
    if (!b64) return res.status(400).json({ error: 'Fayl kerak' });
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 12 * 1024 * 1024) return res.status(400).json({ error: 'Fayl juda katta (12 MB gacha)' });
    let parsed;
    try { parsed = parseTable(buf, String(b.name || '')); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (!parsed.items.length) return res.status(400).json({ error: "Faylda mahsulot topilmadi" });
    const c = await getCfg();
    const source = c.type === 'yespos' ? 'yespos' : 'excel';
    const st = await apply(source, parsed.items, { dry: !!b.dry, full: !!b.hide_missing, hide_missing: !!b.hide_missing, note: `Excel: ${String(b.name || '').slice(0, 60)}` });
    res.json({ ...st, columns: parsed.columns, bad_rows: parsed.skipped });
  }));
  app.get('/api/admin/drafts', A, wrap(async (_, res) => {
    const { data } = await db.from('products').select('*').eq('draft', true).eq('active', true).order('created_at', { ascending: false }).limit(300);
    res.json(data || []);
  }));

  return { getCfg };
};
