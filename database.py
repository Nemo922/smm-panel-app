import asyncpg
import os

DATABASE_URL = os.getenv("DATABASE_URL")

db_pool = None

async def init_db():
    global db_pool
    if not DATABASE_URL:
        print("UYARI: DATABASE_URL bulunamadı!")
        return

    db_pool = await asyncpg.create_pool(DATABASE_URL)

    async with db_pool.acquire() as conn:
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                telegram_id BIGINT UNIQUE NOT NULL,
                first_name TEXT,
                username TEXT,
                balance DOUBLE PRECISION DEFAULT 0.0,
                joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Ensure custom_username exists and is unique
        await conn.execute('''
            ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_username TEXT UNIQUE
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(telegram_id),
                service_id INTEGER,
                link TEXT,
                quantity INTEGER,
                price DOUBLE PRECISION,
                status TEXT DEFAULT 'Bekliyor',
                order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS payment_requests (
                id SERIAL PRIMARY KEY,
                user_id BIGINT REFERENCES users(telegram_id),
                amount DOUBLE PRECISION NOT NULL,
                payment_method TEXT NOT NULL,
                details TEXT,
                status TEXT DEFAULT 'Bekliyor',
                request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
    print("✅ PostgreSQL tabloları hazır.")

async def get_user(telegram_id: int):
    if not db_pool: return None
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM users WHERE telegram_id = $1", telegram_id)
        return dict(row) if row else None

async def check_custom_username_exists(custom_username: str) -> bool:
    if not db_pool: return False
    async with db_pool.acquire() as conn:
        row = await conn.fetchval("SELECT 1 FROM users WHERE custom_username = $1", custom_username)
        return bool(row)

async def create_user(telegram_id: int, first_name: str, username: str, custom_username: str):
    if not db_pool: return
    async with db_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (telegram_id, first_name, username, custom_username) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING",
            telegram_id, first_name, username, custom_username
        )

async def update_balance(telegram_id: int, amount: float):
    if not db_pool: return
    async with db_pool.acquire() as conn:
        await conn.execute(
            "UPDATE users SET balance = balance + $1 WHERE telegram_id = $2",
            amount, telegram_id
        )

async def create_order(user_id: int, service_id: int, link: str, quantity: int, price: float):
    if not db_pool: return
    async with db_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO orders (user_id, service_id, link, quantity, price) VALUES ($1, $2, $3, $4, $5)",
            user_id, service_id, link, quantity, price
        )

async def get_user_orders(telegram_id: int):
    if not db_pool: return []
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM orders WHERE user_id = $1 ORDER BY order_date DESC", telegram_id)
        return [dict(r) for r in rows]

async def create_payment_request(user_id: int, amount: float, payment_method: str, details: str):
    if not db_pool: return
    async with db_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO payment_requests (user_id, amount, payment_method, details) VALUES ($1, $2, $3, $4)",
            user_id, amount, payment_method, details
        )

async def get_pending_payment_requests():
    if not db_pool: return []
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT pr.*, u.first_name, u.custom_username 
            FROM payment_requests pr 
            JOIN users u ON pr.user_id = u.telegram_id 
            WHERE pr.status = 'Bekliyor' 
            ORDER BY pr.request_date DESC
        """)
        return [dict(r) for r in rows]

async def approve_payment_request(request_id: int):
    if not db_pool: return False
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT user_id, amount, status FROM payment_requests WHERE id = $1", request_id)
        if not row or row["status"] != "Bekliyor":
            return False
            
        user_id = row["user_id"]
        amount = row["amount"]
        
        async with conn.transaction():
            await conn.execute("UPDATE payment_requests SET status = 'Onaylandı' WHERE id = $1", request_id)
            await conn.execute("UPDATE users SET balance = balance + $1 WHERE telegram_id = $2", amount, user_id)
        return True

async def reject_payment_request(request_id: int):
    if not db_pool: return False
    async with db_pool.acquire() as conn:
        await conn.execute("UPDATE payment_requests SET status = 'Reddedildi' WHERE id = $1 AND status = 'Bekliyor'", request_id)
        return True
