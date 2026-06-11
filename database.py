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
    print("✅ PostgreSQL tabloları hazır.")

async def get_user(telegram_id: int):
    if not db_pool: return None
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT * FROM users WHERE telegram_id = $1", telegram_id)
        return dict(row) if row else None

async def create_user(telegram_id: int, first_name: str, username: str):
    if not db_pool: return
    async with db_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO users (telegram_id, first_name, username) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
            telegram_id, first_name, username
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
