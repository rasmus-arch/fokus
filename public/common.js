// Delad frontend-kod - inkluderas på alla sidor (före menu.js).
// 1) Patchar window.fetch så Authorization-headern automatiskt läggs på alla anrop mot /api/*,
//    så vi slipper ändra varenda enskilt fetch(...)-anrop i alla HTML-sidor för hand.
// 2) Global 401-hanterare: om en session har gått ut skickas användaren till inloggningen.
// 3) Ett par återanvändbara UI-hjälpfunktioner (paginering, bekräfta+radera) för att minska
//    kodduplicering mellan sidorna.
(function () {
    const originalFetch = window.fetch;
    window.fetch = async function (url, options = {}) {
        const isApiCall = typeof url === 'string' && url.startsWith('/api/');
        if (isApiCall) {
            const token = localStorage.getItem('userToken');
            if (token) {
                options = { ...options, headers: { ...(options.headers || {}), 'Authorization': 'Bearer ' + token } };
            }
        }
        const res = await originalFetch(url, options);
        if (isApiCall && res.status === 401 && !url.includes('/api/login')) {
            localStorage.clear();
            window.location.href = '/index.html';
        }
        return res;
    };
})();

// Byter ut kvarvarande hårdkodade förekomster av det gamla företagsnamnet ("Klarälvskök",
// "K-kök") i sidtiteln och i UI-element markerade med <... data-company-name>, mot det
// faktiska företagsnamnet från Företagsinfo. /api/settings är medvetet publik (används
// redan av inloggningssidan för loggan) så detta funkar även innan inloggning.
(async function applyCompanyBranding() {
    try {
        const res = await fetch('/api/settings');
        if (!res.ok) return;
        const s = await res.json();
        if (!s.company_name) return;
        document.title = document.title.replace(/Klarälvskök/g, s.company_name);
        const apply = () => document.querySelectorAll('[data-company-name]').forEach(el => { el.textContent = s.company_name; });
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
    } catch (e) {}
})();

// Bygger om en <a>-länk till en API-endpoint (t.ex. PDF-generering) med token som query-param,
// eftersom en vanlig länknavigering inte kan bära en Authorization-header.
function apiLinkWithToken(path) {
    const token = localStorage.getItem('userToken');
    const sep = path.includes('?') ? '&' : '?';
    return token ? `${path}${sep}token=${token}` : path;
}

// Enkel, återanvändbar paginerings-widget. onPageChangeFnName är NAMNET (sträng) på en global
// funktion redan definierad på sidan, t.ex. "changePageCust" - samma mönster som redan användes
// innan denna delades ut, bara centraliserat på ett ställe istället för kopierat i varje fil.
function renderPagination(container, currentPage, totalItems, itemsPerPage, onPageChangeFnName) {
    const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
    const start = (currentPage - 1) * itemsPerPage;
    const end = Math.min(start + itemsPerPage, totalItems);
    container.innerHTML = `
        <span class="text-xs text-gray-500">Visar ${totalItems === 0 ? 0 : start + 1}-${end} av ${totalItems}</span>
        <div class="flex gap-2">
            <button type="button" onclick="${onPageChangeFnName}(-1)" class="px-3 py-1 border rounded text-xs font-medium ${currentPage <= 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-gray-50'}" ${currentPage <= 1 ? 'disabled' : ''}>Föregående</button>
            <button type="button" onclick="${onPageChangeFnName}(1)" class="px-3 py-1 border rounded text-xs font-medium ${currentPage >= totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-white hover:bg-gray-50'}" ${currentPage >= totalPages ? 'disabled' : ''}>Nästa</button>
        </div>
    `;
}

// Det upprepade "bekräfta + DELETE-anrop + callback"-mönstret som förekom i över tio
// separata deleteX()-funktioner runt om i appen.
async function confirmAndDelete(confirmText, url, onSuccess) {
    if (!confirm(confirmText)) return;
    try {
        const res = await fetch(url, { method: 'DELETE' });
        if (res.ok && onSuccess) onSuccess();
        return res;
    } catch (e) {
        console.error(e);
        alert('Något gick fel.');
    }
}

