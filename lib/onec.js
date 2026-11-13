// 1C:Предприятие bilan almashuv — CommerceML 2 protokoli ("Обмен с сайтом").
// 1C o'zi /1c_exchange manziliga ulanadi: type=catalog (tovar, narx, qoldiq) va type=sale (buyurtmalar).
const crypto = require('crypto');

const ent = (s) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
const xesc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const rx = (t, g) => new RegExp(`<${t}(?:\\s[^>]*)?>([\\s\\S]*?)</${t}>`, g ? 'g' : '');
const all = (x, t) => (x ? [...x.matchAll(rx(t, true))].map((m) => m[1]) : []);
const one = (x, t) => (x ? rx(t).exec(x)?.[1] ?? null : null);
const txt = (x, t) => { const v = one(x, t); return v == null ? null : ent(v).trim() || null; };
const strip = (x, tags) => tags.reduce((s, t) => s.replace(rx(t, true), ''), x);
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) ? n : null; };
const SIZE_RE = /размер|o.?lcham|razmer|size|рост/i;

function decode(buf) {
  const head = buf.subarray(0, 200).toString('latin1');
  return /encoding="windows-1251"/i.test(head) ? new TextDecoder('windows-1251').decode(buf) : buf.toString('utf8').replace(/^﻿/, '');
}

function parseImport(xml, S) {
  const cls = one(xml, 'Классификатор') || '';
  for (const m of cls.matchAll(/<Группа>\s*<Ид>([\s\S]*?)<\/Ид>\s*<Наименование>([\s\S]*?)<\/Наименование>/g)) S.groups[ent(m[1]).trim()] = ent(m[2]).trim();
  if (/СодержитТолькоИзменения\s*=\s*"false"|<СодержитТолькоИзменения>false</.test(xml)) S.full = true;
  for (const t of all(one(xml, 'Товары'), 'Товар')) {
    const top = strip(t, ['Группы', 'ЗначенияСвойств', 'ХарактеристикиТовара', 'ЗначенияРеквизитов', 'СтавкиНалогов', 'Изготовитель', 'БазоваяЕдиница']);
    const id = txt(top, 'Ид'); if (!id) continue;
    const base = id.split('#')[0];
    S.goods[base] = {
      name: txt(top, 'Наименование'), sku: txt(top, 'Артикул'), barcode: txt(top, 'Штрихкод'), description: txt(top, 'Описание'),
      group: txt(one(t, 'Группы'), 'Ид'), images: all(top, 'Картинка').map((x) => ent(x).trim()).filter(Boolean),
      deleted: /Статус="Удален"|<Статус>Удален</.test(t) || /<ПометкаУдаления>true</.test(top),
    };
  }
}

function parseOffers(xml, S, priceTypeName) {
  if (/СодержитТолькоИзменения\s*=\s*"false"|<СодержитТолькоИзменения>false</.test(xml)) S.full = true;
  for (const pt of all(one(xml, 'ТипыЦен'), 'ТипЦены')) { const id = txt(pt, 'Ид'), n = txt(pt, 'Наименование'); if (id) S.priceTypes[id] = n || id; }
  for (const o of all(one(xml, 'Предложения'), 'Предложение')) {
    const top = strip(o, ['ХарактеристикиТовара', 'Цены', 'Остатки', 'ЗначенияСвойств', 'БазоваяЕдиница', 'Склад']);
    const id = txt(top, 'Ид'); if (!id) continue;
    const cur = S.offers[id] || { id, base: id.split('#')[0] };
    const chars = all(one(o, 'ХарактеристикиТовара'), 'ХарактеристикаТовара').map((c) => ({ n: txt(c, 'Наименование') || '', v: txt(c, 'Значение') || '' }));
    if (chars.length) cur.size = (chars.find((c) => SIZE_RE.test(c.n)) || chars[0]).v || cur.size;
    else if (!cur.size && id.includes('#')) cur.size = /\(([^()]+)\)\s*$/.exec(txt(top, 'Наименование') || '')?.[1] || cur.size;
    cur.name ||= txt(top, 'Наименование');
    const prices = all(one(o, 'Цены'), 'Цена').map((p) => ({ type: txt(p, 'ИдТипаЦены'), v: num(txt(p, 'ЦенаЗаЕдиницу')) })).filter((p) => p.v != null);
    if (prices.length) {
      const want = (priceTypeName || '').toLowerCase();
      const pick = (want && prices.find((p) => (S.priceTypes[p.type] || '').toLowerCase().includes(want)))
        || prices.find((p) => /розн|chakana|retail/i.test(S.priceTypes[p.type] || '')) || prices[0];
      cur.price = pick.v;
    }
    const rests = one(o, 'Остатки');
    if (rests != null) cur.qty = all(rests, 'Количество').reduce((s, x) => s + (num(x) || 0), 0);
    else if (txt(top, 'Количество') != null) cur.qty = num(txt(top, 'Количество'));
    S.offers[id] = cur;
  }
}

