import asyncio
from typing import Optional, Dict, Any, List
import httpx
from datetime import datetime

from ..core.config import settings


class WildberriesAPI:
    """Client for Wildberries API
    
    Official docs: https://dev.wildberries.ru/docs/openapi/api-information
    
    API Domains:
    - common-api.wildberries.ru - общая информация, новости, продавец
    - content-api.wildberries.ru - контент, карточки товаров
    - statistics-api.wildberries.ru - статистика
    - seller-analytics-api.wildberries.ru - аналитика
    - discounts-prices-api.wildberries.ru - цены и скидки
    - marketplace-api.wildberries.ru - маркетплейс (FBS/DBS)
    - advert-api.wildberries.ru - продвижение
    - feedbacks-api.wildberries.ru - вопросы и отзывы
    """
    
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.headers = {
            "Authorization": api_key,
            "Content-Type": "application/json",
        }
        self.timeout = httpx.Timeout(30.0)

    @staticmethod
    def _extract_wb_photo_urls(raw_photos: Any) -> List[str]:
        urls: List[str] = []
        seen: set[str] = set()
        if not isinstance(raw_photos, list):
            return urls
        for item in raw_photos:
            url: Optional[str] = None
            if isinstance(item, str):
                url = item
            elif isinstance(item, dict):
                url = (
                    item.get("big")
                    or item.get("url")
                    or item.get("full")
                    or item.get("c516x688")
                    or item.get("c246x328")
                )
            if not url:
                continue
            s = str(url).strip()
            if not s or s in seen:
                continue
            seen.add(s)
            urls.append(s)
        return urls

    @staticmethod
    def _guess_ext(content_type: str) -> str:
        ct = (content_type or "").split(";")[0].strip().lower()
        if ct == "image/png":
            return ".png"
        if ct == "image/webp":
            return ".webp"
        if ct == "image/jpeg" or ct == "image/jpg":
            return ".jpg"
        return ".jpg"
    
    async def ping(self, api_type: str = "common") -> Dict[str, Any]:
        """Check connection to WB API
        
        Uses official endpoint: GET https://{api}-api.wildberries.ru/ping
        Docs: https://dev.wildberries.ru/docs/openapi/api-information#tag/Proverka-podklyucheniya-k-WB-API
        
        Args:
            api_type: Type of API to ping (common, content, statistics, etc.)
        """
        api_urls = {
            "common": settings.WB_COMMON_API_URL,
            "content": settings.WB_CONTENT_API_URL,
            "statistics": settings.WB_STATISTICS_API_URL,
            "analytics": settings.WB_ANALYTICS_API_URL,
            "prices": settings.WB_PRICES_API_URL,
            "marketplace": settings.WB_MARKETPLACE_API_URL,
            "advert": settings.WB_ADVERT_API_URL,
            "feedbacks": settings.WB_FEEDBACKS_API_URL,
        }
        
        base_url = api_urls.get(api_type, settings.WB_COMMON_API_URL)
        
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{base_url}/ping",
                    headers=self.headers,
                )
                
                if response.status_code == 200:
                    data = response.json()
                    # Response: {"TS": "2024-08-16T11:19:05+03:00", "Status": "OK"}
                    return {
                        "success": True,
                        "status": data.get("Status"),
                        "timestamp": data.get("TS"),
                    }
                elif response.status_code == 401:
                    return {
                        "success": False,
                        "error": "Unauthorized - check your API token",
                    }
                elif response.status_code == 429:
                    return {
                        "success": False,
                        "error": "Too many requests",
                    }
                else:
                    return {
                        "success": False,
                        "error": f"API error: {response.status_code}",
                    }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
    
    async def validate_api_key(self) -> Dict[str, Any]:
        """Validate API key and get supplier info
        
        Uses official endpoint: GET https://common-api.wildberries.ru/api/v1/seller-info
        Docs: https://dev.wildberries.ru/docs/openapi/api-information#tag/Informaciya-o-prodavce
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Get seller info from common-api
                response = await client.get(
                    f"{settings.WB_COMMON_API_URL}/api/v1/seller-info",
                    headers=self.headers,
                )
                
                if response.status_code == 200:
                    data = response.json()
                    # Response: {"name": "ИП Кружинин В. Р.", "sid": "uuid", "tradeMark": "Flax Store"}
                    return {
                        "is_valid": True,
                        "supplier_id": data.get("sid"),
                        "supplier_name": data.get("name"),
                        "trade_mark": data.get("tradeMark"),
                    }
                elif response.status_code == 401:
                    return {
                        "is_valid": False,
                        "error": "Invalid API key",
                    }
                elif response.status_code == 429:
                    return {
                        "is_valid": False,
                        "error": "Too many requests. Try again later.",
                    }
                else:
                    return {
                        "is_valid": False,
                        "error": f"API error: {response.status_code}",
                    }
        except httpx.TimeoutException:
            return {
                "is_valid": False,
                "error": "Connection timeout",
            }
        except Exception as e:
            return {
                "is_valid": False,
                "error": str(e),
            }
    
    async def get_cards(
        self,
        limit: int = 100,
        updated_at: Optional[str] = None,
        nm_id: Optional[int] = None,
        nm_ids: Optional[List[int]] = None,
        with_photo: int = -1,
        text_search: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get cards/products from WB
        
        Uses official endpoint: POST https://content-api.wildberries.ru/content/v2/get/cards/list
        Docs: https://dev.wildberries.ru/openapi/work-with-products#tag/Product-Cards/paths/~1content~1v2~1get~1cards~1list/post
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                # Build request payload according to official docs
                payload = {
                    "settings": {
                        "sort": {
                            "ascending": False
                        },
                        "cursor": {
                            "limit": limit
                        },
                        "filter": {
                            "withPhoto": int(with_photo)  # -1 = all, 0 = without photo, 1 = with photo
                        }
                    }
                }
                
                # Add cursor for pagination
                if updated_at and nm_id:
                    payload["settings"]["cursor"]["updatedAt"] = updated_at
                    payload["settings"]["cursor"]["nmID"] = nm_id
                
                # Filter by specific nmIDs
                if nm_ids:
                    payload["settings"]["filter"]["nmIDs"] = nm_ids

                if text_search:
                    payload["settings"]["filter"]["textSearch"] = str(text_search)
                
                response = await client.post(
                    f"{settings.WB_CONTENT_API_URL}/content/v2/get/cards/list",
                    headers=self.headers,
                    json=payload,
                )
                
                if response.status_code == 200:
                    data = response.json()
                    return {
                        "success": True,
                        "cards": data.get("cards", []),
                        "cursor": data.get("cursor", {}),
                    }
                else:
                    return {
                        "success": False,
                        "error": f"API error: {response.status_code}",
                        "details": response.text,
                    }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
    
    async def get_card_detail(self, nm_id: int) -> Dict[str, Any]:
        """Get detailed info about a specific card"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                payload = {
                    "nmIDs": [nm_id],
                }
                
                response = await client.post(
                    f"{settings.WB_CONTENT_API_URL}/content/v2/get/cards/list",
                    headers=self.headers,
                    json={"settings": {"filter": {"nmIDs": [nm_id]}}},
                )
                
                if response.status_code == 200:
                    data = response.json()
                    cards = data.get("cards", [])
                    if cards:
                        return {
                            "success": True,
                            "card": cards[0],
                        }
                    return {
                        "success": False,
                        "error": "Card not found",
                    }
                else:
                    return {
                        "success": False,
                        "error": f"API error: {response.status_code}",
                    }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
    
    async def update_card(self, card_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update a card on WB"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{settings.WB_CONTENT_API_URL}/content/v2/cards/update",
                    headers=self.headers,
                    json=card_data,
                )
                
                if response.status_code == 200:
                    return {"success": True}
                else:
                    return {
                        "success": False,
                        "error": f"API error: {response.status_code}",
                        "details": response.text,
                    }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }

    async def get_directory_values(self, charc_name: str, locale: str = "ru") -> Dict[str, Any]:
        """Get allowed dictionary values for a characteristic from WB directory.
        
        Uses: GET /content/v2/directory/{charc_name}
        Docs: https://dev.wildberries.ru/openapi/content#tag/Spravochniki
        """
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{settings.WB_CONTENT_API_URL}/content/v2/directory/{charc_name}",
                    headers=self.headers,
                    params={"locale": locale},
                )

                if response.status_code == 200:
                    data = response.json().get("data", [])
                    # Extract just the value strings
                    values = []
                    for item in data:
                        if isinstance(item, dict):
                            val = item.get("value") or item.get("name") or ""
                            if val:
                                values.append(str(val))
                        elif isinstance(item, str):
                            values.append(item)
                    return {
                        "success": True,
                        "values": values,
                    }
                else:
                    return {
                        "success": False,
                        "error": f"API error: {response.status_code}",
                    }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }

    async def get_card_photo_urls(self, nm_id: int) -> List[str]:
        result = await self.get_cards(limit=1, nm_ids=[int(nm_id)], with_photo=-1)
        if not result.get("success"):
            return []
        cards = result.get("cards") or []
        if not cards:
            return []
        card = cards[0] if isinstance(cards[0], dict) else {}
        return self._extract_wb_photo_urls(card.get("photos"))

    async def upload_card_photo(
        self,
        *,
        nm_id: int,
        content: bytes,
        content_type: str,
        photo_number: Optional[int] = None,
        filename: Optional[str] = None,
        poll_attempts: int = 12,
        poll_sleep_sec: float = 1.0,
    ) -> Dict[str, Any]:
        """
        Upload image to WB card media endpoint and return resolved card photo URL.
        If photo_number is set, tries to replace that slot.
        """
        try:
            nm_id = int(nm_id)
            slot = int(photo_number) if photo_number is not None else None
            if slot is not None and slot < 1:
                return {"success": False, "error": "photo_number must be >= 1"}

            before_urls = await self.get_card_photo_urls(nm_id)
            target_slot = slot if slot is not None else max(len(before_urls) + 1, 1)
            ext = self._guess_ext(content_type)
            upload_name = filename or f"photo_{target_slot}{ext}"

            headers = {
                "Authorization": self.api_key,
                "Accept": "application/json",
                "X-Nm-Id": str(nm_id),
                "X-Photo-Number": str(target_slot),
            }
            files = {
                "uploadfile": (
                    upload_name,
                    content,
                    (content_type or "image/jpeg"),
                )
            }

            async with httpx.AsyncClient(timeout=httpx.Timeout(90.0)) as client:
                response = await client.post(
                    f"{settings.WB_CONTENT_API_URL}/content/v3/media/file",
                    headers=headers,
                    files=files,
                )
                if response.status_code >= 400:
                    return {
                        "success": False,
                        "error": f"WB media upload failed: {response.status_code}",
                        "details": response.text,
                    }

            before_set = set(before_urls)
            last_urls = before_urls
            tries = max(int(poll_attempts or 1), 1)
            for _ in range(tries):
                await asyncio.sleep(max(float(poll_sleep_sec or 0.5), 0.2))
                last_urls = await self.get_card_photo_urls(nm_id)
                if target_slot <= len(last_urls):
                    url = last_urls[target_slot - 1]
                    if url:
                        return {
                            "success": True,
                            "photo_url": url,
                            "photo_number": target_slot,
                            "photos": last_urls,
                        }
                new_urls = [u for u in last_urls if u not in before_set]
                if new_urls:
                    return {
                        "success": True,
                        "photo_url": new_urls[-1],
                        "photo_number": target_slot,
                        "photos": last_urls,
                    }

            return {
                "success": False,
                "error": "Uploaded, but could not resolve updated photo URL",
                "photos": last_urls,
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
    
    async def get_categories(self) -> Dict[str, Any]:
        """Get available categories"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{settings.WB_CONTENT_API_URL}/content/v2/object/all",
                    headers=self.headers,
                    params={"top": 1000},
                )
                
                if response.status_code == 200:
                    return {
                        "success": True,
                        "categories": response.json().get("data", []),
                    }
                else:
                    return {
                        "success": False,
                        "error": f"API error: {response.status_code}",
                    }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
    
    async def get_characteristics(self, subject_id: int) -> Dict[str, Any]:
        """Get required characteristics for a category"""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    f"{settings.WB_CONTENT_API_URL}/content/v2/object/charcs/{subject_id}",
                    headers=self.headers,
                )
                
                if response.status_code == 200:
                    return {
                        "success": True,
                        "characteristics": response.json().get("data", []),
                    }
                else:
                    return {
                        "success": False,
                        "error": f"API error: {response.status_code}",
                    }
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
            }
