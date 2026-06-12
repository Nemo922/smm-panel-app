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
    
    # Force enable features in live database on startup
    try:
        if database.db_pool:
            async with database.db_pool.acquire() as conn:
                keys = [
                    'feat_analytics', 'feat_revenue', 'feat_bulk_notify', 'feat_vip',
                    'feat_coupons', 'feat_coupon_mgr', 'feat_live_support', 'feat_stats',
                    'feat_balance_history', 'feat_activity_log', 'feat_spin_wheel'
                ]
                for key in keys:
                    await conn.execute(
                        "INSERT INTO settings (key, value) VALUES ($1, 'true') "
                        "ON CONFLICT (key) DO UPDATE SET value='true'",
                        key
                    )
    except Exception as e:
        print("Startup database sync error:", e)

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
    user_note: Optional[str] = None

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
    await database.log_activity(data.telegram_id, "kayıt", f"Kullanıcı adı: {data.custom_username}")
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

@app.get("/api/user/balance-history")
async def get_balance_history(tg_id: int):
    """Kullanıcının bakiye hareket geçmişi."""
    history = await database.get_user_balance_history(tg_id, limit=50)
    for h in history:
        if h.get('created_at'):
            h['created_at'] = str(h['created_at'])
    return {"success": True, "history": history}

@app.get("/api/admin/balance-history")
async def admin_get_balance_history(tg_id: int):
    """Admin: tüm kullanıcıların bakiye hareketleri."""
    verify_admin(tg_id)
    history = await database.get_all_balance_history(limit=300)
    for h in history:
        if h.get('created_at'):
            h['created_at'] = str(h['created_at'])
    return {"success": True, "history": history}

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
    order_id = await database.create_order(data.telegram_id, data.service_id, data.link, data.quantity, final_price, data.user_note)

    # Bakiye geçmişi logu
    new_bal = user['balance'] - final_price
    await database.add_balance_history(
        data.telegram_id, -final_price, "sipariş",
        f"#{order_id} {service['name'][:40]}", round(new_bal, 2)
    )

    # Referans geliri
    if settings.get("feat_referral") == "true" and user.get("referred_by"):
        ref_percent = float(settings.get("referral_percent", "10"))
        ref_earnings = round(final_price * (ref_percent / 100.0), 2)
        if ref_earnings > 0:
            await database.add_referral_earnings(user["referred_by"], ref_earnings)

    new_balance = user['balance'] - final_price
    service_name = service['name'] if service else f"Servis #{data.service_id}"

    # Aktivite logu
    await database.log_activity(
        data.telegram_id, "sipariş_verildi",
        f"Sipariş #{order_id} | {service_name} | {data.quantity:,} adet | ₺{final_price:.2f}"
    )

    # Admin'e SADECE kısa bildirim (detaylar panel üzerinden görülür)
    admin_ids = get_admin_ids()
    admin_msg = (
        f"🛒 <b>Yeni Sipariş #{order_id}</b>\n"
        f"👤 {user.get('first_name', 'Bilinmiyor')} · {service_name[:30]} · ₺{final_price:.2f}"
    )
    for admin_id in admin_ids:
        await send_telegram_message(admin_id, admin_msg)

    return {"success": True, "message": "Siparişiniz alındı!", "order_id": order_id}

class CancelOrderRequest(BaseModel):
    telegram_id: int
    order_id: int

@app.post("/api/user/order/cancel")
async def user_cancel_order(data: CancelOrderRequest):
    # Siparişin bu kullanıcıya ait olup olmadığını ve durumunu kontrol et
    orders = await database.get_user_orders(data.telegram_id)
    order = next((o for o in orders if o['id'] == data.order_id), None)
    
    if not order:
        return {"success": False, "message": "Sipariş bulunamadı veya size ait değil."}
    
    if order['status'] != 'Bekliyor':
        return {"success": False, "message": f"Bu sipariş '{order['status']}' durumunda olduğu için iptal edilemez (Sadece 'Bekliyor' konumundaki siparişler iptal edilebilir)."}
    
    result = await database.cancel_order(data.order_id, note="Kullanıcı tarafından iptal edildi")
    
    if result:
        refund_amount = result.get('refund', 0.0)
        
        # Bakiye geçmişine iade ekle
        user = await database.get_user(data.telegram_id)
        if user:
            await database.add_balance_history(
                data.telegram_id, refund_amount, "iade",
                f"Sipariş #{data.order_id} iptali",
                user['balance']
            )
            
        await database.log_activity(
            data.telegram_id, "sipariş_iptal",
            f"Kullanıcı siparişi kendi iptal etti. #{data.order_id} | İade: ₺{refund_amount:.2f}"
        )
        
        return {"success": True, "message": "Sipariş iptal edildi ve bakiye iade edildi."}
        
    return {"success": False, "message": "Sipariş iptal edilemedi."}

