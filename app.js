// Initialize Telegram WebApp API
const tg = window.Telegram.WebApp;

// Variables to store current state
let currentUserData = null;
let currentSelectedService = null;
let smmServices = []; // Loaded from backend
let appSettings = {}; // Loaded from backend
let adminOrdersShowHidden = false;
let currentCoupon = null; // Group C: Applied Coupon
let salesChartInstance = null; // Group D: Chart reference

// ═══════════════════════════════════════════════════════════════
// SPLASH SCREEN YÖNETİMİ
// ═══════════════════════════════════════════════════════════════
const splashEl    = document.getElementById('splash-screen');
const splashBar   = document.getElementById('splash-progress');
const splashTxt   = document.getElementById('splash-status');

function setSplashProgress(pct, msg) {
    if (splashBar) splashBar.style.width = pct + '%';
    if (splashTxt) splashTxt.textContent = msg;
}

function hideSplash() {
    if (!splashEl) return;
    splashEl.classList.add('splash-fade-out');
    setTimeout(() => {
        splashEl.style.display = 'none';
    }, 600);
}

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

    // Splash başlangıç
    setSplashProgress(10, 'Bağlantı kuruluyor...');

    // Default mock user if not in Telegram
    let telegram_id = 12345;
    let first_name = "Misafir";
    let username = "kullanici";
    let referred_by = null;

    if (tg.initDataUnsafe && tg.initDataUnsafe.user) {
        const user = tg.initDataUnsafe.user;
        telegram_id = user.id;
        first_name = user.first_name || first_name;
        username = user.username ? `@${user.username}` : `ID: ${user.id}`;
    }

    if (tg.initDataUnsafe && tg.initDataUnsafe.start_param) {
        const param = String(tg.initDataUnsafe.start_param);
        const match = param.match(/\d+/);
        if (match) {
            referred_by = parseInt(match[0]);
        }
    }

    currentUserData = { telegram_id, first_name, username, referred_by };

    // Copy Referral Link Event Listener
    const btnCopyRef = document.getElementById('btn-copy-ref-link');
    if (btnCopyRef) {
        btnCopyRef.addEventListener('click', () => {
            const input = document.getElementById('referral-link-input');
            if (!input) return;
            input.select();
            input.setSelectionRange(0, 99999);
            navigator.clipboard.writeText(input.value);
            showToast("📋 Referans linki kopyalandı!");
        });
    }

    // Adım 1: Ayarları yükle
    setSplashProgress(30, 'Ayarlar yükleniyor...');
    await loadPublicSettings();

    // Splash'taki marka adını ayarlardan güncelle
    const splashBrandEl = document.getElementById('splash-brand-name');
    if (splashBrandEl && appSettings.brand_name) {
        splashBrandEl.textContent = appSettings.brand_name;
    }

    // Adım 2: Hizmetleri yükle
    setSplashProgress(55, 'Hizmetler yükleniyor...');
    await loadServicesFromBackend();

    // Adım 3: Kullanıcı kontrolü
    setSplashProgress(75, 'Hesap kontrol ediliyor...');
    await checkUserStatus(telegram_id);

    // Adım 4: UI kurulumu
    setSplashProgress(90, 'Hazırlanıyor...');
    setupTabs();
    setupCategoryFilters();
    setupModals();
    setupProfileMenu();
    setupDragScroll();
    setupPaymentModal();
    setupAdminPanel();
    setupNotifications();

    // Ödeme yöntemlerini dinamik olarak yükle
    await loadPaymentMethodsForFunds();

    // Tamamlandı — splash kapat
    setSplashProgress(100, 'Hazır! 🚀');
    await new Promise(r => setTimeout(r, 400)); // Kısa bekleme animasyonu için
    hideSplash();

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

    // ─── FEAT: Group A (Arayüz) ───
    
    // feat_announcement: Duyuru Banner
    const annContainer = document.getElementById('feat-announcement-container');
    if (annContainer) {
        annContainer.style.display = settings.feat_announcement === 'true' ? 'flex' : 'none';
        // Gerçek sistemde ayar tablosundan text de eklenebilir, şimdilik placeholder kullanıyoruz.
    }

    // feat_search: Hizmet Arama Çubuğu
    const searchContainer = document.getElementById('feat-search-container');
    if (searchContainer) {
        searchContainer.style.display = settings.feat_search === 'true' ? 'block' : 'none';
    }

    // feat_faq: Sık Sorulan Sorular
    const faqMenu = document.getElementById('menu-faq');
    if (faqMenu) {
        faqMenu.style.display = settings.feat_faq === 'true' ? 'flex' : 'none';
    }

    // feat_animations: Ekstra Animasyonlar
    if (settings.feat_animations === 'true') {
        document.body.classList.add('enhanced-animations');
    } else {
        document.body.classList.remove('enhanced-animations');
    }

    // ─── FEAT: Group B (Kullanıcı İşlemleri) ───
    
    // feat_favorites: Favori Servisler
    const favChip = document.getElementById('feat-favorites-chip');
    if (favChip) {
        favChip.style.display = settings.feat_favorites === 'true' ? 'inline-flex' : 'none';
    }

    // feat_stats: Gelişmiş İstatistikler
    const statsContainer = document.getElementById('feat-stats-container');
    if (statsContainer) {
        statsContainer.style.display = settings.feat_stats === 'true' ? 'grid' : 'none';
    }

    // feat_coupon_mgr: Admin Kupon Yönetimi Tab Butonu
    const couponTabBtn = document.getElementById('admin-tab-coupons-btn');
    if (couponTabBtn) {
        couponTabBtn.style.display = settings.feat_coupon_mgr === 'true' ? 'block' : 'none';
    }

    // feat_analytics: Admin Analizler Tab Butonu
    const analyticsTabBtn = document.getElementById('admin-tab-analytics-btn');
    if (analyticsTabBtn) {
        analyticsTabBtn.style.display = settings.feat_analytics === 'true' ? 'block' : 'none';
    }

    // feat_bulk_notify: Toplu Bildirim Formu
    const bulkNotifyCont = document.getElementById('feat-bulk-notify-container');
    if (bulkNotifyCont) {
        bulkNotifyCont.style.display = settings.feat_bulk_notify === 'true' ? 'block' : 'none';
    }

    // feat_export: CSV Dışa Aktarma Butonları
    const exportUsersBtn = document.getElementById('btn-export-users-csv');
    if (exportUsersBtn) {
        exportUsersBtn.style.display = settings.feat_export === 'true' ? 'flex' : 'none';
    }
    const exportOrdersBtn = document.getElementById('btn-export-orders-csv');
    if (exportOrdersBtn) {
        exportOrdersBtn.style.display = settings.feat_export === 'true' ? 'flex' : 'none';
    }
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
// DESTEK CHAT — ENGELLİ KULLANICI
// ═══════════════════════════════════════════════════════════════
let supportPollingInterval = null;

