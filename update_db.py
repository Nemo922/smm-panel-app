import asyncio
import os
import asyncpg

DATABASE_URL = os.getenv("DATABASE_URL")

async def main():
    if not DATABASE_URL:
        print("DATABASE_URL is not set!")
        return
    try:
        conn = await asyncpg.connect(DATABASE_URL)
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
            print(f"Successfully updated {key} to true.")
        await conn.close()
    except Exception as e:
        print("Error updating database:", e)

if __name__ == "__main__":
    asyncio.run(main())