// Vissa MySQL-drivrutinskonfigurationer packar redan upp JSON-kolumner till objekt/arrayer
// istället för att lämna dem som strängar - hantera båda formaten istället för att anta att
// det alltid är en sträng som behöver JSON.parse(). Tidigare kopierad separat i products.html,
// quote-builder.html och knowledge-base.html.
function parseJsonField(val, fallback) {
    if (val === null || val === undefined || val === '') return fallback;
    if (typeof val !== 'string') return val;
    try { return JSON.parse(val); } catch (e) { return fallback; }
}

// Delad momsfaktor + hämtning, tidigare kopierad separat i products.html och door-models.html.
// Faktor-fält (inköpspris x faktor x moms) på flera sidor räknar mot samma VAT_FACTOR.
let VAT_FACTOR = 1.25;
async function fetchVatRate() {
    try {
        const res = await fetch('/api/settings');
        const s = await res.json();
        VAT_FACTOR = 1 + (parseFloat(s.vat_rate ?? 25) / 100);
    } catch (e) { console.error(e); }
    return VAT_FACTOR;
}

// Delad marginalberäkning - används på produktnivå (products.html, countertops.html) och på
// offert-/ordernivå (quote-builder.html, quotes.html, orders.html), så alla sidor räknar exakt
// likadant. Standardformeln: (intäkt ex moms - kostnad ex moms) / intäkt ex moms.
// saleIncVat = försäljningspris inkl moms, costExVat = kostnad (redan ex moms, t.ex. inköpspris).
// Saknas kostnadsdata helt (null/undefined/'') går marginalen inte att räkna - returnerar null
// istället för att anta 0 kr kostnad, som annars skulle ge en falskt hög (nästan 100%) marginal.
function hasCostData(costExVat) {
    return costExVat !== null && costExVat !== undefined && costExVat !== '' && !isNaN(parseFloat(costExVat));
}
function calcMarginPercent(saleIncVat, costExVat) {
    if (!hasCostData(costExVat)) return null;
    const saleExVat = (parseFloat(saleIncVat) || 0) / VAT_FACTOR;
    if (saleExVat <= 0) return null;
    return ((saleExVat - parseFloat(costExVat)) / saleExVat) * 100;
}
function calcMarginKr(saleIncVat, costExVat) {
    if (!hasCostData(costExVat)) return null;
    const saleExVat = (parseFloat(saleIncVat) || 0) / VAT_FACTOR;
    return saleExVat - parseFloat(costExVat);
}

// Färgad badge som visar marginal i både kr och % (kr utelämnas om det inte skickas in).
// Returnerar en neutral "–" om marginalen inte går att räkna (t.ex. saknad kostnadsdata).
// kundlage-price gör att den döljs i Kundläge precis som andra priser.
function marginBadgeHtml(marginPercent, profitKr) {
    if (marginPercent === null || marginPercent === undefined || isNaN(marginPercent)) return '<span class="text-gray-400 text-xs">– (inköpspris saknas)</span>';
    const roundedPct = Math.round(marginPercent * 10) / 10;
    const color = marginPercent < 10 ? 'text-red-600 bg-red-50' : marginPercent < 25 ? 'text-amber-600 bg-amber-50' : 'text-green-700 bg-green-50';
    const text = (profitKr !== undefined && profitKr !== null && !isNaN(profitKr))
        ? `${Math.round(profitKr).toLocaleString('sv-SE')} kr (${roundedPct.toLocaleString('sv-SE')}%)`
        : `${roundedPct.toLocaleString('sv-SE')}%`;
    return `<span class="kundlage-price inline-block px-1.5 py-0.5 rounded text-[11px] font-bold ${color}">${text}</span>`;
}

