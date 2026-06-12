import asyncio
import os
import asyncpg

DATABASE_URL = os.getenv("DATABASE_URL")

async def main():
    if not DATABASE_URL:
        print("DATABASE_URL env variable is not set!")
        return
    print("Connecting to database...")
    try:
        conn = await asyncpg.connect(DATABASE_URL)
        print("Connected.")
        
        # Check settings
        rows = await conn.fetch("SELECT key, value FROM settings")
        print("--- Settings ---")
        for r in rows:
            print(f"{r['key']}: {r['value']}")
            
        # Check user columns
        columns = await conn.fetch("""
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'users'
        """)
        print("--- Users Columns ---")
        for col in columns:
            print(f"{col['column_name']} ({col['data_type']})")
            
        await conn.close()
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
