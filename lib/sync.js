// Hisob dasturidan kelgan tovarlarni bot bazasiga yozish (barcha manbalar uchun umumiy).
// Element formati:
// { ext, sku, barcode, name, category, price, old_price, qty (null = noma'lum), sizes: {"M": 3} | null, images: [], description }

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL'];
const sizeSort = (a, b) => {
  const ia = SIZE_ORDER.indexOf(String(a).toUpperCase()), ib = SIZE_ORDER.indexOf(String(b).toUpperCase());
  if (ia > -1 && ib > -1) return ia - ib;
  const na = parseFloat(a), nb = parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
};
const lc = (s) => String(s || '').trim().toLowerCase();
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const FIELDS = ['name', 'price', 'old_price', 'external_id', 'sku', 'barcode', 'source', 'stock', 'sizes', 'qty', 'sold_out', 'images', 'image', 'category_id', 'description'];

async function allProducts(db) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('products').select('id,active,draft,' + FIELDS.join(',')).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

function stockOf(it) {
  if (!it.sizes) return { stock: null, sizes: null };
  const keys = Object.keys(it.sizes).sort(sizeSort);
  const known = keys.some((k) => it.sizes[k] != null);
  if (!known) return { stock: null, sizes: keys };
  const stock = Object.fromEntries(keys.map((k) => [k, Math.max(0, Math.floor(it.sizes[k] || 0))]));
  return { stock, sizes: keys.filter((k) => stock[k] > 0) };
}

/**
 * opts: { full, dry, auto_publish, update_names, update_prices, create_categories, hide_missing }
 */