// Räknar total marginal (kr + %) för en hel offert/order utifrån dess sparade quote_data -
// används i offert-/orderlistorna (quotes.html, orders.html) för en snabb överblick utan att
// behöva öppna offertbyggaren. quote = hela raden från /api/quotes (måste innehålla quote_data,
// global_discount, discount_type). Rader utan kostnadsdata (costExVat saknas) exkluderas helt -
// varken deras intäkt eller kostnad räknas med. Notera: räknar bara med kundvagnens rader
// (produkter/luckor/bänkskivor) plus deras montage - monteringsvillkor och startavgifter (som
// sätts i offertbyggaren) räknas INTE med här, så siffran är en approximation. Den exakta,
// fullständiga marginalen visas i offertbyggaren.
function calcQuoteMargin(quote) {
    const qd = parseJsonField(quote.quote_data, {});
    const cart = Array.isArray(qd.quoteCart) ? qd.quoteCart : [];
    if (cart.length === 0) return { percent: null, kr: null, excludedRevenueIncVat: 0, excludedCount: 0 };

    let materialRevenueIncVatAll = 0, marginRevenueIncVat = 0, marginCostExVat = 0, installRevenueIncVat = 0, installerCutIncVat = 0, excludedRevenueIncVat = 0, excludedCount = 0;
    cart.forEach(item => {
        const rowRevenueIncVat = (parseFloat(item.priceIncVat) || 0) * (1 - ((parseFloat(item.discount) || 0) / 100)) * (item.qty || 1);
        materialRevenueIncVatAll += rowRevenueIncVat;
        if (hasCostData(item.costExVat)) {
            marginRevenueIncVat += rowRevenueIncVat;
            marginCostExVat += parseFloat(item.costExVat) * (item.qty || 1);
        } else {
            excludedRevenueIncVat += rowRevenueIncVat;
            excludedCount++;
        }
        installRevenueIncVat += (parseFloat(item.installIncVat) || 0) * (item.qty || 1);
        installerCutIncVat += (parseFloat(item.installerShare) || 0) * (item.qty || 1);
    });

    // Global rabatt slår proportionerligt mot hela materialsumman - skalas ner lika mycket på den
    // marginalberäknade delsumman så den stämmer med vad kunden faktiskt betalar för de varorna.
    const discountVal = parseFloat(quote.global_discount) || 0;
    const discountAmount = quote.discount_type === '%' ? materialRevenueIncVatAll * (discountVal / 100) : discountVal;
    const discountFraction = materialRevenueIncVatAll > 0 ? Math.max(0, materialRevenueIncVatAll - discountAmount) / materialRevenueIncVatAll : 1;
    marginRevenueIncVat *= discountFraction;

    const totalRevenueExVat = (marginRevenueIncVat + installRevenueIncVat) / VAT_FACTOR;
    if (totalRevenueExVat <= 0) return { percent: null, kr: null, excludedRevenueIncVat, excludedCount };
    const totalCostExVat = marginCostExVat + (installerCutIncVat / VAT_FACTOR);
    const profitKr = totalRevenueExVat - totalCostExVat;
    return { percent: (profitKr / totalRevenueExVat) * 100, kr: profitKr, excludedRevenueIncVat, excludedCount };
}

