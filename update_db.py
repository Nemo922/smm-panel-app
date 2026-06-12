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
        await conn.execute("INSERT INTO settings (key, value) VALUES ('feat_referral', 'true') ON CONFLICT (key) DO UPDATE SET value='true'")
        print("Successfully updated feat_referral to true.")
        await conn.close()
    except Exception as e:
        print("Error updating database:", e)

if __name__ == "__main__":
    asyncio.run(main())
