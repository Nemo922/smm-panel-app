// Initialize Telegram WebApp API
const tg = window.Telegram.WebApp;

// Variables to store current state
let currentUserData = null;
let currentSelectedService = null;
let smmServices = []; // Loaded from backend
let appSettings = {}; // Loaded from backend

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
document.addEventListener("DOMContentLoaded", async () => {
    tg.expand();

    // Theme
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'dark' || (!savedTheme && tg.colorScheme === 'dark')) {
        document.body.classList.add('dark-theme');
    } else {
        document.body.classList.remove('dark-theme');
    }
    if (tg.setHeaderColor) tg.setHeaderColor('bg_color');
    setupThemeToggle();

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

    currentUserData = { telegram_id, first_name, username };

    // Load public settings first (brand name, bank info, etc.)
    await loadPublicSettings();

    // Load services from backend
    await loadServicesFromBackend();

    // Check user registration
    await checkUserStatus(telegram_id);

    setupTabs();
    setupCategoryFilters();
    setupModals();
    setupProfileMenu();
    setupDragScroll();
    setupPaymentModal();
    setupAdminPanel();
    
    // Ödeme yöntemlerini dinamik olarak yükle
    await loadPaymentMethodsForFunds();


    // Global Refresh
    const refreshBtn = document.getElementById('global-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', async (e) => {
            const btn = e.currentTarget;
            btn.style.transform = 'rotate(360deg)';
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
            
            await loadPublicSettings();
            await loadServicesFromBackend();
            
            // Admin paneli açıksa mevcut sekmede kal
            if (document.getElementById('view-admin').classList.contains('active')) {
                const activeTab = document.querySelector('.admin-tab.active');
                if (activeTab) {
                    const tabId = activeTab.getAttribute('data-tab');
                    if (tabId === 'tab-payments') loadPendingPayments();
                    if (tabId === 'tab-services') loadAdminServices();
                    if (tabId === 'tab-users') loadAdminUsers();
                    if (tabId === 'tab-orders') loadAdminOrders();
                    if (tabId === 'tab-payment-methods') loadAdminPaymentMethods();
                    if (tabId === 'tab-settings') loadAdminSettings();
                }
            } else {
                // Normal sayfadaysa kullanıcı verisini güncelle
                await checkUserStatus(currentUserData.telegram_id);
            }
            
            setTimeout(() => { btn.style.transform = ''; }, 300);
        });
    }

    tg.ready();
});

// ═══════════════════════════════════════════════════════════════
// SETTINGS & BRAND
// ═══════════════════════════════════════════════════════════════
async function loadPublicSettings() {
    try {
        const res = await fetch('/api/settings/public');
        const data = await res.json();
        if (data.success) {
            appSettings = data.settings;
            applySettings(appSettings);
        }
    } catch (e) {
        console.warn('Ayarlar yüklenemedi:', e);
    }
}

function applySettings(settings) {
    // Brand name
    const brandEl = document.getElementById('brand-name');
    if (brandEl && settings.brand_name) brandEl.textContent = settings.brand_name;

    // Bonus banner
    const bonusTitle = document.getElementById('bonus-title');
    const bonusDesc = document.getElementById('bonus-desc');
    if (bonusTitle && settings.bonus_text) bonusTitle.textContent = '🚀 ' + settings.bonus_text;
    if (bonusDesc && settings.bonus_desc) bonusDesc.textContent = settings.bonus_desc;

    // Crypto networks label
    const cryptoLabel = document.getElementById('crypto-networks-label');
    if (cryptoLabel && settings.crypto_networks) cryptoLabel.textContent = settings.crypto_networks;
}

// ═══════════════════════════════════════════════════════════════
// SERVICES (from backend)
// ═══════════════════════════════════════════════════════════════
async function loadServicesFromBackend() {
    try {
        const res = await fetch('/api/services');
        const data = await res.json();
        if (data.success) {
            smmServices = data.services;
        }
    } catch (e) {
        console.warn('Servisler yüklenemedi:', e);
    }
}

// ═══════════════════════════════════════════════════════════════
// USER AUTH
// ═══════════════════════════════════════════════════════════════
async function checkUserStatus(tg_id) {
    try {
        const response = await fetch(`/api/user?tg_id=${tg_id}`);
        const data = await response.json();

        if (data.registered) {
            if (!data.user.custom_username) {
                document.body.classList.add('hide-nav');
                showView('view-register');
                document.getElementById('register-welcome').textContent = `Kullanıcı Adı Seçin, ${currentUserData.first_name}!`;
                document.getElementById('btn-register').onclick = async () => await registerUser(currentUserData);
                return;
            }
            updateDashboardUI(data.user, data.orders);
            renderOrders(data.orders);
            renderServices('all');

            const menuAdmin = document.getElementById('menu-admin');
            if (data.is_admin) {
                if (menuAdmin) menuAdmin.style.display = 'flex';
            } else {
                if (menuAdmin) menuAdmin.style.display = 'none';
            }
            showView('view-services');
        } else {
            document.body.classList.add('hide-nav');
            showView('view-register');
            document.getElementById('register-welcome').textContent = `Hoş Geldiniz, ${currentUserData.first_name}!`;
            document.getElementById('btn-register').onclick = async () => await registerUser(currentUserData);
        }
    } catch (error) {
        console.error("Backend bağlantı hatası:", error);
        alert("Bağlantı hatası: Sunucu kapalı olabilir.");
    }
}

