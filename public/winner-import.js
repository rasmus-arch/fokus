// Läser en exportfil (.e01) från ritprogrammet Winner och plockar ut artikelraderna.
// Filen är vanlig text (Windows-1252) med en post per rad och semikolon mellan fälten.
// Post 500 (och 450) är en artikelrad: fält 3 = artikelnummer, 8 = benämning, 9 = antal,
// 10 = enhet, 13 = pris per enhet ex moms (leverantörens listpris, inte vårt försäljningspris).
// Raden efter (post 502) kan ha en måttbeskrivning, t.ex. "Höjd = 2400.00, Djup = 595.00".
// Rader med enhet m² (täcksidor/passbitar) är ETT tillverkat stycke per rad - de behålls som
// separata stycken (med mått) och bara identiska stycken slås ihop till antal. Övriga rader
// med samma artikel och pris summeras. Post 520 med gruppen "Kök" följs av post 524 med
// dörrmodellens namn (t.ex. "Dövad Ek kvartskuren Pg G").
function parseWinnerE01(text) {
    const articles = [];
    let customer = '';
    const doorModels = [];
    const byKey = new Map();
    const lines = String(text).split(/\r?\n/);
    let lastArticle = null, kitchenGroup = false;
    lines.forEach(line => {
        if (!line) return;
        const f = line.split(';');
        if (f[0] === '200' && !customer) customer = (f[2] || '').trim();
        if (f[0] === '520') kitchenGroup = (f[4] || '').trim() === 'Kök';
        if (f[0] === '524' && kitchenGroup) {
            const dm = (f[2] || '').trim();
            if (dm && !doorModels.includes(dm)) doorModels.push(dm);
        }
        if (f[0] === '502' && lastArticle && !lastArticle.detail) {
            lastArticle.detail = (f[1] || '').trim();
            lastArticle = null;
            return;
        }
        if ((f[0] !== '500' && f[0] !== '450') || f.length < 14) return;
        lastArticle = null;
        const sku = (f[3] || '').trim();
        const qty = parseFloat(f[9]);
        const price = parseFloat(f[13]);
        if (!sku || !(qty > 0)) return;
        const unit = (f[10] || 'st').trim();
        const row = { sku, name: (f[8] || '').replace(/\s+/g, ' ').trim(), qty, unit, price: isNaN(price) ? 0 : price, detail: '', pieces: 1, perPiece: unit === 'm²' };
        articles.push(row);
        lastArticle = row;
    });
    // Slå ihop: stycken (m²) med identiskt mått och övriga rader med samma artikel/pris
    const merged = [];
    articles.forEach(a => {
        const key = a.perPiece ? [a.sku, a.price, a.unit, a.detail, a.qty].join('|') : [a.sku, a.price, a.unit].join('|');
        if (byKey.has(key)) {
            const t = byKey.get(key);
            if (a.perPiece) t.pieces += 1; else t.qty += a.qty;
        } else { byKey.set(key, a); merged.push(a); }
    });
    merged.forEach(a => { a.qty = Math.round(a.qty * 100000) / 100000; });
    return { customer, doorModels, articles: merged };
}
// "Höjd = 2400.00, Djup = 595.00" -> "2400x595 mm"; annan text returneras som den är
function winnerDetailLabel(detail) {
    const h = /H[öo]jd\s*=\s*([\d.]+)/i.exec(detail || ''), d = /Djup\s*=\s*([\d.]+)/i.exec(detail || ''), b = /Bredd\s*=\s*([\d.]+)/i.exec(detail || '');
    const nums = [h, b, d].filter(Boolean).map(m => Math.round(parseFloat(m[1])));
    if (nums.length >= 2) return nums.join('x') + ' mm';
    return detail || '';
}
if (typeof module !== 'undefined') module.exports = { parseWinnerE01, winnerDetailLabel };
