// Läser en exportfil (.e01) från ritprogrammet Winner och plockar ut artikelraderna.
// Filen är vanlig text (Windows-1252) med en post per rad och semikolon mellan fälten.
// Post 500 (och 450) är en artikelrad: fält 3 = artikelnummer, 8 = benämning, 9 = antal,
// 10 = enhet, 13 = pris per enhet ex moms (leverantörens listpris, inte vårt försäljningspris).
// Samma artikel på flera rader (samma pris) slås ihop till en rad med summerat antal.
function parseWinnerE01(text) {
    const articles = [];
    let customer = '';
    const byKey = new Map();
    String(text).split(/\r?\n/).forEach(line => {
        if (!line) return;
        const f = line.split(';');
        if (f[0] === '200' && !customer) customer = (f[2] || '').trim();
        if ((f[0] !== '500' && f[0] !== '450') || f.length < 14) return;
        const sku = (f[3] || '').trim();
        const qty = parseFloat(f[9]);
        const price = parseFloat(f[13]);
        if (!sku || !(qty > 0)) return;
        const row = { sku, name: (f[8] || '').replace(/\s+/g, ' ').trim(), qty, unit: (f[10] || 'st').trim(), price: isNaN(price) ? 0 : price };
        const key = sku + '|' + row.price + '|' + row.unit;
        if (byKey.has(key)) byKey.get(key).qty += qty;
        else { byKey.set(key, row); articles.push(row); }
    });
    articles.forEach(a => { a.qty = Math.round(a.qty * 1000) / 1000; });
    return { customer, articles };
}
if (typeof module !== 'undefined') module.exports = { parseWinnerE01 };