async function registerUser(userData) {
    const inputUsername = document.getElementById('register-username');
    const customUsername = inputUsername ? inputUsername.value.trim().toLowerCase() : '';
    if (!customUsername) {
        showAlert("Lütfen bir kullanıcı adı belirleyin.");
        return;
    }
    const regex = /^[a-zA-Z0-9]+$/;
    if (!regex.test(customUsername)) {
        showAlert("Kullanıcı adı sadece İngilizce harfler ve rakamlardan oluşmalı.");
        return;
    }
    const btn = document.getElementById('btn-register');
    btn.textContent = "Kontrol ediliyor...";
    btn.disabled = true;
    try {
        const checkRes = await fetch(`/api/check-username?username=${customUsername}`);
        const checkData = await checkRes.json();
        if (checkData.exists) {
            showAlert("Bu kullanıcı adı zaten alınmış. Lütfen başka bir tane deneyin.");
            btn.textContent = "Kayıt Ol ve Giriş Yap";
            btn.disabled = false;
            return;
        }
        btn.textContent = "Kaydediliyor...";
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: userData.telegram_id,
                first_name: userData.first_name,
                username: userData.username,
                custom_username: customUsername
            })
        });
        const data = await response.json();
        if (data.success) {
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            await checkUserStatus(userData.telegram_id);
        } else {
            showAlert(data.detail || "Kayıt başarısız.");
            btn.textContent = "Kayıt Ol ve Giriş Yap";
            btn.disabled = false;
        }
    } catch (err) {
        btn.textContent = "Hata Oluştu, Tekrar Dene";
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD UI
// ═══════════════════════════════════════════════════════════════
function updateDashboardUI(userDbInfo, orders = []) {
    document.body.classList.remove('hide-nav');
    document.querySelector('.balance-amount').textContent = `₺${userDbInfo.balance.toFixed(2)}`;
    document.getElementById('user-name').textContent = userDbInfo.first_name;
    document.getElementById('user-username').textContent = userDbInfo.custom_username ? `@${userDbInfo.custom_username}` : userDbInfo.username;
    document.getElementById('user-avatar').textContent = userDbInfo.first_name.charAt(0).toUpperCase();

    const totalOrders = orders.length;
    const totalSpent = orders.reduce((sum, o) => sum + (o.price || 0), 0);
    const orderCountEl = document.getElementById('profile-order-count');
    const totalSpentEl = document.getElementById('profile-total-spent');
    if (orderCountEl) orderCountEl.textContent = totalOrders;
    if (totalSpentEl) totalSpentEl.textContent = `₺${totalSpent.toFixed(2)}`;
}

// ═══════════════════════════════════════════════════════════════
// ORDERS (USER SIDE)
// ═══════════════════════════════════════════════════════════════
function renderOrders(orders) {
    const container = document.getElementById('orders-container');
    if (!container) return;
    container.innerHTML = '';
    if (!orders || orders.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding: 20px;">Henüz hiç siparişiniz yok.</p>';
        return;
    }
    orders.forEach(order => {
        let badgeClass = 'badge-warning';
        const status = order.status || 'Bekliyor';
        if (status === 'Tamamlandı') badgeClass = 'badge-success';
        if (status === 'İptal Edildi') badgeClass = 'badge-danger';
        if (status === 'İşlemde') badgeClass = 'badge-primary';

        const srv = smmServices.find(s => s.id === order.service_id);
        const srvName = srv ? srv.name : (order.service_name || `Servis #${order.service_id}`);

        let noteHtml = '';
        if (order.admin_note) {
            noteHtml = `<div style="margin-top:10px; padding:10px; background:var(--tg-secondary-bg-color); border-radius:8px; border-left:3px solid var(--color-danger);">
                <p style="font-size:12px; color:var(--tg-hint-color); margin-bottom:4px;">Yetkili Notu:</p>
                <p style="font-size:13px; color:var(--tg-text-color);">${order.admin_note}</p>
            </div>`;
        }

        const card = document.createElement('div');
        card.className = 'order-card';
        card.innerHTML = `
            <div class="order-header">
                <span class="order-id">#${order.id}</span>
                <span class="badge ${badgeClass}">${status}</span>
            </div>
            <div class="order-body">
                <h4>${srvName}</h4>
                <p class="order-link">${order.link} (${order.quantity} Adet)</p>
                ${noteHtml}
            </div>
            <div class="order-footer">
                <span class="order-date">${new Date(order.order_date).toLocaleDateString('tr-TR')}</span>
                <span class="order-price">₺${order.price.toFixed(2)}</span>
            </div>
        `;
        container.appendChild(card);
    });
}

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════
function showView(viewId) {
    document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
    const el = document.getElementById(viewId);
    if (el) el.classList.add('active');
}

function setupTabs() {
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            if (tg.HapticFeedback) tg.HapticFeedback.selectionChanged();
            navItems.forEach(nav => {
                nav.classList.remove('active');
                const icon = nav.querySelector('i');
                if (icon) icon.className = icon.className.replace('ph-fill', 'ph');
            });
            item.classList.add('active');
            const activeIcon = item.querySelector('i');
            if (activeIcon) activeIcon.className = activeIcon.className.replace('ph ', 'ph-fill ');
            showView(item.getAttribute('data-target'));
            window.scrollTo(0, 0);
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// SERVICES (RENDER)
// ═══════════════════════════════════════════════════════════════
function renderServices(filterPlatform) {
    const container = document.getElementById('services-container');
    if (!container) return;
    container.innerHTML = '';
    const filtered = filterPlatform === 'all' ? smmServices : smmServices.filter(s => s.platform === filterPlatform);
    if (filtered.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding: 30px;">Bu kategoride henüz hizmet bulunmuyor.</p>';
        return;
    }
    filtered.forEach(service => {
        const card = document.createElement('div');
        card.className = 'service-card';
        card.innerHTML = `
            <div class="service-header">
                <div class="service-icon platform-${service.platform}"><i class="ph ${service.icon}"></i></div>
                <div class="service-info">
                    <h4>${service.name}</h4>
                    <p>Min: ${service.min_order} - Max: ${service.max_order}</p>
                </div>
            </div>
            <div class="service-footer">
                <div class="price">₺${parseFloat(service.price_per_1000).toFixed(2)} <span>/ 1000 Adet</span></div>
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
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
            chips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            renderServices(chip.getAttribute('data-cat'));
        });
    });
}

// ═══════════════════════════════════════════════════════════════
// ORDER MODAL
// ═══════════════════════════════════════════════════════════════
function setupModals() {
    const orderModal = document.getElementById('order-modal');
    const orderCloseBtn = orderModal ? orderModal.querySelector('.close-modal') : null;
    if (orderCloseBtn) {
        orderCloseBtn.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });
    }
    if (orderModal) {
        orderModal.addEventListener('click', (e) => { if (e.target === orderModal) closeModal(); });
    }

    const paymentModalEl = document.getElementById('payment-modal');
    const paymentCloseBtn = paymentModalEl ? paymentModalEl.querySelector('.close-modal') : null;
    if (paymentCloseBtn) {
        paymentCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            paymentModalEl.classList.remove('active');
            selectedPaymentMethod = null;
        });
    }
    if (paymentModalEl) {
        paymentModalEl.addEventListener('click', (e) => {
            if (e.target === paymentModalEl) {
                paymentModalEl.classList.remove('active');
                selectedPaymentMethod = null;
            }
        });
    }

    const userEditModal = document.getElementById('user-edit-modal');
    const userEditCloseBtn = userEditModal ? userEditModal.querySelector('.close-modal') : null;
    if (userEditCloseBtn) {
        userEditCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            userEditModal.classList.remove('active');
        });
    }
    if (userEditModal) {
        userEditModal.addEventListener('click', (e) => {
            if (e.target === userEditModal) userEditModal.classList.remove('active');
        });
    }

    const addBalanceModal = document.getElementById('admin-add-balance-modal');
    const addBalanceCloseBtn = addBalanceModal ? addBalanceModal.querySelector('.close-modal') : null;
    if (addBalanceCloseBtn) {
        addBalanceCloseBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            addBalanceModal.classList.remove('active');
        });
    }
    if (addBalanceModal) {
        addBalanceModal.addEventListener('click', (e) => {
            if (e.target === addBalanceModal) addBalanceModal.classList.remove('active');
        });
    }

    const cancelOrderModal = document.getElementById('admin-cancel-order-modal');
    const cancelOrderCloseBtn = cancelOrderModal ? cancelOrderModal.querySelector('.close-modal') : null;
    if (cancelOrderCloseBtn) cancelOrderCloseBtn.addEventListener('click', () => cancelOrderModal.classList.remove('active'));
    if (cancelOrderModal) cancelOrderModal.addEventListener('click', (e) => { if (e.target === cancelOrderModal) cancelOrderModal.classList.remove('active'); });

    const paymentActionModal = document.getElementById('admin-payment-action-modal');
    const paymentActionCloseBtn = paymentActionModal ? paymentActionModal.querySelector('.close-modal') : null;
    if (paymentActionCloseBtn) paymentActionCloseBtn.addEventListener('click', () => paymentActionModal.classList.remove('active'));
    if (paymentActionModal) paymentActionModal.addEventListener('click', (e) => { if (e.target === paymentActionModal) paymentActionModal.classList.remove('active'); });
}

const modal = document.getElementById('order-modal');
const inputQuantity = document.getElementById('order-quantity');
const inputLink = document.getElementById('order-link');
const elTotalPrice = document.getElementById('modal-total-price');
const btnSubmitOrder = document.getElementById('btn-submit-order');

function openOrderModal(serviceId) {
    currentSelectedService = smmServices.find(s => s.id === serviceId);
    if (!currentSelectedService) return;
    document.getElementById('modal-service-name').textContent = currentSelectedService.name;
    document.getElementById('modal-service-desc').textContent = currentSelectedService.description;
    document.getElementById('modal-min').textContent = currentSelectedService.min_order;
    document.getElementById('modal-max').textContent = currentSelectedService.max_order;
    inputLink.value = '';
    inputQuantity.value = currentSelectedService.min_order;
    calculatePrice();
    modal.classList.add('active');
    if (tg.MainButton) {
        tg.MainButton.text = 'SİPARİŞİ ONAYLA';
        tg.MainButton.color = tg.themeParams.button_color || '#2481cc';
        tg.MainButton.show();
    }
}

function closeModal() {
    modal.classList.remove('active');
    currentSelectedService = null;
    if (tg.MainButton) tg.MainButton.hide();
}

inputQuantity.addEventListener('input', calculatePrice);

function calculatePrice() {
    if (!currentSelectedService) return;
    let qty = parseInt(inputQuantity.value) || 0;
    if (qty < currentSelectedService.min_order || qty > currentSelectedService.max_order) {
        inputQuantity.style.borderColor = 'var(--color-danger)';
    } else {
        inputQuantity.style.borderColor = 'var(--tg-button-color)';
    }
    const price = (qty / 1000) * parseFloat(currentSelectedService.price_per_1000);
    elTotalPrice.textContent = `₺${price.toFixed(2)}`;
}

const submitOrder = async () => {
    if (!currentSelectedService) return;
    const link = inputLink.value.trim();
    const qty = parseInt(inputQuantity.value) || 0;
    if (!link) { showAlert("Lütfen bağlantı girin."); return; }
    if (qty < currentSelectedService.min_order || qty > currentSelectedService.max_order) {
        showAlert(`Miktar ${currentSelectedService.min_order} - ${currentSelectedService.max_order} arasında olmalıdır.`);
        return;
    }
    const price = (qty / 1000) * parseFloat(currentSelectedService.price_per_1000);
    if (tg.MainButton) tg.MainButton.showProgress();
    btnSubmitOrder.disabled = true;
    btnSubmitOrder.textContent = "İşleniyor...";
    try {
        const response = await fetch('/api/order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                telegram_id: currentUserData.telegram_id,
                service_id: currentSelectedService.id,
                link, quantity: qty, price
            })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            showAlert("✅ Siparişiniz başarıyla oluşturuldu!");
            closeModal();
            await checkUserStatus(currentUserData.telegram_id);
            document.querySelector('[data-target="view-orders"]').click();
        } else {
            if (response.status === 400 && data.detail === "Bakiye yetersiz") {
                showConfirm("Bakiyeniz yetersiz! Bakiye yükleme sayfasına gitmek ister misiniz?", (confirmed) => {
                    if (confirmed) {
                        closeModal();
                        document.querySelector('[data-target="view-funds"]').click();
                    }
                });
            } else {
                showAlert(`Hata: ${data.detail || 'Bilinmeyen Hata'}`);
            }
        }
    } catch (err) {
        showAlert("Sunucu bağlantı hatası!");
    } finally {
        if (tg.MainButton) tg.MainButton.hideProgress();
        btnSubmitOrder.disabled = false;
        btnSubmitOrder.textContent = "Siparişi Onayla";
    }
};

btnSubmitOrder.addEventListener('click', submitOrder);
tg.onEvent('mainButtonClicked', submitOrder);

// ═══════════════════════════════════════════════════════════════
// PAYMENT MODAL
// ═══════════════════════════════════════════════════════════════
let selectedPaymentMethod = null;
const paymentModal = document.getElementById('payment-modal');
const inputPaymentAmount = document.getElementById('payment-amount');
const inputPaymentDetails = document.getElementById('payment-details');
const btnSubmitPayment = document.getElementById('btn-submit-payment');

function setupPaymentModal() {
    const paymentCards = document.querySelectorAll('.payment-card');
    paymentCards.forEach(card => {
        card.addEventListener('click', () => {
            selectedPaymentMethod = card.getAttribute('data-method');
            if (!selectedPaymentMethod) return;
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
            document.getElementById('modal-payment-name').textContent = selectedPaymentMethod;
            const lblDetails = document.getElementById('lbl-payment-details');
            const elDesc = document.getElementById('modal-payment-desc');
            inputPaymentAmount.value = '';
            inputPaymentDetails.value = '';
            const bankName = appSettings.bank_name || 'Banka/Hesap';
            const bankIban = appSettings.bank_iban || 'Hesap numarası bulunmuyor';
            const bankRecipient = appSettings.bank_recipient || 'Alıcı';
            
            // Eğer kartta özel hesap bilgisi varsa onu kullan (yeni özellik)
            const pmAccountName = card.getAttribute('data-account-name');
            const pmAccountNumber = card.getAttribute('data-account-number');
            
            let displayAccountName = pmAccountName || bankRecipient;
            let displayAccountNumber = pmAccountNumber || bankIban;

            // Kripto için özel eski ayarlar (geriye dönük uyumluluk)
            const cryptoAddr = appSettings.crypto_usdt_address || 'TY1234567890abcdef1234567890abcdef';
            const cryptoNet = appSettings.crypto_networks || 'USDT TRC20';

            if (selectedPaymentMethod === "Kripto Para" && !pmAccountNumber) {
                elDesc.innerHTML = `<b>${cryptoNet} Adresi:</b> <code style="font-size:11px;word-break:break-all">${cryptoAddr}</code><br><br>Lütfen gönderimi tamamladıktan sonra TXID bilgisini yazın.`;
                lblDetails.textContent = "TXID / Cüzdan Adresiniz";
                inputPaymentDetails.placeholder = "Örn: e983f...c12a";
            } else {
                let descHtml = '';
                if (displayAccountName || displayAccountNumber) {
                    descHtml = `<div style="background:var(--tg-secondary-bg-color); padding: 12px; border-radius: 8px; margin-bottom: 12px;">`;
                    if (displayAccountName) descHtml += `<div style="margin-bottom: 6px;"><b>Hesap / Alıcı Adı:</b><br><span style="user-select:all;">${displayAccountName}</span></div>`;
                    if (displayAccountNumber) descHtml += `<div><b>Hesap No / IBAN / Cüzdan:</b><br><code style="user-select:all; font-size: 14px; color: var(--tg-button-color); word-break: break-all;">${displayAccountNumber}</code></div>`;
                    descHtml += `</div>`;
                }
                descHtml += `Lütfen transferi tamamladıktan sonra tutar ve gönderen isim soyisminizi / hesap no bilginizi yazın.`;
                elDesc.innerHTML = descHtml;
                lblDetails.textContent = "Gönderen Bilgisi / Detay";
                inputPaymentDetails.placeholder = "Örn: Ahmet Yılmaz veya TR123...";
            }
            paymentModal.classList.add('active');
        });
    });

    if (btnSubmitPayment) {
        btnSubmitPayment.addEventListener('click', async () => {
            const amountVal = parseFloat(inputPaymentAmount.value) || 0;
            const detailsVal = inputPaymentDetails.value.trim();
            if (amountVal <= 0) { showAlert("Lütfen geçerli bir tutar girin."); return; }
            if (!detailsVal) { showAlert("Lütfen açıklama/isim bilgisini doldurun."); return; }
            btnSubmitPayment.disabled = true;
            btnSubmitPayment.textContent = "Gönderiliyor...";
            try {
                const response = await fetch('/api/payment-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        telegram_id: currentUserData.telegram_id,
                        amount: amountVal,
                        payment_method: selectedPaymentMethod,
                        details: detailsVal
                    })
                });
                const data = await response.json();
                if (response.ok && data.success) {
                    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                    showAlert("✅ Ödeme bildiriminiz alındı. Yönetici onayından sonra bakiyeniz yüklenecektir.");
                    paymentModal.classList.remove('active');
                } else {
                    showAlert(`Hata: ${data.detail || 'Bildirim gönderilemedi'}`);
                }
            } catch (e) {
                showAlert("Sunucuyla bağlantı kurulamadı.");
            } finally {
                btnSubmitPayment.disabled = false;
                btnSubmitPayment.textContent = "Bildirimi Gönder";
            }
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// PROFILE MENU
// ═══════════════════════════════════════════════════════════════
function setupProfileMenu() {
    const btnSupport = document.getElementById('menu-support');
    const btnTerms = document.getElementById('menu-terms');
    if (btnSupport) {
        btnSupport.addEventListener('click', (e) => {
            e.preventDefault();
            showAlert("Destek talebi sistemi yakında aktif edilecektir.");
        });
    }
    if (btnTerms) {
        btnTerms.addEventListener('click', (e) => {
            e.preventDefault();
            showAlert("Hizmet şartları yakında yayınlanacaktır.");
        });
    }
}

// ═══════════════════════════════════════════════════════════════
// DRAG SCROLL
// ═══════════════════════════════════════════════════════════════
function setupDragScroll() {
    const slider = document.getElementById('category-list');
    if (!slider) return;
    let isDown = false, startX, scrollLeft;
    slider.addEventListener('mousedown', (e) => {
        isDown = true; slider.classList.add('active-drag');
        startX = e.pageX - slider.offsetLeft; scrollLeft = slider.scrollLeft;
    });
    slider.addEventListener('mouseleave', () => { isDown = false; slider.classList.remove('active-drag'); });
    slider.addEventListener('mouseup', () => { isDown = false; slider.classList.remove('active-drag'); });
    slider.addEventListener('mousemove', (e) => {
        if (!isDown) return; e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        slider.scrollLeft = scrollLeft - (x - startX) * 2;
    });
}

// ═══════════════════════════════════════════════════════════════
// ADMIN PANEL
// ═══════════════════════════════════════════════════════════════
function setupAdminPanel() {
    const menuAdmin = document.getElementById('menu-admin');
    if (menuAdmin) {
        menuAdmin.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(nav => {
                nav.classList.remove('active');
                const icon = nav.querySelector('i');
                if (icon) icon.className = icon.className.replace('ph-fill', 'ph');
            });
            showView('view-admin');
            loadPendingPayments();
        });
    }

    // Back button
    const backBtn = document.getElementById('btn-admin-back');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            showView('view-profile');
            document.querySelector('[data-target="view-profile"]').classList.add('active');
        });
    }

    // Admin tabs
    document.querySelectorAll('.admin-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            const tabId = tab.getAttribute('data-tab');
            const content = document.getElementById(tabId);
            if (content) content.classList.add('active');
            // Auto-load on tab switch
            if (tabId === 'tab-payments') loadPendingPayments();
            else if (tabId === 'tab-services') loadAdminServices();
            else if (tabId === 'tab-users') loadAdminUsers();
            else if (tabId === 'tab-orders') loadAdminOrders();
            else if (tabId === 'tab-payment-methods') loadAdminPaymentMethods();
            else if (tabId === 'tab-settings') loadAdminSettings();
        });
    });

    // Refresh buttons
    document.getElementById('btn-admin-refresh')?.addEventListener('click', loadPendingPayments);
    document.getElementById('btn-refresh-users')?.addEventListener('click', loadAdminUsers);
    document.getElementById('btn-refresh-orders')?.addEventListener('click', loadAdminOrders);
    document.getElementById('btn-refresh-settings')?.addEventListener('click', loadAdminSettings);

    // Service form
    document.getElementById('btn-show-add-service')?.addEventListener('click', () => {
        openServiceForm(null);
    });
    document.getElementById('btn-cancel-service-form')?.addEventListener('click', () => {
        document.getElementById('service-form-card').style.display = 'none';
    });
    document.getElementById('btn-save-service')?.addEventListener('click', saveService);

    // Save user
    document.getElementById('btn-save-user')?.addEventListener('click', saveUser);

    // Payment methods form
    document.getElementById('btn-show-add-payment-method')?.addEventListener('click', () => {
        openPaymentMethodForm(null);
    });
    document.getElementById('btn-cancel-pm-form')?.addEventListener('click', () => {
        document.getElementById('payment-method-form-card').style.display = 'none';
    });
    document.getElementById('btn-save-pm')?.addEventListener('click', savePaymentMethod);
}

// ─── PAYMENTS TAB ────────────────────────────────────────────
async function loadPendingPayments() {
    const container = document.getElementById('admin-payments-container');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding: 20px;">Yükleniyor...</p>';
    try {
        const response = await fetch(`/api/admin/pending-payments?tg_id=${currentUserData.telegram_id}`);
        const data = await response.json();
        if (response.ok && data.success) {
            container.innerHTML = '';
            if (data.requests.length === 0) {
                container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding: 20px;">Bekleyen bakiye bildirimi bulunmuyor.</p>';
                return;
            }
            data.requests.forEach(req => {
                const card = document.createElement('div');
                card.className = 'admin-payment-card';
                card.innerHTML = `
                    <div class="admin-payment-header">
                        <div class="admin-payment-user">${req.first_name} (@${req.custom_username})</div>
                        <div class="admin-payment-amount">₺${req.amount.toFixed(2)}</div>
                    </div>
                    <div style="font-size:12px; color:var(--tg-hint-color)">Yöntem: <b>${req.payment_method}</b> | ${new Date(req.request_date).toLocaleString('tr-TR')}</div>
                    <div class="admin-payment-details">${req.details}</div>
                    <div class="admin-payment-actions">
                        <button class="btn-approve" data-id="${req.id}"><i class="ph ph-check"></i> Onayla</button>
                        <button class="btn-reject" data-id="${req.id}"><i class="ph ph-x"></i> Reddet</button>
                    </div>
                `;
                container.appendChild(card);
            });
            container.querySelectorAll('.btn-approve').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    openPaymentActionModal(parseInt(e.currentTarget.getAttribute('data-id')), 'approve');
                });
            });
            container.querySelectorAll('.btn-reject').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    openPaymentActionModal(parseInt(e.currentTarget.getAttribute('data-id')), 'reject');
                });
            });
        } else {
            container.innerHTML = `<p style="text-align:center; color:var(--color-danger); padding: 20px;">Hata: ${data.detail || 'Yüklenemedi'}</p>`;
        }
    } catch (e) {
        container.innerHTML = '<p style="text-align:center; color:var(--color-danger); padding: 20px;">Sunucuyla bağlantı kurulamadı.</p>';
    }
}

// ─── PAYMENT ACTION MODAL ─────────────────────────────────────
function openPaymentActionModal(requestId, actionType) {
    document.getElementById('payment-action-id').value = requestId;
    document.getElementById('payment-action-type').value = actionType;
    document.getElementById('payment-action-note').value = '';
    
    const title = actionType === 'approve' ? 'Ödemeyi Onayla' : 'Ödemeyi Reddet';
    const desc = actionType === 'approve' ? 'Bu işlemi onayladığınızda kullanıcının bakiyesine tutar eklenecektir.' : 'Bu işlemi reddedeceksiniz.';
    const btnText = actionType === 'approve' ? 'Onayla ve Bildir' : 'Reddet ve Bildir';
    const btnColor = actionType === 'approve' ? 'var(--color-success)' : 'var(--color-danger)';
    
    document.getElementById('payment-action-title').textContent = title;
    document.getElementById('payment-action-desc').textContent = desc;
    
    const btn = document.getElementById('btn-submit-payment-action');
    btn.textContent = btnText;
    btn.style.background = btnColor;
    
    document.getElementById('admin-payment-action-modal').classList.add('active');
}

const btnSubmitPaymentAction = document.getElementById('btn-submit-payment-action');
if (btnSubmitPaymentAction) {
    btnSubmitPaymentAction.addEventListener('click', async () => {
        const requestId = parseInt(document.getElementById('payment-action-id').value);
        const actionType = document.getElementById('payment-action-type').value;
        const note = document.getElementById('payment-action-note').value.trim();
        
        btnSubmitPaymentAction.disabled = true;
        btnSubmitPaymentAction.textContent = "İşleniyor...";
        
        const endpoint = actionType === 'approve' ? '/api/admin/approve-payment' : '/api/admin/reject-payment';
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_id: currentUserData.telegram_id, request_id: requestId, note: note })
            });
            const data = await response.json();
            
            document.getElementById('admin-payment-action-modal').classList.remove('active');
            showAlert(data.message || (data.success ? 'İşlem başarılı.' : 'İşlem başarısız.'));
            if (data.success) await loadPendingPayments();
        } catch (e) {
            showAlert("Sunucuyla bağlantı kurulamadı.");
        } finally {
            btnSubmitPaymentAction.disabled = false;
        }
    });
}

// ─── SERVICES TAB ────────────────────────────────────────────
async function loadAdminServices() {
    const container = document.getElementById('admin-services-list');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding:20px;">Yükleniyor...</p>';
    try {
        const res = await fetch(`/api/admin/services?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        if (res.ok && data.success) {
            container.innerHTML = '';
            if (data.services.length === 0) {
                container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding:20px;">Henüz ürün yok. Yeni Ekle butonunu kullanın.</p>';
                return;
            }
            data.services.forEach(svc => {
                const card = document.createElement('div');
                card.className = `admin-service-card ${!svc.is_active ? 'inactive' : ''}`;
                card.innerHTML = `
                    <div class="admin-service-info">
                        <div class="service-icon platform-${svc.platform}" style="width:36px;height:36px;font-size:18px;flex-shrink:0;">
                            <i class="ph ${svc.icon}"></i>
                        </div>
                        <div>
                            <div class="admin-service-name">${svc.name}</div>
                            <div class="admin-service-meta">₺${parseFloat(svc.price_per_1000).toFixed(2)}/1000 · ${svc.platform} · ${svc.is_active ? '<span style="color:var(--color-success)">Aktif</span>' : '<span style="color:var(--color-danger)">Pasif</span>'}</div>
                        </div>
                    </div>
                    <div class="admin-service-actions">
                        <button class="btn-edit-svc" data-id="${svc.id}"><i class="ph ph-pencil-simple"></i></button>
                        <button class="btn-delete-svc" data-id="${svc.id}"><i class="ph ph-trash"></i></button>
                    </div>
                `;
                container.appendChild(card);
            });
            container.querySelectorAll('.btn-edit-svc').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = parseInt(e.currentTarget.getAttribute('data-id'));
                    const svc = data.services.find(s => s.id === id);
                    openServiceForm(svc);
                });
            });
            container.querySelectorAll('.btn-delete-svc').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = parseInt(e.currentTarget.getAttribute('data-id'));
                    showConfirm("Bu ürünü silmek istediğinize emin misiniz?", async (confirmed) => {
                        if (!confirmed) return;
                        try {
                            const res = await fetch('/api/admin/service/delete', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ admin_id: currentUserData.telegram_id, service_id: id })
                            });
                            const d = await res.json();
                            showAlert(d.message || 'Silindi.');
                            await loadAdminServices();
                            await loadServicesFromBackend();
                        } catch { showAlert("Hata oluştu."); }
                    });
                });
            });
        } else {
            container.innerHTML = `<p style="text-align:center; color:var(--color-danger); padding:20px;">${data.detail || 'Yüklenemedi'}</p>`;
        }
    } catch (e) {
        container.innerHTML = '<p style="text-align:center; color:var(--color-danger); padding:20px;">Bağlantı hatası.</p>';
    }
}

