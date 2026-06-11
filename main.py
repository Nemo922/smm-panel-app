from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
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

# --- API UÇ NOKTALARI ---

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
        
        admin_id = int(os.getenv("ADMIN_TELEGRAM_ID", "12345"))
        is_admin = (tg_id == admin_id)
        
        return {"registered": True, "user": user, "orders": orders, "is_admin": is_admin}
    return {"registered": False}

@app.get("/api/check-username")
async def check_username(username: str):
    exists = await database.check_custom_username_exists(username)
    return {"exists": exists}

@app.post("/api/register")
async def register_user(data: RegisterUser):
    # Verify unique custom_username
    exists = await database.check_custom_username_exists(data.custom_username)
    if exists:
        raise HTTPException(status_code=400, detail="Bu kullanıcı adı zaten alınmış")
        
    user = await database.get_user(data.telegram_id)
    if not user:
        await database.create_user(data.telegram_id, data.first_name, data.username, data.custom_username)
    else:
        await database.update_custom_username(data.telegram_id, data.custom_username)
    return {"success": True, "message": "Kayıt başarılı"}

@app.post("/api/order")
async def place_order(data: NewOrder):
    user = await database.get_user(data.telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")

    if user["balance"] < data.price:
        raise HTTPException(status_code=400, detail="Bakiye yetersiz")

    await database.update_balance(data.telegram_id, -data.price)
    await database.create_order(data.telegram_id, data.service_id, data.link, data.quantity, data.price)

    new_balance = user['balance'] - data.price
    message_text = (
        f"✅ <b>Yeni Sipariş Alındı!</b>\n\n"
        f"Servis ID: {data.service_id}\n"
        f"Link: {data.link}\n"
        f"Miktar: {data.quantity}\n"
        f"Tutar: ₺{data.price:.2f}\n\n"
        f"<i>Kalan Bakiyeniz: ₺{new_balance:.2f}</i>"
    )

    async with httpx.AsyncClient() as client:
        await client.post(
            f"{TELEGRAM_API_URL}/sendMessage",
            json={"chat_id": data.telegram_id, "text": message_text, "parse_mode": "HTML"}
        )

    return {"success": True, "message": "Siparişiniz alındı!"}

@app.post("/api/payment-request")
async def new_payment_request(data: NewPaymentRequest):
    await database.create_payment_request(data.telegram_id, data.amount, data.payment_method, data.details)
    return {"success": True, "message": "Ödeme bildiriminiz alındı. Yönetici onayı bekleniyor."}

@app.get("/api/admin/pending-payments")
async def admin_pending_payments(tg_id: int):
    admin_id = int(os.getenv("ADMIN_TELEGRAM_ID", "12345"))
    if tg_id != admin_id:
        raise HTTPException(status_code=403, detail="Yetkisiz erişim")
    requests = await database.get_pending_payment_requests()
    for r in requests:
        if r.get('request_date'):
            r['request_date'] = str(r['request_date'])
    return {"success": True, "requests": requests}

@app.post("/api/admin/approve-payment")
async def admin_approve_payment(data: AdminAction):
    admin_id = int(os.getenv("ADMIN_TELEGRAM_ID", "12345"))
    if data.admin_id != admin_id:
        raise HTTPException(status_code=403, detail="Yetkisiz erişim")
        
    success = await database.approve_payment_request(data.request_id)
    if success:
        return {"success": True, "message": "Ödeme onaylandı ve bakiye eklendi."}
    return {"success": False, "message": "İşlem başarısız veya zaten onaylanmış."}

@app.post("/api/admin/reject-payment")
async def admin_reject_payment(data: AdminAction):
    admin_id = int(os.getenv("ADMIN_TELEGRAM_ID", "12345"))
    if data.admin_id != admin_id:
        raise HTTPException(status_code=403, detail="Yetkisiz erişim")
        
    success = await database.reject_payment_request(data.request_id)
    if success:
        return {"success": True, "message": "Ödeme bildirimi reddedildi."}
    return {"success": False, "message": "İşlem başarısız veya zaten işlenmiş."}

# --- STATİK DOSYALAR ---
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
