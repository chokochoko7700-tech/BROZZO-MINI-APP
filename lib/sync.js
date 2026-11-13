// Qoldiqni boshqarish: bot buyurtmasi qoldiqni kamaytiradi, bekor qilinsa qaytaradi

const SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '2XL', 'XXXL', '3XL', '4XL', '5XL'];
const sizeSort = (a, b) => {
  const ia = SIZE_ORDER.indexOf(String(a).toUpperCase()), ib = SIZE_ORDER.indexOf(String(b).toUpperCase());
  if (ia > -1 && ib > -1) return ia - ib;
  const na = parseFloat(a), nb = parseFloat(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return String(a).localeCompare(String(b));
};
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

module.exports = { adjustStock, sizeSort };