function openServiceForm(svc) {
    const formCard = document.getElementById('service-form-card');
    document.getElementById('service-form-title').textContent = svc ? 'Ürünü Düzenle' : 'Yeni Ürün Ekle';
    document.getElementById('edit-service-id').value = svc ? svc.id : '';
    document.getElementById('svc-platform').value = svc ? svc.platform : 'instagram';
    document.getElementById('svc-icon').value = svc ? svc.icon : 'ph-star';
    document.getElementById('svc-name').value = svc ? svc.name : '';
    document.getElementById('svc-desc').value = svc ? svc.description : '';
    document.getElementById('svc-price').value = svc ? svc.price_per_1000 : '';
    document.getElementById('svc-min').value = svc ? svc.min_order : '';
    document.getElementById('svc-max').value = svc ? svc.max_order : '';
    formCard.style.display = 'block';
    formCard.scrollIntoView({ behavior: 'smooth' });
}

async function saveService() {
    const serviceId = document.getElementById('edit-service-id').value;
    const payload = {
        admin_id: currentUserData.telegram_id,
        platform: document.getElementById('svc-platform').value,
        name: document.getElementById('svc-name').value.trim(),
        description: document.getElementById('svc-desc').value.trim(),
        price_per_1000: parseFloat(document.getElementById('svc-price').value) || 0,
        min_order: parseInt(document.getElementById('svc-min').value) || 100,
        max_order: parseInt(document.getElementById('svc-max').value) || 10000,
        icon: document.getElementById('svc-icon').value.trim() || 'ph-star',
    };
    if (!payload.name || payload.price_per_1000 <= 0) {
        showAlert("Lütfen ürün adı ve geçerli fiyat girin."); return;
    }
    const btn = document.getElementById('btn-save-service');
    btn.disabled = true; btn.textContent = "Kaydediliyor...";
    try {
        let endpoint, body;
        if (serviceId) {
            endpoint = '/api/admin/service/update';
            body = { ...payload, service_id: parseInt(serviceId), is_active: true };
        } else {
            endpoint = '/api/admin/service/create';
            body = payload;
        }
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const d = await res.json();
        // Close form first, then show alert
        document.getElementById('service-form-card').style.display = 'none';
        await loadAdminServices();
        await loadServicesFromBackend();
        renderServices('all');
        showAlert(d.message || '✅ Ürün kaydedildi.');
    } catch { showAlert("Hata oluştu."); }
    finally { btn.disabled = false; btn.textContent = "Kaydet"; }
}

