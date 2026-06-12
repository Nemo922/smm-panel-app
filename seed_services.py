import asyncio
from database import get_db_pool

async def seed_services():
    pool = await get_db_pool()
    admin_id = 1424785899 # default admin tg id, can be any valid admin id
    
    platforms = [
        {"id": "instagram", "icon": "ph-instagram-logo"},
        {"id": "tiktok", "icon": "ph-tiktok-logo"},
        {"id": "twitter", "icon": "ph-twitter-logo"},
        {"id": "youtube", "icon": "ph-youtube-logo"},
        {"id": "facebook", "icon": "ph-facebook-logo"},
        {"id": "linkedin", "icon": "ph-linkedin-logo"},
        {"id": "spotify", "icon": "ph-spotify-logo"},
        {"id": "twitch", "icon": "ph-twitch-logo"},
        {"id": "snapchat", "icon": "ph-snapchat-logo"},
        {"id": "telegram", "icon": "ph-telegram-logo"},
        {"id": "discord", "icon": "ph-discord-logo"}
    ]
    
    categories = [
        {"name": "Takipçi", "desc": "Gerçek ve aktif takipçiler", "price": 25.0, "min": 100, "max": 10000},
        {"name": "Beğeni", "desc": "Hızlı gelen beğeniler", "price": 10.0, "min": 50, "max": 20000},
        {"name": "İzlenme", "desc": "Keşfet etkili izlenmeler", "price": 5.0, "min": 1000, "max": 1000000},
        {"name": "Yorum", "desc": "Organik görünümlü yorumlar", "price": 40.0, "min": 10, "max": 1000}
    ]
    
    count = 0
    async with pool.acquire() as conn:
        for platform in platforms:
            for cat in categories:
                # Check if exists
                exists = await conn.fetchval(
                    "SELECT 1 FROM services WHERE platform=$1 AND name LIKE $2",
                    platform["id"], f"%{cat['name']}%"
                )
                if not exists:
                    name = f"{platform['id'].capitalize()} {cat['name']}"
                    await conn.execute(
                        """
                        INSERT INTO services 
                        (platform, name, description, price_per_1000, min_order, max_order, icon, is_active)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                        """,
                        platform["id"], name, cat["desc"], cat["price"], cat["min"], cat["max"], platform["icon"], True
                    )
                    count += 1
                    
    print(f"Başarıyla {count} yeni servis eklendi.")

if __name__ == "__main__":
    asyncio.run(seed_services())