function buildItems(S) {
  const bases = new Map();
  for (const o of Object.values(S.offers)) { if (!bases.has(o.base)) bases.set(o.base, []); bases.get(o.base).push(o); }
  const ids = new Set([...Object.keys(S.goods), ...bases.keys()]);
  const items = [], variants = {};
  for (const id of ids) {
    const g = S.goods[id] || {}, offs = bases.get(id) || [];
    if (g.deleted) { items.push({ ext: id, name: g.name || id, qty: 0, price: null, sizes: null, images: [] }); continue; }
    const name = g.name || offs[0]?.name?.replace(/\s*\([^()]*\)\s*$/, '');
    if (!name) continue;
    const priced = offs.filter((o) => o.price != null);
    const withQty = offs.filter((o) => o.qty != null);
    const sizes = {};
    for (const o of offs) if (o.size) { sizes[o.size] = (sizes[o.size] || 0) + Math.max(0, Math.floor(o.qty || 0)); (variants[id] ||= {})[o.size] = o.id; }
    items.push({
      ext: id, name, sku: g.sku, barcode: g.barcode, description: g.description, category: g.group ? S.groups[g.group] || null : null,
      price: priced.length ? Math.round(Math.min(...priced.map((o) => o.price))) : null, old_price: undefined,
      qty: withQty.length ? withQty.reduce((s, o) => s + Math.max(0, o.qty), 0) : null,
      sizes: Object.keys(sizes).length && withQty.length ? sizes : null, images: g.images || [],
    });
  }
  return { items, variants };
}