// ─── USERS TAB ───────────────────────────────────────────────
async function loadAdminUsers() {
    const container = document.getElementById('admin-users-list');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding:20px;">Yükleniyor...</p>';
    try {
        const res = await fetch(`/api/admin/users?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        if (res.ok && data.success) {
            container.innerHTML = '';
            if (data.users.length === 0) {
                container.innerHTML = '<p style="text-align:center;color:var(--tg-hint-color);padding:20px;">Henüz kullanıcı yok.</p>';
                return;
            }
            data.users.forEach(user => {
                const card = document.createElement('div');
                card.className = 'admin-user-card';
                card.innerHTML = `
                    <div class="admin-user-avatar">${(user.first_name || '?').charAt(0).toUpperCase()}</div>
                    <div class="admin-user-info">
                        <div class="admin-user-name">${user.first_name || 'Bilinmiyor'}</div>
                        <div class="admin-user-meta">@${user.custom_username || '—'} · ID: ${user.telegram_id}</div>
                        <div class="admin-user-balance">Bakiye: <b>₺${parseFloat(user.balance || 0).toFixed(2)}</b></div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="btn-edit-user" data-tgid="${user.telegram_id}" data-name="${user.first_name || ''}" data-balance="${user.balance || 0}">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-add-balance" data-tgid="${user.telegram_id}" data-name="${user.first_name || ''}" style="width: 36px; height: 36px; border-radius: 8px; border: none; background: rgba(52, 199, 89, 0.12); color: var(--color-success); font-size: 18px; display: flex; align-items: center; justify-content: center; cursor: pointer; flex-shrink: 0; transition: opacity 0.2s;">
                            <i class="ph ph-wallet"></i>
                        </button>
                    </div>
                `;
                container.appendChild(card);
            });
            container.querySelectorAll('.btn-edit-user').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const b = e.currentTarget;
                    openUserEditModal(b.dataset.tgid, b.dataset.name, b.dataset.balance);
                });
            });
            container.querySelectorAll('.btn-add-balance').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const b = e.currentTarget;
                    openAddBalanceModal(b.dataset.tgid, b.dataset.name);
                });
            });
        } else {
            container.innerHTML = `<p style="color:var(--color-danger);padding:20px;">${data.detail || 'Yüklenemedi'}</p>`;
        }
    } catch {
        container.innerHTML = '<p style="color:var(--color-danger);padding:20px;">Bağlantı hatası.</p>';
    }
}

function openUserEditModal(tgId, name, balance) {
    document.getElementById('edit-user-tg-id').value = tgId;
    document.getElementById('edit-user-name').value = name;
    document.getElementById('edit-user-balance').value = parseFloat(balance).toFixed(2);
    document.getElementById('edit-user-tgid-display').value = tgId;
    document.getElementById('user-edit-modal').classList.add('active');
}

async function saveUser() {
    const tgId = parseInt(document.getElementById('edit-user-tg-id').value);
    const name = document.getElementById('edit-user-name').value.trim();
    const balance = parseFloat(document.getElementById('edit-user-balance').value) || 0;
    if (!name) { showAlert("Ad boş olamaz."); return; }
    const btn = document.getElementById('btn-save-user');
    btn.disabled = true; btn.textContent = "Kaydediliyor...";
    try {
        const res = await fetch('/api/admin/user/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_id: currentUserData.telegram_id, telegram_id: tgId, balance, first_name: name })
        });
        const d = await res.json();
        // Close modal first, then show success
        document.getElementById('user-edit-modal').classList.remove('active');
        await loadAdminUsers();
        showAlert(d.message || '✅ Kullanıcı güncellendi.');
    } catch { showAlert("Hata oluştu."); }
    finally { btn.disabled = false; btn.textContent = "Kaydet"; }
}

function openAddBalanceModal(tgId, name) {
    document.getElementById('add-balance-tg-id').value = tgId;
    document.getElementById('add-balance-user-name').textContent = `Üye: ${name}`;
    document.getElementById('add-balance-amount').value = '';
    document.getElementById('add-balance-note').value = '';
    document.getElementById('admin-add-balance-modal').classList.add('active');
}

const btnSubmitAddBalance = document.getElementById('btn-submit-add-balance');
if (btnSubmitAddBalance) {
    btnSubmitAddBalance.addEventListener('click', async () => {
        const tgId = parseInt(document.getElementById('add-balance-tg-id').value);
        const amount = parseFloat(document.getElementById('add-balance-amount').value) || 0;
        const note = document.getElementById('add-balance-note').value.trim();
        
        if (amount <= 0) { showAlert("Lütfen 0'dan büyük bir tutar girin."); return; }
        if (!note) { showAlert("Lütfen kullanıcıya iletilecek bir not yazın."); return; }
        
        btnSubmitAddBalance.disabled = true;
        btnSubmitAddBalance.textContent = "Ekleniyor...";
        
        try {
            const res = await fetch('/api/admin/user/add-balance', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_id: currentUserData.telegram_id, telegram_id: tgId, amount, note })
            });
            const d = await res.json();
            
            document.getElementById('admin-add-balance-modal').classList.remove('active');
            await loadAdminUsers();
            showAlert(d.message || '✅ Bakiye eklendi ve mesaj gönderildi.');
        } catch { 
            showAlert("Hata oluştu."); 
        } finally { 
            btnSubmitAddBalance.disabled = false; 
            btnSubmitAddBalance.textContent = "Bakiyeyi Ekle ve Bildir"; 
        }
    });
}

// ─── ORDERS TAB ──────────────────────────────────────────────
async function loadAdminOrders() {
    const container = document.getElementById('admin-orders-list');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding:20px;">Yükleniyor...</p>';
    try {
        const res = await fetch(`/api/admin/orders?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        if (res.ok && data.success) {
            container.innerHTML = '';
            if (data.orders.length === 0) {
                container.innerHTML = '<p style="text-align:center;color:var(--tg-hint-color);padding:20px;">Henüz sipariş yok.</p>';
                return;
            }
            data.orders.forEach(order => {
                const card = document.createElement('div');
                card.className = 'admin-order-card';
                const statusColors = { 'Tamamlandı': 'var(--color-success)', 'İptal Edildi': 'var(--color-danger)', 'Bekliyor': 'var(--color-warning)', 'İşlemde': 'var(--tg-button-color)' };
                const color = statusColors[order.status] || 'var(--tg-hint-color)';
                
                let statusHtml = '';
                if (order.status === 'İptal Edildi') {
                    statusHtml = `<span style="font-size:12px;font-weight:700;color:${color}">${order.status}</span>`;
                } else {
                    statusHtml = `
                        <select class="admin-status-select" data-id="${order.id}" style="color:${color}; border: 1px solid ${color}40;">
                            <option value="Bekliyor" ${order.status === 'Bekliyor' ? 'selected' : ''}>Bekliyor</option>
                            <option value="İşlemde" ${order.status === 'İşlemde' ? 'selected' : ''}>İşlemde</option>
                            <option value="Tamamlandı" ${order.status === 'Tamamlandı' ? 'selected' : ''}>Tamamlandı</option>
                        </select>
                    `;
                }

                card.innerHTML = `
                    <div class="admin-order-header">
                        <span class="admin-order-id">#${order.id}</span>
                        ${statusHtml}
                    </div>
                    <div class="admin-order-service">${order.service_name || `Servis #${order.service_id}`}</div>
                    <div class="admin-order-meta">👤 ${order.first_name} (@${order.custom_username}) · ${order.quantity.toLocaleString()} adet</div>
                    <div class="admin-order-meta" style="word-break:break-all">🔗 ${order.link}</div>
                    <div class="admin-order-footer">
                        <span>₺${parseFloat(order.price).toFixed(2)}</span>
                        <span>${new Date(order.order_date).toLocaleDateString('tr-TR')}</span>
                        ${order.status !== 'İptal Edildi' ? `<button class="btn-cancel-order" data-id="${order.id}"><i class="ph ph-x-circle"></i> İptal & İade</button>` : ''}
                    </div>
                `;
                container.appendChild(card);
            });

            container.querySelectorAll('.admin-status-select').forEach(select => {
                select.addEventListener('change', async (e) => {
                    const id = parseInt(e.currentTarget.getAttribute('data-id'));
                    const newStatus = e.currentTarget.value;
                    try {
                        const res = await fetch('/api/admin/order/update-status', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ admin_id: currentUserData.telegram_id, order_id: id, status: newStatus })
                        });
                        const d = await res.json();
                        if (d.success) {
                            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                            await loadAdminOrders();
                        } else {
                            showAlert(d.message || "Güncellenemedi.");
                            await loadAdminOrders();
                        }
                    } catch { 
                        showAlert("Hata oluştu."); 
                        await loadAdminOrders();
                    }
                });
            });

            container.querySelectorAll('.btn-cancel-order').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = parseInt(e.currentTarget.getAttribute('data-id'));
                    document.getElementById('cancel-order-id').value = id;
                    document.getElementById('cancel-order-note').value = '';
                    document.getElementById('admin-cancel-order-modal').classList.add('active');
                });
            });
        } else {
            container.innerHTML = `<p style="color:var(--color-danger);padding:20px;">${data.detail || 'Yüklenemedi'}</p>`;
        }
    } catch {
        container.innerHTML = '<p style="color:var(--color-danger);padding:20px;">Bağlantı hatası.</p>';
    }
}

const btnSubmitCancelOrder = document.getElementById('btn-submit-cancel-order');
if (btnSubmitCancelOrder) {
    btnSubmitCancelOrder.addEventListener('click', async () => {
        const id = parseInt(document.getElementById('cancel-order-id').value);
        const note = document.getElementById('cancel-order-note').value.trim();
        
        btnSubmitCancelOrder.disabled = true;
        btnSubmitCancelOrder.textContent = "İptal Ediliyor...";
        
        try {
            const res = await fetch('/api/admin/order/cancel', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_id: currentUserData.telegram_id, order_id: id, note: note })
            });
            const d = await res.json();
            
            document.getElementById('admin-cancel-order-modal').classList.remove('active');
            showAlert(d.message);
            await loadAdminOrders();
        } catch { 
            showAlert("Hata oluştu."); 
        } finally {
            btnSubmitCancelOrder.disabled = false;
            btnSubmitCancelOrder.textContent = "İptal Et ve Bildir";
        }
    });
}


// ─── PAYMENT METHODS TAB ─────────────────────────────────────
async function loadAdminPaymentMethods() {
    const container = document.getElementById('admin-payment-methods-list');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:var(--tg-hint-color);padding:20px;">Yükleniyor...</p>';
    try {
        const res = await fetch(`/api/admin/payment-methods?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        if (res.ok && data.success) {
            container.innerHTML = '';
            if (data.methods.length === 0) {
                container.innerHTML = '<p style="text-align:center;color:var(--tg-hint-color);padding:20px;">Henüz ödeme yöntemi yok.</p>';
                return;
            }
            data.methods.forEach(pm => {
                const card = document.createElement('div');
                card.className = 'admin-service-card';
                const statusBadge = pm.is_active
                    ? '<span style="color:var(--color-success);font-weight:600;font-size:12px;">● Aktif</span>'
                    : '<span style="color:var(--color-danger);font-weight:600;font-size:12px;">● Pasif</span>';
                card.innerHTML = `
                    <div class="admin-service-info">
                        <div class="service-icon" style="width:36px;height:36px;font-size:18px;flex-shrink:0;background:${pm.color}22;color:${pm.color};">
                            <i class="ph ${pm.icon}"></i>
                        </div>
                        <div>
                            <div class="admin-service-name">${pm.name}</div>
                            <div class="admin-service-meta">${pm.description} · Sıra: ${pm.sort_order} · ${statusBadge}</div>
                        </div>
                    </div>
                    <div class="admin-service-actions">
                        <button class="btn-edit-pm" data-id="${pm.id}" style="background:var(--tg-button-color);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">
                            <i class="ph ph-pencil-simple"></i>
                        </button>
                        <button class="btn-delete-pm" data-id="${pm.id}" style="background:var(--color-danger);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                `;
                container.appendChild(card);
            });

            // Edit buttons
            container.querySelectorAll('.btn-edit-pm').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = parseInt(e.currentTarget.getAttribute('data-id'));
                    const pm = data.methods.find(m => m.id === id);
                    openPaymentMethodForm(pm);
                });
            });

            // Delete buttons
            container.querySelectorAll('.btn-delete-pm').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = parseInt(e.currentTarget.getAttribute('data-id'));
                    showConfirm("Bu ödeme yöntemini silmek istediğinize emin misiniz?", async (confirmed) => {
                        if (!confirmed) return;
                        try {
                            const res = await fetch('/api/admin/payment-method/delete', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ admin_id: currentUserData.telegram_id, method_id: id })
                            });
                            const d = await res.json();
                            showAlert(d.message || 'Silindi.');
                            await loadAdminPaymentMethods();
                            await loadPaymentMethodsForFunds();
                        } catch { showAlert("Hata oluştu."); }
                    });
                });
            });
        } else {
            container.innerHTML = `<p style="color:var(--color-danger);padding:20px;">${data.detail || 'Yüklenemedi'}</p>`;
        }
    } catch {
        container.innerHTML = '<p style="color:var(--color-danger);padding:20px;">Bağlantı hatası.</p>';
    }
}

