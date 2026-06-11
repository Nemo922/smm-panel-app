from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
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

# --- API MODELLERİ ---
class RegisterUser(BaseModel):
    telegram_id: int
    first_name: str
    username: str

class NewOrder(BaseModel):
    telegram_id: int
    service_id: int
    link: str
    quantity: int
    price: float

# --- API UÇ NOKTALARI (ENDPOINTS) ---

@app.get("/api/user")
async def get_user_data(tg_id: int):
    user = await database.get_user(tg_id)
    if user:
        orders = await database.get_user_orders(tg_id)
        # asyncpg datetime nesnelerini string'e çevirmek için
        for o in orders:
            o['order_date'] = str(o['order_date'])
        
        user['joined_date'] = str(user['joined_date'])
        return {"registered": True, "user": dict(user), "orders": orders}
    else:
        return {"registered": False}

@app.post("/api/register")
async def register_user(data: RegisterUser):
    user = await database.get_user(data.telegram_id)
    if not user:
        await database.create_user(data.telegram_id, data.first_name, data.username)
        return {"success": True, "message": "Kayıt başarılı"}
    return {"success": True, "message": "Zaten kayıtlı"}

@app.post("/api/order")
async def place_order(data: NewOrder):
    user = await database.get_user(data.telegram_id)
    if not user:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
    
    if user["balance"] < data.price:
        raise HTTPException(status_code=400, detail="Bakiye yetersiz")
    
    await database.update_balance(data.telegram_id, -data.price)
    await database.create_order(data.telegram_id, data.service_id, data.link, data.quantity, data.price)
    
    message_text = f"✅ <b>Yeni Sipariş Alındı!</b>\n\n"\
                   f"Servis ID: {data.service_id}\n"\
                   f"Link: {data.link}\n"\
                   f"Miktar: {data.quantity}\n"\
                   f"Tutar: ₺{data.price}\n\n"\
                   f"<i>Kalan Bakiyeniz: ₺{user['balance'] - data.price}</i>"
    
    async with httpx.AsyncClient() as client:
        await client.post(
            f"{TELEGRAM_API_URL}/sendMessage",
            json={"chat_id": data.telegram_id, "text": message_text, "parse_mode": "HTML"}
        )
        
    return {"success": True, "message": "Siparişiniz alındı!"}

# --- STATİK DOSYALARI SUNMA (Arayüz) ---
app.mount("/static", StaticFiles(directory="."), name="static")

@app.get("/")
async def serve_index():
    return FileResponse("index.html")

# Eğer dosya CSS veya JS ise direkt çekebilmek için özel Route
@app.get("/{filename}")
async def serve_files(filename: str):
    if os.path.isfile(filename):
        return FileResponse(filename)
    raise HTTPException(status_code=404)

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