function showBlockedScreen(reason) {
    // Tüm splash ve ana içeriği gizle
    document.body.innerHTML = `
        <!-- Engelli Ekranı -->
        <div id="blocked-screen" style="
            display:flex; flex-direction:column; align-items:center; justify-content:center;
            min-height:100vh; text-align:center; padding:30px 20px;
            background: linear-gradient(135deg, #0f0f1a 0%, #1a0f0f 100%);
            font-family:'Inter',sans-serif; color:#f1f1f1; position:relative; overflow:hidden;
        ">
            <!-- Arka plan efekti -->
            <div style="
                position:absolute; inset:0; background:radial-gradient(ellipse at 50% 0%, rgba(220,38,38,0.15) 0%, transparent 70%);
                pointer-events:none;
            "></div>

            <!-- İkon -->
            <div style="
                width:90px; height:90px; border-radius:50%;
                background:linear-gradient(135deg, rgba(220,38,38,0.2), rgba(220,38,38,0.05));
                border:2px solid rgba(220,38,38,0.4);
                display:flex; align-items:center; justify-content:center;
                margin-bottom:24px; position:relative;
                box-shadow: 0 0 40px rgba(220,38,38,0.3);
            ">
                <i class="ph-fill ph-prohibit" style="font-size:48px; color:#ef4444;"></i>
            </div>

            <!-- Başlık -->
            <h1 style="font-size:22px; font-weight:700; margin:0 0 10px; color:#fff;">Erişim Engellendi</h1>
            <p style="color:#9ca3af; font-size:14px; line-height:1.6; max-width:280px; margin:0 0 32px;">
                ${reason}
            </p>

            <!-- Bilgi Kutusu -->
            <div style="
                background:rgba(255,255,255,0.05); border:1px solid rgba(255,255,255,0.1);
                border-radius:14px; padding:16px 20px; max-width:300px; width:100%;
                text-align:left; margin-bottom:20px;
            ">
                <p style="color:#d1d5db; font-size:13px; margin:0; line-height:1.6;">
                    💡 Hesabınızla ilgili bir sorun yaşandığını düşünüyorsanız, sağ alttaki
                    <strong style="color:#60a5fa;">Destek Al</strong> butonuna tıklayarak
                    bize mesaj gönderebilirsiniz.
                </p>
            </div>
        </div>

        <!-- Destek FAB Butonu -->
        <button id="support-fab-btn" onclick="openSupportChat()" style="
            position:fixed; bottom:24px; right:24px; z-index:9999;
            width:60px; height:60px; border-radius:50%; border:none; cursor:pointer;
            background:linear-gradient(135deg, #3b82f6, #2563eb);
            box-shadow:0 4px 20px rgba(59,130,246,0.5);
            display:flex; align-items:center; justify-content:center;
            font-size:26px; color:white;
            animation: supportPulse 2.5s infinite;
            transition: transform 0.2s, box-shadow 0.2s;
        " onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'">
            <i class="ph-fill ph-chat-circle-dots"></i>
            <span id="support-unread-badge" style="
                position:absolute; top:4px; right:4px;
                background:#ef4444; color:white; border-radius:50%;
                width:18px; height:18px; font-size:10px; font-weight:700;
                display:none; align-items:center; justify-content:center;
                border:2px solid #1e3a8a;
            "></span>
        </button>

        <!-- Destek Chat Modalı -->
        <div id="support-chat-modal" style="
            position:fixed; inset:0; z-index:10000;
            background:rgba(0,0,0,0.7); backdrop-filter:blur(8px);
            display:none; align-items:flex-end; justify-content:center;
            padding:0;
        ">
            <div style="
                width:100%; max-width:480px;
                height:85vh; background:#111827;
                border-radius:20px 20px 0 0;
                border:1px solid rgba(255,255,255,0.1);
                display:flex; flex-direction:column;
                overflow:hidden;
                transform:translateY(100%);
                transition:transform 0.35s cubic-bezier(0.34,1.56,0.64,1);
            " id="support-chat-inner">
                <!-- Header -->
                <div style="
                    padding:16px 20px; background:#1f2937;
                    border-bottom:1px solid rgba(255,255,255,0.08);
                    display:flex; align-items:center; gap:12px; flex-shrink:0;
                ">
                    <div style="
                        width:40px; height:40px; border-radius:50%;
                        background:linear-gradient(135deg,#3b82f6,#1d4ed8);
                        display:flex; align-items:center; justify-content:center;
                        font-size:20px; color:white; flex-shrink:0;
                    "><i class="ph-fill ph-headset"></i></div>
                    <div style="flex:1; min-width:0;">
                        <div style="font-weight:700; color:#f9fafb; font-size:15px;">Destek Hattı</div>
                        <div style="color:#6b7280; font-size:12px;" id="support-status-text">Bağlanıyor...</div>
                    </div>
                    <button onclick="closeSupportChat()" style="
                        background:rgba(255,255,255,0.1); border:none; border-radius:50%;
                        width:32px; height:32px; cursor:pointer; color:#9ca3af;
                        display:flex; align-items:center; justify-content:center; font-size:18px;
                        transition:background 0.2s;
                    " onmouseover="this.style.background='rgba(255,255,255,0.2)'" onmouseout="this.style.background='rgba(255,255,255,0.1)'">
                        <i class="ph ph-x"></i>
                    </button>
                </div>

                <!-- Mesaj Alanı -->
                <div id="support-messages-area" style="
                    flex:1; overflow-y:auto; padding:16px;
                    display:flex; flex-direction:column; gap:10px;
                    scroll-behavior:smooth;
                ">
                    <!-- İlk hoşgeldin mesajı -->
                    <div style="
                        background:rgba(59,130,246,0.1); border:1px solid rgba(59,130,246,0.2);
                        border-radius:12px; padding:12px 14px; max-width:85%; align-self:flex-start;
                    ">
                        <p style="color:#93c5fd; font-size:13px; margin:0; line-height:1.5;">
                            👋 Merhaba! Destek ekibine bağlandınız. Mesajınızı yazın, en kısa sürede yanıtlayacağız.
                        </p>
                    </div>
                </div>

                <!-- Input Alanı -->
                <div style="
                    padding:12px 16px; background:#1f2937;
                    border-top:1px solid rgba(255,255,255,0.08);
                    display:flex; gap:10px; align-items:flex-end; flex-shrink:0;
                ">
                    <textarea id="support-input" placeholder="Mesajınızı yazın..." rows="1"
                        oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,100)+'px'"
                        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendSupportMessage();}"
                        style="
                            flex:1; background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.1);
                            border-radius:12px; padding:10px 14px; color:#f9fafb; font-size:14px;
                            resize:none; font-family:inherit; outline:none; min-height:42px;
                            transition:border-color 0.2s;
                        "
                        onfocus="this.style.borderColor='rgba(59,130,246,0.5)'"
                        onblur="this.style.borderColor='rgba(255,255,255,0.1)'"
                    ></textarea>
                    <button onclick="sendSupportMessage()" id="support-send-btn" style="
                        width:42px; height:42px; border-radius:12px; border:none; cursor:pointer;
                        background:linear-gradient(135deg,#3b82f6,#2563eb);
                        color:white; font-size:18px; flex-shrink:0;
                        display:flex; align-items:center; justify-content:center;
                        transition:transform 0.15s, opacity 0.15s;
                        box-shadow:0 2px 8px rgba(59,130,246,0.4);
                    " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                        <i class="ph-fill ph-paper-plane-right"></i>
                    </button>
                </div>
            </div>
        </div>

        <style>
        @keyframes supportPulse {
            0%, 100% { box-shadow: 0 4px 20px rgba(59,130,246,0.5); }
            50% { box-shadow: 0 4px 30px rgba(59,130,246,0.8), 0 0 0 8px rgba(59,130,246,0.1); }
        }
        </style>
    `;

    // Modal animasyonu başlat
    setTimeout(() => {
        const inner = document.getElementById('support-chat-inner');
        if (inner) inner.style.transform = '';
    }, 50);

    // Eğer kullanıcı daha önce mesaj gönderdiyse yükle
    loadSupportMessages();
}

function openSupportChat() {
    const modal = document.getElementById('support-chat-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    requestAnimationFrame(() => {
        const inner = document.getElementById('support-chat-inner');
        if (inner) inner.style.transform = 'translateY(0)';
    });
    document.getElementById('support-status-text').textContent = 'Çevrimiçi · Genellikle birkaç saat içinde yanıt verilir';

    // Mesajları yükle ve her 15 sn güncelle
    loadSupportMessages();
    if (!supportPollingInterval) {
        supportPollingInterval = setInterval(loadSupportMessages, 15000);
    }
}

function closeSupportChat() {
    const inner = document.getElementById('support-chat-inner');
    if (inner) inner.style.transform = 'translateY(100%)';
    setTimeout(() => {
        const modal = document.getElementById('support-chat-modal');
        if (modal) modal.style.display = 'none';
    }, 350);
    if (supportPollingInterval) {
        clearInterval(supportPollingInterval);
        supportPollingInterval = null;
    }
}

