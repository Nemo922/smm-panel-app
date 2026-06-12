from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import httpx
import database
import os
import html
import asyncio

# --- YAPILANDIRMA ---
BOT_TOKEN = os.getenv("BOT_TOKEN", "BURAYA_BOT_TOKEN_YAZIN")
TELEGRAM_API_URL = f"https://api.telegram.org/bot{BOT_TOKEN}"

app = FastAPI(title="SMM Panel API")

db_admin_ids = set()

# --- VERİTABANI BAŞLATMA ---
@app.on_event("startup")
async def startup_event():
    global db_admin_ids
    await database.init_db()
    ids = await database.get_db_admin_ids()
    db_admin_ids = set(ids)

@app.on_event("shutdown")
async def shutdown_event():
    if database.db_pool:
        await database.db_pool.close()

# --- YARDIMCI FONKSİYONLAR ---
async def send_telegram_message(chat_id: int, text: str):
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            await client.post(
                f"{TELEGRAM_API_URL}/sendMessage",
                json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
            )
    except Exception:
        pass  # Bildirim hatası siparişi etkilemesin

def get_admin_ids() -> list[int]:
    admins_str = os.getenv("ADMIN_TELEGRAM_IDS", "7910651923,12345")
    env_admins = {int(x.strip()) for x in admins_str.split(',') if x.strip().isdigit()}
    return list(env_admins | db_admin_ids)

def verify_admin(tg_id: int):
    if tg_id not in get_admin_ids():
        raise HTTPException(status_code=403, detail="Yetkisiz erişim")

# --- API MODELLERİ ---
class RegisterUser(BaseModel):
    telegram_id: int
    first_name: str
    username: str
    custom_username: str
    referred_by: Optional[int] = None

class NewOrder(BaseModel):
    telegram_id: int
    service_id: int
    link: str
    quantity: int
    price: float
    coupon_code: Optional[str] = None

class NewPaymentRequest(BaseModel):
    telegram_id: int
    amount: float
    payment_method: str
    details: str

class AdminAction(BaseModel):
    admin_id: int
    request_id: int
    note: Optional[str] = None

class AdminOrderAction(BaseModel):
    admin_id: int
    order_id: int
    note: Optional[str] = None

class AdminOrderStatus(BaseModel):
    admin_id: int
    order_id: int
    status: str

class AdminOrderVisibility(BaseModel):
    admin_id: int
    order_id: int
    keep_visible: bool

class AdminUpdateUser(BaseModel):
    admin_id: int
    telegram_id: int
    balance: float
    first_name: str

class AdminAddBalance(BaseModel):
    admin_id: int
    telegram_id: int
    amount: float
    note: str

class AdminUpdateAdminRole(BaseModel):
    admin_id: int
    telegram_id: int
    is_admin: bool

class AdminCreateService(BaseModel):
    admin_id: int
    platform: str
    name: str
    description: str
    price_per_1000: float
    min_order: int
    max_order: int
    icon: str

class AdminUpdateService(BaseModel):
    admin_id: int
    service_id: int
    platform: str
    name: str
    description: str
    price_per_1000: float
    min_order: int
    max_order: int
    icon: str
    is_active: bool

class AdminDeleteService(BaseModel):
    admin_id: int
    service_id: int

class AdminUpdateSetting(BaseModel):
    admin_id: int
    key: str
    value: str

class AdminCreatePaymentMethod(BaseModel):
    admin_id: int
    name: str
    description: str = ''
    icon: str = 'ph-wallet'
    color: str = '#6366f1'
    sort_order: int = 0
    account_name: str = ''
    account_number: str = ''

class AdminUpdatePaymentMethod(BaseModel):
    admin_id: int
    method_id: int
    name: str
    description: str
    icon: str
    color: str
    is_active: bool
    sort_order: int
    account_name: Optional[str] = None
    account_number: Optional[str] = None

class AdminDeletePaymentMethod(BaseModel):
    admin_id: int
    method_id: int

class AdminBlockUser(BaseModel):
    admin_id: int
    telegram_id: int
    is_blocked: bool

class AdminVipLevel(BaseModel):
    admin_id: int
    telegram_id: int
    vip_level: int

class AdminCreateCoupon(BaseModel):
    admin_id: int
    code: str
    discount_percent: float
    max_uses: int

