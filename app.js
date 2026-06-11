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
    setupProfileMenu();
    setupDragScroll();
    setupPaymentModal();
    setupAdminPanel();

    tg.ready();
});

// CHECK REGISTRATION STATUS
async function checkUserStatus(tg_id) {
    try {
        const response = await fetch(`/api/user?tg_id=${tg_id}`);
        const data = await response.json();

        if (data.registered) {
            // User is registered, go to Dashboard
            updateDashboardUI(data.user, data.orders);
            renderOrders(data.orders);
            renderServices('all'); // Load services
            
            // Check Admin Status and toggle menu link
            const menuAdmin = document.getElementById('menu-admin');
            if (data.is_admin) {
                if (menuAdmin) menuAdmin.style.display = 'flex';
            } else {
                if (menuAdmin) menuAdmin.style.display = 'none';
            }
            
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
    const inputUsername = document.getElementById('register-username');
    const customUsername = inputUsername ? inputUsername.value.trim().toLowerCase() : '';
    
    // Check if empty
    if (!customUsername) {
        if (tg.showAlert) tg.showAlert("Lütfen bir kullanıcı adı belirleyin.");
        else alert("Lütfen bir kullanıcı adı belirleyin.");
        return;
    }
    
    // Validate character set (alphanumeric only, no space or turkish chars)
    const regex = /^[a-zA-Z0-9]+$/;
    if (!regex.test(customUsername)) {
        const errMsg = "Kullanıcı adı sadece İngilizce harfler ve rakamlardan oluşmalı, boşluk veya Türkçe karakter içermemelidir.";
        if (tg.showAlert) tg.showAlert(errMsg);
        else alert(errMsg);
        return;
    }
    
    const btn = document.getElementById('btn-register');
    btn.textContent = "Kontrol ediliyor...";
    btn.disabled = true;

    try {
        // First check if username exists
        const checkRes = await fetch(`/api/check-username?username=${customUsername}`);
        const checkData = await checkRes.json();
        
        if (checkData.exists) {
            const errMsg = "Bu kullanıcı adı zaten alınmış. Lütfen başka bir tane deneyin.";
            if (tg.showAlert) tg.showAlert(errMsg);
            else alert(errMsg);
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
            if(tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            // Refresh to load Dashboard
            await checkUserStatus(userData.telegram_id);
        } else {
            const errMsg = data.detail || "Kayıt başarısız.";
            if (tg.showAlert) tg.showAlert(errMsg);
            else alert(errMsg);
            btn.textContent = "Kayıt Ol ve Giriş Yap";
            btn.disabled = false;
        }
    } catch(err) {
        btn.textContent = "Hata Oluştu, Tekrar Dene";
        btn.disabled = false;
    }
}

// UPDATE UI
function updateDashboardUI(userDbInfo, orders = []) {
    document.body.classList.remove('hide-nav'); // Show bottom nav

    // Global Header Balance
    document.querySelector('.balance-amount').textContent = `₺${userDbInfo.balance.toFixed(2)}`;

    // Profile Page Info
    document.getElementById('user-name').textContent = userDbInfo.first_name;
    document.getElementById('user-username').textContent = userDbInfo.username;
    document.getElementById('user-avatar').textContent = userDbInfo.first_name.charAt(0).toUpperCase();

    // Profile Page Stats
    const totalOrders = orders.length;
    const totalSpent = orders.reduce((sum, o) => sum + (o.price || 0), 0);

    const orderCountEl = document.getElementById('profile-order-count');
    const totalSpentEl = document.getElementById('profile-total-spent');
    
    if (orderCountEl) orderCountEl.textContent = totalOrders;
    if (totalSpentEl) totalSpentEl.textContent = `₺${totalSpent.toFixed(2)}`;
}

// PROFILE MENU TRIGGERS (Yakında Gelecek)
function setupProfileMenu() {
    const btnSupport = document.getElementById('menu-support');
    const btnTerms = document.getElementById('menu-terms');
    
    if (btnSupport) {
        btnSupport.addEventListener('click', (e) => {
            e.preventDefault();
            if (tg.showAlert) {
                tg.showAlert("Destek talebi sistemi yakında aktif edilecektir.");
            } else {
                alert("Destek talebi sistemi yakında aktif edilecektir.");
            }
        });
    }
    
    if (btnTerms) {
        btnTerms.addEventListener('click', (e) => {
            e.preventDefault();
            if (tg.showAlert) {
                tg.showAlert("Hizmet şartları yakında yayınlanacaktır.");
            } else {
                alert("Hizmet şartları yakında yayınlanacaktır.");
            }
        });
    }
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
            if (response.status === 400 && data.detail === "Bakiye yetersiz") {
                if (tg.showConfirm) {
                    tg.showConfirm("Bakiyeniz bu sipariş için yetersizdir. Bakiye yükleme sayfasına gitmek ister misiniz?", (confirmed) => {
                        if (confirmed) {
                            closeModal();
                            document.querySelector('[data-target="view-funds"]').click();
                        }
                    });
                } else {
                    const confirmed = confirm("Bakiyeniz bu sipariş için yetersizdir. Bakiye yükleme sayfasına gitmek ister misiniz?");
                    if (confirmed) {
                        closeModal();
                        document.querySelector('[data-target="view-funds"]').click();
                    }
                }
            } else {
                tg.showAlert(`Hata: ${data.detail || 'Bilinmeyen Hata'}`);
            }
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

// Drag Scroll for category chip menu on desktop
function setupDragScroll() {
    const slider = document.getElementById('category-list');
    if (!slider) return;
    
    let isDown = false;
    let startX;
    let scrollLeft;

    slider.addEventListener('mousedown', (e) => {
        isDown = true;
        slider.classList.add('active-drag');
        startX = e.pageX - slider.offsetLeft;
        scrollLeft = slider.scrollLeft;
    });
    
    slider.addEventListener('mouseleave', () => {
        isDown = false;
        slider.classList.remove('active-drag');
    });
    
    slider.addEventListener('mouseup', () => {
        isDown = false;
        slider.classList.remove('active-drag');
    });
    
    slider.addEventListener('mousemove', (e) => {
        if(!isDown) return;
        e.preventDefault();
        const x = e.pageX - slider.offsetLeft;
        const walk = (x - startX) * 2; // scroll speed multiplier
        slider.scrollLeft = scrollLeft - walk;
    });
}

// Payment modal management
let selectedPaymentMethod = null;
const paymentModal = document.getElementById('payment-modal');
const btnClosePaymentModal = document.getElementById('close-payment-modal');
const inputPaymentAmount = document.getElementById('payment-amount');
const inputPaymentDetails = document.getElementById('payment-details');
const btnSubmitPayment = document.getElementById('btn-submit-payment');

function setupPaymentModal() {
    // Select payment method cards
    const paymentCards = document.querySelectorAll('.payment-card');
    paymentCards.forEach(card => {
        card.addEventListener('click', () => {
            selectedPaymentMethod = card.getAttribute('data-method');
            if (!selectedPaymentMethod) return;
            
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
            
            document.getElementById('modal-payment-name').textContent = selectedPaymentMethod;
            
            // Set details label and description based on method
            const lblDetails = document.getElementById('lbl-payment-details');
            const elDesc = document.getElementById('modal-payment-desc');
            
            inputPaymentAmount.value = '';
            inputPaymentDetails.value = '';
            
            if (selectedPaymentMethod === "Havale / EFT") {
                elDesc.innerHTML = "<b>Ziraat Bankası IBAN:</b> TR99 0001 0000 0000 1234 5678 90<br><b>Alıcı:</b> BoostPanel SMM<br><br>Lütfen transferi tamamladıktan sonra buraya tutar ve gönderen isim soyismini yazın.";
                lblDetails.textContent = "Gönderen Adı Soyadı";
                inputPaymentDetails.placeholder = "Örn: Ahmet Yılmaz";
            } else if (selectedPaymentMethod === "Kripto Para") {
                elDesc.innerHTML = "<b>USDT TRC20 Adresi:</b> TY1234567890abcdef1234567890abcdef<br><br>Lütfen gönderimi tamamladıktan sonra buraya tutar ve gönderim yaptığınız TXID (İşlem Kodu) bilgisini yazın.";
                lblDetails.textContent = "TXID / Cüzdan Adresiniz";
                inputPaymentDetails.placeholder = "Örn: e983f...c12a veya cüzdan adresi";
            } else {
                elDesc.innerHTML = "Manuel Kredi / Banka kartı ödeme bildirim ekranıdır.<br><br>Lütfen ödemeyi yaptıktan sonra buraya ödeme detaylarını ve adınızı soyadınızı yazın.";
                lblDetails.textContent = "Ödeme Detayları ve İsim";
                inputPaymentDetails.placeholder = "Örn: Kredi kartı ile 100 TL ödeme yaptım, Ahmet Yılmaz";
            }
            
            paymentModal.classList.add('active');
        });
    });
    
    if (btnClosePaymentModal) {
        btnClosePaymentModal.addEventListener('click', () => {
            paymentModal.classList.remove('active');
            selectedPaymentMethod = null;
        });
    }
    
    if (btnSubmitPayment) {
        btnSubmitPayment.addEventListener('click', async () => {
            const amountVal = parseFloat(inputPaymentAmount.value) || 0;
            const detailsVal = inputPaymentDetails.value.trim();
            
            if (amountVal <= 0) {
                if (tg.showAlert) tg.showAlert("Lütfen geçerli bir tutar girin.");
                else alert("Lütfen geçerli bir tutar girin.");
                return;
            }
            if (!detailsVal) {
                if (tg.showAlert) tg.showAlert("Lütfen açıklama/isim bilgisini doldurun.");
                else alert("Lütfen açıklama/isim bilgisini doldurun.");
                return;
            }
            
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
                    if (tg.showAlert) tg.showAlert("Ödeme bildiriminiz alınmıştır. Yönetici onayından sonra bakiyeniz yüklenecektir.");
                    else alert("Ödeme bildiriminiz alınmıştır. Yönetici onayından sonra bakiyeniz yüklenecektir.");
                    paymentModal.classList.remove('active');
                } else {
                    if (tg.showAlert) tg.showAlert(`Hata: ${data.detail || 'Bildirim gönderilemedi'}`);
                    else alert(`Hata: ${data.detail || 'Bildirim gönderilemedi'}`);
                }
            } catch(e) {
                if (tg.showAlert) tg.showAlert("Sunucuyla bağlantı kurulamadı.");
                else alert("Sunucuyla bağlantı kurulamadı.");
            } finally {
                btnSubmitPayment.disabled = false;
                btnSubmitPayment.textContent = "Bildirimi Gönder";
            }
        });
    }
}

// Admin Panel Controller
function setupAdminPanel() {
    const menuAdmin = document.getElementById('menu-admin');
    const btnRefresh = document.getElementById('btn-admin-refresh');
    
    if (menuAdmin) {
        menuAdmin.addEventListener('click', (e) => {
            e.preventDefault();
            // Switch tabs visually: deselect bottom nav
            document.querySelectorAll('.nav-item').forEach(nav => {
                nav.classList.remove('active');
                const icon = nav.querySelector('i');
                if (icon) icon.className = icon.className.replace('ph-fill', 'ph');
            });
            showView('view-admin');
            loadPendingPayments();
        });
    }
    
    if (btnRefresh) {
        btnRefresh.addEventListener('click', () => {
            loadPendingPayments();
        });
    }
}

async function loadPendingPayments() {
    const container = document.getElementById('admin-payments-container');
    container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding: 20px;">Yükleniyor...</p>';
    
    try {
        const response = await fetch(`/api/admin/pending-payments?tg_id=${currentUserData.telegram_id}`);
        const data = await response.json();
        
        if (response.ok && data.success) {
            container.innerHTML = '';
            const requests = data.requests;
            
            if (requests.length === 0) {
                container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding: 20px;">Bekleyen bakiye bildirimi bulunmuyor.</p>';
                return;
            }
            
            requests.forEach(req => {
                const card = document.createElement('div');
                card.className = 'admin-payment-card';
                card.innerHTML = `
                    <div class="admin-payment-header">
                        <div class="admin-payment-user">
                            ${req.first_name} (@${req.custom_username})
                        </div>
                        <div class="admin-payment-amount">
                            ₺${req.amount.toFixed(2)}
                        </div>
                    </div>
                    <div style="font-size:12px; color:var(--tg-hint-color)">
                        Yöntem: <b>${req.payment_method}</b> | Tarih: ${new Date(req.request_date).toLocaleString()}
                    </div>
                    <div class="admin-payment-details">
                        ${req.details}
                    </div>
                    <div class="admin-payment-actions">
                        <button class="btn-approve" data-id="${req.id}">Onayla</button>
                        <button class="btn-reject" data-id="${req.id}">Reddet</button>
                    </div>
                `;
                container.appendChild(card);
            });
            
            // Attach action listeners
            container.querySelectorAll('.btn-approve').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = parseInt(e.target.getAttribute('data-id'));
                    await processPaymentAction(id, 'approve');
                });
            });
            
            container.querySelectorAll('.btn-reject').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = parseInt(e.target.getAttribute('data-id'));
                    await processPaymentAction(id, 'reject');
                });
            });
            
        } else {
            container.innerHTML = `<p style="text-align:center; color:var(--color-danger); padding: 20px;">Hata: ${data.detail || 'Veriler yüklenemedi'}</p>`;
        }
    } catch(e) {
        container.innerHTML = '<p style="text-align:center; color:var(--color-danger); padding: 20px;">Sunucuyla bağlantı kurulamadı.</p>';
    }
}

async function processPaymentAction(requestId, actionType) {
    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('medium');
    
    const endpoint = actionType === 'approve' ? '/api/admin/approve-payment' : '/api/admin/reject-payment';
    
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_id: currentUserData.telegram_id,
                request_id: requestId
            })
        });
        const data = await response.json();
        
        if (response.ok && data.success) {
            if (tg.showAlert) tg.showAlert(data.message);
            else alert(data.message);
            await loadPendingPayments();
        } else {
            if (tg.showAlert) tg.showAlert(`Hata: ${data.detail || 'İşlem başarısız'}`);
            else alert(`Hata: ${data.detail || 'İşlem başarısız'}`);
        }
    } catch(e) {
        if (tg.showAlert) tg.showAlert("Sunucuyla bağlantı kurulamadı.");
        else alert("Sunucuyla bağlantı kurulamadı.");
    }
}