function openPaymentMethodForm(pm) {
    document.getElementById('payment-method-form-title').textContent = pm ? 'Ödeme Yöntemini Düzenle' : 'Yeni Ödeme Yöntemi Ekle';
    document.getElementById('edit-pm-id').value = pm ? pm.id : '';
    document.getElementById('pm-name').value = pm ? pm.name : '';
    document.getElementById('pm-description').value = pm ? pm.description : '';
    document.getElementById('pm-icon').value = pm ? pm.icon : 'ph-wallet';
    document.getElementById('pm-color').value = pm ? pm.color : '#6366f1';
    document.getElementById('pm-sort').value = pm ? pm.sort_order : 0;
    document.getElementById('pm-account-name').value = pm ? (pm.account_name || '') : '';
    document.getElementById('pm-account-number').value = pm ? (pm.account_number || '') : '';
    // Show active/passive only on edit
    const activeGroup = document.getElementById('pm-active-group');
    if (pm) {
        activeGroup.style.display = 'block';
        document.getElementById('pm-is-active').value = pm.is_active ? 'true' : 'false';
    } else {
        activeGroup.style.display = 'none';
    }
    const formCard = document.getElementById('payment-method-form-card');
    formCard.style.display = 'block';
    formCard.scrollIntoView({ behavior: 'smooth' });
}