async function loadSupportMessages() {
    if (!currentUserData) return;
    try {
        const res = await fetch(`/api/support/messages?user_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        if (!data.success) return;

        const area = document.getElementById('support-messages-area');
        if (!area) return;

        // Mevcut kullanıcı mesajlarını render et (hoşgeldin mesajından sonra)
        const userMsgs = area.querySelectorAll('.chat-msg');
        userMsgs.forEach(el => el.remove());

        let hasUnreplied = false;
        data.messages.forEach(msg => {
            // Kullanıcı mesajı (sağ)
            const userDiv = document.createElement('div');
            userDiv.className = 'chat-msg';
            userDiv.style.cssText = 'display:flex; justify-content:flex-end;';
            userDiv.innerHTML = `
                <div style="
                    background:linear-gradient(135deg,rgba(59,130,246,0.3),rgba(37,99,235,0.2));
                    border:1px solid rgba(59,130,246,0.3);
                    border-radius:14px 14px 4px 14px; padding:10px 14px;
                    max-width:80%; color:#e2e8f0; font-size:13px; line-height:1.5;
                ">
                    <p style="margin:0;">${escapeHtmlSupport(msg.message)}</p>
                    <span style="font-size:10px; color:#6b7280; margin-top:4px; display:block; text-align:right;">
                        ${formatSupportTime(msg.created_at)}
                    </span>
                </div>`;
            area.appendChild(userDiv);

            // Admin yanıtı (sol)
            if (msg.reply) {
                const replyDiv = document.createElement('div');
                replyDiv.className = 'chat-msg';
                replyDiv.style.cssText = 'display:flex; justify-content:flex-start;';
                replyDiv.innerHTML = `
                    <div style="
                        background:rgba(34,197,94,0.1); border:1px solid rgba(34,197,94,0.25);
                        border-radius:14px 14px 14px 4px; padding:10px 14px;
                        max-width:80%; font-size:13px; line-height:1.5;
                    ">
                        <div style="font-size:10px; color:#22c55e; font-weight:600; margin-bottom:4px;">
                            ✓ Destek Ekibi
                        </div>
                        <p style="margin:0; color:#d1fae5;">${escapeHtmlSupport(msg.reply)}</p>
                        <span style="font-size:10px; color:#6b7280; margin-top:4px; display:block;">
                            ${formatSupportTime(msg.replied_at)}
                        </span>
                    </div>`;
                area.appendChild(replyDiv);
            } else {
                hasUnreplied = true;
            }
        });

        // Okunmamış badge göster
        const badge = document.getElementById('support-unread-badge');
        if (badge) {
            const unreadReplies = data.messages.filter(m => m.reply && !m.is_read).length;
            if (unreadReplies > 0) {
                badge.textContent = unreadReplies;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        // En alta scroll
        area.scrollTop = area.scrollHeight;

    } catch (e) {
        console.warn('Destek mesajları yüklenemedi:', e);
    }
}

async function sendSupportMessage() {
    const input = document.getElementById('support-input');
    if (!input || !currentUserData) return;
    const text = input.value.trim();
    if (!text) return;

    const btn = document.getElementById('support-send-btn');
    if (btn) btn.disabled = true;
    input.disabled = true;

    try {
        const res = await fetch('/api/support/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: currentUserData.telegram_id,
                first_name: currentUserData.first_name || 'Kullanıcı',
                username: currentUserData.username || '',
                message: text
            })
        });
        const data = await res.json();
        if (data.success) {
            input.value = '';
            input.style.height = 'auto';
            await loadSupportMessages();
        } else {
            alert('Mesaj gönderilemedi, lütfen tekrar deneyin.');
        }
    } catch (e) {
        alert('Bağlantı hatası.');
    } finally {
        if (btn) btn.disabled = false;
        input.disabled = false;
        input.focus();
    }
}

function escapeHtmlSupport(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function parseDateUTC(dateStr) {
    if (!dateStr) return new Date();
    let str = String(dateStr);
    if (!str.includes('Z') && !str.includes('+')) {
        str += 'Z';
    }
    return new Date(str);
}

function formatSupportTime(isoStr) {
    if (!isoStr) return '';
    try {
        const d = parseDateUTC(isoStr);
        return d.toLocaleTimeString('tr-TR', { hour:'2-digit', minute:'2-digit' }) +
               ' · ' + d.toLocaleDateString('tr-TR', { day:'numeric', month:'short' });
    } catch { return ''; }
}

// ═══════════════════════════════════════════════════════════════
// USER AUTH
// ═══════════════════════════════════════════════════════════════
async function checkUserStatus(tg_id) {
    try {
        const response = await fetch(`/api/user?tg_id=${tg_id}`);
        if (response.status === 403) {
            const errData = await response.json();
            showBlockedScreen(errData.detail || 'Hesabınız askıya alınmıştır.');
            return;
        }
        const data = await response.json();

        if (data.registered) {
            currentUserData = { ...currentUserData, ...data.user };
            
            if (!data.user.custom_username) {
                document.body.classList.add('hide-nav');
                showView('view-register');
                document.getElementById('register-welcome').textContent = `Kullanıcı Adı Seçin, ${currentUserData.first_name}!`;
                document.getElementById('btn-register').onclick = async () => await registerUser(currentUserData);
                return;
            }
            updateDashboardUI(data.user, data.orders);
            updateVipAndReferralUI(data);
            renderOrders(data.orders);
            renderServices('all');
            await loadNotifications();

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
                custom_username: customUsername,
                referred_by: userData.referred_by
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

    // ─── FEAT: Group B (Gelişmiş İstatistikler) ───
    if (appSettings.feat_stats === 'true') {
        const completedCount = orders.filter(o => o.status === 'Tamamlandı').length;
        const pendingCount = orders.filter(o => o.status === 'Bekliyor' || o.status === 'İşlemde').length;
        
        const statsCompletedEl = document.getElementById('stats-completed-orders');
        const statsPendingEl = document.getElementById('stats-pending-orders');
        if (statsCompletedEl) statsCompletedEl.textContent = completedCount;
        if (statsPendingEl) statsPendingEl.textContent = pendingCount;
    }
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

        // ─── FEAT: Group B (Sipariş İlerleme Çubuğu) ───
        let progressHtml = '';
        if (appSettings.feat_order_progress === 'true') {
            let progress = 0;
            let pColor = 'var(--color-primary)';
            if (status === 'Bekliyor') progress = 33;
            else if (status === 'İşlemde') progress = 66;
            else if (status === 'Tamamlandı') { progress = 100; pColor = 'var(--color-success)'; }
            else if (status === 'İptal Edildi') { progress = 100; pColor = 'var(--color-danger)'; }
            
            progressHtml = `
            <div style="margin-top: 12px;">
                <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:6px; color:var(--tg-hint-color); font-weight: 600;">
                    <span>İlerleme</span>
                    <span>%${progress}</span>
                </div>
                <div style="width: 100%; height: 6px; background: var(--tg-secondary-bg-color); border-radius: 3px; overflow: hidden;">
                    <div style="width: ${progress}%; height: 100%; background: ${pColor}; border-radius: 3px; transition: width 0.5s ease;"></div>
                </div>
            </div>`;
        }

        // ─── FEAT: Group B (Tekrar Sipariş Butonu) ───
        let reorderBtnHtml = '';
        if (appSettings.feat_reorder === 'true') {
            reorderBtnHtml = `<button class="btn-reorder" data-service-id="${order.service_id}" style="background:var(--tg-secondary-bg-color); color:var(--tg-text-color); border:none; padding:6px 10px; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; display:flex; align-items:center; gap:4px;"><i class="ph ph-arrow-counter-clockwise"></i> Tekrarla</button>`;
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
                <p class="order-link" style="word-break: break-all;">${order.link} (${order.quantity} Adet)</p>
                ${noteHtml}
                ${progressHtml}
            </div>
            <div class="order-footer" style="align-items: center;">
                <div style="display:flex; flex-direction:column; gap:2px;">
                    <span class="order-price" style="font-size: 14px; font-weight: 700; color:var(--tg-text-color);">₺${order.price.toFixed(2)}</span>
                    <span class="order-date" style="font-size: 11px; color:var(--tg-hint-color);">${parseDateUTC(order.order_date).toLocaleDateString('tr-TR')}</span>
                </div>
                ${reorderBtnHtml}
            </div>
        `;
        container.appendChild(card);
    });

    // Tekrar Sipariş Ver butonu dinleyicisi
    document.querySelectorAll('.btn-reorder').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
            const sid = parseInt(e.currentTarget.getAttribute('data-service-id'));
            // Sipariş modalını aç ve o servisi seç
            openOrderModal(sid);
        });
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
    
    // Uygula feat_search
    const searchInput = document.getElementById('service-search-input');
    const query = (appSettings.feat_search === 'true' && searchInput) ? searchInput.value.toLowerCase().trim() : '';

    // Favorileri yerel hafızadan al
    let favorites = [];
    try { favorites = JSON.parse(localStorage.getItem('fav_services')) || []; } catch(e){}

    let filtered = [];
    if (filterPlatform === 'all') {
        filtered = smmServices;
    } else if (filterPlatform === 'favorites') {
        filtered = smmServices.filter(s => favorites.includes(s.id));
    } else {
        filtered = smmServices.filter(s => s.platform === filterPlatform);
    }
    
    if (query) {
        filtered = filtered.filter(s => s.name.toLowerCase().includes(query) || s.platform.toLowerCase().includes(query));
    }

    if (filtered.length === 0) {
        container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding: 30px;">Eşleşen hizmet bulunamadı.</p>';
        return;
    }

    const isRedesign = appSettings.feat_service_redesign === 'true';

    filtered.forEach(service => {
        const card = document.createElement('div');
        
        // ─── FEAT: Group B (Favoriler) ───
        let favIconHtml = '';
        if (appSettings.feat_favorites === 'true') {
            const isFav = favorites.includes(service.id);
            const favColor = isFav ? '#f59e0b' : 'var(--tg-hint-color)';
            const favClass = isFav ? 'ph-fill ph-star' : 'ph ph-star';
            favIconHtml = `<button class="btn-favorite" data-id="${service.id}" style="background:none; border:none; color:${favColor}; font-size:22px; cursor:pointer; padding:0; display:flex; align-items:center; justify-content:center; transition: transform 0.2s;"><i class="${favClass}"></i></button>`;
        }

        if (isRedesign) {
            // YENİ TİP KART TASARIMI
            card.className = 'service-card redesign';
            card.innerHTML = `
                <div class="service-redesign-header">
                    <div class="redesign-icon platform-${service.platform}"><i class="ph ${service.icon}"></i></div>
                    <div class="redesign-title">
                        <h4>${service.name}</h4>
                        <div class="redesign-badges">
                            <span class="badge-minmax"><i class="ph ph-arrows-down-up"></i> ${service.min_order} - ${service.max_order}</span>
                            <span class="badge-platform">${service.platform.toUpperCase()}</span>
                        </div>
                    </div>
                    <div style="margin-left:auto;">${favIconHtml}</div>
                </div>
                <div class="service-redesign-footer">
                    <div class="redesign-price-box">
                        <span class="currency">₺</span>
                        <span class="amount">${parseFloat(service.price_per_1000).toFixed(2)}</span>
                        <span class="unit">/ 1000</span>
                    </div>
                    <button class="tg-button primary btn-buy" data-id="${service.id}" style="padding: 10px 16px; font-size: 14px; border-radius: 10px;">
                        <i class="ph ph-shopping-cart"></i> Satın Al
                    </button>
                </div>
            `;
        } else {
            // ESKİ TİP KART TASARIMI
            card.className = 'service-card';
            card.innerHTML = `
                <div class="service-header">
                    <div class="service-icon platform-${service.platform}"><i class="ph ${service.icon}"></i></div>
                    <div class="service-info">
                        <h4>${service.name}</h4>
                        <p>Min: ${service.min_order} - Max: ${service.max_order}</p>
                    </div>
                    <div style="margin-left:auto;">${favIconHtml}</div>
                </div>
                <div class="service-footer">
                    <div class="price">₺${parseFloat(service.price_per_1000).toFixed(2)} <span>/ 1000 Adet</span></div>
                    <button class="btn-buy" data-id="${service.id}">Satın Al</button>
                </div>
            `;
        }
        
        container.appendChild(card);
    });
    document.querySelectorAll('.btn-buy').forEach(btn => {
        btn.addEventListener('click', (e) => {
            openOrderModal(parseInt(e.target.getAttribute('data-id')));
        });
    });

    // Favoriye Ekle / Çıkar dinleyicisi
    document.querySelectorAll('.btn-favorite').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
            const sid = parseInt(e.currentTarget.getAttribute('data-id'));
            let favs = [];
            try { favs = JSON.parse(localStorage.getItem('fav_services')) || []; } catch(err){}
            if (favs.includes(sid)) {
                favs = favs.filter(id => id !== sid); // Çıkar
            } else {
                favs.push(sid); // Ekle
                if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
            }
            localStorage.setItem('fav_services', JSON.stringify(favs));
            
            // Yeniden render et (şu anki filtreyi koruyarak)
            const activeChip = document.querySelector('.category-chip.active');
            renderServices(activeChip ? activeChip.getAttribute('data-cat') : 'all');
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

    // FEAT: Search input event
    const searchInput = document.getElementById('service-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', () => {
            const activeChip = document.querySelector('.category-chip.active');
            const cat = activeChip ? activeChip.getAttribute('data-cat') : 'all';
            renderServices(cat);
        });
    }
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

    // FEAT: Apply Coupon Event Listener
    const btnApplyCoupon = document.getElementById('btn-apply-coupon');
    if (btnApplyCoupon) {
        btnApplyCoupon.addEventListener('click', async () => {
            const codeInput = document.getElementById('order-coupon');
            const code = codeInput.value.trim().toUpperCase();
            if (!code) { showAlert("Lütfen bir kupon kodu girin."); return; }
            
            btnApplyCoupon.disabled = true;
            btnApplyCoupon.textContent = "...";
            const msgEl = document.getElementById('coupon-message');
            msgEl.textContent = '';
            
            try {
                const res = await fetch(`/api/coupon/validate?code=${code}&tg_id=${currentUserData.telegram_id}`);
                const data = await res.json();
                if (res.ok && data.success) {
                    currentCoupon = { code: code, discountPercent: data.discount_percent };
                    codeInput.disabled = true;
                    btnApplyCoupon.textContent = "✓";
                    msgEl.style.color = '#22c55e';
                    msgEl.textContent = `Kupon uygulandı! %${data.discount_percent} indirim.`;
                    calculatePrice();
                } else {
                    msgEl.style.color = 'var(--color-danger)';
                    msgEl.textContent = data.detail || "Geçersiz kupon.";
                    btnApplyCoupon.disabled = false;
                    btnApplyCoupon.textContent = "Uygula";
                }
            } catch(e) {
                msgEl.style.color = 'var(--color-danger)';
                msgEl.textContent = "Bağlantı hatası.";
                btnApplyCoupon.disabled = false;
                btnApplyCoupon.textContent = "Uygula";
            }
        });
    }
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
    
    // Reset coupon UI & State
    currentCoupon = null;
    const couponGroup = document.getElementById('feat-coupon-group');
    if (couponGroup) {
        couponGroup.style.display = appSettings.feat_coupons === 'true' ? 'block' : 'none';
    }
    const couponInput = document.getElementById('order-coupon');
    if (couponInput) {
        couponInput.value = '';
        couponInput.disabled = false;
    }
    const couponMessage = document.getElementById('coupon-message');
    if (couponMessage) {
        couponMessage.textContent = '';
        couponMessage.style.color = '';
    }
    const applyBtn = document.getElementById('btn-apply-coupon');
    if (applyBtn) {
        applyBtn.textContent = 'Uygula';
        applyBtn.disabled = false;
    }
    
    const couponDiscountRow = document.getElementById('coupon-discount-row');
    if (couponDiscountRow) couponDiscountRow.style.display = 'none';
    const vipDiscountRow = document.getElementById('vip-discount-row');
    if (vipDiscountRow) vipDiscountRow.style.display = 'none';

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
    currentCoupon = null;
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
    
    let price = (qty / 1000) * parseFloat(currentSelectedService.price_per_1000);
    
    // VIP discount
    if (appSettings.feat_vip === 'true' && currentUserData && currentUserData.vip_level > 0) {
        const vipDiscount = Math.min(currentUserData.vip_level * 5, 25);
        price = price * (1 - vipDiscount / 100);
        const vipRow = document.getElementById('vip-discount-row');
        if (vipRow) {
            vipRow.style.display = 'block';
            document.getElementById('modal-vip-discount').textContent = `-%${vipDiscount}`;
        }
    } else {
        const vipRow = document.getElementById('vip-discount-row');
        if (vipRow) vipRow.style.display = 'none';
    }
    
    // Coupon discount
    if (appSettings.feat_coupons === 'true' && currentCoupon) {
        price = price * (1 - currentCoupon.discountPercent / 100);
        const couponRow = document.getElementById('coupon-discount-row');
        if (couponRow) {
            couponRow.style.display = 'block';
            document.getElementById('modal-coupon-discount').textContent = `-%${currentCoupon.discountPercent}`;
        }
    } else {
        const couponRow = document.getElementById('coupon-discount-row');
        if (couponRow) couponRow.style.display = 'none';
    }
    
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
    
    let price = (qty / 1000) * parseFloat(currentSelectedService.price_per_1000);
    
    // VIP discount client calculation
    if (appSettings.feat_vip === 'true' && currentUserData && currentUserData.vip_level > 0) {
        const vipDiscount = Math.min(currentUserData.vip_level * 5, 25);
        price = price * (1 - vipDiscount / 100);
    }
    
    // Coupon discount client calculation
    if (appSettings.feat_coupons === 'true' && currentCoupon) {
        price = price * (1 - currentCoupon.discountPercent / 100);
    }
    
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
                link, 
                quantity: qty, 
                price: price,
                coupon_code: (appSettings.feat_coupons === 'true' && currentCoupon) ? currentCoupon.code : null
            })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            closeModal();
            showToast("✅ Siparişiniz alındı!");
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
            if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
            const termsModal = document.getElementById('terms-modal');
            if (termsModal) {
                // Scroll to top when opening
                const termsBody = document.getElementById('terms-body');
                if (termsBody) termsBody.scrollTop = 0;
                termsModal.classList.add('active');
            }
        });
    }

    // Terms modal close handlers
    const termsModal = document.getElementById('terms-modal');
    const closeTermsBtn = document.getElementById('close-terms-modal');
    const acceptTermsBtn = document.getElementById('btn-terms-accept');

    function closeTermsModal() {
        if (termsModal) termsModal.classList.remove('active');
    }

    if (closeTermsBtn) closeTermsBtn.addEventListener('click', (e) => { e.stopPropagation(); closeTermsModal(); });
    if (acceptTermsBtn) acceptTermsBtn.addEventListener('click', () => {
        if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
        closeTermsModal();
    });
    if (termsModal) termsModal.addEventListener('click', (e) => { if (e.target === termsModal) closeTermsModal(); });

    // ─── FEAT: FAQ ───
    const menuFaq = document.getElementById('menu-faq');
    const btnFaqBack = document.getElementById('btn-faq-back');
    
    if (menuFaq) {
        menuFaq.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.nav-item').forEach(nav => {
                nav.classList.remove('active');
                const icon = nav.querySelector('i');
                if (icon) icon.className = icon.className.replace('ph-fill', 'ph');
            });
            showView('view-faq');
            window.scrollTo(0, 0);
        });
    }
    
    if (btnFaqBack) {
        btnFaqBack.addEventListener('click', () => {
            showView('view-profile');
            document.querySelector('[data-target="view-profile"]').classList.add('active');
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
            else if (tabId === 'tab-features') loadAdminFeatures();
            else if (tabId === 'tab-coupons') loadAdminCoupons();
            else if (tabId === 'tab-analytics') loadAdminAnalytics();
            else if (tabId === 'tab-support') loadAdminSupportMessages();
        });
    });

    // Coupons Form Event Listeners
    document.getElementById('btn-show-add-coupon')?.addEventListener('click', () => {
        document.getElementById('coupon-form-card').style.display = 'block';
    });
    document.getElementById('btn-cancel-coupon-form')?.addEventListener('click', () => {
        document.getElementById('coupon-form-card').style.display = 'none';
    });
    document.getElementById('btn-save-coupon')?.addEventListener('click', async () => {
        const code = document.getElementById('coupon-code').value.trim().toUpperCase();
        const discount = parseFloat(document.getElementById('coupon-discount').value) || 0;
        const maxUses = parseInt(document.getElementById('coupon-max-uses').value) || 0;
        
        if (!code || discount <= 0 || discount > 100 || maxUses <= 0) {
            showAlert("Lütfen tüm alanları geçerli değerlerle doldurun."); return;
        }
        
        const btn = document.getElementById('btn-save-coupon');
        btn.disabled = true; btn.textContent = "...";
        
        try {
            const res = await fetch('/api/admin/coupon/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_id: currentUserData.telegram_id, code, discount_percent: discount, max_uses: maxUses })
            });
            const d = await res.json();
            document.getElementById('coupon-form-card').style.display = 'none';
            document.getElementById('coupon-code').value = '';
            document.getElementById('coupon-discount').value = '';
            document.getElementById('coupon-max-uses').value = '';
            await loadAdminCoupons();
            showAlert(d.message || 'Kupon oluşturuldu.');
        } catch { showAlert("Hata oluştu."); }
        finally { btn.disabled = false; btn.textContent = "Oluştur"; }
    });

    // Refresh buttons
    document.getElementById('btn-admin-refresh')?.addEventListener('click', loadPendingPayments);
    document.getElementById('btn-refresh-users')?.addEventListener('click', loadAdminUsers);
    document.getElementById('btn-refresh-orders')?.addEventListener('click', loadAdminOrders);
    document.getElementById('btn-refresh-settings')?.addEventListener('click', loadAdminSettings);
    document.getElementById('btn-refresh-features')?.addEventListener('click', loadAdminFeatures);
    document.getElementById('btn-refresh-support')?.addEventListener('click', loadAdminSupportMessages);

    // Toggle hidden orders
    const btnToggleHidden = document.getElementById('btn-toggle-hidden-orders');
    if (btnToggleHidden) {
        btnToggleHidden.addEventListener('click', async () => {
            adminOrdersShowHidden = !adminOrdersShowHidden;
            const icon = btnToggleHidden.querySelector('i');
            const text = btnToggleHidden.querySelector('span');
            if (adminOrdersShowHidden) {
                icon.className = 'ph ph-eye-slash';
                text.textContent = 'Gizlenenleri Gizle';
                btnToggleHidden.style.background = 'var(--tg-button-color)';
                btnToggleHidden.style.color = 'var(--tg-button-text-color)';
            } else {
                icon.className = 'ph ph-eye';
                text.textContent = 'Gizlenenleri Göster';
                btnToggleHidden.style.background = 'var(--tg-secondary-bg-color)';
                btnToggleHidden.style.color = 'var(--tg-text-color)';
            }
            await loadAdminOrders();
        });
    }

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

    // Bulk Notify button click
    document.getElementById('btn-send-bulk-notify')?.addEventListener('click', async () => {
        const title = document.getElementById('bulk-notify-title').value.trim();
        const msg = document.getElementById('bulk-notify-message').value.trim();
        if (!title || !msg) { showAlert("Lütfen tüm alanları doldurun."); return; }
        
        showConfirm("Tüm kullanıcılara bu duyuruyu göndermek istiyor musunuz?", async (confirmed) => {
            if (!confirmed) return;
            const btn = document.getElementById('btn-send-bulk-notify');
            btn.disabled = true; btn.textContent = "...";
            try {
                const res = await fetch('/api/admin/bulk-notify', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ admin_id: currentUserData.telegram_id, title, message: msg })
                });
                const d = await res.json();
                if (d.success) {
                    document.getElementById('bulk-notify-title').value = '';
                    document.getElementById('bulk-notify-message').value = '';
                    showAlert(d.message);
                } else {
                    showAlert(d.detail || "Gönderilemedi.");
                }
            } catch { showAlert("Hata oluştu."); }
            finally { btn.disabled = false; btn.textContent = "Duyuruyu Gönder"; }
        });
    });

    // Export CSV events
    document.getElementById('btn-export-users-csv')?.addEventListener('click', exportUsersCSV);
    document.getElementById('btn-export-orders-csv')?.addEventListener('click', exportOrdersCSV);
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
                    <div style="font-size:12px; color:var(--tg-hint-color)">Yöntem: <b>${req.payment_method}</b> | ${parseDateUTC(req.request_date).toLocaleString('tr-TR')}</div>
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
                
                let vipText = '';
                if (user.vip_level > 0) {
                    vipText = ` · <span style="color:#f59e0b;font-weight:700;"><i class="ph-fill ph-crown"></i> VIP ${user.vip_level}</span>`;
                }
                
                let blockedText = '';
                if (user.is_blocked) {
                    blockedText = ` · <span style="color:var(--color-danger);font-weight:700;">ENGELLESİ</span>`;
                }

                let adminText = '';
                if (user.is_admin) {
                    adminText = ` · <span style="color:#3b82f6;font-weight:700;"><i class="ph-fill ph-shield-star"></i> ADMİN</span>`;
                }

                card.innerHTML = `
                    <div class="admin-user-avatar">${(user.first_name || '?').charAt(0).toUpperCase()}</div>
                    <div class="admin-user-info">
                        <div class="admin-user-name">${user.first_name || 'Bilinmiyor'}</div>
                        <div class="admin-user-meta">@${user.custom_username || '—'} · ID: ${user.telegram_id}${vipText}${adminText}${blockedText}</div>
                        <div class="admin-user-balance">Bakiye: <b>₺${parseFloat(user.balance || 0).toFixed(2)}</b></div>
                    </div>
                    <div style="display:flex; gap:6px;">
                        <button class="btn-edit-user" data-tgid="${user.telegram_id}" data-name="${user.first_name || ''}" data-balance="${user.balance || 0}" data-vip="${user.vip_level || 0}" data-blocked="${user.is_blocked || false}" data-admin="${user.is_admin || false}">
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
                    openUserEditModal(b.dataset.tgid, b.dataset.name, b.dataset.balance, b.dataset.vip, b.dataset.blocked, b.dataset.admin);
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

function openUserEditModal(tgId, name, balance, vipLevel = 0, isBlocked = false, isAdmin = false) {
    document.getElementById('edit-user-tg-id').value = tgId;
    document.getElementById('edit-user-name').value = name;
    document.getElementById('edit-user-balance').value = parseFloat(balance).toFixed(2);
    document.getElementById('edit-user-tgid-display').value = tgId;

    // VIP Group Display
    const vipGroup = document.getElementById('edit-user-vip-group');
    if (vipGroup) {
        vipGroup.style.display = appSettings.feat_vip === 'true' ? 'block' : 'none';
        document.getElementById('edit-user-vip').value = vipLevel;
    }

    // Block Group Display
    const blockGroup = document.getElementById('edit-user-block-group');
    if (blockGroup) {
        blockGroup.style.display = appSettings.feat_block_user === 'true' ? 'block' : 'none';
        document.getElementById('edit-user-is-blocked').value = String(isBlocked) === 'true' ? 'true' : 'false';
    }

    // Admin Group
    document.getElementById('edit-user-is-admin').value = String(isAdmin) === 'true' ? 'true' : 'false';

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
        // Base user details update
        const res = await fetch('/api/admin/user/update', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_id: currentUserData.telegram_id, telegram_id: tgId, balance, first_name: name })
        });
        await res.json();

        // Save VIP Seviyesi if active
        if (appSettings.feat_vip === 'true') {
            const vipLevel = parseInt(document.getElementById('edit-user-vip').value);
            await fetch('/api/admin/user/vip', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_id: currentUserData.telegram_id, telegram_id: tgId, vip_level: vipLevel })
            });
        }

        // Save block status if active
        if (appSettings.feat_block_user === 'true') {
            const isBlocked = document.getElementById('edit-user-is-blocked').value === 'true';
            await fetch('/api/admin/user/block', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ admin_id: currentUserData.telegram_id, telegram_id: tgId, is_blocked: isBlocked })
            });
        }

        // Save admin status
        const isAdminStatus = document.getElementById('edit-user-is-admin').value === 'true';
        await fetch('/api/admin/user/admin_role', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_id: currentUserData.telegram_id, telegram_id: tgId, is_admin: isAdminStatus })
        });

        document.getElementById('user-edit-modal').classList.remove('active');
        await loadAdminUsers();
        showAlert('✅ Kullanıcı bilgileri güncellendi.');
    } catch { 
        showAlert("Hata oluştu."); 
    } finally { 
        btn.disabled = false; btn.textContent = "Kaydet"; 
    }
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
        const res = await fetch(`/api/admin/orders?tg_id=${currentUserData.telegram_id}&show_hidden=${adminOrdersShowHidden}`);
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

                // Check if older than 1 day (24 hours)
                const orderDate = parseDateUTC(order.order_date);
                const now = new Date();
                const isOlderThan1Day = (now - orderDate) > (24 * 60 * 60 * 1000);
                
                let visibilityBtnHtml = '';
                if (isOlderThan1Day) {
                    if (order.keep_visible) {
                        visibilityBtnHtml = `<button class="btn-toggle-visibility" data-id="${order.id}" data-keep-visible="false"><i class="ph ph-eye-slash"></i> Gizle</button>`;
                    } else {
                        visibilityBtnHtml = `<button class="btn-toggle-visibility hidden-state" data-id="${order.id}" data-keep-visible="true"><i class="ph ph-eye"></i> Aktif Et</button>`;
                    }
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
                        <span>${orderDate.toLocaleDateString('tr-TR')}</span>
                        <div style="display:flex; gap:6px; align-items:center;">
                            ${visibilityBtnHtml}
                            ${order.status !== 'İptal Edildi' ? `<button class="btn-cancel-order" data-id="${order.id}"><i class="ph ph-x-circle"></i> İptal & İade</button>` : ''}
                        </div>
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

            container.querySelectorAll('.btn-toggle-visibility').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = parseInt(e.currentTarget.getAttribute('data-id'));
                    const keepVisible = e.currentTarget.getAttribute('data-keep-visible') === 'true';
                    try {
                        const res = await fetch('/api/admin/order/update-visibility', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ admin_id: currentUserData.telegram_id, order_id: id, keep_visible: keepVisible })
                        });
                        const d = await res.json();
                        if (d.success) {
                            if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
                            await loadAdminOrders();
                        } else {
                            showAlert(d.message || "Güncellenemedi.");
                        }
                    } catch {
                        showAlert("Hata oluştu.");
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

function showToast(message, duration = 1000) {
    let toast = document.getElementById('custom-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'custom-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    if (tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

function setupNotifications() {
    const notifToggle = document.getElementById('notifications-toggle');
    const notifModal = document.getElementById('notifications-modal');
    const closeNotifModal = document.getElementById('close-notifications-modal');
    
    if (notifToggle && notifModal) {
        notifToggle.addEventListener('click', async () => {
            notifModal.classList.add('active');
            await loadNotifications();
            await markNotificationsAsRead();
        });
    }
    if (closeNotifModal && notifModal) {
        closeNotifModal.addEventListener('click', () => {
            notifModal.classList.remove('active');
        });
    }
    notifModal?.addEventListener('click', (e) => {
        if (e.target === notifModal) {
            notifModal.classList.remove('active');
        }
    });
}

async function loadNotifications() {
    try {
        const res = await fetch(`/api/user/notifications?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        if (res.ok && data.success) {
            const list = document.getElementById('notifications-list');
            const badge = document.getElementById('notifications-badge');
            if (!list) return;
            
            list.innerHTML = '';
            const unreadCount = data.notifications.filter(n => !n.is_read).length;
            
            if (badge) {
                if (unreadCount > 0) {
                    badge.style.display = 'block';
                } else {
                    badge.style.display = 'none';
                }
            }
            
            if (data.notifications.length === 0) {
                list.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding: 20px;">Bildiriminiz bulunmamaktadır.</p>';
                return;
            }
            
            data.notifications.forEach(n => {
                const card = document.createElement('div');
                card.className = `notification-card ${n.is_read ? '' : 'unread'}`;
                
                const ndate = parseDateUTC(n.created_at);
                card.innerHTML = `
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span class="notification-title">${n.title}</span>
                        <span class="notification-time">${ndate.toLocaleDateString('tr-TR')} ${ndate.toLocaleTimeString('tr-TR', {hour: '2-digit', minute:'2-digit'})}</span>
                    </div>
                    <span class="notification-message">${n.message}</span>
                `;
                list.appendChild(card);
            });
        }
    } catch (err) {
        console.error("Bildirimler yüklenemedi:", err);
    }
}