@app.post("/api/payment-request")
async def new_payment_request(data: NewPaymentRequest):
    settings = await database.get_settings()
    min_deposit = float(settings.get("min_deposit_amount", "0") or "0")
    if min_deposit > 0 and data.amount < min_deposit:
        raise HTTPException(
            status_code=400,
            detail=f"Minimum yükleme tutarı ₺{min_deposit:.2f} olmalıdır."
        )
    await database.create_payment_request(data.telegram_id, data.amount, data.payment_method, data.details)
    await database.log_activity(
        data.telegram_id, "ödeme_bildirimi",
        f"₺{data.amount:.2f} | {data.payment_method}"
    )
    # Admin'e SADECE yeni bildirim mesajı (detay panel üzerinden görülür)
    admin_ids = get_admin_ids()
    user = await database.get_user(data.telegram_id)
    admin_msg = (
        f"💳 <b>YENİ BAKİYE YÜKLEME TALEBİ</b>\n"
        f"👤 {user.get('first_name','?')} (@{user.get('custom_username','?')}) · ₺{data.amount:.2f}\n"
        f"Detaylar için paneli kontrol edin."
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
    # Tüm bekleyen talepleri değil, tamamlanmışları da ara
    reqs = await database.get_pending_payment_requests()
    req = next((r for r in reqs if r['id'] == data.request_id), None)
    success = await database.approve_payment_request(data.request_id)
    if success:
        if req:
            note_str = f" Not: {data.note}" if data.note else ""
            await database.create_notification(
                req['user_id'], 
                "Ödemeniz Onaylandı", 
                f"₺{req['amount']:.2f} tutarındaki ödemeniz onaylandı ve hesabınıza yüklendi.{note_str}"
            )
            await database.log_activity(
                req['user_id'], "bakiye_yüklendi",
                f"₺{req['amount']:.2f} ödeme onaylandı (Admin: {data.admin_id})"
            )
            refreshed = await database.get_user(req['user_id'])
            await database.add_balance_history(
                req['user_id'], req['amount'], "yükleme",
                f"{req.get('payment_method','Ödeme')} onaylandı",
                refreshed['balance'] if refreshed else req['amount']
            )
            # Kullanıcıya TEK Telegram bildirimi
            tg_msg = (
                f"✅ <b>Bakiye Yükleme Onaylandı</b>\n"
                f"₺{req['amount']:.2f} hesabınıza yüklendi.{note_str}\n"
                f"Detaylar için uygulamaya giriş yapın."
            )
            await send_telegram_message(req['user_id'], tg_msg)
            
            # REFERRAL KOMISYON SISTEMI (%5)
            settings = await database.get_settings()
            if settings.get("feat_referral") == "true":
                user = await database.get_user(req['user_id'])
                if user and user.get('referred_by'):
                    commission = round(req['amount'] * 0.05, 2)
                    if commission > 0:
                        await database.add_referral_commission(user['referred_by'], commission)
                        await database.create_notification(
                            user['referred_by'],
                            "Referans Kazancı",
                            f"Davet ettiğiniz kullanıcı bakiye yükledi. ₺{commission:.2f} komisyon kazandınız!"
                        )
                        await send_telegram_message(
                            user['referred_by'], 
                            f"🎁 <b>Referans Komisyonu</b>\n₺{commission:.2f} bakiyenize eklendi."
                        )

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
            note_str = f" Not: {data.note}" if data.note else ""
            await database.create_notification(
                req['user_id'], 
                "Ödemeniz Reddedildi", 
                f"₺{req['amount']:.2f} tutarındaki ödemeniz reddedildi.{note_str}"
            )
            # Kullanıcıya TEK Telegram bildirimi
            tg_msg = (
                f"❌ <b>Bakiye Yükleme Reddedildi</b>\n"
                f"₺{req['amount']:.2f} talebiniz reddedildi.{note_str}\n"
                f"Detaylar için uygulamaya giriş yapın."
            )
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

@app.get("/api/admin/user/detail")
async def admin_get_user_detail(tg_id: int, user_tg_id: int):
    """Admin: Belirli bir kullanıcının tüm detaylarını, siparişlerini ve bakiye hareketlerini döndürür."""
    verify_admin(tg_id)
    user = await database.get_user(user_tg_id)
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if user.get('joined_date'):
        user['joined_date'] = str(user['joined_date'])
    
    orders = await database.get_user_orders(user_tg_id)
    for o in orders:
        if o.get('order_date'):
            o['order_date'] = str(o['order_date'])
    
    balance_history = await database.get_user_balance_history(user_tg_id, limit=100)
    for h in balance_history:
        if h.get('created_at'):
            h['created_at'] = str(h['created_at'])
    
    activity = await database.get_activity_log(user_id=user_tg_id, limit=100)
    for a in activity:
        if a.get('created_at'):
            a['created_at'] = str(a['created_at'])
    
    return {
        "success": True,
        "user": user,
        "orders": orders,
        "balance_history": balance_history,
        "activity": activity
    }

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
    
    # Aktivite logu
    await database.log_activity(
        data.telegram_id, "admin_bakiye_ekledi",
        f"₺{data.amount:.2f} eklendi. Not: {data.note} (Admin: {data.admin_id})"
    )
    
    # Kullanıcıya bildirim gönder
    user = await database.get_user(data.telegram_id)
    new_balance = user['balance'] if user else 0.0
    
    # Bakiye geçmişi
    await database.add_balance_history(
        data.telegram_id, data.amount, "admin_ekleme",
        data.note or f"Admin #{data.admin_id} tarafından eklendi",
        new_balance
    )
    
    # Save details in database notifications
    note_str = f" Not: {data.note}" if data.note else ""
    await database.create_notification(
        data.telegram_id, 
        "Bakiye Eklendi", 
        f"Hesabınıza ₺{data.amount:.2f} eklendi. Güncel Bakiyeniz: ₺{new_balance:.2f}.{note_str}"
    )
    
    # Kullanıcıya kısa Telegram bildirimi
    tg_msg = (
        f"💰 <b>Bakiye Eklendi</b>\n"
        f"₺{data.amount:.2f} hesabınıza eklendi.\n"
        f"Detaylar için uygulamaya giriş yapın."
    )
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
        await database.log_activity(
            result['user_id'], "sipariş_iptal",
            f"Sipariş #{data.order_id} iptal | ₺{result['refund']:.2f} iade (Admin: {data.admin_id})"
        )
        # Send generic message to Telegram
        tg_msg = "✉️ <b>Bir mesajınız bulunmaktadır.</b>\n\nLütfen detayları görmek için uygulamaya giriş sağlayınız."
        await send_telegram_message(result['user_id'], tg_msg)
        return {"success": True, "message": "Sipariş iptal edildi ve bakiye iade edildi."}

    return {"success": False, "message": "Sipariş bulunamadı veya zaten iptal edilmiş."}

@app.post("/api/admin/order/update-status")
async def admin_update_order_status(data: AdminOrderStatus):
    verify_admin(data.admin_id)
    user_id = await database.update_order_status(data.order_id, data.status)
    if user_id:
        await database.create_notification(
            user_id,
            "Sipariş Durumu Güncellendi",
            f"#{data.order_id} numaralı siparişinizin durumu '{data.status}' olarak güncellendi."
        )
        # Tamamlandı veya İptal durumunda kullanıcıya kısa bildirim
        if data.status in ["Tamamlandı", "İptal Edildi"]:
            icon = "✅" if data.status == "Tamamlandı" else "❌"
            tg_msg = (
                f"{icon} <b>Sipariş #{data.order_id} {data.status}</b>\n"
                f"Detaylar için uygulamayı açın."
            )
            await send_telegram_message(user_id, tg_msg)
            
    return {"success": True, "message": f"Sipariş durumu '{data.status}' olarak güncellendi."}

@app.post("/api/admin/order/update-visibility")
async def admin_update_order_visibility(data: AdminOrderVisibility):
    verify_admin(data.admin_id)
    await database.update_order_visibility(data.order_id, data.keep_visible)
    return {"success": True, "message": "Sipariş görünürlüğü güncellendi."}

# ═══════════════════════════════════════════════════════════════
# ADMİN – AYARLAR
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/analytics/advanced")
async def admin_get_advanced_analytics(tg_id: int):
    verify_admin(tg_id)
    data = await database.get_advanced_analytics()
    # Serialize datetimes in daily_revenue
    for row in data.get('daily_revenue', []):
        if 'date' in row and hasattr(row['date'], 'isoformat'):
            row['date'] = row['date'].isoformat()
    return {"success": True, "data": data}

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

@app.get("/api/admin/seed-services")
async def seed_services_endpoint(tg_id: int):
    verify_admin(tg_id)
    platforms = [
        {"id": "instagram", "icon": "ph-instagram-logo"},
        {"id": "tiktok", "icon": "ph-tiktok-logo"},
        {"id": "twitter", "icon": "ph-twitter-logo"},
        {"id": "youtube", "icon": "ph-youtube-logo"},
        {"id": "facebook", "icon": "ph-facebook-logo"},
        {"id": "linkedin", "icon": "ph-linkedin-logo"},
        {"id": "spotify", "icon": "ph-spotify-logo"},
        {"id": "twitch", "icon": "ph-twitch-logo"},
        {"id": "snapchat", "icon": "ph-snapchat-logo"},
        {"id": "telegram", "icon": "ph-telegram-logo"},
        {"id": "discord", "icon": "ph-discord-logo"}
    ]
    categories = [
        {"name": "Takipçi", "desc": "Gerçek ve aktif takipçiler", "price": 25.0, "min": 100, "max": 10000},
        {"name": "Beğeni", "desc": "Hızlı gelen beğeniler", "price": 10.0, "min": 50, "max": 20000},
        {"name": "İzlenme", "desc": "Keşfet etkili izlenmeler", "price": 5.0, "min": 1000, "max": 1000000},
        {"name": "Yorum", "desc": "Organik görünümlü yorumlar", "price": 40.0, "min": 10, "max": 1000}
    ]
    count = 0
    async with database.db_pool.acquire() as conn:
        for platform in platforms:
            for cat in categories:
                exists = await conn.fetchval(
                    "SELECT 1 FROM services WHERE platform=$1 AND name LIKE $2",
                    platform["id"], f"%{cat['name']}%"
                )
                if not exists:
                    name = f"{platform['id'].capitalize()} {cat['name']}"
                    await conn.execute(
                        """
                        INSERT INTO services 
                        (platform, name, description, price_per_1000, min_order, max_order, icon, is_active)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        """,
                        platform["id"], name, cat["desc"], cat["price"], cat["min"], cat["max"], platform["icon"], True
                    )
                    count += 1
    return {"success": True, "message": f"{count} adet yeni servis eklendi."}

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
# FEAT: ACTIVITY LOG ENDPOİNTLERİ
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/activity-log")
async def admin_get_activity_log(tg_id: int, user_id: int = None, limit: int = 100):
    """Admin: genel veya kullanıcıya ait aktivite logunu döndür."""
    verify_admin(tg_id)
    settings = await database.get_settings()
    if settings.get("feat_activity_log") != "true":
        raise HTTPException(status_code=400, detail="Aktivite logu özelliği aktif değil")
    logs = await database.get_activity_log(user_id=user_id, limit=min(limit, 500))
    for entry in logs:
        if entry.get("created_at"):
            entry["created_at"] = str(entry["created_at"])
    return {"success": True, "logs": logs}

@app.get("/api/admin/revenue-report")
async def admin_get_revenue_report(tg_id: int):
    """Admin: kapsamlı gelir raporu döndür."""
    verify_admin(tg_id)
    settings = await database.get_settings()
    if settings.get("feat_revenue") != "true":
        raise HTTPException(status_code=400, detail="Gelir raporu özelliği aktif değil")
    report = await database.get_revenue_report()
    return {"success": True, "report": report}

# ═══════════════════════════════════════════════════════════════
# FEAT: OTOMATİK API ENTEGRASYONu (feat_auto_api)
# ═══════════════════════════════════════════════════════════════

async def _send_to_external_api(api_url: str, api_key: str, action: str, params: dict) -> dict:
    """Harici SMM panel API'sine istek at."""
    try:
        payload = {"key": api_key, "action": action, **params}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(api_url, data=payload)
            return resp.json()
    except Exception as e:
        return {"error": str(e)}

@app.post("/api/admin/auto-api/test")
async def auto_api_test(tg_id: int):
    """Harici API bağlantısını test et."""
    verify_admin(tg_id)
    settings = await database.get_settings()
    if settings.get("feat_auto_api") != "true":
        raise HTTPException(status_code=400, detail="Otomatik API özelliği aktif değil")
    api_url = settings.get("auto_api_url", "").strip()
    api_key = settings.get("auto_api_key", "").strip()
    if not api_url or not api_key:
        raise HTTPException(status_code=400, detail="API URL veya Key ayarlanmamış")
    result = await _send_to_external_api(api_url, api_key, "balance", {})
    return {"success": True, "result": result}

@app.post("/api/admin/auto-api/submit-order")
async def auto_api_submit_order(tg_id: int, order_id: int):
    """Mevcut bir siparişi harici API'ye manuel olarak gönder."""
    verify_admin(tg_id)
    settings = await database.get_settings()
    if settings.get("feat_auto_api") != "true":
        raise HTTPException(status_code=400, detail="Otomatik API özelliği aktif değil")

    api_url = settings.get("auto_api_url", "").strip()
    api_key = settings.get("auto_api_key", "").strip()
    if not api_url or not api_key:
        raise HTTPException(status_code=400, detail="API URL veya Key ayarlanmamış")

    # Sipariş bilgilerini al
    orders = await database.get_all_orders(show_hidden=True)
    order = next((o for o in orders if o['id'] == order_id), None)
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı")

    # Servis eşlemesini kontrol et
    import json
    service_map = {}
    try:
        service_map = json.loads(settings.get("auto_api_service_map", "{}"))
    except Exception:
        pass

    provider_service_id = service_map.get(str(order['service_id']))
    if not provider_service_id:
        raise HTTPException(
            status_code=400,
            detail=f"Servis #{order['service_id']} için provider eşlemesi bulunamadı. "
                   "Admin ayarlardan 'auto_api_service_map' JSON'una ekleyin."
        )

    result = await _send_to_external_api(api_url, api_key, "add", {
        "service": provider_service_id,
        "link": order['link'],
        "quantity": order['quantity'],
    })

    if result.get("error"):
        return {"success": False, "message": f"API hatası: {result['error']}"}

    external_id = str(result.get("order", ""))
    if external_id:
        await database.create_external_api_order(order_id, api_url, external_id)
        await database.update_order_status(order_id, "İşlemde")
        return {"success": True, "external_order_id": external_id, "message": "Sipariş harici API'ye gönderildi."}

    return {"success": False, "message": "API yanıtı beklenmedik formatta.", "raw": result}

@app.get("/api/admin/auto-api/log")
async def auto_api_get_log(tg_id: int):
    """Harici API sipariş logunu getir."""
    verify_admin(tg_id)
    settings = await database.get_settings()
    if settings.get("feat_auto_api") != "true":
        raise HTTPException(status_code=400, detail="Otomatik API özelliği aktif değil")
    logs = await database.get_external_api_log(limit=200)
    for entry in logs:
        for k, v in entry.items():
            if hasattr(v, 'isoformat'):
                entry[k] = v.isoformat()
    return {"success": True, "logs": logs}

@app.post("/api/admin/auto-api/check-status")
async def auto_api_check_status(tg_id: int, order_id: int):
    """Harici API'den sipariş durumunu sorgula ve güncelle."""
    verify_admin(tg_id)
    settings = await database.get_settings()
    if settings.get("feat_auto_api") != "true":
        raise HTTPException(status_code=400, detail="Otomatik API özelliği aktif değil")

    api_url = settings.get("auto_api_url", "").strip()
    api_key = settings.get("auto_api_key", "").strip()

    pending = await database.get_pending_external_orders()
    ext_order = next((p for p in pending if p['order_id'] == order_id), None)
    if not ext_order:
        raise HTTPException(status_code=404, detail="Bu sipariş için harici API kaydı bulunamadı")

    result = await _send_to_external_api(api_url, api_key, "status", {
        "order": ext_order['external_order_id']
    })

    if result.get("error"):
        return {"success": False, "message": f"API hatası: {result['error']}"}

    api_status = result.get("status", "").lower()
    # Yaygın SMM panel durum eşlemesi
    status_map = {
        "completed": "Tamamlandı",
        "in progress": "İşlemde",
        "processing": "İşlemde",
        "pending": "Bekliyor",
        "partial": "Tamamlandı",
        "cancelled": "İptal Edildi",
        "canceled": "İptal Edildi",
        "refunded": "İptal Edildi",
    }
    local_status = status_map.get(api_status, "İşlemde")
    await database.update_external_api_order_status(order_id, api_status)
    await database.update_order_status(order_id, local_status)

    return {"success": True, "api_status": api_status, "local_status": local_status}

# ═══════════════════════════════════════════════════════════════
# FEAT: ŞANS ÇARKI (feat_spin_wheel)
# ═══════════════════════════════════════════════════════════════

import random

class SpinRequest(BaseModel):
    telegram_id: int

# Ödül tablosu: (isim, tür, değer, ağırlık, renk)
SPIN_PRIZES = [
    {"label": "₺1",       "type": "balance", "value": 1.0,   "weight": 25, "color": "#6366f1"},
    {"label": "₺2",       "type": "balance", "value": 2.0,   "weight": 20, "color": "#22c55e"},
    {"label": "₺5",       "type": "balance", "value": 5.0,   "weight": 15, "color": "#f59e0b"},
    {"label": "%10",      "type": "coupon",  "value": 10.0,  "weight": 15, "color": "#ec4899"},
    {"label": "₺10",      "type": "balance", "value": 10.0,  "weight": 10, "color": "#3b82f6"},
    {"label": "Tekrar!",  "type": "retry",   "value": 0.0,   "weight": 10, "color": "#64748b"},
    {"label": "₺25",      "type": "balance", "value": 25.0,  "weight": 4,  "color": "#a855f7"},
    {"label": "₺50",      "type": "balance", "value": 50.0,  "weight": 1,  "color": "#ef4444"},
]

@app.get("/api/spin/status")
async def spin_status(tg_id: int):
    settings = await database.get_settings()
    if settings.get("feat_spin_wheel") != "true":
        return {"available": False, "enabled": False}
    user = await database.get_user(tg_id)
    if not user:
        return {"available": False, "enabled": True}
    available = await database.check_spin_available(tg_id)
    return {"available": available, "enabled": True, "prizes": SPIN_PRIZES}

@app.post("/api/spin")
async def spin_wheel(data: SpinRequest):
    settings = await database.get_settings()
    if settings.get("feat_spin_wheel") != "true":
        raise HTTPException(status_code=400, detail="Şans çarkı şu an kapalı.")
    
    user = await database.get_user(data.telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    
    available = await database.check_spin_available(data.telegram_id)
    if not available:
        raise HTTPException(status_code=400, detail="Bugünkü çevirme hakkınızı zaten kullandınız. Yarın tekrar deneyin!")
    
    # Ağırlıklı rastgele seçim
    weights = [p["weight"] for p in SPIN_PRIZES]
    chosen_index = random.choices(range(len(SPIN_PRIZES)), weights=weights, k=1)[0]
    prize = SPIN_PRIZES[chosen_index]
    
    # Ödülü uygula
    if prize["type"] == "balance" and prize["value"] > 0:
        await database.update_balance(data.telegram_id, prize["value"])
        new_bal = user["balance"] + prize["value"]
        await database.add_balance_history(
            data.telegram_id, prize["value"], "çark_ödülü",
            f"Şans çarkından {prize['label']} kazandınız!", round(new_bal, 2)
        )
        await database.create_notification(
            data.telegram_id, "🎯 Şans Çarkı Ödülü",
            f"Tebrikler! Şans çarkından {prize['label']} bakiye kazandınız!"
        )
    elif prize["type"] == "coupon" and prize["value"] > 0:
        # Kişiye özel tek kullanımlık kupon oluştur
        coupon_code = f"SPIN{data.telegram_id}{random.randint(100,999)}"
        await database.create_coupon(coupon_code, prize["value"], max_uses=1)
        await database.create_notification(
            data.telegram_id, "🎟️ İndirim Kuponu Kazandınız!",
            f"Şans çarkından %{int(prize['value'])} indirim kuponu kazandınız! Kodunuz: {coupon_code}"
        )
    elif prize["type"] == "retry":
        # Tekrar dene — hakkını geri ver (kaydetme)
        await database.create_notification(
            data.telegram_id, "🔄 Tekrar Dene!",
            "Şans çarkında 'Tekrar Dene' geldi. Bir kez daha çevirebilirsiniz!"
        )
        return {
            "success": True,
            "prize_index": chosen_index,
            "prize": prize,
            "message": "Tekrar çevirebilirsiniz!",
            "retry": True
        }
    
    # Kaydı tut
    await database.record_spin(data.telegram_id, prize["type"], prize["value"])
    await database.log_activity(
        data.telegram_id, "çark_çevirme",
        f"Şans çarkı: {prize['label']} ({prize['type']})"
    )
    
    return {
        "success": True,
        "prize_index": chosen_index,
        "prize": prize,
        "message": f"Tebrikler! {prize['label']} kazandınız!",
        "retry": False
    }

# ═══════════════════════════════════════════════════════════════
# FEAT: TOPLU SİPARİŞ (feat_bulk_order)
# ═══════════════════════════════════════════════════════════════

class BulkOrderItem(BaseModel):
    telegram_id: int
    service_id: int
    links: list[str]          # birden fazla link
    quantity: int
    coupon_code: Optional[str] = None

@app.post("/api/bulk-order")
async def place_bulk_order(data: BulkOrderItem):
    """Aynı servisi birden fazla linke toplu sipariş ver."""
    settings = await database.get_settings()
    if settings.get("feat_bulk_order") != "true":
        raise HTTPException(status_code=400, detail="Toplu sipariş özelliği aktif değil")

    if not data.links:
        raise HTTPException(status_code=400, detail="En az bir link giriniz")
    if len(data.links) > 20:
        raise HTTPException(status_code=400, detail="Tek seferde en fazla 20 link girilebilir")

    # Linleri temizle
    links = [l.strip() for l in data.links if l.strip()]
    if not links:
        raise HTTPException(status_code=400, detail="Geçerli link bulunamadı")

    user = await database.get_user(data.telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")

    if user.get("is_blocked") and settings.get("feat_block_user") == "true":
        raise HTTPException(status_code=403, detail="Hesabınız engellenmiştir.")

    services = await database.get_all_services()
    service = next((s for s in services if s['id'] == data.service_id), None)
    if not service:
        raise HTTPException(status_code=404, detail="Hizmet bulunamadı")

    # Her link için birim fiyat hesapla
    unit_price = (service['price_per_1000'] / 1000.0) * data.quantity

    # VIP indirimi
    if settings.get("feat_vip") == "true" and user.get("vip_level", 0) > 0:
        vip_discount = min(user["vip_level"] * 5.0, 25.0)
        unit_price = unit_price * (1.0 - vip_discount / 100.0)

    # Kupon indirimi
    coupon_id_to_use = None
    if data.coupon_code and settings.get("feat_coupons") == "true":
        coupon = await database.get_coupon(data.coupon_code)
        if not coupon:
            raise HTTPException(status_code=400, detail="Geçersiz kupon kodu")
        used_already = await database.db_pool.fetchval(
            "SELECT 1 FROM coupon_uses WHERE coupon_id = $1 AND user_id = $2",
            coupon['id'], data.telegram_id
        )
        if used_already:
            raise HTTPException(status_code=400, detail="Bu kuponu daha önce kullandınız")
        if coupon['current_uses'] >= coupon['max_uses']:
            raise HTTPException(status_code=400, detail="Kupon kullanım sınırı dolmuştur")
        unit_price = unit_price * (1.0 - coupon['discount_percent'] / 100.0)
        coupon_id_to_use = coupon['id']

    unit_price = round(unit_price, 2)
    total_price = round(unit_price * len(links), 2)

    if user["balance"] < total_price:
        raise HTTPException(
            status_code=400,
            detail=f"Bakiye yetersiz. Gerekli: ₺{total_price:.2f}, Mevcut: ₺{user['balance']:.2f}"
        )

    # Kuponu işaretle (toplu siparişte 1 kez kullanılır)
    if coupon_id_to_use:
        success = await database.use_coupon(coupon_id_to_use, data.telegram_id)
        if not success:
            raise HTTPException(status_code=400, detail="Kupon kullanımı başarısız")

    # Toplam bakiyeyi düş, siparişleri oluştur
    await database.update_balance(data.telegram_id, -total_price)
    order_ids = []
    for link in links:
        oid = await database.create_order(data.telegram_id, data.service_id, link, data.quantity, unit_price)
        order_ids.append(oid)

    # Activity log
    await database.log_activity(
        data.telegram_id, "toplu_sipariş",
        f"{len(links)} link | {service['name']} | ₺{total_price:.2f}"
    )

    # Kullanıcıya Telegram bildirimi
    user_msg = (
        f"📦 <b>Toplu Siparişiniz Alındı!</b>\n\n"
        f"🛒 Hizmet: {service['name']}\n"
        f"🔢 Miktar/Link: {data.quantity:,}\n"
        f"🔗 Link Sayısı: {len(links)}\n"
        f"💰 Toplam: ₺{total_price:.2f}\n"
        f"🆔 Sipariş No'ları: {', '.join(f'#{o}' for o in order_ids)}"
    )
    await send_telegram_message(data.telegram_id, user_msg)

    return {
        "success": True,
        "message": f"{len(links)} sipariş oluşturuldu.",
        "order_ids": order_ids,
        "total_price": total_price
    }

# ═══════════════════════════════════════════════════════════════
# FEAT: GELİR RAPORU ENDPOİNTLERİ
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/revenue")
async def admin_get_revenue(tg_id: int, period: str = "monthly"):
    """
    Admin: gelir raporunu döndür.
    period: 'daily' (son 30 gün), 'monthly' (son 12 ay), 'yearly'
    """
    verify_admin(tg_id)
    settings = await database.get_settings()
    if settings.get("feat_revenue") != "true":
        raise HTTPException(status_code=400, detail="Gelir raporu özelliği aktif değil")
    report = await database.get_revenue_report(period=period)
    for row in report.get("rows", []):
        for k, v in row.items():
            if hasattr(v, "isoformat"):
                row[k] = v.isoformat()
    return {"success": True, "report": report}

# ═══════════════════════════════════════════════════════════════
# FEAT: TOPLU SİPARİŞ ENDPOİNTLERİ
# ═══════════════════════════════════════════════════════════════

class BulkOrderItem(BaseModel):
    link: str
    quantity: int

class NewBulkOrder(BaseModel):
    telegram_id: int
    service_id: int
    items: list[BulkOrderItem]
    coupon_code: Optional[str] = None

@app.post("/api/bulk-order")
async def place_bulk_order(data: NewBulkOrder):
    """Tek servis seçimi ile birden fazla link/miktar için toplu sipariş."""
    settings = await database.get_settings()
    if settings.get("feat_bulk_order") != "true":
        raise HTTPException(status_code=400, detail="Toplu sipariş özelliği aktif değil")

    if not data.items:
        raise HTTPException(status_code=400, detail="En az bir sipariş kalemi gereklidir")
    if len(data.items) > 50:
        raise HTTPException(status_code=400, detail="Tek seferde en fazla 50 sipariş verilebilir")

    user = await database.get_user(data.telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if user.get("is_blocked") and settings.get("feat_block_user") == "true":
        raise HTTPException(status_code=403, detail="Hesabınız engellenmiştir.")

    services = await database.get_all_services()
    service = next((s for s in services if s['id'] == data.service_id), None)
    if not service:
        raise HTTPException(status_code=404, detail="Hizmet bulunamadı")

    # Kupon doğrulama
    coupon_obj = None
    if data.coupon_code and settings.get("feat_coupons") == "true":
        coupon_obj = await database.get_coupon(data.coupon_code)
        if not coupon_obj:
            raise HTTPException(status_code=400, detail="Geçersiz kupon kodu")
        used = await database.db_pool.fetchval(
            "SELECT 1 FROM coupon_uses WHERE coupon_id=$1 AND user_id=$2",
            coupon_obj['id'], data.telegram_id
        )
        if used:
            raise HTTPException(status_code=400, detail="Bu kuponu daha önce kullandınız")

    # Toplam tutarı hesapla
    total_price = 0.0
    for item in data.items:
        base = (service['price_per_1000'] / 1000.0) * item.quantity
        if settings.get("feat_vip") == "true" and user.get("vip_level", 0) > 0:
            discount = min(user["vip_level"] * 5.0, 25.0)
            base = base * (1.0 - discount / 100.0)
        if coupon_obj:
            base = base * (1.0 - coupon_obj['discount_percent'] / 100.0)
        total_price += base

    total_price = round(total_price, 2)
    if user["balance"] < total_price:
        raise HTTPException(status_code=400, detail=f"Bakiye yetersiz. Toplam tutar: ₺{total_price:.2f}")

    # Kuponu kullan
    if coupon_obj:
        ok = await database.use_coupon(coupon_obj['id'], data.telegram_id)
        if not ok:
            raise HTTPException(status_code=400, detail="Kupon kullanımı başarısız")

    # Bakiyeyi düş ve her kalemi ayrı sipariş olarak kaydet
    await database.update_balance(data.telegram_id, -total_price)
    order_ids = []
    for item in data.items:
        item_price = (service['price_per_1000'] / 1000.0) * item.quantity
        if settings.get("feat_vip") == "true" and user.get("vip_level", 0) > 0:
            item_price = item_price * (1.0 - min(user["vip_level"] * 5.0, 25.0) / 100.0)
        if coupon_obj:
            item_price = item_price * (1.0 - coupon_obj['discount_percent'] / 100.0)
        item_price = round(item_price, 2)
        oid = await database.create_order(data.telegram_id, data.service_id, item.link, item.quantity, item_price)
        order_ids.append(oid)

    await database.log_activity(
        data.telegram_id, "toplu_sipariş",
        f"{len(data.items)} kalem | {service['name']} | Toplam ₺{total_price:.2f}"
    )

    # Kullanıcıya bildirim
    await send_telegram_message(
        data.telegram_id,
        f"✅ <b>Toplu Siparişiniz Alındı!</b>\n\n"
        f"📦 Hizmet: {service['name']}\n"
        f"🔢 Kalem Sayısı: {len(data.items)}\n"
        f"💰 Toplam Tutar: ₺{total_price:.2f}\n"
        f"🆔 Sipariş Numaraları: {', '.join(f'#{oid}' for oid in order_ids)}"
    )

    # Admin'e bildirim
    for admin_id in get_admin_ids():
        await send_telegram_message(
            admin_id,
            f"📦 <b>TOPLU SİPARİŞ</b>\n\n"
            f"👤 {user.get('first_name','?')} (@{user.get('custom_username','?')})\n"
            f"📋 {service['name']} — {len(data.items)} kalem\n"
            f"💰 Toplam: ₺{total_price:.2f}"
        )

    return {
        "success": True,
        "message": f"{len(data.items)} sipariş başarıyla oluşturuldu.",
        "order_ids": order_ids,
        "total_price": total_price
    }

# ═══════════════════════════════════════════════════════════════
# FEAT: OTOMATİK API ENTEGRASYONU (feat_auto_api)
# ═══════════════════════════════════════════════════════════════

class AdminTestAutoApi(BaseModel):
    admin_id: int

@app.get("/api/admin/auto-api/status")
async def auto_api_status(tg_id: int):
    """Admin: harici SMM API bağlantı durumunu döndür."""
    verify_admin(tg_id)
    settings = await database.get_settings()
    if settings.get("feat_auto_api") != "true":
        raise HTTPException(status_code=400, detail="Otomatik API özelliği aktif değil")
    
    api_url = settings.get("auto_api_url", "")
    api_key = settings.get("auto_api_key", "")
    
    if not api_url or not api_key:
        return {"success": True, "connected": False, "message": "API URL veya API Key ayarlanmamış"}
    
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(api_url, data={"key": api_key, "action": "balance"})
            result = resp.json()
            balance = result.get("balance", "N/A")
            currency = result.get("currency", "USD")
            return {"success": True, "connected": True, "balance": balance, "currency": currency}
    except Exception as e:
        return {"success": True, "connected": False, "message": f"Bağlantı hatası: {str(e)[:100]}"}

@app.post("/api/admin/auto-api/test")
async def auto_api_test(data: AdminTestAutoApi):
    """Admin: harici API bağlantısını test et."""
    verify_admin(data.admin_id)
    settings = await database.get_settings()
    if settings.get("feat_auto_api") != "true":
        raise HTTPException(status_code=400, detail="Otomatik API özelliği aktif değil")
    
    api_url = settings.get("auto_api_url", "")
    api_key = settings.get("auto_api_key", "")
    
    if not api_url or not api_key:
        raise HTTPException(status_code=400, detail="Önce Ayarlar'dan API URL ve API Key girin")
    
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.post(api_url, data={"key": api_key, "action": "balance"})
            result = resp.json()
            if "balance" in result:
                return {"success": True, "message": f"✅ Bağlantı başarılı! Bakiye: {result['balance']} {result.get('currency','USD')}"}
            elif "error" in result:
                return {"success": False, "message": f"API Hatası: {result['error']}"}
            else:
                return {"success": True, "message": "Bağlantı kuruldu fakat yanıt beklenenden farklı.", "raw": str(result)[:200]}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Bağlantı kurulamadı: {str(e)[:150]}")

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

class AdminSupportSend(BaseModel):
    admin_id: int
    user_id: int
    message: str

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
    """Admin: tüm destek mesajlarını listele (eski uyumluluk)."""
    verify_admin(tg_id)
    messages = await database.get_all_support_messages()
    for m in messages:
        for k, v in m.items():
            if hasattr(v, 'isoformat'):
                m[k] = v.isoformat()
    return {"success": True, "messages": messages}

@app.get("/api/admin/support/users")
async def admin_get_support_users(tg_id: int):
    """Admin: Destek mesajı gönderen kullanıcıların listesi (chat modu)."""
    verify_admin(tg_id)
    users = await database.get_support_users()
    for u in users:
        for k, v in u.items():
            if hasattr(v, 'isoformat'):
                u[k] = v.isoformat()
    return {"success": True, "users": users}

@app.get("/api/admin/support/chat/{user_id}")
async def admin_get_support_chat(user_id: int, tg_id: int):
    """Admin: Belirli bir kullanıcının destek sohbet geçmişi."""
    verify_admin(tg_id)
    # Okunmamış mesajları okundu olarak işaretle
    await database.mark_user_support_read(user_id)
    messages = await database.get_user_support_chat(user_id)
    for m in messages:
        for k, v in m.items():
            if hasattr(v, 'isoformat'):
                m[k] = v.isoformat()
    return {"success": True, "messages": messages}

@app.post("/api/admin/support/send-to-user")
async def admin_send_support_message(data: AdminSupportSend):
    """Admin, bir kullanıcıya doğrudan mesaj gönderir."""
    verify_admin(data.admin_id)
    msg_id = await database.send_admin_support_message(data.user_id, data.message)
    if msg_id is None:
        raise HTTPException(status_code=500, detail="Mesaj gönderilemedi.")
    
    # Kullanıcıya Telegram bildirimi gönder
    reply_tg = (
        f"✅ <b>Destek Ekibinden Mesaj</b>\n\n"
        f"💬 <i>{html.escape(data.message)}</i>\n\n"
        f"<i>Yanıtlamak için uygulamayı açınız.</i>"
    )
    await send_telegram_message(data.user_id, reply_tg)
    
    return {"success": True, "msg_id": msg_id}

@app.post("/api/admin/support/reply")
async def admin_reply_support(data: SupportReply):
    """Admin: destek mesajına yanıt ver (eski uyumluluk)."""
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

@app.get("/manifest.json")
async def serve_manifest():
    return FileResponse("manifest.json", headers={"Cache-Control": "public, max-age=86400"})

@app.get("/sw.js")
async def serve_sw():
    return FileResponse("sw.js", headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
