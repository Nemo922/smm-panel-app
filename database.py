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
        # Services table - products managed from admin panel
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS services (
                id SERIAL PRIMARY KEY,
                platform TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT,
                price_per_1000 DOUBLE PRECISION NOT NULL,
                min_order INTEGER NOT NULL DEFAULT 100,
                max_order INTEGER NOT NULL DEFAULT 10000,
                icon TEXT DEFAULT 'ph-star',
                is_active BOOLEAN DEFAULT TRUE,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Settings table - key-value store for admin configurable settings
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        # Payment methods table - admin configurable
        await conn.execute('''
            CREATE TABLE IF NOT EXISTS payment_methods (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                description TEXT DEFAULT '',
                icon TEXT DEFAULT 'ph-wallet',
                color TEXT DEFAULT '#6366f1',
                is_active BOOLEAN DEFAULT TRUE,
                sort_order INTEGER DEFAULT 0
            )
        ''')
        # Add account fields safely if they don't exist
        try:
            await conn.execute('ALTER TABLE payment_methods ADD COLUMN account_name TEXT DEFAULT \'\'')
        except Exception:
            pass
        try:
            await conn.execute('ALTER TABLE payment_methods ADD COLUMN account_number TEXT DEFAULT \'\'')
        except Exception:
            pass
        # Seed default payment methods if empty
        pm_count = await conn.fetchval("SELECT COUNT(*) FROM payment_methods")
        if pm_count == 0:
            default_methods = [
                ('Papara', 'Anında Onay', 'ph-wallet', '#FF2B6D', True, 1),
                ('PayFix', 'Anında Onay', 'ph-device-mobile', '#FFA500', True, 2),
                ('Kripto Para', 'USDT TRC20', 'ph-currency-btc', '#F7931A', True, 3),
                ('Havale / EFT', '%5 Bonus Fırsatı', 'ph-bank', '#4CAF50', True, 4),
            ]
            for m in default_methods:
                await conn.execute(
                    "INSERT INTO payment_methods (name, description, icon, color, is_active, sort_order) VALUES ($1,$2,$3,$4,$5,$6)",
                    *m
                )
        # Seed default settings if not exists
        default_settings = [
            ('brand_name', 'SMM Panel'),
            ('bank_name', 'Ziraat Bankası'),
            ('bank_iban', 'TR99 0001 0000 0000 1234 5678 90'),
            ('bank_recipient', 'BoostPanel SMM'),
            ('crypto_usdt_address', 'TY1234567890abcdef1234567890abcdef'),
            ('crypto_networks', 'USDT TRC20'),
            ('bonus_text', '%10 Bonus Kampanyası'),
            ('bonus_desc', '₺500 ve üzeri tüm bakiye yüklemelerinde anında %10 ekstra bonus cüzdanına eklenir.'),
            ('bonus_threshold', '500'),
            ('bonus_percent', '10'),
        ]
        for key, value in default_settings:
            await conn.execute(
                "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
                key, value
            )
        # Seed default services if table is empty
        count = await conn.fetchval("SELECT COUNT(*) FROM services")
        if count == 0:
            default_services = [
                ('instagram', 'Instagram Takipçi (Türk)', 'Gerçek ve aktif Türk kullanıcılar.', 25.00, 100, 50000, 'ph-instagram-logo', True, 1),
                ('instagram', 'Instagram Beğeni (Global)', 'Kaliteli global hesaplardan anında beğeni.', 5.50, 50, 10000, 'ph-heart', True, 2),
                ('tiktok', 'TikTok Video İzlenme', 'Keşfet etkili yüksek hızlı video izlenme.', 2.00, 1000, 1000000, 'ph-tiktok-logo', True, 3),
                ('twitter', 'Twitter (X) Retweet', 'Organik etkileşimli RT hizmeti.', 45.00, 50, 5000, 'ph-twitter-logo', True, 4),
                ('youtube', 'YouTube Abone', 'Ömür boyu telafili abone servisi.', 150.00, 100, 10000, 'ph-youtube-logo', True, 5),
            ]
            for s in default_services:
                await conn.execute(
                    "INSERT INTO services (platform, name, description, price_per_1000, min_order, max_order, icon, is_active, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
                    *s
                )
    print("✅ PostgreSQL tabloları hazır.")

# ─── USER FUNCTIONS ──────────────────────────────────────────────────────────

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

async def update_custom_username(telegram_id: int, custom_username: str):
    if not db_pool: return
    async with db_pool.acquire() as conn:
        await conn.execute(
            "UPDATE users SET custom_username = $1 WHERE telegram_id = $2",
            custom_username, telegram_id
        )

async def get_all_users():
    if not db_pool: return []
    async with db_pool.acquire() as conn:
        rows = await conn.fetch(
            "SELECT telegram_id, first_name, username, custom_username, balance, joined_date FROM users ORDER BY joined_date DESC"
        )
        return [dict(r) for r in rows]

async def admin_update_user(telegram_id: int, balance: float, first_name: str):
    if not db_pool: return False
    async with db_pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE users SET balance = $1, first_name = $2 WHERE telegram_id = $3",
            balance, first_name, telegram_id
        )
        return result == "UPDATE 1"

# ─── ORDER FUNCTIONS ─────────────────────────────────────────────────────────

async def create_order(user_id: int, service_id: int, link: str, quantity: int, price: float):
    if not db_pool: return None
    async with db_pool.acquire() as conn:
        order_id = await conn.fetchval(
            "INSERT INTO orders (user_id, service_id, link, quantity, price) VALUES ($1, $2, $3, $4, $5) RETURNING id",
            user_id, service_id, link, quantity, price
        )
        return order_id