async function markNotificationsAsRead() {
    try {
        await fetch('/api/user/notifications/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegram_id: currentUserData.telegram_id })
        });
        const badge = document.getElementById('notifications-badge');
        if (badge) badge.style.display = 'none';
        
        document.querySelectorAll('.notification-card.unread').forEach(c => c.classList.remove('unread'));
    } catch (err) {
        console.error("Bildirimler okundu işaretlenemedi:", err);
    }
}

// ═══════════════════════════════════════════════════════════════
// ÖZELLİK YÖNETİMİ (MODÜLLER) TAB'I
// ═══════════════════════════════════════════════════════════════
async function loadAdminFeatures() {
    const container = document.getElementById('admin-features-container');
    if (!container) return;
    
    container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding: 20px;">Özellikler yükleniyor...</p>';
    
    try {
        // Ayarları normal endpoint'ten çekiyoruz
        const res = await fetch(`/api/admin/settings?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        
        if (res.ok && data.success) {
            const settings = data.settings;
            container.innerHTML = '';
            
            const featureList = [
                { key: "feat_search", label: "🔍 Hizmet Arama Çubuğu", group: "Arayüz (Grup A)" },
                { key: "feat_faq", label: "❓ SSS / Yardım Sayfası", group: "Arayüz (Grup A)" },
                { key: "feat_announcement", label: "📢 Duyuru Banner Sistemi", group: "Arayüz (Grup A)" },
                { key: "feat_animations", label: "✨ Ekstra Mikro Animasyonlar", group: "Arayüz (Grup A)" },
                { key: "feat_service_redesign", label: "🖼️ Yeni Tip Servis Kartları", group: "Arayüz (Grup A)" },
                
                { key: "feat_favorites", label: "⭐ Favori Servisler", group: "Kullanıcı İşlemleri (Grup B)" },
                { key: "feat_reorder", label: "🔄 Tekrar Sipariş Butonu", group: "Kullanıcı İşlemleri (Grup B)" },
                { key: "feat_stats", label: "📊 Profilde Gelişmiş İstatistik", group: "Kullanıcı İşlemleri (Grup B)" },
                { key: "feat_order_progress", label: "📦 Sipariş İlerleme Çubuğu", group: "Kullanıcı İşlemleri (Grup B)" },
                
                { key: "feat_coupons", label: "🎟️ Kupon / İndirim Kullanımı", group: "Gelişmiş Sistemler (Grup C)" },
                { key: "feat_coupon_mgr", label: "🎟️ Admin: Kupon Yönetimi", group: "Gelişmiş Sistemler (Grup C)" },
                { key: "feat_vip", label: "🏆 VIP / Sadakat Seviyeleri", group: "Gelişmiş Sistemler (Grup C)" },
                { key: "feat_referral", label: "👥 Referans Sistemi", group: "Gelişmiş Sistemler (Grup C)" },
                { key: "feat_block_user", label: "🚫 Kullanıcı Engelleme", group: "Gelişmiş Sistemler (Grup C)" },
                
                { key: "feat_analytics", label: "📈 Grafikli Dashboard", group: "Yönetim (Grup D)" },
                { key: "feat_revenue", label: "💰 Gelir Raporları", group: "Yönetim (Grup D)" },
                { key: "feat_export", label: "📋 Excel / CSV Dışa Aktarma", group: "Yönetim (Grup D)" },
                { key: "feat_bulk_notify", label: "📣 Toplu Bildirim Atma", group: "Yönetim (Grup D)" },
                
                { key: "feat_live_support", label: "💬 Canlı Destek Botu", group: "Ekstra Özellikler" },
                { key: "feat_bulk_order", label: "🧮 Toplu Sipariş Girişi", group: "Ekstra Özellikler" },
                { key: "feat_pwa", label: "📱 PWA Yükleme", group: "Ekstra Özellikler" },
                { key: "feat_activity_log", label: "📝 Aktivite Logları", group: "Ekstra Özellikler" },
                { key: "feat_auto_api", label: "🤖 Otomatik API Gönderimi", group: "Ekstra Özellikler" },
                { key: "feat_theme_color", label: "🌈 Dinamik Tema Rengi", group: "Ekstra Özellikler" },
                { key: "feat_rich_notif", label: "🔔 Zengin Push Bildirimler", group: "Ekstra Özellikler" }
            ];

            let currentGroup = "";
            let html = "";
            
            featureList.forEach(feat => {
                if (currentGroup !== feat.group) {
                    currentGroup = feat.group;
                    html += `<div style="margin-top:20px; margin-bottom:10px; font-size:13px; font-weight:700; color:var(--tg-button-color); border-bottom: 1px solid var(--glass-border); padding-bottom:5px;">${currentGroup}</div>`;
                }
                
                const isEnabled = settings[feat.key] === 'true';
                
                html += `
                    <div class="feature-toggle-item" style="display:flex; justify-content:space-between; align-items:center; background:var(--glass-bg); border:1px solid var(--glass-border); border-radius:12px; padding:12px 16px; margin-bottom:8px;">
                        <div>
                            <div style="font-weight:600; font-size:14px; color:var(--tg-text-color);">${feat.label}</div>
                            <div style="font-size:11px; color:var(--tg-hint-color); margin-top:2px;">
                                ${isEnabled ? '<span style="color:var(--color-success)">Aktif</span>' : 'Pasif'}
                            </div>
                        </div>
                        <label class="toggle-switch">
                            <input type="checkbox" class="feature-checkbox" data-key="${feat.key}" ${isEnabled ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                `;
            });
            
            container.innerHTML = html;
            
            // Add event listeners to checkboxes
            container.querySelectorAll('.feature-checkbox').forEach(cb => {
                cb.addEventListener('change', async (e) => {
                    const key = e.target.getAttribute('data-key');
                    const isChecked = e.target.checked;
                    
                    if (tg.HapticFeedback) tg.HapticFeedback.impactOccurred('light');
                    
                    // Geçici olarak deaktif yap
                    e.target.disabled = true;
                    
                    try {
                        const res = await fetch('/api/admin/settings/update', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                admin_id: currentUserData.telegram_id,
                                key: key,
                                value: isChecked ? 'true' : 'false'
                            })
                        });
                        const d = await res.json();
                        
                        if (!d.success) {
                            showAlert("Hata: " + (d.message || "Kaydedilemedi"));
                            e.target.checked = !isChecked; // geri al
                        } else {
                            // Başarılı ise arayüzü güncellemesi için appSettings nesnesini güncelle
                            appSettings[key] = isChecked ? 'true' : 'false';
                            
                            // Yanındaki yazıyı güncelle
                            const statusText = e.target.closest('.feature-toggle-item').querySelector('span');
                            if (statusText) {
                                statusText.style.color = isChecked ? 'var(--color-success)' : '';
                                statusText.textContent = isChecked ? 'Aktif' : 'Pasif';
                            }
                        }
                    } catch (err) {
                        showAlert("Sunucu bağlantı hatası.");
                        e.target.checked = !isChecked;
                    } finally {
                        e.target.disabled = false;
                    }
                });
            });

        } else {
            container.innerHTML = `<p style="text-align:center; color:var(--color-danger); padding: 20px;">Hata: ${data.detail || 'Yüklenemedi'}</p>`;
        }
    } catch (e) {
        container.innerHTML = '<p style="text-align:center; color:var(--color-danger); padding: 20px;">Sunucuyla bağlantı kurulamadı.</p>';
    }
}

// ─── GROUP C CUSTOM RENDERING AND HELPERS ────────────────────────────────────

function updateVipAndReferralUI(data) {
    const user = data.user;
    
    // VIP Badge
    const vipBadge = document.getElementById('profile-vip-badge');
    const vipLevelText = document.getElementById('profile-vip-level-text');
    if (vipBadge && vipLevelText) {
        if (appSettings.feat_vip === 'true' && user.vip_level > 0) {
            vipBadge.style.display = 'inline-flex';
            vipLevelText.textContent = `VIP Seviye ${user.vip_level}`;
        } else {
            vipBadge.style.display = 'none';
        }
    }
    
    // Referrals Container
    const referralContainer = document.getElementById('feat-referral-container');
    if (referralContainer) {
        if (appSettings.feat_referral === 'true') {
            referralContainer.style.display = 'block';
            
            const refPercentText = document.getElementById('ref-bonus-percent-text');
            if (refPercentText) {
                refPercentText.textContent = `%${appSettings.referral_percent || '10'}`;
            }
            
            const refLinkInput = document.getElementById('referral-link-input');
            if (refLinkInput) {
                // Generate deep link for the Telegram bot
                const cleanBrand = (appSettings.brand_name || 'bot').toLowerCase().replace(/\s+/g, '');
                refLinkInput.value = `https://t.me/${cleanBrand}?startapp=${user.telegram_id}`;
            }
            
            document.getElementById('ref-count').textContent = data.referred_users_count || 0;
            document.getElementById('ref-earnings').textContent = `₺${parseFloat(user.referral_earnings || 0).toFixed(2)}`;
        } else {
            referralContainer.style.display = 'none';
        }
    }
}

