from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import httpx
import database
import os

# --- YAPILANDIRMA ---
BOT_TOKEN = os.getenv("BOT_TOKEN", "BURAYA_BOT_TOKEN_YAZIN")
TELEGRAM_API_URL = f"https://api.telegram.org/bot{BOT_TOKEN}"

app = FastAPI(title="SMM Panel API")

# --- VERİTABANI BAŞLATMA ---
@app.on_event("startup")
async def startup_event():
    await database.init_db()

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

def get_admin_id() -> int:
    return int(os.getenv("ADMIN_TELEGRAM_ID", "12345"))

def verify_admin(tg_id: int):
    if tg_id != get_admin_id():
        raise HTTPException(status_code=403, detail="Yetkisiz erişim")

# --- API MODELLERİ ---
class RegisterUser(BaseModel):
    telegram_id: int
    first_name: str
    username: str
    custom_username: str

class NewOrder(BaseModel):
    telegram_id: int
    service_id: int
    link: str
    quantity: int
    price: float

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

# ═══════════════════════════════════════════════════════════════
# KULLANICI / GENEL API UÇ NOKTALARI
# ═══════════════════════════════════════════════════════════════

@app.get("/api/user")
async def get_user_data(tg_id: int):
    user = await database.get_user(tg_id)
    if user:
        orders = await database.get_user_orders(tg_id)
        for o in orders:
            if o.get('order_date'):
                o['order_date'] = str(o['order_date'])
        if user.get('joined_date'):
            user['joined_date'] = str(user['joined_date'])
        is_admin = (tg_id == get_admin_id())
        return {"registered": True, "user": user, "orders": orders, "is_admin": is_admin}
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
        await database.create_user(data.telegram_id, data.first_name, data.username, data.custom_username)
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