async function applySync(db, source, items, opts = {}) {
  const o = { update_prices: true, create_categories: true, ...opts };
  const now = new Date().toISOString();
  const products = await allProducts(db);
  const byExt = new Map(), bySku = new Map(), byBar = new Map(), byName = new Map();
  for (const p of products) {
    if (p.external_id && p.source === source) byExt.set(p.external_id, p);
    if (p.sku) bySku.set(lc(p.sku), p);
    if (p.barcode) byBar.set(String(p.barcode), p);
    if (p.active && !byName.has(lc(p.name))) byName.set(lc(p.name), p);
  }
  const { data: cats } = await db.from('categories').select('id,name,sort');
  const catId = new Map((cats || []).map((c) => [lc(c.name), c.id]));
  const st = { added: 0, updated: 0, unchanged: 0, hidden: 0, skipped: 0, total: items.length };
  const updates = [], inserts = [], seen = new Set(), sample = [], newCats = new Set();

  for (const it of items) {
    if (!it.name || !it.ext) { st.skipped++; continue; }
    const p = byExt.get(String(it.ext)) || (it.sku && bySku.get(lc(it.sku))) || (it.barcode && byBar.get(String(it.barcode))) || byName.get(lc(it.name));
    if (p && seen.has(p.id)) { st.skipped++; continue; }
    const { stock, sizes } = stockOf(it);
    const qty = it.qty == null ? null : Math.max(0, Math.floor(it.qty));
    const cname = it.category && lc(it.category);
    if (p) {
      seen.add(p.id);
      const row = Object.fromEntries(['id', ...FIELDS].map((k) => [k, p[k] ?? null]));
      Object.assign(row, { external_id: String(it.ext), source, sku: it.sku || p.sku, barcode: it.barcode || p.barcode });
      if (o.update_names) row.name = it.name;
      if (o.update_prices && it.price != null) {
        row.price = it.price;
        row.old_price = it.old_price && it.old_price > it.price ? it.old_price : (it.old_price == null && p.old_price > it.price ? p.old_price : null);
      }
      if (stock) row.stock = stock;
      if (sizes && sizes.length) row.sizes = sizes;
      if (qty != null) { row.qty = qty; row.sold_out = qty <= 0; }
      if (!(p.images || []).length && it.images?.length) { row.images = it.images.slice(0, 12); row.image = row.images[0]; }
      if (!p.category_id && cname) { row.category_id = catId.get(cname) || null; if (!row.category_id && o.create_categories) newCats.add(it.category.trim()); row._cat = cname; }
      if (!p.description && it.description) row.description = String(it.description).slice(0, 2000);
      const changed = FIELDS.some((k) => !same(row[k], p[k])) || row._cat;
      if (changed) { st.updated++; updates.push(row); if (sample.length < 8) sample.push({ act: 'upd', name: row.name, price: row.price, qty: row.qty, sizes: row.sizes }); }
      else st.unchanged++;
    } else {
      if (it.price == null || (qty != null && qty <= 0)) { st.skipped++; continue; }
      const images = (it.images || []).slice(0, 12);
      if (cname && !catId.get(cname) && o.create_categories) newCats.add(it.category.trim());
      inserts.push({
        name: String(it.name).slice(0, 140), price: it.price, old_price: it.old_price && it.old_price > it.price ? it.old_price : null,
        external_id: String(it.ext), source, sku: it.sku || null, barcode: it.barcode || null, stock, sizes: sizes || [], qty, sold_out: qty != null && qty <= 0,
        images, image: images[0] || null, description: it.description ? String(it.description).slice(0, 2000) : null,
        category_id: null, _cat: cname, active: true, draft: !(o.auto_publish && images.length), synced_at: now,
      });
      st.added++;
      if (sample.length < 8) sample.push({ act: 'new', name: it.name, price: it.price, qty, sizes });
    }
  }
  // To'liq yuklashda ro'yxatda yo'q tovarlar "Sotuvda yo'q" bo'ladi
  const hide = [];
  if (o.full && o.hide_missing !== false) {
    for (const p of products) if (p.source === source && p.active && !seen.has(p.id) && !p.sold_out) hide.push(p.id);
    st.hidden = hide.length;
  }
  st.new_categories = [...newCats];
  if (o.dry) return { ...st, sample };

  // Yangi kategoriyalar
  let sort = Math.max(0, ...(cats || []).map((c) => c.sort || 0));
  for (const name of newCats) {
    const { data } = await db.from('categories').insert({ name: name.slice(0, 40), sort: ++sort }).select('id').single();
    if (data) catId.set(lc(name), data.id);
  }
  for (const r of [...updates, ...inserts]) { if (r._cat) r.category_id = r.category_id || catId.get(r._cat) || null; delete r._cat; }
  for (const r of updates) r.synced_at = now;
  for (let i = 0; i < updates.length; i += 200) {
    const { error } = await db.from('products').upsert(updates.slice(i, i + 200), { onConflict: 'id' });
    if (error) throw error;
  }
  for (let i = 0; i < inserts.length; i += 200) {
    const { error } = await db.from('products').insert(inserts.slice(i, i + 200));
    if (error) throw error;
  }
  for (let i = 0; i < hide.length; i += 200) {
    await db.from('products').update({ sold_out: true, qty: 0, synced_at: now }).in('id', hide.slice(i, i + 200));
  }
  return st;
}

// Bot buyurtmasi: qoldiqni kamaytirish (sign=-1) yoki bekor qilinganda qaytarish (sign=+1)
async function adjustStock(db, lines, sign) {
  const ids = [...new Set(lines.map((l) => l.id))];
  if (!ids.length) return;
  const { data } = await db.from('products').select('id,stock,qty,sizes,sold_out').in('id', ids);
  for (const p of data || []) {
    if (p.qty == null && !p.stock) continue;
    const stock = p.stock ? { ...p.stock } : null;
    let qty = p.qty;
    for (const l of lines.filter((x) => x.id === p.id)) {
      if (stock && l.size && stock[l.size] != null) stock[l.size] = Math.max(0, stock[l.size] + sign * l.qty);
      if (qty != null) qty = Math.max(0, qty + sign * l.qty);
    }
    const row = { qty };
    if (stock) { row.stock = stock; row.sizes = Object.keys(stock).sort(sizeSort).filter((k) => stock[k] > 0); if (qty == null) row.qty = Object.values(stock).reduce((a, b) => a + b, 0); }
    row.sold_out = (row.qty ?? 1) <= 0;
    await db.from('products').update(row).eq('id', p.id);
  }
}

module.exports = { applySync, adjustStock, sizeSort };
