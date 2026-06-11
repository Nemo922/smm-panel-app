// Initialize Telegram WebApp API
const tg = window.Telegram.WebApp;

// Variables to store current state
let currentUserData = null;
let currentSelectedService = null;

// Mock Service Data (In a real app, this would also come from the backend)
const smmServices = [
    { id: 1, platform: 'instagram', name: 'Instagram Takipçi (Türk)', desc: 'Gerçek ve aktif Türk kullanıcılar.', pricePer1000: 25.00, min: 100, max: 50000, icon: 'ph-instagram-logo' },
    { id: 2, platform: 'instagram', name: 'Instagram Beğeni (Global)', desc: 'Kaliteli global hesaplardan anında beğeni.', pricePer1000: 5.50, min: 50, max: 10000, icon: 'ph-heart' },
    { id: 3, platform: 'tiktok', name: 'TikTok Video İzlenme', desc: 'Keşfet etkili yüksek hızlı video izlenme.', pricePer1000: 2.00, min: 1000, max: 1000000, icon: 'ph-tiktok-logo' },
    { id: 4, platform: 'twitter', name: 'Twitter (X) Retweet', desc: 'Organik etkileşimli RT hizmeti.', pricePer1000: 45.00, min: 50, max: 5000, icon: 'ph-twitter-logo' },
    { id: 5, platform: 'youtube', name: 'YouTube Abone', desc: 'Ömür boyu telafili abone servisi.', pricePer1000: 150.00, min: 100, max: 10000, icon: 'ph-youtube-logo' }
];

document.addEventListener("DOMContentLoaded", async () => {
    tg.expand();

    if (tg.colorScheme === 'dark') {
        document.body.classList.add('dark-theme');
    }
    
    if(tg.setHeaderColor) {
        tg.setHeaderColor('bg_color');
    }

    // Default mock user if not in Telegram
    let telegram_id = 12345;
    let first_name = "Misafir";
    let username = "kullanici";

    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const user = tg.initDataUnsafe.user;
        telegram_id = user.id;
        first_name = user.first_name || first_name;
        username = user.username ? `@${user.username}` : `ID: ${user.id}`;
    }

    // Store globally
    currentUserData = { telegram_id, first_name, username };

    // Check user registration status from Python Backend
    await checkUserStatus(telegram_id);

    setupTabs();
    setupCategoryFilters();
    setupModal();

    tg.ready();
});

// CHECK REGISTRATION STATUS
async function checkUserStatus(tg_id) {
    try {
        const response = await fetch(`/api/user?tg_id=${tg_id}`);
        const data = await response.json();

        if (data.registered) {
            // User is registered, go to Dashboard
            updateDashboardUI(data.user);
            renderOrders(data.orders);
            renderServices('all'); // Load services
            showView('view-services');
        } else {
            // User not registered, show Register Screen
            document.body.classList.add('hide-nav'); // Hide bottom nav
            showView('view-register');
            
            document.getElementById('register-welcome').textContent = `Hoş Geldiniz, ${currentUserData.first_name}!`;
            
            // Setup Register Button
            document.getElementById('btn-register').onclick = async () => {
                await registerUser(currentUserData);
            };
        }
    } catch (error) {
        console.error("Backend bağlantı hatası:", error);
        // Fallback for testing without backend
        alert("Bağlantı hatası: Sunucu kapalı olabilir. Lütfen backend'i çalıştırın.");
    }
}

// REGISTER USER
async function registerUser(userData) {
    const btn = document.getElementById('btn-register');
    btn.textContent = "Kaydediliyor...";
    btn.disabled = true;

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: userData.telegram_id,
                first_name: userData.first_name,
                username: userData.username
            })
        });
        const data = await response.json();
        
        if (data.success) {
            if(tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            // Refresh to load Dashboard
            await checkUserStatus(userData.telegram_id);
        }
    } catch(err) {
        btn.textContent = "Hata Oluştu, Tekrar Dene";
        btn.disabled = false;
    }
}

// UPDATE UI
function updateDashboardUI(userDbInfo) {
    document.body.classList.remove('hide-nav'); // Show bottom nav

    // Global Header Balance
    document.querySelector('.balance-amount').textContent = `₺${userDbInfo.balance.toFixed(2)}`;

    // Profile Page Info
    document.getElementById('user-name').textContent = userDbInfo.first_name;
    document.getElementById('user-username').textContent = userDbInfo.username;
    document.getElementById('user-avatar').textContent = userDbInfo.first_name.charAt(0).toUpperCase();
}

function renderOrders(orders) {
    const container = document.querySelector('.orders-list');
    container.innerHTML = '';

    if (!orders || orders.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding: 20px;">Henüz hiç siparişiniz yok.</p>';
        return;
    }

    orders.forEach(order => {
        let badgeClass = 'badge-warning'; // İşlemde
        if (order.status.toLowerCase() === 'tamamlandı') badgeClass = 'badge-success';
        
        // Find service name
        const srv = smmServices.find(s => s.id === order.service_id);
        const srvName = srv ? srv.name : `Servis ID: ${order.service_id}`;

        const card = document.createElement('div');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="order-header">
                <span class="order-id">#${order.id}</span>
                <span class="badge ${badgeClass}">${order.status}</span>
            </div>
            <div class="order-body">
                <h4>${srvName}</h4>
                <p class="order-link">${order.link} (${order.quantity} Adet)</p>
            </div>
            <div class="order-footer">
                <span class="order-date">${new Date(order.order_date).toLocaleDateString()}</span>
                <span class="order-price">₺${order.price.toFixed(2)}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

function showView(viewId) {
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    document.getElementById(viewId).classList.add('active');
}

function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            if(tg.HapticFeedback) tg.HapticFeedback.selectionChanged();

            navItems.forEach(nav => {
                nav.classList.remove('active');
                const icon = nav.querySelector('i');
                icon.className = icon.className.replace('ph-fill', 'ph');
            });
            item.classList.add('active');
            const activeIcon = item.querySelector('i');
            activeIcon.className = activeIcon.className.replace('ph ', 'ph-fill ');

            showView(item.getAttribute('data-target'));
            window.scrollTo(0, 0);
        });
    });
}