async def get_user_orders(telegram_id: int):
    if not db_pool: return []
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM orders WHERE user_id = $1 ORDER BY order_date DESC", telegram_id)
        return [dict(r) for r in rows]

async def get_all_orders():
    if not db_pool: return []
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("""
            SELECT o.*, u.first_name, u.custom_username, s.name as service_name
            FROM orders o
            JOIN users u ON o.user_id = u.telegram_id
            LEFT JOIN services s ON o.service_id = s.id
            ORDER BY o.order_date DESC
            LIMIT 200
        """)
        return [dict(r) for r in rows]

async def cancel_order(order_id: int):
    """Cancel order and refund user balance."""
    if not db_pool: return False
    async with db_pool.acquire() as conn:
        row = await conn.fetchrow("SELECT user_id, price, status FROM orders WHERE id = $1", order_id)
        if not row or row['status'] == 'İptal Edildi':
            return False
        async with conn.transaction():
            await conn.execute("UPDATE orders SET status = 'İptal Edildi' WHERE id = $1", order_id)
            # Refund if price > 0
            if row['price'] and row['price'] > 0:
                await conn.execute(
                    "UPDATE users SET balance = balance + $1 WHERE telegram_id = $2",
                    row['price'], row['user_id']
                )
        return {'refund': row['price'] if row['price'] else 0.0, 'user_id': row['user_id']}


async def update_order_status(order_id: int, status: str):
    if not db_pool: return False
    async with db_pool.acquire() as conn:
        result = await conn.execute("UPDATE orders SET status = $1 WHERE id = $2", status, order_id)
        return result == "UPDATE 1"

# ─── SERVICE FUNCTIONS ───────────────────────────────────────────────────────

async def get_all_services():
    if not db_pool: return []
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM services ORDER BY sort_order, id")
        return [dict(r) for r in rows]

async def get_active_services():
    if not db_pool: return []
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM services WHERE is_active = TRUE ORDER BY sort_order, id")
        return [dict(r) for r in rows]

async def create_service(platform: str, name: str, description: str, price_per_1000: float, min_order: int, max_order: int, icon: str):
    if not db_pool: return None
    async with db_pool.acquire() as conn:
        service_id = await conn.fetchval(
            "INSERT INTO services (platform, name, description, price_per_1000, min_order, max_order, icon) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
            platform, name, description, price_per_1000, min_order, max_order, icon
        )
        return service_id

async def update_service(service_id: int, platform: str, name: str, description: str, price_per_1000: float, min_order: int, max_order: int, icon: str, is_active: bool):
    if not db_pool: return False
    async with db_pool.acquire() as conn:
        result = await conn.execute(
            "UPDATE services SET platform=$1, name=$2, description=$3, price_per_1000=$4, min_order=$5, max_order=$6, icon=$7, is_active=$8 WHERE id=$9",
            platform, name, description, price_per_1000, min_order, max_order, icon, is_active, service_id
        )
        return result == "UPDATE 1"

async def delete_service(service_id: int):
    if not db_pool: return False
    async with db_pool.acquire() as conn:
        result = await conn.execute("DELETE FROM services WHERE id = $1", service_id)
        return result == "DELETE 1"

# ─── SETTINGS FUNCTIONS ───────────────────────────────────────────────────────

async def get_settings():
    if not db_pool: return {}
    async with db_pool.acquire() as conn:
        rows = await conn.fetch("SELECT key, value FROM settings")
        return {r['key']: r['value'] for r in rows}

async def update_setting(key: str, value: str):
    if not db_pool: return
    async with db_pool.acquire() as conn:
        await conn.execute(
            "INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()",
            key, value
        )

# ─── PAYMENT REQUEST FUNCTIONS ───────────────────────────────────────────────

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

# ─── PAYMENT METHOD FUNCTIONS ─────────────────────────────────────────────────

async def get_payment_methods(active_only: bool = False):
    if not db_pool: return []
    async with db_pool.acquire() as conn:
        if active_only:
            rows = await conn.fetch("SELECT * FROM payment_methods WHERE is_active = TRUE ORDER BY sort_order, id")
        else:
            rows = await conn.fetch("SELECT * FROM payment_methods ORDER BY sort_order, id")
        return [dict(r) for r in rows]

async def create_payment_method(name: str, description: str, icon: str, color: str, sort_order: int, account_name: str = '', account_number: str = ''):
    if not db_pool: return None
    async with db_pool.acquire() as conn:
        return await conn.fetchval(
            """INSERT INTO payment_methods (name, description, icon, color, sort_order, account_name, account_number)
               VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id""",
            name, description, icon, color, sort_order, account_name, account_number
        )

async def update_payment_method(method_id: int, name: str, description: str, icon: str, color: str, is_active: bool, sort_order: int, account_name: str = '', account_number: str = ''):
    if not db_pool: return False
    async with db_pool.acquire() as conn:
        result = await conn.execute(
            """UPDATE payment_methods SET name=$1, description=$2, icon=$3, color=$4, is_active=$5, sort_order=$6, account_name=$7, account_number=$8
               WHERE id=$9""",
            name, description, icon, color, is_active, sort_order, account_name, account_number, method_id
        )
        return result == "UPDATE 1"

async def delete_payment_method(method_id: int):
    if not db_pool: return False
    async with db_pool.acquire() as conn:
        result = await conn.execute("DELETE FROM payment_methods WHERE id = $1", method_id)