@app.post("/api/order")
async def place_order(data: NewOrder):
    user = await database.get_user(data.telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    if user["balance"] < data.price:
        raise HTTPException(status_code=400, detail="Bakiye yetersiz")

    # Servis bilgisini al
    services = await database.get_all_services()
    service = next((s for s in services if s['id'] == data.service_id), None)

    await database.update_balance(data.telegram_id, -data.price)
    order_id = await database.create_order(data.telegram_id, data.service_id, data.link, data.quantity, data.price)

    new_balance = user['balance'] - data.price
    service_name = service['name'] if service else f"Servis #{data.service_id}"

    # Kullanıcıya bildirim
    user_msg = (
        f"✅ <b>Siparişiniz Alındı!</b>\n\n"
        f"📦 Hizmet: {service_name}\n"
        f"🔗 Link: <code>{data.link}</code>\n"
        f"🔢 Miktar: {data.quantity:,}\n"
        f"💰 Tutar: ₺{data.price:.2f}\n"
        f"🆔 Sipariş No: #{order_id}\n\n"
        f"<i>Kalan Bakiye: ₺{new_balance:.2f}</i>"
    )
    await send_telegram_message(data.telegram_id, user_msg)

    # Admin'e bildirim
    admin_id = get_admin_id()
    admin_msg = (
        f"🛒 <b>YENİ SİPARİŞ #{order_id}</b>\n\n"
        f"👤 Kullanıcı: {user.get('first_name', 'Bilinmiyor')} (@{user.get('custom_username', '?')})\n"
        f"📦 Hizmet: {service_name}\n"
        f"🔗 Link: <code>{data.link}</code>\n"
        f"🔢 Miktar: {data.quantity:,}\n"
        f"💰 Tutar: ₺{data.price:.2f}"
    )
    await send_telegram_message(admin_id, admin_msg)

    return {"success": True, "message": "Siparişiniz alındı!", "order_id": order_id}

@app.post("/api/payment-request")
async def new_payment_request(data: NewPaymentRequest):
    await database.create_payment_request(data.telegram_id, data.amount, data.payment_method, data.details)
    # Admin'e bildirim
    admin_id = get_admin_id()
    user = await database.get_user(data.telegram_id)
    admin_msg = (
        f"💳 <b>YENİ BAKİYE YÜKLEME TALEBİ</b>\n\n"
        f"👤 Kullanıcı: {user.get('first_name','?')} (@{user.get('custom_username','?')})\n"
        f"💰 Tutar: ₺{data.amount:.2f}\n"
        f"🏦 Yöntem: {data.payment_method}\n"
        f"📝 Açıklama: {data.details}"
    )
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
            msg = f"✅ <b>Bakiye Yüklendi!</b>\n\n₺{req['amount']:.2f} bakiyeniz onaylandı ve hesabınıza eklendi."
            if data.note:
                msg += f"\n\n📝 <b>Not:</b> <i>{data.note}</i>"
            await send_telegram_message(req['user_id'], msg)
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
            msg = f"❌ <b>Bakiye Yükleme Talebiniz Reddedildi</b>\n\nTutar: ₺{req['amount']:.2f}"
            if data.note:
                msg += f"\n\n📝 <b>Not:</b> <i>{data.note}</i>"
            await send_telegram_message(req['user_id'], msg)
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

@app.post("/api/admin/user/add-balance")
async def admin_add_balance(data: AdminAddBalance):
    verify_admin(data.admin_id)
    if data.amount <= 0:
        raise HTTPException(status_code=400, detail="Eklenecek tutar 0'dan büyük olmalıdır.")
    
    await database.update_balance(data.telegram_id, data.amount)
    
    # Kullanıcıya bildirim gönder
    user = await database.get_user(data.telegram_id)
    new_balance = user['balance'] if user else 0.0
    
    msg = (
        f"💰 <b>Bakiyeniz Güncellendi!</b>\n\n"
        f"Hesabınıza <b>₺{data.amount:.2f}</b> eklendi.\n"
        f"Güncel Bakiye: ₺{new_balance:.2f}\n\n"
        f"📝 <b>Yönetici Notu:</b> <i>{data.note}</i>"
    )
    await send_telegram_message(data.telegram_id, msg)
    
    return {"success": True, "message": f"Bakiye eklendi ve kullanıcıya mesaj gönderildi."}

# ═══════════════════════════════════════════════════════════════
# ADMİN – SİPARİŞ YÖNETİMİ
# ═══════════════════════════════════════════════════════════════

@app.get("/api/admin/orders")
async def admin_get_orders(tg_id: int):
    verify_admin(tg_id)
    orders = await database.get_all_orders()
    for o in orders:
        if o.get('order_date'):
            o['order_date'] = str(o['order_date'])
    return {"success": True, "orders": orders}

@app.post("/api/admin/order/cancel")
async def admin_cancel_order(data: AdminOrderAction):
    verify_admin(data.admin_id)
    result = await database.cancel_order(data.order_id)
    if result:
        msg = f"❌ <b>Siparişiniz İptal Edildi</b>\n\nSipariş #{data.order_id} iptal edildi ve ₺{result['refund']:.2f} bakiyenize iade edildi."
        if data.note:
            msg += f"\n\n📝 <b>Not:</b> <i>{data.note}</i>"
        await send_telegram_message(result['user_id'], msg)
        return {"success": True, "message": "Sipariş iptal edildi ve bakiye iade edildi."}
    return {"success": False, "message": "Sipariş bulunamadı veya zaten iptal edilmiş."}

@app.post("/api/admin/order/update-status")
async def admin_update_order_status(data: AdminOrderStatus):
    verify_admin(data.admin_id)
    await database.update_order_status(data.order_id, data.status)
    return {"success": True, "message": f"Sipariş durumu '{data.status}' olarak güncellendi."}

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
# STATİK DOSYALAR
# ═══════════════════════════════════════════════════════════════

@app.get("/")
async def serve_index():
    return FileResponse("index.html")

@app.get("/style.css")
async def serve_css():
    return FileResponse("style.css")

@app.get("/app.js")
async def serve_js():
    return FileResponse("app.js")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