// Läsbara etiketter för anledningarna POST /api/quotes/:id/recalculate-costs kan ge till varför
// en rad INTE kunde få kostnadsdata - se recalcQuoteCartCosts i server.js.
const RECALC_REASON_LABELS = {
    'lucka-saknar-inköpspris': 'Lucka/lådfront - dörrmodellens prisrad saknar inköpspris',
    'lucka-ingen-matchning-mot-dörrmodell': 'Lucka/lådfront - ingen matchande prisrad hittades i dörrmodellens prislista',
    'bänkskiva': 'Bänkskiva - saknar sparad referens till färg/tjocklek och kan inte återskapas automatiskt',
    'ingen-produktkoppling': 'Rad utan koppling till en produkt (t.ex. fritextrad)',
    'produkt-borttagen': 'Produkten är borttagen ur katalogen',
    'variant-hittades-ej': 'Variabel produkt - varianten hittades inte eller saknar inköpspris',
    'produkt-saknar-inköpspris': 'Produkten saknar inköpspris i katalogen'
};
// Bygger en läsbar textsammanfattning (för alert()) av de rader som INTE kunde få kostnadsdata,
// grupperat per anledning - så det syns konkret VILKA rader det handlar om istället för bara ett tal.
function describeRecalcDetails(details) {
    if (!details || details.length === 0) return '';
    const byReason = {};
    details.forEach(d => { (byReason[d.reason] = byReason[d.reason] || []).push(d.name); });
    let msg = '\n\nRader som fortfarande saknar kostnadsdata:';
    Object.keys(byReason).forEach(reason => {
        const names = byReason[reason];
        const shown = names.slice(0, 10);
        msg += `\n\n${RECALC_REASON_LABELS[reason] || reason} (${names.length} st):\n- ${shown.join('\n- ')}`;
        if (names.length > shown.length) msg += `\n... och ${names.length - shown.length} till`;
    });
    return msg;
}
// Samma sak som describeRecalcDetails, fast för bulk-körningen (alla offerter på en gång) som
// bara skickar tillbaka antal per anledning istället för varje enskilt radnamn (för stor mängd
// annars) - se reasonCounts från POST /api/quotes/recalculate-costs.
function describeRecalcReasonCounts(reasonCounts) {
    if (!reasonCounts || Object.keys(reasonCounts).length === 0) return '';
    let msg = '\n\nRader som fortfarande saknar kostnadsdata:';
    Object.keys(reasonCounts).forEach(reason => {
        msg += `\n- ${RECALC_REASON_LABELS[reason] || reason}: ${reasonCounts[reason]} st`;
    });
    return msg;
}

// Enkel HTML-escaping för text som interpolers i innerHTML-mallar (produktnamn, kundnamn,
// leaddata från externa webbformulär osv). Använd runt värden som kan innehålla < > & " '
// för att undvika att data av misstag tolkas som HTML/script.
function escapeHtml(val) {
    if (val === null || val === undefined) return '';
    return String(val)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ==========================================
// KUNDLÄGE - global på/av-knapp (i sidomenyn) som döljer ALLA priser i gränssnittet, tänkt
// för att kunna vända skärmen mot kunden (t.ex. i offertbyggaren) utan att visa belopp.
// Sidor markerar sina prisfält med klassen "kundlage-price" - det är det enda varje sida
// själv behöver göra, resten (toggle-knappen, tillståndet, CSS:en) sköts härifrån.
// ==========================================
(function () {
    const style = document.createElement('style');
    style.textContent = 'body.kundlage-active .kundlage-price { display: none !important; }';
    document.head.appendChild(style);

    function isKundlageActive() { return localStorage.getItem('kundlage') === 'true'; }

    function applyKundlageClass() {
        document.body.classList.toggle('kundlage-active', isKundlageActive());
    }

    function toggleKundlage() {
        localStorage.setItem('kundlage', (!isKundlageActive()).toString());
        applyKundlageClass();
        const btn = document.getElementById('kundlageToggleBtn');
        if (btn) updateKundlageButton(btn);
    }
    window.toggleKundlage = toggleKundlage;

    function updateKundlageButton(btn) {
        const active = isKundlageActive();
        btn.innerHTML = active
            ? '<i class="fas fa-eye-slash mr-2"></i> Kundläge: PÅ'
            : '<i class="fas fa-eye mr-2"></i> Kundläge: AV';
        btn.className = 'w-full py-2 rounded transition flex items-center justify-center text-sm font-medium ' + (active ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-200');
    }
    window.updateKundlageButton = updateKundlageButton;

    const apply = () => applyKundlageClass();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply); else apply();
})();
