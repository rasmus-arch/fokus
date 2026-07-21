document.addEventListener("DOMContentLoaded", () => {
    const role = localStorage.getItem('userRole');
    if(!role) {
        window.location.href = '/index.html';
        return;
    }

    // Funktion för att kolla vilken sida vi är på just nu
    const currentPath = window.location.pathname.toLowerCase();
    const isActive = (path) => currentPath.includes(path);

    // CSS-klasser för menyn (Aktiv respektive Inaktiv)
    const baseClass = "block py-2.5 px-4 rounded transition flex items-center";
    const activeClass = "bg-blue-900 bg-opacity-40 border border-blue-700 text-blue-300 font-medium";
    const inactiveClass = "hover:bg-gray-800 text-gray-300";

    let menuHtml = `
        <div class="bg-gray-900 text-white w-64 min-h-screen flex flex-col transition-all duration-300">
            <div class="p-5 bg-gray-800 text-xl font-bold tracking-widest text-center border-b border-gray-700">KLARO 2.0</div>
            <nav class="flex-1 p-4 space-y-2">
    `;

    // Administratörer och Säljare ser allt
    if(role !== 'Montör') {
        menuHtml += `<a href="/dashboard.html" class="${baseClass} ${isActive('dashboard') ? activeClass : inactiveClass}"><i class="fas fa-home w-6"></i> Översikt</a>`;
        menuHtml += `<a href="/leads.html" class="${baseClass} ${isActive('leads') ? activeClass : inactiveClass}"><i class="fas fa-users w-6"></i> Kundregister</a>`;
        menuHtml += `<a href="/products.html" class="${baseClass} ${isActive('products') ? activeClass : inactiveClass}"><i class="fas fa-boxes w-6"></i> Produkter</a>`;
        menuHtml += `<a href="/countertops.html" class="${baseClass} ${isActive('countertops') ? activeClass : inactiveClass}"><i class="fas fa-layer-group w-6"></i> Bänkskivor</a>`;
        menuHtml += `<a href="/quotes.html" class="${baseClass} ${isActive('quote') ? activeClass : inactiveClass}"><i class="fas fa-file-invoice w-6"></i> Offerter</a>`;
        
    }

    // Endast Superadmin/Admin ser administrationssidorna
    if (role === 'Superadmin' || role === 'Admin') {
        menuHtml += `<div class="pt-3 mt-3 border-t border-gray-800 text-[10px] uppercase text-gray-500 px-4 mb-1">Administration</div>`;
        menuHtml += `<a href="/suppliers.html" class="${baseClass} ${isActive('suppliers') ? activeClass : inactiveClass}"><i class="fas fa-truck w-6"></i> Leverantörer</a>`;
        menuHtml += `<a href="/door-models.html" class="${baseClass} ${isActive('door-models') ? activeClass : inactiveClass}"><i class="fas fa-swatchbook w-6"></i> Dörrmodeller</a>`;
        menuHtml += `<a href="/users.html" class="${baseClass} ${isActive('users') ? activeClass : inactiveClass}"><i class="fas fa-user-shield w-6"></i> Användare</a>`;
        menuHtml += `<a href="/settings.html" class="${baseClass} ${isActive('settings') ? activeClass : inactiveClass}"><i class="fas fa-cog w-6"></i> Företagsinfo</a>`;
    }
    
    // ALLA (även montörer) ser Ordrar
    menuHtml += `<a href="/orders.html" class="${baseClass} ${isActive('order') ? activeClass : inactiveClass}"><i class="fas fa-truck-loading w-6"></i> Ordrar</a>`;
    menuHtml += `<a href="/montage.html" class="${baseClass} ${isActive('montage') ? activeClass : inactiveClass}"><i class="fas fa-calendar-alt w-6"></i> Montage</a>`;
    menuHtml += `
            </nav>
            <div class="p-4 border-t border-gray-800">
                <div class="text-xs text-gray-500 mb-3 px-2">Inloggad som: <span class="text-white font-semibold">${role}</span></div>
                <button onclick="localStorage.clear(); window.location.href='/index.html'" class="w-full bg-red-600 hover:bg-red-700 text-white py-2 rounded transition flex items-center justify-center"><i class="fas fa-sign-out-alt mr-2"></i> Logga ut</button>
            </div>
        </div>
    `;
    
    const container = document.getElementById('sidebar-container');
    if(container) container.innerHTML = menuHtml;
});