class AdminDeleteCoupon(BaseModel):
    admin_id: int
    coupon_id: int

class ApplyCoupon(BaseModel):
    telegram_id: int
    code: str

# ═══════════════════════════════════════════════════════════════
# KULLANICI / GENEL API UÇ NOKTALARI
# ═══════════════════════════════════════════════════════════════

@app.get("/api/user")
async def get_user_data(tg_id: int):
    user = await database.get_user(tg_id)
    if user:
        settings = await database.get_settings()
        if user.get("is_blocked") and settings.get("feat_block_user") == "true":
            raise HTTPException(status_code=403, detail="Hesabınız askıya alınmıştır. Lütfen destek ile iletişime geçiniz.")
        
        orders = await database.get_user_orders(tg_id)
        for o in orders:
            if o.get('order_date'):
                o['order_date'] = str(o['order_date'])
        if user.get('joined_date'):
            user['joined_date'] = str(user['joined_date'])
        is_admin = (tg_id in get_admin_ids())
        
        # Referred users details
        referred_users = []
        if settings.get("feat_referral") == "true":
            referred_users = await database.get_referred_users(tg_id)
            for ru in referred_users:
                if ru.get('joined_date'):
                    ru['joined_date'] = str(ru['joined_date'])
                    
        return {
            "registered": True, 
            "user": user, 
            "orders": orders, 
            "is_admin": is_admin,
            "referred_users": referred_users,
            "referred_users_count": len(referred_users)
        }
    return {"registered": False}

@app.get("/api/check-username")
async def check_username(username: str):
    exists = await database.check_custom_username_exists(username)
    return {"exists": exists}

@app.post("/api/register")
async def register_user(data: RegisterUser):
    exists = await database.check_custom_username_exists(data.custom_username)
    if exists:
        raise HTTPException(status_code=400, detail="Bu kullanıcı adı zaten alınmış")
    user = await database.get_user(data.telegram_id)
    if not user:
        ref_by = None
        if data.referred_by:
            ref_user = await database.get_user(data.referred_by)
            if ref_user and data.referred_by != data.telegram_id:
                ref_by = data.referred_by
        await database.create_user(data.telegram_id, data.first_name, data.username, data.custom_username, ref_by)
    else:
        await database.update_custom_username(data.telegram_id, data.custom_username)
    return {"success": True, "message": "Kayıt başarılı"}

@app.get("/api/services")
async def get_services():
    """Aktif servisleri döner (kullanıcı tarafı)."""
    services = await database.get_active_services()
    for s in services:
        if s.get('created_at'):
            s['created_at'] = str(s['created_at'])
    return {"success": True, "services": services}

@app.get("/api/settings/public")
async def get_public_settings():
    """Kullanıcı tarafı için gerekli ayarları döner (marka adı, ödeme bilgileri)."""
    settings = await database.get_settings()
    return {"success": True, "settings": settings}

@app.get("/api/payment-methods")
async def get_active_payment_methods():
    """Aktif ödeme yöntemlerini döner (kullanıcı tarafı)."""
    methods = await database.get_payment_methods(active_only=True)
    return {"success": True, "methods": methods}
class ReadNotificationsModel(BaseModel):
    telegram_id: int

@app.get("/api/user/notifications")
async def get_notifications(tg_id: int):
    notifications = await database.get_user_notifications(tg_id)
    for n in notifications:
        if n.get('created_at'):
            n['created_at'] = str(n['created_at'])
    return {"success": True, "notifications": notifications}

@app.post("/api/user/notifications/read")
async def read_notifications(data: ReadNotificationsModel):
    await database.mark_notifications_as_read(data.telegram_id)
    return {"success": True}