async function loadAdminCoupons() {
    const container = document.getElementById('admin-coupons-list');
    if (!container) return;
    container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding:20px;">Yükleniyor...</p>';
    try {
        const res = await fetch(`/api/admin/coupons?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        if (res.ok && data.success) {
            container.innerHTML = '';
            if (data.coupons.length === 0) {
                container.innerHTML = '<p style="text-align:center;color:var(--tg-hint-color);padding:20px;">Henüz kupon yok. Yeni Ekle butonunu kullanın.</p>';
                return;
            }
            data.coupons.forEach(coupon => {
                const card = document.createElement('div');
                card.className = 'admin-service-card';
                card.innerHTML = `
                    <div class="admin-service-info">
                        <div class="service-icon" style="width:36px;height:36px;font-size:18px;flex-shrink:0;background:rgba(34,197,94,0.12);color:#22c55e;display:flex;align-items:center;justify-content:center;">
                            <i class="ph ph-ticket"></i>
                        </div>
                        <div>
                            <div class="admin-service-name">${coupon.code}</div>
                            <div class="admin-service-meta">%${coupon.discount_percent} İndirim · Kullanım: ${coupon.current_uses}/${coupon.max_uses}</div>
                        </div>
                    </div>
                    <div class="admin-service-actions">
                        <button class="btn-delete-coupon" data-id="${coupon.id}" style="background:var(--color-danger);color:#fff;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;display:flex;align-items:center;justify-content:center;width:36px;height:36px;">
                            <i class="ph ph-trash"></i>
                        </button>
                    </div>
                `;
                container.appendChild(card);
            });

            container.querySelectorAll('.btn-delete-coupon').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = parseInt(e.currentTarget.getAttribute('data-id'));
                    showConfirm("Bu kuponu silmek istediğinize emin misiniz?", async (confirmed) => {
                        if (!confirmed) return;
                        try {
                            const res = await fetch('/api/admin/coupon/delete', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ admin_id: currentUserData.telegram_id, coupon_id: id })
                            });
                            const d = await res.json();
                            showAlert(d.message || 'Kupon silindi.');
                            await loadAdminCoupons();
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

// ─── GROUP D CUSTOM RENDERING AND HELPERS ────────────────────────────────────

async function loadAdminAnalytics() {
    try {
        const res = await fetch(`/api/admin/analytics?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        
        if (res.ok && data.success) {
            const stats = data.analytics;
            
            document.getElementById('analytics-total-users').textContent = stats.total_users;
            document.getElementById('analytics-total-orders').textContent = stats.total_orders;
            document.getElementById('analytics-pending-payments').textContent = `₺${stats.pending_payments_amount.toFixed(2)} (${stats.pending_payments_count})`;
            
            // Ciro Kartı (feat_revenue)
            const revCard = document.getElementById('feat-revenue-card');
            if (revCard) {
                if (appSettings.feat_revenue === 'true') {
                    revCard.style.display = 'flex';
                    document.getElementById('analytics-total-revenue').textContent = `₺${stats.total_revenue.toFixed(2)}`;
                } else {
                    revCard.style.display = 'none';
                }
            }
            
            // Chart.js Çizimi (feat_analytics)
            const chartData = stats.sales_chart;
            const labels = chartData.map(item => item.date);
            const amounts = chartData.map(item => item.amount);
            
            const ctx = document.getElementById('salesChartCanvas').getContext('2d');
            if (salesChartInstance) salesChartInstance.destroy();
            
            salesChartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: labels.length > 0 ? labels : ['Veri Yok'],
                    datasets: [{
                        label: 'Satış Tutarı',
                        data: amounts.length > 0 ? amounts : [0],
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99, 102, 241, 0.1)',
                        borderWidth: 2,
                        tension: 0.3,
                        fill: true
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { display: false }
                    },
                    scales: {
                        y: {
                            grid: { color: 'rgba(255, 255, 255, 0.05)' },
                            ticks: { color: 'var(--tg-hint-color)' }
                        },
                        x: {
                            grid: { display: false },
                            ticks: { color: 'var(--tg-hint-color)' }
                        }
                    }
                }
            });
        }
    } catch(err) {
        console.error("Analizler yüklenemedi:", err);
    }
}