async function savePaymentMethod() {
    const pmId = document.getElementById('edit-pm-id').value;
    const name = document.getElementById('pm-name').value.trim();
    const description = document.getElementById('pm-description').value.trim();
    const icon = document.getElementById('pm-icon').value.trim() || 'ph-wallet';
    const color = document.getElementById('pm-color').value.trim() || '#6366f1';
    const sortOrder = parseInt(document.getElementById('pm-sort').value) || 0;
    const accountName = document.getElementById('pm-account-name').value.trim();
    const accountNumber = document.getElementById('pm-account-number').value.trim();
    const isActive = document.getElementById('pm-is-active').value !== 'false';

    if (!name) { showAlert('Yöntem adı boş olamaz.'); return; }

    const btn = document.getElementById('btn-save-pm');
    btn.disabled = true; btn.textContent = 'Kaydediliyor...';
    try {
        let endpoint, body;
        if (pmId) {
            endpoint = '/api/admin/payment-method/update';
            body = { admin_id: currentUserData.telegram_id, method_id: parseInt(pmId), name, description, icon, color, is_active: isActive, sort_order: sortOrder, account_name: accountName, account_number: accountNumber };
        } else {
            endpoint = '/api/admin/payment-method/create';
            body = { admin_id: currentUserData.telegram_id, name, description, icon, color, sort_order: sortOrder, account_name: accountName, account_number: accountNumber };
        }
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const d = await res.json();
        document.getElementById('payment-method-form-card').style.display = 'none';
        await loadAdminPaymentMethods();
        await loadPaymentMethodsForFunds();
        showAlert(d.message || '✅ Kaydedildi.');
    } catch { showAlert("Hata oluştu."); }
    finally { btn.disabled = false; btn.textContent = 'Kaydet'; }
}