function renderServices(filterPlatform) {
    const container = document.getElementById('services-container');
    container.innerHTML = '';

    const filtered = filterPlatform === 'all' ? smmServices : smmServices.filter(s => s.platform === filterPlatform);

    filtered.forEach(service => {
        const card = document.createElement('div');
        card.className = 'service-card';
        card.innerHTML = `
            <div class="service-header">
                <div class="service-icon platform-${service.platform}"><i class="ph ${service.icon}"></i></div>
                <div class="service-info">
                    <h4>${service.name}</h4>
                    <p>Min: ${service.min} - Max: ${service.max}</p>
                </div>
            </div>
            <div class="service-footer">
                <div class="price">₺${service.pricePer1000.toFixed(2)} <span>/ 1000 Adet</span></div>
                <button class="btn-buy" data-id="${service.id}">Satın Al</button>
            </div>
        `;
        container.appendChild(card);
    });

    document.querySelectorAll('.btn-buy').forEach(btn => {
        btn.addEventListener('click', (e) => {
            openOrderModal(parseInt(e.target.getAttribute('data-id')));
        });
    });
}

function setupCategoryFilters() {
    const chips = document.querySelectorAll('.category-chip');
    chips.forEach(chip => {
        chip.addEventListener('click', () => {
            if(tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderServices(chip.getAttribute('data-cat'));
        });
    });
}

// Modal Logic
const modal = document.getElementById('order-modal');
const btnCloseModal = document.querySelector('.close-modal');
const inputQuantity = document.getElementById('order-quantity');
const inputLink = document.getElementById('order-link');
const elTotalPrice = document.getElementById('modal-total-price');
const btnSubmitOrder = document.getElementById('btn-submit-order');

function openOrderModal(serviceId) {
    currentSelectedService = smmServices.find(s => s.id === serviceId);
    
    document.getElementById('modal-service-name').textContent = currentSelectedService.name;
    document.getElementById('modal-service-desc').textContent = currentSelectedService.desc;
    document.getElementById('modal-min').textContent = currentSelectedService.min;
    document.getElementById('modal-max').textContent = currentSelectedService.max;
    
    inputLink.value = '';
    inputQuantity.value = currentSelectedService.min;
    calculatePrice();

    modal.classList.add('active');
    
    if(tg.MainButton) {
        tg.MainButton.text = 'SİPARİŞİ ONAYLA';
        tg.MainButton.color = tg.themeParams.button_color || '#2481cc';
        tg.MainButton.show();
    }
}

function closeModal() {
    modal.classList.remove('active');
    currentSelectedService = null;
    if(tg.MainButton) tg.MainButton.hide();
}

btnCloseModal.addEventListener('click', closeModal);
inputQuantity.addEventListener('input', calculatePrice);

function calculatePrice() {
    if(!currentSelectedService) return;
    let qty = parseInt(inputQuantity.value) || 0;
    
    if(qty < currentSelectedService.min || qty > currentSelectedService.max) {
        inputQuantity.style.borderColor = 'var(--color-danger)';
    } else {
        inputQuantity.style.borderColor = 'var(--tg-button-color)';
    }

    const price = (qty / 1000) * currentSelectedService.pricePer1000;
    elTotalPrice.textContent = `₺${price.toFixed(2)}`;
}

// Submit Order via API
const submitOrder = async () => {
    if(!currentSelectedService) return;
    
    const link = inputLink.value.trim();
    const qty = parseInt(inputQuantity.value) || 0;

    if(!link) { tg.showAlert("Lütfen bağlantı girin."); return; }
    if(qty < currentSelectedService.min || qty > currentSelectedService.max) {
        tg.showAlert(`Miktar ${currentSelectedService.min} - ${currentSelectedService.max} arasında olmalıdır.`);
        return;
    }

    const price = ((qty / 1000) * currentSelectedService.pricePer1000);

    // Disable button to prevent double clicks
    if(tg.MainButton) tg.MainButton.showProgress();
    btnSubmitOrder.disabled = true;
    btnSubmitOrder.textContent = "İşleniyor...";

    try {
        const response = await fetch('/api/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: currentUserData.telegram_id,
                service_id: currentSelectedService.id,
                link: link,
                quantity: qty,
                price: price
            })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            if(tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            tg.showAlert("Sipariş başarıyla oluşturuldu! (Bakiye düşüldü)");
            closeModal();
            // Refresh User Data to update balance and orders
            await checkUserStatus(currentUserData.telegram_id);
            // Switch to orders tab
            document.querySelector('[data-target="view-orders"]').click();
        } else {
            tg.showAlert(`Hata: ${data.detail || 'Bilinmeyen Hata'}`);
        }
    } catch(err) {
        tg.showAlert("Sunucu bağlantı hatası!");
    } finally {
        if(tg.MainButton) tg.MainButton.hideProgress();
        btnSubmitOrder.disabled = false;
        btnSubmitOrder.textContent = "Siparişi Onayla";
    }
};

btnSubmitOrder.addEventListener('click', submitOrder);
tg.onEvent('mainButtonClicked', submitOrder);
