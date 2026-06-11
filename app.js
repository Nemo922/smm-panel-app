// Initialize Telegram WebApp API
const tg = window.Telegram.WebApp;

// Mock Service Data
const smmServices = [
    {
        id: 1,
        platform: 'instagram',
        name: 'Instagram Takipçi (Türk & Gerçek)',
        desc: 'Gerçek ve aktif Türk kullanıcılardan oluşan takipçi paketi. Düşüşlere karşı 30 gün telafi garantilidir.',
        pricePer1000: 25.00,
        min: 100,
        max: 50000,
        icon: 'ph-instagram-logo'
    },
    {
        id: 2,
        platform: 'instagram',
        name: 'Instagram Beğeni (Global)',
        desc: 'Kaliteli global hesaplardan anında beğeni. Paylaşım linki girmeniz yeterlidir.',
        pricePer1000: 5.50,
        min: 50,
        max: 10000,
        icon: 'ph-heart'
    },
    {
        id: 3,
        platform: 'tiktok',
        name: 'TikTok Video İzlenme',
        desc: 'Keşfet etkili yüksek hızlı video izlenme. Aynı gün içinde tamamlanır.',
        pricePer1000: 2.00,
        min: 1000,
        max: 1000000,
        icon: 'ph-tiktok-logo'
    },
    {
        id: 4,
        platform: 'twitter',
        name: 'Twitter (X) Retweet',
        desc: 'Tweetlerinizin etkileşimini artıracak kaliteli hesaplardan organik RT.',
        pricePer1000: 45.00,
        min: 50,
        max: 5000,
        icon: 'ph-twitter-logo'
    },
    {
        id: 5,
        platform: 'youtube',
        name: 'YouTube Abone (Ömür Boyu Telafili)',
        desc: 'Kanalınız için kaliteli abone servisi. Para kazanma açmaya uygundur.',
        pricePer1000: 150.00,
        min: 100,
        max: 10000,
        icon: 'ph-youtube-logo'
    }
];

let currentSelectedService = null;

document.addEventListener("DOMContentLoaded", () => {
    tg.expand();

    if (tg.colorScheme === 'dark') {
        document.body.classList.add('dark-theme');
    }
    
    if(tg.setHeaderColor) {
        tg.setHeaderColor('bg_color');
    }

    setupUserInfo();
    setupTabs();
    renderServices('all');
    setupCategoryFilters();
    setupModal();

    tg.ready();
});

function setupUserInfo() {
    const nameEl = document.getElementById('user-name');
    const usernameEl = document.getElementById('user-username');
    const initialEl = document.getElementById('user-avatar');

    let firstName = "Misafir Kullanıcı";
    let username = "Giriş yapılmadı";

    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const user = tg.initDataUnsafe.user;
        firstName = user.first_name || firstName;
        username = user.username ? `@${user.username}` : `ID: ${user.id}`;
    }

    nameEl.textContent = firstName;
    usernameEl.textContent = username;
    initialEl.textContent = firstName.charAt(0).toUpperCase();
}

function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    const views = document.querySelectorAll('.view-section');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Haptic
            if(tg.HapticFeedback) tg.HapticFeedback.selectionChanged();

            // Update Nav UI
            navItems.forEach(nav => {
                nav.classList.remove('active');
                const icon = nav.querySelector('i');
                icon.className = icon.className.replace('ph-fill', 'ph');
            });
            item.classList.add('active');
            const activeIcon = item.querySelector('i');
            activeIcon.className = activeIcon.className.replace('ph ', 'ph-fill ');

            // Switch View
            const targetId = item.getAttribute('data-target');
            views.forEach(view => view.classList.remove('active'));
            document.getElementById(targetId).classList.add('active');
            
            // Scroll to top
            window.scrollTo(0, 0);
        });
    });
}

function renderServices(filterPlatform) {
    const container = document.getElementById('services-container');
    container.innerHTML = '';

    const filtered = filterPlatform === 'all' 
        ? smmServices 
        : smmServices.filter(s => s.platform === filterPlatform);

    filtered.forEach(service => {
        const card = document.createElement('div');
        card.className = 'service-card';
        card.innerHTML = `
            <div class="service-header">
                <div class="service-icon platform-${service.platform}">
                    <i class="ph ${service.icon}"></i>
                </div>
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

    // Add event listeners to buy buttons
    document.querySelectorAll('.btn-buy').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = parseInt(e.target.getAttribute('data-id'));
            openOrderModal(id);
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
            
            const cat = chip.getAttribute('data-cat');
            renderServices(cat);
        });
    });
}

// Modal Logic
const modal = document.getElementById('order-modal');
const btnCloseModal = document.querySelector('.close-modal');
const inputQuantity = document.getElementById('order-quantity');
const inputLink = document.getElementById('order-link');
const elTotalPrice = document.getElementById('modal-total-price');

function openOrderModal(serviceId) {
    currentSelectedService = smmServices.find(s => s.id === serviceId);
    
    document.getElementById('modal-service-name').textContent = currentSelectedService.name;
    document.getElementById('modal-service-desc').textContent = currentSelectedService.desc;
    document.getElementById('modal-min').textContent = currentSelectedService.min;
    document.getElementById('modal-max').textContent = currentSelectedService.max;
    
    // Reset Inputs
    inputLink.value = '';
    inputQuantity.value = currentSelectedService.min;
    calculatePrice();

    modal.classList.add('active');
    
    // Check if MainButton exists to use native TG button, else fallback to HTML button
    if(tg.MainButton) {
        tg.MainButton.text = 'SİPARİŞİ ONAYLA';
        tg.MainButton.color = tg.themeParams.button_color || '#2481cc';
        tg.MainButton.show();
    }
}

function closeModal() {
    modal.classList.remove('active');
    currentSelectedService = null;
    if(tg.MainButton) {
        tg.MainButton.hide();
    }
}

btnCloseModal.addEventListener('click', closeModal);

inputQuantity.addEventListener('input', calculatePrice);

function calculatePrice() {
    if(!currentSelectedService) return;
    
    let qty = parseInt(inputQuantity.value) || 0;
    
    // Simple validation visual feedback
    if(qty < currentSelectedService.min || qty > currentSelectedService.max) {
        inputQuantity.style.borderColor = 'var(--color-danger)';
    } else {
        inputQuantity.style.borderColor = 'var(--tg-button-color)';
    }

    const price = (qty / 1000) * currentSelectedService.pricePer1000;
    elTotalPrice.textContent = `₺${price.toFixed(2)}`;
}

// Handle Order Submission
const submitOrder = () => {
    if(!currentSelectedService) return;
    
    const link = inputLink.value.trim();
    const qty = parseInt(inputQuantity.value) || 0;

    if(!link) {
        tg.showAlert("Lütfen bağlantı veya kullanıcı adı girin.");
        return;
    }

    if(qty < currentSelectedService.min || qty > currentSelectedService.max) {
        tg.showAlert(`Miktar ${currentSelectedService.min} ile ${currentSelectedService.max} arasında olmalıdır.`);
        return;
    }

    const price = ((qty / 1000) * currentSelectedService.pricePer1000).toFixed(2);

    const orderData = {
        action: 'new_order',
        service_id: currentSelectedService.id,
        link: link,
        quantity: qty,
        price: price
    };

    // Send data back to Telegram Bot
    if(tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    tg.sendData(JSON.stringify(orderData));
    
    // In a real scenario, the window will be closed by the bot after receiving data
};

// HTML button fallback
document.getElementById('btn-submit-order').addEventListener('click', submitOrder);

// Native Telegram MainButton event
tg.onEvent('mainButtonClicked', submitOrder);
