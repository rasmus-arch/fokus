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