// Bakiye Yükle sayfasını dinamik ödeme yöntemleriyle güncelle
async function loadPaymentMethodsForFunds() {
    try {
        const res = await fetch('/api/payment-methods');
        const data = await res.json();
        if (res.ok && data.success) {
            const container = document.querySelector('.payment-methods');
            if (!container) return;
            container.innerHTML = '';
            data.methods.forEach(pm => {
                const card = document.createElement('div');
                card.className = 'payment-card';
                card.setAttribute('data-method', pm.name);
                if (pm.account_name) card.setAttribute('data-account-name', pm.account_name);
                if (pm.account_number) card.setAttribute('data-account-number', pm.account_number);
                card.innerHTML = `
                    <div class="pay-icon" style="background:${pm.color}22;color:${pm.color};"><i class="ph ${pm.icon}"></i></div>
                    <div class="pay-info">
                        <h4>${pm.name}</h4>
                        <p>${pm.description}</p>
                    </div>
                    <i class="ph ph-caret-right"></i>
                `;
                container.appendChild(card);
            });
            // Re-bind payment modal events
            setupPaymentModal();
        }
    } catch { /* Sessiz hata */ }
}

// ─── SETTINGS TAB ────────────────────────────────────────────

const settingLabels = {
    brand_name: 'Site Adı',
    bank_name: 'Banka Adı',
    bank_iban: 'IBAN Numarası',
    bank_recipient: 'Alıcı Adı',
    crypto_usdt_address: 'USDT Adresi',
    crypto_networks: 'Kripto Ağı',
    bonus_text: 'Bonus Banner Başlığı',
    bonus_desc: 'Bonus Banner Açıklaması',
    bonus_threshold: 'Bonus Eşik Tutarı (₺)',
    bonus_percent: 'Bonus Yüzdesi (%)',
};