async function exportUsersCSV() {
    try {
        const res = await fetch(`/api/admin/users?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();
        if (res.ok && data.success) {
            let csv = "Telegram ID,Ad,Kullanici Adi,Ozel Kullanici Adi,Bakiye,Kayit Tarihi,VIP Seviyesi,Engelli mi\n";
            data.users.forEach(u => {
                csv += `"${u.telegram_id}","${u.first_name || ''}","${u.username || ''}","${u.custom_username || ''}","${u.balance || 0}","${u.joined_date || ''}","${u.vip_level || 0}","${u.is_blocked || false}"\n`;
            });
            downloadCSV(csv, "smm_users_export.csv");
            showToast("📥 Kullanıcılar CSV olarak indirildi.");
        }
    } catch(err) { showAlert("Dışa aktarma başarısız."); }
}

async function exportOrdersCSV() {
    try {
        const res = await fetch(`/api/admin/orders?tg_id=${currentUserData.telegram_id}&show_hidden=true`);
        const data = await res.json();
        if (res.ok && data.success) {
            let csv = "Siparis ID,Kullanici,Hizmet,Miktar,Tutar,Baglanti,Durum,Tarih\n";
            data.orders.forEach(o => {
                csv += `"${o.id}","${o.first_name} (@${o.custom_username})","${o.service_name || o.service_id}","${o.quantity}","${o.price}","${o.link}","${o.status}","${o.order_date}"\n`;
            });
            downloadCSV(csv, "smm_orders_export.csv");
            showToast("📥 Siparişler CSV olarak indirildi.");
        }
    } catch(err) { showAlert("Dışa aktarma başarısız."); }
}

function downloadCSV(csvContent, fileName) {
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute("href", url);
        link.setAttribute("download", fileName);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}


// ═══════════════════════════════════════════════════════════════
// ADMİN — DESTEK CHAT SİSTEMİ
// ═══════════════════════════════════════════════════════════════

let currentSupportUserId = null;
let currentSupportUserName = '';

/**
 * Destek sekmesi açıldığında çağrılır.
 * Kullanıcı listesini sol panelde gösterir.
 */
async function loadAdminSupportMessages() {
    // Kullanıcı listesini göster, chat penceresini gizle
    const listView = document.getElementById('support-user-list-view');
    const chatView = document.getElementById('support-chat-view');
    if (listView) listView.style.display = 'block';
    if (chatView) chatView.style.display = 'none';
    currentSupportUserId = null;

    const container = document.getElementById('support-users-container');
    if (!container || !currentUserData) return;
    container.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding:20px;">Yükleniyor...</p>';

    try {
        const res = await fetch(`/api/admin/support/users?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
            container.innerHTML = '<p style="text-align:center; color:var(--color-danger); padding:20px;">Yüklenemedi.</p>';
            return;
        }

        const users = data.users;

        // Rozeti güncelle
        const totalUnread = users.reduce((s, u) => s + (u.unread_count || 0), 0);
        const badge = document.getElementById('support-pending-badge');
        if (badge) {
            if (totalUnread > 0) {
                badge.textContent = totalUnread;
                badge.style.display = 'inline-flex';
            } else {
                badge.style.display = 'none';
            }
        }

        if (users.length === 0) {
            container.innerHTML = `
                <div style="text-align:center; padding:48px 20px; color:var(--tg-hint-color);">
                    <i class="ph ph-chat-circle-slash" style="font-size:56px; opacity:0.3; display:block; margin-bottom:16px;"></i>
                    <p style="font-weight:600; margin:0 0 6px;">Henüz destek mesajı yok</p>
                    <p style="font-size:12px; margin:0;">Kullanıcılar bir mesaj gönderdiğinde burada görünecek.</p>
                </div>`;
            return;
        }

        container.innerHTML = '';
        users.forEach(user => {
            const unread = user.unread_count || 0;
            const lastMsg = user.last_message || '';
            const lastTime = user.last_message_at
                ? parseDateUTC(user.last_message_at).toLocaleString('tr-TR', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' })
                : '';
            const initials = (user.first_name || 'U').charAt(0).toUpperCase();
            const isLastAdmin = user.last_sender === 'admin';

            const item = document.createElement('div');
            item.setAttribute('data-user-id', user.user_id);
            item.setAttribute('data-first-name', user.first_name || '');
            item.setAttribute('data-username', user.username || '');
            item.style.cssText = `
                display:flex; align-items:center; gap:12px;
                padding:12px 14px; border-radius:14px; cursor:pointer;
                background:var(--tg-secondary-bg-color);
                border:1px solid var(--glass-border); margin-bottom:8px;
                transition:background 0.15s, transform 0.1s;
            `;
            item.innerHTML = `
                <div style="
                    width:46px; height:46px; border-radius:50%; flex-shrink:0;
                    background:linear-gradient(135deg,#6366f1,#4f46e5);
                    display:flex; align-items:center; justify-content:center;
                    font-weight:700; color:#fff; font-size:18px; position:relative;
                ">
                    ${initials}
                    ${unread > 0 ? `<span style="
                        position:absolute; top:-2px; right:-2px;
                        background:#ef4444; color:#fff; border-radius:50%;
                        min-width:18px; height:18px; font-size:10px; font-weight:700;
                        display:flex; align-items:center; justify-content:center;
                        padding:0 4px; border:2px solid var(--tg-secondary-bg-color);
                    ">${unread}</span>` : ''}
                </div>
                <div style="flex:1; min-width:0;">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:3px;">
                        <span style="font-weight:700; font-size:14px; color:var(--tg-text-color);">
                            ${escapeHtmlAdmin(user.first_name || 'Kullanıcı')}
                            ${user.username ? `<span style="font-weight:400; font-size:11px; color:var(--tg-hint-color);">@${escapeHtmlAdmin(user.username)}</span>` : ''}
                        </span>
                        <span style="font-size:11px; color:var(--tg-hint-color); white-space:nowrap;">${lastTime}</span>
                    </div>
                    <div style="font-size:12px; color:var(--tg-hint-color); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
                        ${isLastAdmin ? '<span style="color:var(--tg-button-color); font-weight:600;">Sen: </span>' : ''}
                        ${escapeHtmlAdmin(lastMsg.substring(0, 60))}${lastMsg.length > 60 ? '...' : ''}
                    </div>
                </div>
                <i class="ph ph-caret-right" style="color:var(--tg-hint-color); font-size:14px; flex-shrink:0;"></i>
            `;

            item.addEventListener('pointerenter', () => { item.style.background = 'var(--glass-bg)'; item.style.transform = 'scale(1.01)'; });
            item.addEventListener('pointerleave', () => { item.style.background = 'var(--tg-secondary-bg-color)'; item.style.transform = 'scale(1)'; });
            item.addEventListener('click', () => {
                openSupportChat(user.user_id, user.first_name || 'Kullanıcı', user.username || '');
            });

            container.appendChild(item);
        });

    } catch(err) {
        console.error('Destek kullanıcıları yüklenemedi:', err);
        container.innerHTML = '<p style="color:var(--color-danger); padding:20px; text-align:center;">Bağlantı hatası.</p>';
    }
}

/**
 * Belirli bir kullanıcının chat penceresini açar.
 */
async function openSupportChat(userId, firstName, username) {
    currentSupportUserId = userId;
    currentSupportUserName = firstName;

    const listView = document.getElementById('support-user-list-view');
    const chatView = document.getElementById('support-chat-view');
    if (listView) listView.style.display = 'none';
    if (chatView) { chatView.style.display = 'flex'; }

    // Header bilgilerini güncelle
    const avatarEl = document.getElementById('support-chat-avatar');
    const nameEl = document.getElementById('support-chat-name');
    const idEl = document.getElementById('support-chat-id');
    if (avatarEl) avatarEl.textContent = (firstName || 'U').charAt(0).toUpperCase();
    if (nameEl) nameEl.textContent = firstName + (username ? ` @${username}` : '');
    if (idEl) idEl.textContent = `ID: ${userId}`;

    await loadSupportChatMessages(userId);

    // Input temizle
    const input = document.getElementById('support-reply-input');
    if (input) { input.value = ''; input.style.height = 'auto'; input.focus(); }
}

/**
 * Belirli bir kullanıcının chat mesajlarını yükler ve gösterir.
 */
async function loadSupportChatMessages(userId) {
    const msgBox = document.getElementById('support-chat-messages');
    if (!msgBox || !currentUserData) return;
    msgBox.innerHTML = '<p style="text-align:center; color:var(--tg-hint-color); padding:20px;">Yükleniyor...</p>';

    try {
        const res = await fetch(`/api/admin/support/chat/${userId}?tg_id=${currentUserData.telegram_id}`);
        const data = await res.json();

        if (!res.ok || !data.success) {
            msgBox.innerHTML = '<p style="text-align:center; color:var(--color-danger); padding:20px;">Yüklenemedi.</p>';
            return;
        }

        msgBox.innerHTML = '';

        if (data.messages.length === 0) {
            msgBox.innerHTML = `
                <div style="text-align:center; padding:40px 20px; color:var(--tg-hint-color); margin:auto;">
                    <i class="ph ph-chat-circle-dots" style="font-size:48px; opacity:0.3; display:block; margin-bottom:12px;"></i>
                    <p>Henüz mesaj yok.</p>
                </div>`;
            return;
        }

        data.messages.forEach(msg => {
            const isAdmin = msg.sender === 'admin';
            const timeStr = msg.created_at
                ? parseDateUTC(msg.created_at).toLocaleString('tr-TR', { hour:'2-digit', minute:'2-digit', day:'2-digit', month:'2-digit' })
                : '';

            const bubble = document.createElement('div');
            bubble.style.cssText = `
                display:flex; flex-direction:column; max-width:80%;
                align-self:${isAdmin ? 'flex-end' : 'flex-start'};
            `;
            bubble.innerHTML = `
                <div style="
                    padding:10px 14px; border-radius:${isAdmin ? '18px 18px 4px 18px' : '18px 18px 18px 4px'};
                    background:${isAdmin ? 'linear-gradient(135deg,#6366f1,#4f46e5)' : 'var(--tg-secondary-bg-color)'};
                    color:${isAdmin ? '#fff' : 'var(--tg-text-color)'};
                    font-size:14px; line-height:1.5; word-break:break-word;
                    box-shadow:0 1px 4px rgba(0,0,0,0.1);
                ">${escapeHtmlAdmin(msg.message)}</div>
                <div style="
                    font-size:10px; color:var(--tg-hint-color); margin-top:4px;
                    align-self:${isAdmin ? 'flex-end' : 'flex-start'};
                    padding:0 4px;
                ">${isAdmin ? '✓ Admin · ' : ''}${timeStr}</div>
            `;
            msgBox.appendChild(bubble);
        });

        // En alta kaydır
        msgBox.scrollTop = msgBox.scrollHeight;

    } catch(err) {
        console.error('Chat mesajları yüklenemedi:', err);
        msgBox.innerHTML = '<p style="color:var(--color-danger); padding:20px; text-align:center;">Bağlantı hatası.</p>';
    }
}

/**
 * Admin'in chat kutusundan mesaj göndermesini işler.
 */
async function adminSendSupportMessage() {
    if (!currentSupportUserId || !currentUserData) return;
    const input = document.getElementById('support-reply-input');
    if (!input) return;
    const msg = input.value.trim();
    if (!msg) return;

    input.disabled = true;
    const sendBtn = document.getElementById('btn-support-send');
    if (sendBtn) { sendBtn.style.opacity = '0.5'; sendBtn.style.transform = 'scale(0.9)'; }

    try {
        const res = await fetch('/api/admin/support/send-to-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_id: currentUserData.telegram_id,
                user_id: currentSupportUserId,
                message: msg
            })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            input.value = '';
            input.style.height = 'auto';
            await loadSupportChatMessages(currentSupportUserId);
        } else {
            showAlert('Mesaj gönderilemedi.');
            input.disabled = false;
        }
    } catch(err) {
        showAlert('Bağlantı hatası.');
        input.disabled = false;
    } finally {
        if (sendBtn) { sendBtn.style.opacity = '1'; sendBtn.style.transform = 'scale(1)'; }
        input.disabled = false;
    }
}

function escapeHtmlAdmin(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g,'&amp;')
        .replace(/</g,'&lt;')
        .replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;')
        .replace(/\n/g,'<br>');
}

// ─── Destek Chat Event Listener'ları ─────────────────────────────────────────

(function setupSupportChatEvents() {
    // Geri butonu: chat → kullanıcı listesi
    const backBtn = document.getElementById('btn-support-back');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            currentSupportUserId = null;
            const listView = document.getElementById('support-user-list-view');
            const chatView = document.getElementById('support-chat-view');
            if (chatView) chatView.style.display = 'none';
            if (listView) listView.style.display = 'block';
            // Kullanıcı listesini yenile (rozet güncellemesi için)
            loadAdminSupportMessages();
        });
    }

    // Mesaj gönder butonu
    const sendBtn = document.getElementById('btn-support-send');
    if (sendBtn) {
        sendBtn.addEventListener('click', adminSendSupportMessage);
    }

    // Textarea — Enter ile gönder (Shift+Enter = yeni satır), otomatik boy ayarı
    const textarea = document.getElementById('support-reply-input');
    if (textarea) {
        textarea.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                adminSendSupportMessage();
            }
        });
        textarea.addEventListener('input', () => {
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 100) + 'px';
        });
    }

    // Yenile butonu
    const refreshBtn = document.getElementById('btn-refresh-support');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (currentSupportUserId) {
                loadSupportChatMessages(currentSupportUserId);
            } else {
                loadAdminSupportMessages();
            }
        });
    }
})();





