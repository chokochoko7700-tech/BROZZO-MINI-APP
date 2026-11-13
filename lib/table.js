// Excel (.xlsx) va CSV fayllarni o'qish — tashqi kutubxonasiz.
// Natija: mahsulotlar ro'yxati (sync.js formatida).
const zlib = require('zlib');

function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Fayl Excel (.xlsx) emas');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const files = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nl = buf.readUInt16LE(p + 28), xl = buf.readUInt16LE(p + 30), cl = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nl);
    p += 46 + nl + xl + cl;
    if (!/\.(xml|rels)$/.test(name)) continue;
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const data = buf.subarray(start, start + size);
    files[name] = (method === 8 ? zlib.inflateRawSync(data) : data).toString('utf8');
  }
  return files;
}

const ent = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&amp;/g, '&');
const texts = (x) => [...x.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => ent(m[1])).join('');
const colIdx = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

function readXlsx(buf) {
  const f = unzip(buf);
  const shared = f['xl/sharedStrings.xml'] ? [...f['xl/sharedStrings.xml'].matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
  // birinchi varaq
  let sheet = 'xl/worksheets/sheet1.xml';
  const wb = f['xl/workbook.xml'], rels = f['xl/_rels/workbook.xml.rels'];
  const rid = wb && /<sheet\b[^>]*r:id="([^"]+)"/.exec(wb)?.[1];
  const target = rid && rels && new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`).exec(rels)?.[1];
  if (target) sheet = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  const xml = f[sheet] || Object.entries(f).find(([k]) => k.startsWith('xl/worksheets/'))?.[1];
  if (!xml) throw new Error('Excel varag\'i topilmadi');
  const rows = [];
  for (const r of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1], inner = c[2] || '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const t = /t="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let val = '';
      if (t === 's') val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = texts(inner);
      else if (v != null) val = ent(v);
      row[ref ? colIdx(ref) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => (x == null ? '' : String(x).trim())));
  }
  return rows;
}

function readCsv(buf) {
  let s = buf.toString('utf8');
  if (s.includes('�')) s = new TextDecoder('windows-1251').decode(buf);
  s = s.replace(/^﻿/, '');
  const first = s.split(/\r?\n/)[0] || '';
  const d = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === d) { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

// Ustun nomlari (o'zbek / rus / ingliz; 1C, BILLZ, YesPOS eksportlari)
const COLS = {
  name: /^(nomi?|nomlanishi|mahsulot( nomi)?|tovar( nomi)?|наименование|название|товар|номенклатура|name|product( name)?|title)$/,
  sku: /^(artikul|артикул|sku|kod|код|code|article|model)$/,
  barcode: /^(shtrix.?kod|штрих.?код|штрихкод|barcode|ean)$/,
  price: /^(narx|narxi|sotish narxi|chakana narx|цена|цена продажи|розничная цена|цена розничная|price|retail price|sale price|selling price)$/,
  old_price: /^(eski narx|eski narxi|old price|старая цена|цена до скидки|compare price)$/,
  qty: /^(qoldiq|soni|miqdor|miqdori|остаток|остатки|количество|кол.?во|в наличии|qty|quantity|stock|remains?|balance|count|available)$/,
  size: /^(o.?lcham|o.?lchami|razmer|размер|характеристика|size)$/,
  color: /^(rang|rangi|цвет|color|colour)$/,
  category: /^(kategoriya|turkum|guruh|категория|группа|раздел|category|category name|group)$/,
  image: /^(rasm|rasmi|rasmlar|rasm havolasi|фото|изображение|картинка|image|images|photo|photos|picture|image url|photo url)$/,
  description: /^(tavsif|izoh|описание|description)$/,
};
const normH = (h) => String(h || '').toLowerCase().replace(/[ʻʼ'`’]/g, "'").replace(/[_-]+/g, ' ').replace(/\(.*?\)|[*:.,]/g, '').replace(/\s+/g, ' ').trim();
const toNum = (v) => {
  if (v === '' || v == null) return null;
  const s = String(v).replace(/\s| |so.?m|сум|uzs/gi, '').replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

function rowsToItems(rows) {
  let hi = -1, map = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const m = {};
    rows[i].forEach((h, j) => { const k = Object.keys(COLS).find((c) => COLS[c].test(normH(h))); if (k && m[k] == null) m[k] = j; });
    if (m.name != null && (m.price != null || m.qty != null)) { hi = i; map = m; break; }
  }
  if (!map) throw new Error("Sarlavha topilmadi. Kamida \"Nomi\" va \"Narx\" (yoki \"Qoldiq\") ustunlari bo'lsin");
  const groups = new Map();
  let skipped = 0;
  for (const r of rows.slice(hi + 1)) {
    const g = (k) => (map[k] == null ? '' : String(r[map[k]] ?? '').trim());
    const name = g('name');
    if (!name) { if (r.some(Boolean)) skipped++; continue; }
    const sku = g('sku'), barcode = g('barcode'), color = g('color');
    const key = (sku || name.toLowerCase()) + (color ? '|' + color.toLowerCase() : '');
    const it = groups.get(key) || { ext: key, sku: sku || null, barcode: barcode || null, name: color && !name.toLowerCase().includes(color.toLowerCase()) ? `${name} / ${color}` : name,
      category: g('category') || null, price: null, old_price: null, qty: 0, sizes: {}, images: [], description: g('description') || null, hasQty: map.qty != null };
    const price = toNum(g('price')), old = toNum(g('old_price')), qty = map.qty != null ? Math.max(0, Math.floor(toNum(g('qty')) || 0)) : null;
    if (price != null) it.price = Math.round(price);
    if (old != null && old > 0) it.old_price = Math.round(old);
    const size = g('size');
    if (qty != null) { it.qty += qty; if (size) it.sizes[size] = (it.sizes[size] || 0) + qty; }
    else if (size) it.sizes[size] = null;
    const img = g('image');
    if (/^https:\/\//.test(img)) img.split(/[\s,;]+/).filter((u) => /^https:\/\//.test(u)).forEach((u) => it.images.includes(u) || it.images.push(u));
    if (!it.barcode && barcode) it.barcode = barcode;
    groups.set(key, it);
  }
  const items = [...groups.values()].map((it) => ({ ...it, qty: it.hasQty ? it.qty : null, sizes: Object.keys(it.sizes).length ? it.sizes : null }));
  return { items, skipped, columns: Object.keys(map) };
}

function parseTable(buf, filename = '') {
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (/\.xls$/i.test(filename) && !isZip) throw new Error("Eski .xls format. Excel'da \"Сохранить как → .xlsx\" qilib qayta yuklang");
  return rowsToItems(isZip ? readXlsx(buf) : readCsv(buf));
}

module.exports = { parseTable, readXlsx, readCsv, rowsToItems, toNum };