function ordersXml(orders, prodMap, variants) {
  const d = new Date();
  const docs = orders.map((o) => {
    const dt = new Date(o.created_at);
    const lines = (o.items || []).map((l) => {
      const p = prodMap[l.id] || {};
      const base = p.source === 'onec' && p.external_id ? p.external_id : `tg-${l.id}`;
      const id = (l.size && variants[base]?.[l.size]) || base;
      return `<Товар><Ид>${xesc(id)}</Ид>${p.sku ? `<Артикул>${xesc(p.sku)}</Артикул>` : ''}<Наименование>${xesc(l.name + (l.size ? ` (${l.size})` : ''))}</Наименование>` +
        `<БазоваяЕдиница Код="796" НаименованиеПолное="Штука" МеждународноеСокращение="PCE">шт</БазоваяЕдиница>` +
        `<ЦенаЗаЕдиницу>${l.price}</ЦенаЗаЕдиницу><Количество>${l.qty}</Количество><Сумма>${l.price * l.qty}</Сумма>` +
        `<ЗначенияРеквизитов><ЗначениеРеквизита><Наименование>ВидНоменклатуры</Наименование><Значение>Товар</Значение></ЗначениеРеквизита>` +
        `<ЗначениеРеквизита><Наименование>ТипНоменклатуры</Наименование><Значение>Товар</Значение></ЗначениеРеквизита></ЗначенияРеквизитов></Товар>`;
    }).join('');
    const status = { new: 'Новый', confirmed: 'Подтвержден', done: 'Выполнен', cancel: 'Отменен' }[o.status] || 'Новый';
    return `<Документ><Ид>tg-${o.id}</Ид><Номер>${o.id}</Номер><Дата>${dt.toISOString().slice(0, 10)}</Дата><Время>${dt.toISOString().slice(11, 19)}</Время>` +
      `<ХозОперация>Заказ товара</ХозОперация><Роль>Продавец</Роль><Валюта>UZS</Валюта><Курс>1</Курс><Сумма>${o.total}</Сумма>` +
      `<Контрагенты><Контрагент><Ид>tg-${o.tg_id}</Ид><Наименование>${xesc(o.name)}</Наименование><ПолноеНаименование>${xesc(o.name)}</ПолноеНаименование><Роль>Покупатель</Роль>` +
      `<Контакты><Контакт><Тип>Телефон рабочий</Тип><Значение>${xesc(o.phone)}</Значение></Контакт></Контакты>` +
      `<АдресРегистрации><Представление>${xesc(o.address || '')}</Представление></АдресРегистрации></Контрагент></Контрагенты>` +
      `<Комментарий>${xesc([o.comment, o.delivery === 'pickup' ? "Do'kondan olib ketadi" : `Yetkazish: ${o.address || ''}`, o.tg_username ? '@' + o.tg_username : ''].filter(Boolean).join(' | '))}</Комментарий>` +
      `<Товары>${lines}${o.delivery_fee ? `<Товар><Ид>ORDER_DELIVERY</Ид><Наименование>Доставка</Наименование><БазоваяЕдиница Код="796">шт</БазоваяЕдиница><ЦенаЗаЕдиницу>${o.delivery_fee}</ЦенаЗаЕдиницу><Количество>1</Количество><Сумма>${o.delivery_fee}</Сумма><ЗначенияРеквизитов><ЗначениеРеквизита><Наименование>ВидНоменклатуры</Наименование><Значение>Услуга</Значение></ЗначениеРеквизита><ЗначениеРеквизита><Наименование>ТипНоменклатуры</Наименование><Значение>Услуга</Значение></ЗначениеРеквизита></ЗначенияРеквизитов></Товар>` : ''}</Товары>` +
      `<ЗначенияРеквизитов><ЗначениеРеквизита><Наименование>Статус заказа</Наименование><Значение>${status}</Значение></ЗначениеРеквизита>` +
      `<ЗначениеРеквизита><Наименование>Метод оплаты</Наименование><Значение>Наличный расчет</Значение></ЗначениеРеквизита></ЗначенияРеквизитов></Документ>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<КоммерческаяИнформация ВерсияСхемы="2.08" ДатаФормирования="${d.toISOString().slice(0, 19)}">${docs}</КоммерческаяИнформация>`;
}

/**
 * deps: { db, getCfg, setKey, getKey, runApply(items, {full}), uploadImage(name, buf) }
 */
function onecHandler(deps) {
  let S = null; // joriy almashuv sessiyasi
  const cookie = { name: 'brozzo1c', value: null };
  const fresh = () => ({ files: {}, size: 0, goods: {}, offers: {}, groups: {}, priceTypes: {}, full: false, at: Date.now() });

  return async (req, res) => {
    res.type('text/plain; charset=utf-8');
    const q = req.query, cfg = await deps.getCfg();
    const fail = (m) => res.send('failure\n' + m);
    if (cfg.type !== 'onec' || !cfg.onec_login || !cfg.onec_password) return fail('1C integratsiyasi yoqilmagan');
    const [, b64] = /^Basic\s+(.+)$/i.exec(req.get('authorization') || '') || [];
    const [login, pass] = b64 ? Buffer.from(b64, 'base64').toString('utf8').split(/:(.*)/s) : [];
    const eq = (a, b) => { const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? '')); return x.length === y.length && crypto.timingSafeEqual(x, y); };
    const okBasic = b64 ? eq(login, cfg.onec_login) & eq(pass, cfg.onec_password) : false;
    const ip = deps.clientIp ? deps.clientIp(req) : '';
    if (b64 && !okBasic && deps.tooMany && deps.tooMany('1c' + ip, 10, 15 * 60000)) return res.status(429).send('failure\nJuda ko\'p noto\'g\'ri urinish. 15 daqiqa kuting');
    const ck = new RegExp(`${cookie.name}=([a-f0-9]+)`).exec(req.get('cookie') || '')?.[1];
    const okCookie = cookie.value && ck === cookie.value;
    if (q.mode === 'checkauth') {
      if (!okBasic) return fail("Login yoki parol noto'g'ri");
      cookie.value = crypto.randomBytes(16).toString('hex');
      if (q.type === 'catalog') S = fresh();
      return res.send(`success\n${cookie.name}\n${cookie.value}\nsessid=${cookie.value}\ntimestamp=${Math.floor(Date.now() / 1000)}\n`);
    }
    if (!okBasic && !okCookie) return fail('Avtorizatsiya kerak');
    if (q.mode === 'complete' || q.mode === 'deactivate') return res.send('success\n');
    if (q.mode === 'init') {
      if (q.type === 'catalog' && (!S || Date.now() - S.at > 3600e3)) S = fresh();
      return res.send(`zip=no\nfile_limit=${20 * 1024 * 1024}\n`);
    }
    try {
      if (q.type === 'catalog') {
        S ||= fresh();
        const fname = String(q.filename || '').replace(/\\/g, '/');
        if (q.mode === 'file') {
          const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
          if (S.size + body.length > 60 * 1024 * 1024) return fail('Fayllar juda katta: 1C sozlamasida rasmlarni alohida yoki kamroq yuboring');
          S.files[fname] = S.files[fname] ? Buffer.concat([S.files[fname], body]) : body;
          S.size += body.length;
          return res.send('success\n');
        }
        if (q.mode === 'import') {
          const base = fname.split('/').pop();
          const buf = S.files[fname] || S.files[base];
          if (!buf) return res.send('success\n');
          const xml = decode(buf);
          if (/^import/i.test(base) || /<Каталог/.test(xml)) parseImport(xml, S);
          if (/^(offers|prices|rests)/i.test(base) || /<ПакетПредложений/.test(xml)) parseOffers(xml, S, cfg.onec_price_type);
          delete S.files[fname]; delete S.files[base];
          const { items, variants } = buildItems(S);
          // 1C'dan kelgan rasmlar (import_files/...) — saytga yuklanadi
          let up = 0;
          for (const it of items) {
            const urls = [];
            for (const p of it.images || []) {
              S.urls ||= {};
              if (S.urls[p]) { urls.push(S.urls[p]); continue; }
              const f = S.files[p] || S.files[p.replace(/^\//, '')];
              if (f && up < 300) { try { S.urls[p] = await deps.uploadImage(p, f); urls.push(S.urls[p]); up++; } catch {} }
            }
            it.images = urls;
          }
          if (Object.keys(variants).length) await deps.setKey('onec_variants', { ...((await deps.getKey('onec_variants')) || {}), ...variants });
          const r = await deps.runApply(items, { full: S.full && Object.keys(S.offers).length > 0 });
          return res.send(`success\nQabul qilindi: ${r.added} yangi, ${r.updated} yangilandi\n`);
        }
      }
      if (q.type === 'sale') {
        if (q.mode === 'query') {
          const since = (await deps.getKey('onec_sent_id')) || 0;
          const { data: orders } = await deps.db.from('orders').select('*').gt('id', since).neq('status', 'cancel').order('id').limit(200);
          const ids = [...new Set((orders || []).flatMap((o) => (o.items || []).map((i) => i.id)))];
          const { data: prods } = ids.length ? await deps.db.from('products').select('id,external_id,source,sku').in('id', ids) : { data: [] };
          const pm = Object.fromEntries((prods || []).map((p) => [p.id, p]));
          await deps.setKey('onec_pending_id', orders?.length ? orders[orders.length - 1].id : since);
          res.type('application/xml; charset=utf-8');
          return res.send(ordersXml(orders || [], pm, (await deps.getKey('onec_variants')) || {}));
        }
        if (q.mode === 'success') {
          const p = await deps.getKey('onec_pending_id');
          if (p) await deps.setKey('onec_sent_id', p);
          return res.send('success\n');
        }
        if (q.mode === 'file') return res.send('success\n'); // 1C'dagi buyurtma holatlari — hozircha qabul qilib qo'yiladi
      }
      return fail("Noma'lum so'rov");
    } catch (e) {
      console.error('1C xatosi', e);
      deps.log?.(false, '1C: ' + e.message);
      return fail(e.message);
    }
  };
}

module.exports = { onecHandler, parseImport, parseOffers, buildItems, ordersXml };
