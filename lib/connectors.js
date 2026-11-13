// BILLZ (api-admin.billz.ai) va universal JSON API (YesPOS va boshqalar) ulagichlari
const { rowsToItems } = require('./table');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isHttps = (u) => typeof u === 'string' && /^https:\/\/\S+$/.test(u);

/* ===== BILLZ ===== */
const BILLZ = 'https://api-admin.billz.ai';
const PLATFORM = '7d4a4c38-dd84-4902-b744-0488b80a4c01'; // integratsiyalar uchun statik qiymat (BILLZ hujjati)
let TOK = { v: null, exp: 0, key: null };

async function billzToken(secret) {
  if (TOK.key === secret && Date.now() < TOK.exp) return TOK.v;
  const r = await fetch(BILLZ + '/v1/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'platform-id': PLATFORM }, body: JSON.stringify({ secret_token: secret }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.data?.access_token) throw new Error(`BILLZ kaliti qabul qilinmadi (${r.status})`);
  TOK = { v: j.data.access_token, exp: Date.now() + (Math.max(600, +j.data.expires_in || 3600) - 300) * 1000, key: secret };
  return TOK.v;
}
async function billzGet(secret, path) {
  for (let a = 0; a < 5; a++) {
    const r = await fetch(BILLZ + path, { headers: { Authorization: 'Bearer ' + await billzToken(secret), 'platform-id': PLATFORM, Accept: 'application/json' } });
    if (r.status === 429) { await sleep(1500 * 2 ** a); continue; }
    if (r.status === 401 && a === 0) { TOK.exp = 0; continue; }
    const j = await r.json().catch(() => null);
    if (!r.ok || !j) throw new Error(`BILLZ ${path.split('?')[0]}: ${r.status}`);
    return j;
  }
  throw new Error('BILLZ: juda ko\'p so\'rov (429)');
}
async function billzShops(secret) {
  const j = await billzGet(secret, '/v1/shop?limit=100');
  const arr = j.shops || j.data?.shops || j.data || j.result || (Array.isArray(j) ? j : []);
  return (Array.isArray(arr) ? arr : []).map((s) => ({ id: s.id, name: s.name || s.shop_name || s.id }));
}

const SIZE_RE = /razmer|размер|o.?lcham|size|рост/i, COLOR_RE = /цвет|rang|color|colour/i;
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function billzMap(products, shopId) {
  const groups = new Map();
  for (const p of products) {
    const pick = (arr) => { const a = Array.isArray(arr) ? arr : []; return shopId ? a.filter((x) => x.shop_id === shopId) : a; };
    const pr = pick(p.shop_prices)[0] || (p.shop_prices || [])[0] || {};
    const retail = +pr.retail_price || 0, promo = +pr.promo_price || 0;
    const qty = pick(p.shop_measurement_values).reduce((s, x) => s + (+x.active_measurement_value || 0), 0);
    const attrs = p.product_attributes || [];
    const size = attrs.find((a) => SIZE_RE.test(a.attribute_name || ''))?.attribute_value || null;
    const color = attrs.find((a) => COLOR_RE.test(a.attribute_name || ''))?.attribute_value || null;
    const key = (p.parent_id || p.id) + (color ? '|' + color : '');
    let name = String(p.name || '').trim();
    if (size) name = name.replace(new RegExp(`[\\s/,(-]*${escRe(size)}\\)?\\s*$`), '').trim() || name;
    const photos = (p.photos || []).slice().sort((a, b) => (b.is_main - a.is_main) || (a.sequence - b.sequence)).map((x) => x.photo_url).filter(isHttps);
    if (!photos.length && isHttps(p.main_image_url_full || p.main_image_url)) photos.push(p.main_image_url_full || p.main_image_url);
    const it = groups.get(key) || { ext: key, sku: p.sku || null, barcode: p.barcode || null, name: color && !lc(name).includes(lc(color)) ? `${name} / ${color}` : name,
      category: p.categories?.[0]?.name || null, price: null, old_price: null, qty: 0, sizes: size ? {} : null, images: [], description: p.description || null };
    const price = promo > 0 && promo < retail ? promo : retail;
    if (price > 0 && (it.price == null || price < it.price)) { it.price = Math.round(price); it.old_price = promo > 0 && promo < retail ? Math.round(retail) : null; }
    it.qty += Math.max(0, Math.floor(qty));
    if (size) { it.sizes ||= {}; it.sizes[size] = (it.sizes[size] || 0) + Math.max(0, Math.floor(qty)); }
    for (const u of photos) if (!it.images.includes(u)) it.images.push(u);
    groups.set(key, it);
  }
  return [...groups.values()];
}
const lc = (s) => String(s || '').toLowerCase();

async function billzFetch(cfg, onProgress) {
  if (!cfg.billz_token) throw new Error('BILLZ kaliti kiritilmagan');
  const all = [];
  for (let page = 1; page <= 200; page++) {
    const j = await billzGet(cfg.billz_token, `/v2/products?limit=200&page=${page}&include_empty_stocks=true`);
    const list = j.products || j.data?.products || [];
    all.push(...list);
    onProgress?.(all.length, j.count);
    if (list.length < 200 || (j.count && all.length >= j.count)) break;
    await sleep(600); // BILLZ limiti: 2 so'rov/soniya
  }
  return billzMap(all, cfg.billz_shop_id || null);
}

/* ===== Universal JSON API (YesPOS va API'si bor boshqa dasturlar) ===== */
function flat(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'object' && x ? x.url || x.photo_url || x.image_url || x.src || x.name || '' : x)).filter(Boolean).join(' ');
  if (typeof v === 'object') return v.name || v.title || v.value || '';
  return String(v);
}
async function apiFetch(cfg) {
  if (!isHttps(cfg.api_url)) throw new Error('API manzili https:// bilan boshlanishi kerak');
  const headers = { Accept: 'application/json' };
  if (cfg.api_token) headers[cfg.api_header || 'Authorization'] = (cfg.api_header && cfg.api_header !== 'Authorization') ? cfg.api_token : 'Bearer ' + cfg.api_token;
  const r = await fetch(cfg.api_url, { headers });
  if (!r.ok) throw new Error(`API javobi: ${r.status}`);
  const j = await r.json().catch(() => { throw new Error('API JSON qaytarmadi'); });
  const list = Array.isArray(j) ? j : j.products || j.items || j.data?.products || j.data?.items || j.data || j.result || j.goods || [];
  if (!Array.isArray(list) || !list.length) throw new Error("API'dan mahsulot ro'yxati kelmadi");
  const keys = [...new Set(list.slice(0, 50).flatMap((o) => Object.keys(o || {})))];
  const rows = [keys, ...list.map((o) => keys.map((k) => flat(o?.[k])))];
  return rowsToItems(rows).items;
}

module.exports = { billzFetch, billzShops, billzToken, apiFetch, billzMap };
