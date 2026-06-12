import asyncio
import os
import asyncpg

DATABASE_URL = os.getenv("DATABASE_URL")

async def main():
    print("DATABASE_URL:", DATABASE_URL)
    if not DATABASE_URL:
        print("Env variables:")
        for k, v in os.environ.items():
            if "database" in k.lower() or "db" in k.lower() or "url" in k.lower():
                print(f"  {k}: {v}")
        return

    try:
        conn = await asyncpg.connect(DATABASE_URL)
        print("Successfully connected to database.")
        
        # Settings
        rows_settings = await conn.fetch("SELECT key, value FROM settings")
        print("\n--- Settings ---")
        for r in rows_settings:
            print(f"  {r['key']}: {r['value']}")
            
        # Users
        rows_users = await conn.fetch("SELECT telegram_id, username, custom_username, referred_by, balance, referral_earnings FROM users")
        print("\n--- Users ---")
        for u in rows_users:
            print(f"  ID: {u['telegram_id']} | Username: {u['username']} | Custom: {u['custom_username']} | Ref By: {u['referred_by']} | Bal: {u['balance']} | Ref Earn: {u['referral_earnings']}")
            
        # Orders
        rows_orders = await conn.fetch("SELECT id, user_id, service_id, price, status FROM orders ORDER BY id DESC LIMIT 5")
        print("\n--- Latest 5 Orders ---")
        for o in rows_orders:
            print(f"  ID: {o['id']} | User: {o['user_id']} | Service: {o['service_id']} | Price: {o['price']} | Status: {o['status']}")
            
        await conn.close()
    except Exception as e:
        print("Database error:", e)

if __name__ == "__main__":
    asyncio.run(main())