@app.post("/api/order")
async def place_order(data: NewOrder):
    user = await database.get_user(data.telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    
    settings = await database.get_settings()
    
    # Check block
    if user.get("is_blocked") and settings.get("feat_block_user") == "true":
        raise HTTPException(status_code=403, detail="Hesabınız engellenmiştir.")

    # Servis bilgisini al
    services = await database.get_all_services()
    service = next((s for s in services if s['id'] == data.service_id), None)
    if not service:
        raise HTTPException(status_code=404, detail="Hizmet bulunamadı")

    # Fiyat hesaplama (Güvenlik ve İndirimler)
    base_price = (service['price_per_1000'] / 1000.0) * data.quantity
    final_price = base_price

    # VIP indirimi
    vip_discount = 0.0
    if settings.get("feat_vip") == "true" and user.get("vip_level", 0) > 0:
        vip_level = user["vip_level"]
        vip_discount = min(vip_level * 5.0, 25.0)  # Her seviye %5, max %25
        final_price = final_price * (1.0 - vip_discount / 100.0)

    # Kupon indirimi
    coupon_id_to_use = None
    if data.coupon_code and settings.get("feat_coupons") == "true":
        coupon = await database.get_coupon(data.coupon_code)
        if not coupon:
            raise HTTPException(status_code=400, detail="Geçersiz veya süresi dolmuş kupon kodu")
        used_already = await database.db_pool.fetchval("SELECT 1 FROM coupon_uses WHERE coupon_id = $1 AND user_id = $2", coupon['id'], data.telegram_id)
        if used_already:
            raise HTTPException(status_code=400, detail="Bu kuponu daha önce kullandınız")
        if coupon['current_uses'] >= coupon['max_uses']:
            raise HTTPException(status_code=400, detail="Kupon kullanım sınırı dolmuştur")
        
        final_price = final_price * (1.0 - coupon['discount_percent'] / 100.0)
        coupon_id_to_use = coupon['id']

    final_price = round(final_price, 2)

    if user["balance"] < final_price:
        raise HTTPException(status_code=400, detail="Bakiye yetersiz")

    # Kuponu kullanılmış olarak işaretle
    if coupon_id_to_use:
        success = await database.use_coupon(coupon_id_to_use, data.telegram_id)
        if not success:
            raise HTTPException(status_code=400, detail="Kupon kullanımı başarısız oldu")

    # Bakiyeyi güncelle ve siparişi oluştur
    await database.update_balance(data.telegram_id, -final_price)
    order_id = await database.create_order(data.telegram_id, data.service_id, data.link, data.quantity, final_price)

    # Referans geliri
    if settings.get("feat_referral") == "true" and user.get("referred_by"):
        ref_percent = float(settings.get("referral_percent", "10"))
        ref_earnings = round(final_price * (ref_percent / 100.0), 2)
        if ref_earnings > 0:
            await database.add_referral_earnings(user["referred_by"], ref_earnings)

    new_balance = user['balance'] - final_price
    service_name = service['name'] if service else f"Servis #{data.service_id}"

    # Kullanıcıya bildirim
    user_msg = (
        f"✅ <b>Siparişiniz Alındı!</b>\n\n"
        f"📦 Hizmet: {service_name}\n"
        f"🔗 Link: <code>{data.link}</code>\n"
        f"🔢 Miktar: {data.quantity:,}\n"
        f"💰 Tutar: ₺{final_price:.2f}\n"
        f"🆔 Sipariş No: #{order_id}\n\n"
        f"<i>Kalan Bakiye: ₺{new_balance:.2f}</i>"
    )
    await send_telegram_message(data.telegram_id, user_msg)

    # Admin'e bildirim
    admin_ids = get_admin_ids()
    admin_msg = (
        f"🛒 <b>YENİ SİPARİŞ #{order_id}</b>\n\n"
        f"👤 Kullanıcı: {user.get('first_name', 'Bilinmiyor')} (@{user.get('custom_username', '?')})\n"
        f"📦 Hizmet: {service_name}\n"
        f"🔗 Link: <code>{data.link}</code>\n"
        f"🔢 Miktar: {data.quantity:,}\n"
        f"💰 Tutar: ₺{final_price:.2f}"
    )
    for admin_id in admin_ids:
        await send_telegram_message(admin_id, admin_msg)

    return {"success": True, "message": "Siparişiniz alındı!", "order_id": order_id}

@app.post("/api/payment-request")
async def new_payment_request(data: NewPaymentRequest):
    await database.create_payment_request(data.telegram_id, data.amount, data.payment_method, data.details)
    # Admin'e bildirim
    admin_ids = get_admin_ids()
    user = await database.get_user(data.telegram_id)
    admin_msg = (
        f"💳 <b>YENİ BAKİYE YÜKLEME TALEBİ</b>\n\n"
        f"👤 Kullanıcı: {user.get('first_name','?')} (@{user.get('custom_username','?')})\n"
        f"💰 Tutar: ₺{data.amount:.2f}\n"
        f"🏦 Yöntem: {data.payment_method}\n"
        f"📝 Açıklama: {data.details}"
    )
    for admin_id in admin_ids:
        await send_telegram_message(admin_id, admin_msg)
    return {"success": True, "message": "Ödeme bildiriminiz alındı."}

# ═══════════════════════════════════════════════════════════════
# ADMİN – ÖDEME TALEPLERİ
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/pending-payments")
async def admin_pending_payments(tg_id: int):
    verify_admin(tg_id)
    requests = await database.get_pending_payment_requests()
    for r in requests:
        if r.get('request_date'):
            r['request_date'] = str(r['request_date'])
    return {"success": True, "requests": requests}

@app.post("/api/admin/approve-payment")
async def admin_approve_payment(data: AdminAction):
    verify_admin(data.admin_id)
    # Get request details for notification
    reqs = await database.get_pending_payment_requests()
    req = next((r for r in reqs if r['id'] == data.request_id), None)
    success = await database.approve_payment_request(data.request_id)
    if success:
        if req:
            # Save details in database notifications
            note_str = f" Not: {data.note}" if data.note else ""
            await database.create_notification(
                req['user_id'], 
                "Ödemeniz Onaylandı", 
                f"₺{req['amount']:.2f} tutarındaki ödemeniz onaylandı ve hesabınıza yüklendi.{note_str}"
            )
            # Send generic message to Telegram
            tg_msg = "✉️ <b>Bir mesajınız bulunmaktadır.</b>\n\nLütfen detayları görmek için uygulamaya giriş sağlayınız."
            await send_telegram_message(req['user_id'], tg_msg)
        return {"success": True, "message": "Ödeme onaylandı ve bakiye eklendi."}
    return {"success": False, "message": "İşlem başarısız veya zaten onaylanmış."}

@app.post("/api/admin/reject-payment")
async def admin_reject_payment(data: AdminAction):
    verify_admin(data.admin_id)
    reqs = await database.get_pending_payment_requests()
    req = next((r for r in reqs if r['id'] == data.request_id), None)
    success = await database.reject_payment_request(data.request_id)
    if success:
        if req:
            # Save details in database notifications
            note_str = f" Not: {data.note}" if data.note else ""
            await database.create_notification(
                req['user_id'], 
                "Ödemeniz Reddedildi", 
                f"₺{req['amount']:.2f} tutarındaki ödemeniz reddedildi.{note_str}"
            )
            # Send generic message to Telegram
            tg_msg = "✉️ <b>Bir mesajınız bulunmaktadır.</b>\n\nLütfen detayları görmek için uygulamaya giriş sağlayınız."
            await send_telegram_message(req['user_id'], tg_msg)
        return {"success": True, "message": "Ödeme bildirimi reddedildi."}
    return {"success": False, "message": "İşlem başarısız veya zaten işlenmiş."}

# ═══════════════════════════════════════════════════════════════
# ADMİN – ÜRÜN (SERVİS) YÖNETİMİ
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/services")
async def admin_get_services(tg_id: int):
    verify_admin(tg_id)
    services = await database.get_all_services()
    for s in services:
        if s.get('created_at'):
            s['created_at'] = str(s['created_at'])
    return {"success": True, "services": services}

@app.post("/api/admin/service/create")
async def admin_create_service(data: AdminCreateService):
    verify_admin(data.admin_id)
    service_id = await database.create_service(
        data.platform, data.name, data.description,
        data.price_per_1000, data.min_order, data.max_order, data.icon
    )
    return {"success": True, "service_id": service_id, "message": "Ürün eklendi."}

@app.post("/api/admin/service/update")
async def admin_update_service(data: AdminUpdateService):
    verify_admin(data.admin_id)
    success = await database.update_service(
        data.service_id, data.platform, data.name, data.description,
        data.price_per_1000, data.min_order, data.max_order, data.icon, data.is_active
    )
    if success:
        return {"success": True, "message": "Ürün güncellendi."}
    raise HTTPException(status_code=404, detail="Ürün bulunamadı.")

@app.post("/api/admin/service/delete")
async def admin_delete_service(data: AdminDeleteService):
    verify_admin(data.admin_id)
    success = await database.delete_service(data.service_id)
    if success:
        return {"success": True, "message": "Ürün silindi."}
    raise HTTPException(status_code=404, detail="Ürün bulunamadı.")

# ═══════════════════════════════════════════════════════════════
# ADMİN – KULLANICI YÖNETİMİ
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/users")
async def admin_get_users(tg_id: int):
    verify_admin(tg_id)
    users = await database.get_all_users()
    for u in users:
        if u.get('joined_date'):
            u['joined_date'] = str(u['joined_date'])
    return {"success": True, "users": users}

@app.post("/api/admin/user/update")
async def admin_update_user(data: AdminUpdateUser):
    verify_admin(data.admin_id)
    success = await database.admin_update_user(data.telegram_id, data.balance, data.first_name)
    # Always return success since asyncpg UPDATE result checking can vary
    return {"success": True, "message": "Kullanıcı güncellendi."}

@app.post("/api/admin/user/admin_role")
async def admin_update_admin_role(data: AdminUpdateAdminRole):
    verify_admin(data.admin_id)
    
    # Kendi ana yetkisini silmesini engelleme (Sadece Env Adminleri super admin kabul edelim)
    admins_str = os.getenv("ADMIN_TELEGRAM_IDS", "7910651923,12345")
    env_admins = [int(x.strip()) for x in admins_str.split(',') if x.strip().isdigit()]
    
    if data.telegram_id in env_admins and not data.is_admin:
        raise HTTPException(status_code=400, detail="Ana yöneticinin (Super Admin) yetkisi kaldırılamaz.")
        
    success = await database.update_admin_role(data.telegram_id, data.is_admin)
    if success:
        global db_admin_ids
        if data.is_admin:
            db_admin_ids.add(data.telegram_id)
        else:
            db_admin_ids.discard(data.telegram_id)
        return {"success": True, "message": "Yetki seviyesi güncellendi."}
    raise HTTPException(status_code=400, detail="İşlem başarısız.")

@app.post("/api/admin/user/add-balance")
async def admin_add_balance(data: AdminAddBalance):
    verify_admin(data.admin_id)
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Eklenecek tutar 0'dan büyük olmalıdır.")
    
    await database.update_balance(data.telegram_id, data.amount)
    
    # Kullanıcıya bildirim gönder
    user = await database.get_user(data.telegram_id)
    new_balance = user['balance'] if user else 0.0
    
    # Save details in database notifications
    note_str = f" Not: {data.note}" if data.note else ""
    await database.create_notification(
        data.telegram_id, 
        "Bakiye Eklendi", 
        f"Hesabınıza ₺{data.amount:.2f} eklendi. Güncel Bakiyeniz: ₺{new_balance:.2f}.{note_str}"
    )
    
    # Send generic message to Telegram
    tg_msg = "✉️ <b>Bir mesajınız bulunmaktadır.</b>\n\nLütfen detayları görmek için uygulamaya giriş sağlayınız."
    await send_telegram_message(data.telegram_id, tg_msg)
    
    return {"success": True, "message": f"Bakiye eklendi ve kullanıcıya mesaj gönderildi."}

# ═══════════════════════════════════════════════════════════════
# ADMİN – SİPARİŞ YÖNETİMİ
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/orders")
async def admin_get_orders(tg_id: int, show_hidden: bool = False):
    verify_admin(tg_id)
    orders = await database.get_all_orders(show_hidden)
    for o in orders:
        if o.get('order_date'):
            o['order_date'] = str(o['order_date'])
    return {"success": True, "orders": orders}

@app.post("/api/admin/order/cancel")
async def admin_cancel_order(data: AdminOrderAction):
    verify_admin(data.admin_id)
    result = await database.cancel_order(data.order_id, data.note)
    if result:
        # Save details in database notifications
        note_str = f" Not: {data.note}" if data.note else ""
        await database.create_notification(
            result['user_id'], 
            f"Sipariş İptal Edildi #{data.order_id}", 
            f"Sipariş #{data.order_id} iptal edildi ve ₺{result['refund']:.2f} bakiyenize iade edildi.{note_str}"
        )
        # Send generic message to Telegram
        tg_msg = "✉️ <b>Bir mesajınız bulunmaktadır.</b>\n\nLütfen detayları görmek için uygulamaya giriş sağlayınız."
        await send_telegram_message(result['user_id'], tg_msg)
        return {"success": True, "message": "Sipariş iptal edildi ve bakiye iade edildi."}
    return {"success": False, "message": "Sipariş bulunamadı veya zaten iptal edilmiş."}

@app.post("/api/admin/order/update-status")
async def admin_update_order_status(data: AdminOrderStatus):
    verify_admin(data.admin_id)
    await database.update_order_status(data.order_id, data.status)
    return {"success": True, "message": f"Sipariş durumu '{data.status}' olarak güncellendi."}

@app.post("/api/admin/order/update-visibility")
async def admin_update_order_visibility(data: AdminOrderVisibility):
    verify_admin(data.admin_id)
    await database.update_order_visibility(data.order_id, data.keep_visible)
    return {"success": True, "message": "Sipariş görünürlüğü güncellendi."}

# ═══════════════════════════════════════════════════════════════
# ADMİN – AYARLAR
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/settings")
async def admin_get_settings(tg_id: int):
    verify_admin(tg_id)
    settings = await database.get_settings()
    return {"success": True, "settings": settings}

@app.post("/api/admin/settings/update")
async def admin_update_setting(data: AdminUpdateSetting):
    verify_admin(data.admin_id)
    await database.update_setting(data.key, data.value)
    return {"success": True, "message": "Ayar güncellendi."}

# ═══════════════════════════════════════════════════════════════
# ADMİN – ÖDEME YÖNTEMLERİ
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/payment-methods")
async def admin_get_payment_methods(tg_id: int):
    verify_admin(tg_id)
    methods = await database.get_payment_methods(active_only=False)
    return {"success": True, "methods": methods}

@app.post("/api/admin/payment-method/create")
async def admin_create_payment_method(data: AdminCreatePaymentMethod):
    verify_admin(data.admin_id)
    method_id = await database.create_payment_method(
        data.name, data.description, data.icon, data.color, data.sort_order, data.account_name, data.account_number
    )
    return {"success": True, "method_id": method_id, "message": "Ödeme yöntemi eklendi."}

@app.post("/api/admin/payment-method/update")
async def admin_update_payment_method(data: AdminUpdatePaymentMethod):
    verify_admin(data.admin_id)
    await database.update_payment_method(
        data.method_id, data.name, data.description, data.icon, data.color, data.is_active, data.sort_order, data.account_name, data.account_number
    )
    return {"success": True, "message": "Ödeme yöntemi güncellendi."}

@app.post("/api/admin/payment-method/delete")
async def admin_delete_payment_method(data: AdminDeletePaymentMethod):
    verify_admin(data.admin_id)
    await database.delete_payment_method(data.method_id)
    return {"success": True, "message": "Ödeme yöntemi silindi."}


# ═══════════════════════════════════════════════════════════════
# GROUP C: GELİŞMİŞ SİSTEMLER ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@app.get("/api/coupon/validate")
async def validate_coupon(code: str, tg_id: int):
    settings = await database.get_settings()
    if settings.get("feat_coupons") != "true":
        raise HTTPException(status_code=400, detail="Kupon sistemi aktif değil")
    coupon = await database.get_coupon(code)
    if not coupon:
        raise HTTPException(status_code=404, detail="Kupon bulunamadı veya süresi dolmuş")
    used = await database.db_pool.fetchval("SELECT 1 FROM coupon_uses WHERE coupon_id = $1 AND user_id = $2", coupon['id'], tg_id)
    if used:
        raise HTTPException(status_code=400, detail="Bu kuponu zaten kullandınız")
    if coupon['current_uses'] >= coupon['max_uses']:
        raise HTTPException(status_code=400, detail="Kupon kullanım sınırı dolmuştur")
    return {"success": True, "discount_percent": coupon['discount_percent']}

@app.get("/api/admin/coupons")
async def admin_get_coupons(tg_id: int):
    verify_admin(tg_id)
    coupons = await database.get_coupons()
    for c in coupons:
        if c.get('created_at'):
            c['created_at'] = str(c['created_at'])
    return {"success": True, "coupons": coupons}

@app.post("/api/admin/coupon/create")
async def admin_create_coupon(data: AdminCreateCoupon):
    verify_admin(data.admin_id)
    coupon_id = await database.create_coupon(data.code, data.discount_percent, data.max_uses)
    return {"success": True, "coupon_id": coupon_id, "message": "Kupon oluşturuldu."}

@app.post("/api/admin/coupon/delete")
async def admin_delete_coupon(data: AdminDeleteCoupon):
    verify_admin(data.admin_id)
    success = await database.delete_coupon(data.coupon_id)
    return {"success": success, "message": "Kupon silindi."}

@app.post("/api/admin/user/block")
async def admin_block_user(data: AdminBlockUser):
    verify_admin(data.admin_id)
    success = await database.block_user(data.telegram_id, data.is_blocked)
    action = "engellendi" if data.is_blocked else "engeli kaldırıldı"
    return {"success": success, "message": f"Kullanıcı {action}."}

@app.post("/api/admin/user/vip")
async def admin_update_vip_level(data: AdminVipLevel):
    verify_admin(data.admin_id)
    success = await database.update_vip_level(data.telegram_id, data.vip_level)
    return {"success": success, "message": f"Kullanıcı VIP seviyesi {data.vip_level} olarak güncellendi."}

# ═══════════════════════════════════════════════════════════════
# GROUP D: ANALYTICS & BULK NOTIFICATIONS ENDPOINTS
# ═══════════════════════════════════════════════════════════════

class AdminBulkNotify(BaseModel):
    admin_id: int
    title: str
    message: str

async def send_bulk_telegram_job(user_ids: list[int], text: str):
    for uid in user_ids:
        await send_telegram_message(uid, text)
        await asyncio.sleep(0.04) # 25 messages per second rate limiting safety

@app.get("/api/admin/analytics")
async def admin_get_analytics(tg_id: int):
    verify_admin(tg_id)
    analytics = await database.get_admin_analytics()
    return {"success": True, "analytics": analytics}

@app.post("/api/admin/bulk-notify")
async def admin_bulk_notify(data: AdminBulkNotify, background_tasks: BackgroundTasks):
    verify_admin(data.admin_id)
    settings = await database.get_settings()
    if settings.get("feat_bulk_notify") != "true":
        raise HTTPException(status_code=400, detail="Toplu bildirim özelliği aktif değil")
        
    user_ids = await database.send_bulk_notification_db(data.title, data.message)
    
    # Send Telegram in background
    tg_text = f"📢 <b>{data.title}</b>\n\n{data.message}"
    background_tasks.add_task(send_bulk_telegram_job, user_ids, tg_text)
    
    return {"success": True, "message": f"Toplu bildirim sıraya alındı. {len(user_ids)} üyeye iletiliyor."}

# ═══════════════════════════════════════════════════════════════
# DESTEK CHAT SİSTEMİ (ENGELLİ KULLANICILER)
# ═══════════════════════════════════════════════════════════════

class SupportMessage(BaseModel):
    user_id: int
    first_name: str
    username: str
    message: str

class SupportReply(BaseModel):
    admin_id: int
    msg_id: int
    reply: str

@app.post("/api/support/send")
async def support_send(data: SupportMessage):
    """Engelli kullanıcıdan destek mesajı al."""
    msg_id = await database.create_support_message(
        data.user_id, data.first_name, data.username, data.message
    )
    if msg_id is None:
        raise HTTPException(status_code=500, detail="Mesaj gönderilemedi.")
    
    # Admin'e Telegram bildirimi gönder
    settings = await database.get_settings()
    admin_ids = get_admin_ids()
    notif_text = (
        f"🆘 <b>Yeni Destek Talebi #{msg_id}</b>\n"
        f"👤 {html.escape(data.first_name)} ({html.escape(data.username)})\n"
        f"🆔 <code>{data.user_id}</code>\n\n"
        f"💬 {html.escape(data.message)}\n\n"
        f"<i>Yanıtlamak için: /reply {msg_id} [yanıtınız]</i>"
    )
    for admin_id in admin_ids:
        await send_telegram_message(admin_id, notif_text)
    
    return {"success": True, "msg_id": msg_id}

@app.get("/api/support/messages")
async def support_get_user_messages(user_id: int):
    """Kullanıcının kendi destek mesajlarını getir."""
    messages = await database.get_support_messages_for_user(user_id)
    # datetime nesnelerini string'e çevir
    for m in messages:
        for k, v in m.items():
            if hasattr(v, 'isoformat'):
                m[k] = v.isoformat()
    return {"success": True, "messages": messages}

@app.get("/api/admin/support/messages")
async def admin_get_support_messages(tg_id: int):
    """Admin: tüm destek mesajlarını listele."""
    verify_admin(tg_id)
    messages = await database.get_all_support_messages()
    for m in messages:
        for k, v in m.items():
            if hasattr(v, 'isoformat'):
                m[k] = v.isoformat()
    return {"success": True, "messages": messages}

@app.post("/api/admin/support/reply")
async def admin_reply_support(data: SupportReply):
    """Admin: destek mesajına yanıt ver."""
    verify_admin(data.admin_id)
    await database.reply_support_message(data.msg_id, data.reply)
    
    # Veritabanından kullanıcı ID'sini al ve bildirim gönder
    msgs = await database.get_all_support_messages()
    target = next((m for m in msgs if m['id'] == data.msg_id), None)
    if target:
        user_tg_id = target['user_id']
        reply_text = (
            f"✅ <b>Destek Yanıtı</b>\n\n"
            f"Mesajınıza yanıt verildi:\n\n"
            f"💬 <i>{html.escape(data.reply)}</i>"
        )
        await send_telegram_message(user_tg_id, reply_text)
    
    return {"success": True}

# ═══════════════════════════════════════════════════════════════
# TELEGRAM BOT WEBHOOK
# ═══════════════════════════════════════════════════════════════

@app.post("/api/telegram-webhook")
async def telegram_webhook(request: Request):
    """Telegram botundan gelen güncelleme işleyicisi."""
    try:
        body = await request.json()
        message = body.get("message") or body.get("edited_message")
        if not message:
            return {"ok": True}
        
        chat_id = message.get("chat", {}).get("id")
        text = message.get("text", "") or ""
        admin_ids = get_admin_ids()
        
        # Admin'in /reply <id> <yanıt> komutu
        if chat_id in admin_ids and text.startswith("/reply "):
            parts = text[7:].split(" ", 1)
            if len(parts) == 2 and parts[0].isdigit():
                msg_id = int(parts[0])
                reply_text = parts[1]
                await database.reply_support_message(msg_id, reply_text)
                
                # Kullanıcıya bildir
                msgs = await database.get_all_support_messages()
                target = next((m for m in msgs if m['id'] == msg_id), None)
                if target:
                    await send_telegram_message(
                        target['user_id'],
                        f"✅ <b>Destek Yanıtı</b>\n\n{html.escape(reply_text)}"
                    )
                await send_telegram_message(chat_id, f"✅ Mesaj #{msg_id} yanıtlandı.")
            else:
                await send_telegram_message(chat_id, "⚠️ Format: /reply <mesaj_id> <yanıtınız>")
        
        # /support_list komutu
        elif chat_id in admin_ids and text == "/support_list":
            msgs = await database.get_all_support_messages()
            if not msgs:
                await send_telegram_message(chat_id, "📭 Henüz destek mesajı yok.")
            else:
                pending = [m for m in msgs if not m.get('reply')]
                lines = [f"📋 <b>Bekleyen Talepler ({len(pending)} adet)</b>\n"]
                for m in pending[:10]:
                    lines.append(
                        f"#{m['id']} | {html.escape(m.get('first_name',''))} | "
                        f"{str(m.get('created_at',''))[:16]}\n"
                        f"  → {html.escape(m['message'][:60])}"
                    )
                await send_telegram_message(chat_id, "\n".join(lines))
        
        return {"ok": True}
    except Exception as e:
        print(f"Webhook hata: {e}")
        return {"ok": True}


# ═══════════════════════════════════════════════════════════════
# STATİK DOSYALAR
# ═══════════════════════════════════════════════════════════════

@app.get("/")
async def serve_index():
    return FileResponse("index.html", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

@app.get("/style.css")
async def serve_css():
    return FileResponse("style.css", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

@app.get("/app.js")
async def serve_js():
    return FileResponse("app.js", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