async function loadAdminSettings() {
    const container = document.getElementById('admin-settings-container');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center;color:var(--tg-hint-color);padding:20px;">Yükleniyor...</p>';
    try {
        const res = await fetch(`/api/admin/settings?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        if (res.ok && data.success) {
            container.innerHTML = '';
            Object.entries(data.settings).forEach(([key, value]) => {
                const label = settingLabels[key] || key;
                const group = document.createElement('div');
                group.className = 'admin-setting-group';
                group.innerHTML = `
                    <div class="admin-setting-label">${label}</div>
                    <div class="admin-setting-row">
                        <input type="text" class="admin-setting-input" id="setting-${key}" value="${value}" placeholder="${label}">
                        <button class="btn-save-setting" data-key="${key}"><i class="ph ph-floppy-disk"></i></button>
                    </div>
                `;
                container.appendChild(group);
            });
            container.querySelectorAll('.btn-save-setting').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const key = e.currentTarget.getAttribute('data-key');
                    const value = document.getElementById(`setting-${key}`).value.trim();
                    if (!value) { showAlert("Değer boş olamaz."); return; }
                    const origIcon = e.currentTarget.innerHTML;
                    e.currentTarget.disabled = true;
                    e.currentTarget.innerHTML = '<i class="ph ph-spinner"></i>';
                    try {
                        const res = await fetch('/api/admin/settings/update', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ admin_id: currentUserData.telegram_id, key, value })
                        });
                        const d = await res.json();
                        if (d.success) {
                            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                            appSettings[key] = value;
                            applySettings(appSettings);
                            // Show checkmark briefly on button
                            e.currentTarget.innerHTML = '<i class="ph ph-check"></i>';
                            e.currentTarget.style.background = 'var(--color-success)';
                            setTimeout(() => {
                                e.currentTarget.innerHTML = origIcon;
                                e.currentTarget.style.background = '';
                                e.currentTarget.disabled = false;
                            }, 1500);
                            return; // skip finally re-enable
                        } else {
                            showAlert('Hata: Güncellenemedi.');
                        }
                    } catch { showAlert("Hata oluştu."); }
                    e.currentTarget.innerHTML = origIcon;
                    e.currentTarget.disabled = false;
                });
            });
        }
    } catch {
        container.innerHTML = '<p style="color:var(--color-danger);padding:20px;">Bağlantı hatası.</p>';
    }
}

// ═══════════════════════════════════════════════════════════════
// THEME TOGGLE
// ═══════════════════════════════════════════════════════════════
function setupThemeToggle() {
    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;
    const toggleTheme = (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
        document.body.classList.toggle('dark-theme');
        const themeIcon = themeToggle.querySelector('i');
        if (themeIcon) {
            if (document.body.classList.contains('dark-theme')) {
                themeIcon.className = "ph ph-sun";
                localStorage.setItem('theme', 'dark');
            } else {
                themeIcon.className = "ph ph-moon";
                localStorage.setItem('theme', 'light');
            }
        }
    };
    themeToggle.addEventListener('click', toggleTheme);
    const themeIcon = themeToggle.querySelector('i');
    if (themeIcon) {
        themeIcon.className = document.body.classList.contains('dark-theme') ? "ph ph-sun" : "ph ph-moon";
    }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════
function showAlert(msg) {
    if (tg.showAlert) tg.showAlert(msg);
    else alert(msg);
}

function showConfirm(msg, callback) {
    if (tg.showConfirm && tg.isVersionAtLeast && tg.isVersionAtLeast('6.2')) {
        tg.showConfirm(msg, function(confirmed) {
            callback(confirmed);
        });
    } else {
        const result = confirm(msg);
        callback(result);
    }
}
