# backend/services/kie_service/kie_services.py

import aiohttp
import asyncio
import requests
import json
import logging
from typing import Any, List, Dict, Tuple, Optional

from app.core.config import settings
from app.core.database import SessionLocal
from app.services.scence_repositories import SceneCategoryRepository
from app.services.promt_repository import PromptRepository

logger = logging.getLogger(__name__)


class KIEInsufficientCreditsError(Exception):
    def __init__(self, result: dict):
        self.result = result
        msg = result.get("msg", "KIE credits are insufficient")
        super().__init__(msg)


class KIEService:
    def __init__(self):
        self.api_key = settings.KIE_API_KEY
        self.create_url = "https://api.kie.ai/api/v1/jobs/createTask"
        self.query_url = "https://api.kie.ai/api/v1/jobs/recordInfo"
        self.headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    @staticmethod
    def _short(value: Any, max_len: int = 1000) -> str:
        try:
            text = json.dumps(value, ensure_ascii=False)
        except (TypeError, ValueError):
            text = str(value)
        if len(text) <= max_len:
            return text
        return f"{text[:max_len]}...(+{len(text) - max_len} chars)"

    @staticmethod
    def _safe_headers(headers: Dict[str, str]) -> Dict[str, str]:
        return {
            "Content-Type": headers.get("Content-Type", ""),
            "Authorization": "Bearer ***",
        }

    def _ensure_api_key(self) -> None:
        if not self.api_key:
            raise PermissionError("KIE API key is not configured. Set KIE_API_KEY in .env")

    # ===== DEFAULT PROMPTS (fallback uchun) =====

    DEFAULT_GHOST_PROMPT = (
        "Create a ghost mannequin from the reference image: transparent body, "
        "light background, no face, professional product photography, high detail, photorealistic."
    )

    DEFAULT_OWN_COMBINE_PROMPT = (
        "Professional product normalization: Take the ghost mannequin from the first reference image "
        "and place it on the model from the second reference image. "
        "Match pose, lighting, and style perfectly. Maintain product details, natural lighting, high quality, photorealistic."
    )

    DEFAULT_NEW_MODEL_PROMPT = (
        "Professional product normalization: Take the ghost mannequin from the reference image "
        "and place it on a new model. High quality, photorealistic, studio lighting, natural pose."
    )

    async def _get_normalize_prompts(self, db: Optional[SessionLocal] = None) -> Tuple[str, str, str]:
        """
        Normalize uchun 3 ta prompt:
        1. normalize_ghost - ghost mannequin yaratish uchun
        2. normalize_own_combine - ghost + o'z modelni birlashtirish
        3. normalize_new_model - ghost + yangi model (DB dan)
        
        Agar DB dan topilmasa - default promptlarni qaytaradi
        """
        ghost_prompt = self.DEFAULT_GHOST_PROMPT
        own_combine_prompt = self.DEFAULT_OWN_COMBINE_PROMPT
        new_model_prompt = self.DEFAULT_NEW_MODEL_PROMPT

        if db:
            try:
                repo = PromptRepository(db)
                
                # normalize_ghost
                ghost_p = repo.get_active_prompt("normalize_ghost")
                if ghost_p and ghost_p.system_prompt:
                    ghost_prompt = ghost_p.system_prompt
                
                # normalize_own_combine
                own_p = repo.get_active_prompt("normalize_own_combine")
                if own_p and own_p.system_prompt:
                    own_combine_prompt = own_p.system_prompt
                
                # normalize_new_model
                new_p = repo.get_active_prompt("normalize_new_model")
                if new_p and new_p.system_prompt:
                    new_model_prompt = new_p.system_prompt
                    
            except Exception as e:
                logger.warning(f"Failed to load normalize prompts from DB: {e}")

        return ghost_prompt, own_combine_prompt, new_model_prompt

    # ===== KIE API LOW LEVEL =====

    def get_model_base(self, model: str) -> str:
        return model.split("/")[0]

    def create_task(self, model: str, input_data: dict) -> str:
        self._ensure_api_key()
        payload = {"model": model, "input": input_data}
        logger.info(
            "KIE create_task request | model=%s url=%s headers=%s payload=%s",
            model,
            self.create_url,
            self._safe_headers(self.headers),
            self._short(payload, max_len=3000),
        )

        try:
            response = requests.post(
                self.create_url,
                headers=self.headers,
                data=json.dumps(payload),
                timeout=(10, 60),
            )
        except requests.RequestException as exc:
            logger.error("KIE create_task network error | model=%s url=%s error=%s", model, self.create_url, exc)
            raise

        logger.info(
            "KIE create_task http_response | status=%s body=%s",
            response.status_code,
            self._short(response.text, max_len=3000),
        )
        response.raise_for_status()
        try:
            result = response.json()
        except ValueError as exc:
            logger.error("KIE create_task invalid JSON | model=%s body=%s", model, self._short(response.text, max_len=3000))
            raise

        logger.info(
            "KIE create_task response parsed | taskId=%s code=%s msg=%s data=%s",
            result.get("data", {}).get("taskId"),
            result.get("code"),
            result.get("msg"),
            self._short(result.get("data", {}), max_len=1500),
        )

        code = result.get("code")

        if code == 402:
            logger.error(f"KIE credits insufficient (402): {result}")
            raise KIEInsufficientCreditsError(result)

        msg = (result.get("msg") or "").lower()
        if code in (401, 403) or "access" in msg or "permission" in msg:
            logger.error(f"KIE access error: {result}")
            raise PermissionError(result.get("msg", "KIE access denied"))

        if code != 200:
            logger.error(f"API create task error: {result}")
            raise ValueError(f"Failed to create task: {result.get('msg', 'Unknown error')}")

        task_id = result.get("data", {}).get("taskId")
        if not task_id:
            logger.error(f"API response without taskId: {result}")
            raise ValueError(f"Failed to extract taskId: {result}")
        return task_id

    def _try_create_task_with_size_fallback(
        self,
        model: str,
        input_data: dict,
        *,
        image_sizes: list[Optional[str]],
    ) -> str:
        """
        KIE ba'zi modellarda image_size parametri cheklangan bo'ladi.
        To'g'ri variantni topish uchun ketma-ket sinovdan o'tkazamiz.
        """
        last_error: Optional[Exception] = None
        logger.info(
            "KIE create_task_with_size_fallback start | model=%s image_sizes=%s input=%s",
            model,
            image_sizes,
            self._short(input_data, max_len=1200),
        )
        for image_size in image_sizes:
            logger.info("KIE create_task_with_size_fallback attempt | model=%s image_size=%s", model, image_size)
            payload = dict(input_data)
            if image_size:
                payload["image_size"] = image_size
            try:
                task_id = self.create_task(model, payload)
                logger.info("KIE create_task_with_size_fallback success | model=%s image_size=%s task_id=%s", model, image_size, task_id)
                return task_id
            except ValueError as e:
                last_error = e
                msg = str(e).lower()
                if "image_size is not within the range of allowed options" in msg:
                    logger.warning(
                        "KIE create_task image_size rejected | model=%s image_size=%s err=%s",
                        model,
                        image_size,
                        e,
                    )
                    continue
                raise

        raise last_error or ValueError("Failed to create task: image_size is not within the allowed options")

    def create_task_with_fallback(self, model: str, input_data: dict, *, image_sizes: Optional[List[Optional[str]]] = None) -> str:
        """
        If input_data contains image_size and model rejects some variants,
        try a safe list before failing.
        """
        logger.info(
            "KIE create_task_with_fallback start | model=%s has_image_size=%s input=%s",
            model,
            "image_size" in input_data,
            self._short(input_data, max_len=1000),
        )
        if "image_size" not in input_data:
            return self.create_task(model, input_data)

        preferred_sizes: list[Optional[str]] = [
            *(image_sizes or []),
            "3:4",
            "1:1",
            "2:3",
            "768:1024",
            "1024:768",
            "1024:1024",
            None,
        ]

        return self._try_create_task_with_size_fallback(
            model,
            input_data,
            image_sizes=preferred_sizes,
        )

    def get_task_status(self, task_id: str) -> dict:
        if not task_id:
            raise ValueError("Task ID cannot be None")

        params = {"taskId": task_id}
        logger.info("KIE get_task_status request | task_id=%s url=%s", task_id, self.query_url)
        try:
            response = requests.get(
                self.query_url,
                params=params,
                headers=self.headers,
                timeout=(10, 60),
            )
        except requests.RequestException as exc:
            logger.error("KIE get_task_status network error | task_id=%s url=%s error=%s", task_id, self.query_url, exc)
            raise

        logger.info("KIE get_task_status response | status=%s body=%s", response.status_code, self._short(response.text, max_len=3000))
        response.raise_for_status()
        try:
            result = response.json()
        except ValueError as exc:
            logger.error("KIE get_task_status invalid JSON | task_id=%s body=%s", task_id, self._short(response.text, max_len=3000))
            raise

        if result.get("code") != 200:
            error_msg = result.get("message") or result.get("msg", "Unknown error")
            logger.error(
                "KIE get_task_status API error | task_id=%s code=%s msg=%s result=%s",
                task_id,
                result.get("code"),
                error_msg,
                self._short(result, max_len=1200),
            )
            raise ValueError(f"Failed to get status: {error_msg}")

        data = result.get("data", {})
        state = data.get("state", "unknown")
        result_json_str = data.get("resultJson", "{}")

        try:
            result_dict = json.loads(result_json_str) if result_json_str else {}
            logger.info(f"Parsed resultJson: {result_dict}")
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse resultJson: {result_json_str}, error: {e}")
            result_dict = {}

        if state in ["fail", "failed", "error"]:
            fail_msg = data.get("failMsg", "Unknown error")
            fail_code = data.get("failCode", "Unknown")
            logger.error(
                "KIE task failed | task_id=%s code=%s state=%s msg=%s data=%s",
                task_id,
                fail_code,
                state,
                fail_msg,
                self._short(data, max_len=1500),
            )
            raise Exception(f"Task failed: {fail_msg} (code: {fail_code})")

        logger.info("KIE get_task_status success state=%s data=%s", state, self._short(data, max_len=1500))
        return {"status": state, "result": result_dict}

    async def poll_task(
        self,
        task_id: str,
        max_attempts: int | None = None,
        poll_interval_seconds: int | None = None,
    ) -> dict:
        if max_attempts is None:
            cfg_attempts = int(settings.KIE_MAX_POLL_ATTEMPTS or 0)
            max_attempts = None if cfg_attempts <= 0 else cfg_attempts
        else:
            max_attempts = None if max_attempts <= 0 else max_attempts

        if poll_interval_seconds is None or poll_interval_seconds < 1:
            poll_interval_seconds = max(1, int(settings.KIE_POLL_INTERVAL_SECONDS or 10))
        attempt = 0
        max_attempts = None if max_attempts is not None and max_attempts <= 0 else max_attempts
        attempt_limit_label = "∞" if max_attempts is None else str(max_attempts)
        started_at = asyncio.get_running_loop().time()
        while True:
            attempt += 1
            if max_attempts is not None and attempt > max_attempts:
                break
            try:
                status_info = await asyncio.to_thread(self.get_task_status, task_id)
                elapsed = round(asyncio.get_running_loop().time() - started_at, 1)
                logger.info(
                    "KIE poll attempt | task_id=%s attempt=%s/%s status=%s elapsed=%ss",
                    task_id,
                    attempt,
                    attempt_limit_label,
                    status_info["status"],
                    elapsed,
                )
                if status_info["status"] == "success":
                    logger.info(f"Task {task_id} completed successfully!")
                    return status_info["result"]
                elif status_info["status"] in ["fail", "failed", "error"]:
                    logger.error(f"Task {task_id} failed with status: {status_info['status']}")
                    raise Exception(f"Task failed: {status_info}")
                logger.info("Task still processing, waiting %s seconds...", poll_interval_seconds)
                await asyncio.sleep(poll_interval_seconds)
            except Exception as e:
                lowered = str(e).lower()
                if lowered.startswith("task failed:"):
                    logger.error("KIE poll failed permanently | task_id=%s attempt=%s error=%s", task_id, attempt, e)
                    raise
                logger.error("KIE poll attempt error | task_id=%s attempt=%s error=%s", task_id, attempt, e)
                if max_attempts is not None and attempt >= max_attempts:
                    raise
                logger.info("Retrying in %s seconds...", poll_interval_seconds)
                await asyncio.sleep(poll_interval_seconds)

        raise Exception(
            f"Task timeout after {max_attempts} attempts ({max_attempts * poll_interval_seconds} seconds)"
        )

    async def download_image(self, url: str) -> bytes:
        logger.info(f"Downloading content from: {url}")
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(
                    url,
                    timeout=aiohttp.ClientTimeout(total=300),
                ) as response:
                    logger.info("KIE download_image response status=%s content-type=%s", response.status, response.headers.get("content-type"))
                    response.raise_for_status()
                    content = await response.read()
                    logger.info(f"Successfully downloaded {len(content)} bytes")
                    return content
        except Exception as e:
            logger.error(f"Failed to download from {url}: {e}")
            raise

    # ===== PRODUCT CARD SCENES =====

    async def generate_product_cards(self, data: dict) -> List[dict]:
        photo_url = data["photo_url"]
        results: List[dict] = []
        model = "google/nano-banana-edit"

        db = SessionLocal()
        try:
            scene_repo = SceneCategoryRepository(db)
            gen_type = data["generation_type"]

            if gen_type == "all_scenes":
                hierarchy = scene_repo.get_full_hierarchy()
                for cat_id, cat in hierarchy.items():
                    cat_name = cat["name"]
                    for sub_id, sub in cat["subcategories"].items():
                        sub_name = sub["name"]
                        for item in sub["items"]:
                            item_name = item["name"]
                            item_prompt = item["prompt"]
                            full_prompt = (
                                "Create a professional product card: Place the product from the "
                                f"reference image into the scene: {cat_name} → {sub_name} → {item_name}. "
                                f"Details: {item_prompt}. High quality, photorealistic, studio lighting, clean background."
                            )
                            input_data = {
                                "prompt": full_prompt,
                                "image_urls": [photo_url],
                                "output_format": "png",
                                "image_size": "3:4",
                            }
                            task_id = await asyncio.to_thread(
                                self.create_task_with_fallback, model, input_data
                            )
                            result = await self.poll_task(task_id)
                            if "resultUrls" in result and result["resultUrls"]:
                                image_bytes = await self.download_image(
                                    result["resultUrls"][0]
                                )
                                results.append(
                                    {
                                        "image": image_bytes,
                                        "category": cat_name,
                                        "subcategory": sub_name,
                                        "item": item_name,
                                    }
                                )

            elif gen_type == "group_scenes":
                category_id = int(data["selected_group"])
                category = scene_repo.get_category(category_id)
                if not category:
                    raise ValueError(f"Scene category {category_id} not found")

                subcats = scene_repo.get_subcategories_by_category(category_id)
                for sub in subcats:
                    items = scene_repo.get_items_by_subcategory(sub.id)
                    for it in items:
                        full_prompt = (
                            "Create a professional product card: Place the product from the "
                            f"reference image into the scene: {category.name} → {sub.name} → {it.name}. "
                            f"Details: {it.prompt}. High quality, photorealistic, studio lighting, clean background."
                        )
                        input_data = {
                            "prompt": full_prompt,
                            "image_urls": [photo_url],
                            "output_format": "png",
                            "image_size": "3:4",
                        }
                        task_id = await asyncio.to_thread(
                            self.create_task_with_fallback, model, input_data
                        )
                        result = await self.poll_task(task_id)
                        if "resultUrls" in result and result["resultUrls"]:
                            image_bytes = await self.download_image(
                                result["resultUrls"][0]
                            )
                            results.append(
                                {
                                    "image": image_bytes,
                                    "category": category.name,
                                    "subcategory": sub.name,
                                    "item": it.name,
                                }
                            )

            elif gen_type == "single_scene":
                item_id = int(data["selected_item"])
                item = scene_repo.get_item(item_id)
                if not item:
                    raise ValueError(f"Scene item {item_id} not found")

                sub = scene_repo.get_subcategory(item.subcategory_id)
                if not sub:
                    raise ValueError(
                        f"Subcategory {item.subcategory_id} for item {item_id} not found"
                    )

                cat = scene_repo.get_category(sub.category_id)
                if not cat:
                    raise ValueError(
                        f"Category {sub.category_id} for subcategory {sub.id} not found"
                    )

                full_prompt = (
                    "Create a professional product card: Place the product from the "
                    f"reference image into the scene: {cat.name} → {sub.name} → {item.name}. "
                    f"Details: {item.prompt}. High quality, photorealistic, studio lighting, clean background."
                )
                input_data = {
                    "prompt": full_prompt,
                    "image_urls": [photo_url],
                    "output_format": "png",
                    "image_size": "3:4",
                }
                task_id = await asyncio.to_thread(self.create_task_with_fallback, model, input_data)
                result = await self.poll_task(task_id)
                if "resultUrls" in result and result["resultUrls"]:
                    image_bytes = await self.download_image(result["resultUrls"][0])
                    results.append(
                        {
                            "image": image_bytes,
                            "category": cat.name,
                            "subcategory": sub.name,
                            "item": item.name,
                        }
                    )
            else:
                raise ValueError("Unknown generation_type")
        finally:
            db.close()

        return results

    # ===== NORMALIZE / OWN MODEL (DB prompts bilan) =====

    async def normalize_own_model(
        self, 
        item_image_url: str, 
        model_image_url: str,
        ghost_prompt_override: Optional[str] = None,
        combine_prompt_override: Optional[str] = None,
        max_attempts: int | None = None,
    ) -> dict:
        model = "google/nano-banana-edit"
        
        db = SessionLocal()
        try:
            ghost_prompt, own_combine_prompt, _ = await self._get_normalize_prompts(db)
            
            # Override lar bor bo'lsa ularni ishlatamiz
            if ghost_prompt_override:
                ghost_prompt = ghost_prompt_override
            if combine_prompt_override:
                own_combine_prompt = combine_prompt_override

            # 1-qadam: itemdan ghost / maneken
            input_data_ghost = {
                "prompt": ghost_prompt,
                "image_urls": [item_image_url],
                "output_format": "png",
                "image_size": "3:4",
            }
            task_id_ghost = await asyncio.to_thread(
                self.create_task_with_fallback, model, input_data_ghost
            )
            ghost_result = await self.poll_task(task_id_ghost, max_attempts=max_attempts)
            if "resultUrls" not in ghost_result or not ghost_result["resultUrls"]:
                raise ValueError("No ghost image in result")
            ghost_url = ghost_result["resultUrls"][0]

            # 2-qadam: ghost + model photo
            input_data_combine = {
                "prompt": own_combine_prompt,
                "image_urls": [ghost_url, model_image_url],
                "output_format": "png",
                "image_size": "3:4",
            }
            task_id_combine = await asyncio.to_thread(
                self.create_task_with_fallback, model, input_data_combine
            )
            combine_result = await self.poll_task(task_id_combine, max_attempts=max_attempts)
            if "resultUrls" in combine_result and combine_result["resultUrls"]:
                return {"image": await self.download_image(combine_result["resultUrls"][0])}
            raise ValueError("No final image in result")
        finally:
            db.close()

    async def normalize_new_model(
        self, 
        item_image_url: str, 
        model_prompt: str,
        ghost_prompt_override: Optional[str] = None,
        new_model_prompt_override: Optional[str] = None,
        max_attempts: int | None = None,
    ) -> dict:
        model = "google/nano-banana-edit"

        db = SessionLocal()
        try:
            ghost_prompt, _, new_model_base_prompt = await self._get_normalize_prompts(db)
            
            # Override lar
            if ghost_prompt_override:
                ghost_prompt = ghost_prompt_override

            # 1-qadam: itemdan ghost / maneken
            input_data_ghost = {
                "prompt": ghost_prompt,
                "image_urls": [item_image_url],
                "output_format": "png",
                "image_size": "3:4",
            }
            task_id_ghost = await asyncio.to_thread(
                self.create_task_with_fallback, model, input_data_ghost
            )
            ghost_result = await self.poll_task(task_id_ghost, max_attempts=max_attempts)
            if "resultUrls" not in ghost_result or not ghost_result["resultUrls"]:
                raise ValueError("No ghost image in result")
            ghost_url = ghost_result["resultUrls"][0]

            # 2-qadam: yangi fotomodelni AI bilan generatsiya qilish
            if new_model_prompt_override:
                combine_prompt = new_model_prompt_override
            else:
                combine_prompt = (
                    f"{new_model_base_prompt} "
                    f"Model details: {model_prompt}"
                )
                
            input_data_combine = {
                "prompt": combine_prompt,
                "image_urls": [ghost_url],
                "output_format": "png",
                "image_size": "3:4",
            }
            task_id_combine = await asyncio.to_thread(
                self.create_task_with_fallback, model, input_data_combine
            )
            combine_result = await self.poll_task(task_id_combine, max_attempts=max_attempts)
            if "resultUrls" in combine_result and combine_result["resultUrls"]:
                return {"image": await self.download_image(combine_result["resultUrls"][0])}
            raise ValueError("No final image in result")
        finally:
            db.close()

    # ===== VIDEO / SIMPLE EDITS =====

    async def enhance_photo(
        self, 
        photo_url: str, 
        level: str = "medium",
        max_attempts: int | None = None,
    ) -> dict:
        model = "google/nano-banana-edit"
        
        prompts = {
            "light": (
                "Light photo enhancement: slightly improve sharpness, "
                "brightness and colors. Keep natural look. Professional photography quality."
            ),
            "medium": (
                "Medium photo enhancement: improve sharpness, adjust lighting, "
                "enhance colors, reduce noise. High-quality professional result."
            ),
            "strong": (
                "Strong photo enhancement: significantly improve sharpness, "
                "optimize lighting, vivid colors, remove all noise, "
                "professional studio quality result."
            )
        }
        
        prompt = prompts.get(level, prompts["medium"])
        
        input_data = {
            "prompt": prompt,
            "image_urls": [photo_url],
            "output_format": "png",
        }

        task_id = await asyncio.to_thread(
            self._try_create_task_with_size_fallback,
            model,
            input_data,
            image_sizes=["3:4", "1:1", "2:3", "768:1024", "1024:768", "1024:1024"],
        )
        result = await self.poll_task(task_id, max_attempts=max_attempts)
        
        if "resultUrls" in result and result["resultUrls"]:
            return {"image": await self.download_image(result["resultUrls"][0])}
        
        raise ValueError("No image in result")

    async def generate_video(
        self,
        image_url: str,
        prompt: str,
        model: str,
        duration: int,
        resolution: str,
        max_attempts: int | None = None,
    ) -> dict:
        logger.info(f"Starting video generation with model: {model}")
        logger.info(f"Image URL: {image_url}")
        logger.info(f"Prompt: {prompt}")
        logger.info(f"Duration: {duration}, Resolution: {resolution}")

        if "grok" in model.lower():
            input_data = {
                "image_urls": [image_url],
                "index": 0,
                "prompt": prompt,
                "mode": "normal",
            }
            logger.info("Using Grok model format")
        else:
            input_data = {
                "prompt": prompt,
                "image_url": image_url,
                "duration": str(duration),
                "resolution": resolution,
            }
            logger.info("Using Hailuo model format")

        logger.info(f"Creating task with input: {input_data}")
        task_id = await asyncio.to_thread(self.create_task_with_fallback, model, input_data)
        logger.info(f"Task created with ID: {task_id}")
        logger.info("Starting to poll task status...")
        result = await self.poll_task(task_id, max_attempts=max_attempts)
        logger.info(f"Video generation complete! Result: {result}")

        if "resultUrls" in result and result["resultUrls"]:
            video_url = result["resultUrls"][0]
            logger.info(f"Downloading video from: {video_url}")
            video_bytes = await self.download_image(video_url)
            logger.info(f"Video downloaded successfully, size: {len(video_bytes)} bytes")
            return {"video": video_bytes}

        logger.error(f"No video URLs in result: {result}")
        raise ValueError(f"No video URLs in result: {result}")

    # ===== SIMPLE SCENE / POSE / CUSTOM EDITS =====

    async def change_scene(
        self,
        image_url: str,
        prompt: str,
        max_attempts: int | None = None,
    ) -> dict:
        model = "google/nano-banana-edit"
        full_prompt = (
            "Scene transformation using the reference image: Change the background and scene to "
            f"{prompt}. Keep the main subject (person or product) unchanged, professional photography, "
            "high detail, photorealistic."
        )
        input_data = {
            "prompt": full_prompt,
            "image_urls": [image_url],
            "output_format": "png",
            "image_size": "3:4",
        }
        task_id = await asyncio.to_thread(self.create_task_with_fallback, model, input_data)
        result = await self.poll_task(task_id, max_attempts=max_attempts)
        if "resultUrls" in result and result["resultUrls"]:
            return {"image": await self.download_image(result["resultUrls"][0])}
        raise ValueError("No image in result")

    async def change_pose(
        self,
        image_url: str,
        prompt: str,
        max_attempts: int | None = None,
    ) -> dict:
        model = "google/nano-banana-edit"
        full_prompt = (
            "Pose transformation using the reference image: Change the pose to "
            f"{prompt}. Keep the face, clothing, and other details unchanged, "
            "natural body position, professional photography, high quality."
        )
        input_data = {
            "prompt": full_prompt,
            "image_urls": [image_url],
            "output_format": "png",
            "image_size": "3:4",
        }
        task_id = await asyncio.to_thread(self.create_task_with_fallback, model, input_data)
        result = await self.poll_task(task_id, max_attempts=max_attempts)
        if "resultUrls" in result and result["resultUrls"]:
            return {"image": await self.download_image(result["resultUrls"][0])}
        raise ValueError("No image in result")

    async def custom_generation(
        self,
        image_url: str,
        prompt: str,
        max_attempts: int | None = None,
    ) -> dict:
        model = "google/nano-banana-edit"
        full_prompt = (
            "Custom image edit based on the reference image: "
            f"{prompt}. High quality, photorealistic, maintain original subject details."
        )
        input_data = {
            "prompt": full_prompt,
            "image_urls": [image_url],
            "output_format": "png",
            "image_size": "3:4",
        }
        task_id = await asyncio.to_thread(self.create_task_with_fallback, model, input_data)
        result = await self.poll_task(task_id, max_attempts=max_attempts)
        if "resultUrls" in result and result["resultUrls"]:
            return {"image": await self.download_image(result["resultUrls"][0])}
        raise ValueError("No image in result")
    
    async def combine_elements(
        self, 
        main_image_url: str, 
        reference_image_url: str, 
        prompt: str
    ) -> dict:
        """
        Combine elements from two images.
        Main image provides the subject (person/product).
        Reference image provides the element to transfer (background, style, colors, etc.)
        """
        model = "google/nano-banana-edit"
        full_prompt = (
            f"Multi-image composition: {prompt}. "
            "Use the first reference image as the main subject, "
            "and the second reference image for the requested elements. "
            "High quality, photorealistic, seamless blend, professional result."
        )
        input_data = {
            "prompt": full_prompt,
            "image_urls": [main_image_url, reference_image_url],
            "output_format": "png",
            "image_size": "3:4",
        }
        task_id = await asyncio.to_thread(self.create_task_with_fallback, model, input_data)
        result = await self.poll_task(task_id)
        if "resultUrls" in result and result["resultUrls"]:
            return {"image": await self.download_image(result["resultUrls"][0])}
        raise ValueError("No image in result")
    
    async def inpaint_generation(self, photo_url: str, mask_bytes: bytes | None, prompt: str, mask_url: str | None = None) -> dict:
        """
        Inpainting - edit specific area of image using mask.
        
        photo_url: Original image URL
        mask_bytes: Mask image bytes (white = area to edit, black = keep)
        mask_url: Pre-uploaded mask URL (alternative to mask_bytes)
        prompt: Description of what to generate in the masked area
        
        Strategy: Send mask as second reference image and instruct model to edit only white areas.
        """
        model = "google/nano-banana-edit"
        
        # Use mask_url if provided, otherwise we can't use mask_bytes directly (KIE doesn't support data URLs)
        if mask_url:
            # Use more specific prompt for masked editing
            full_prompt = (
                f"Look at the second reference image (mask). The WHITE areas indicate where to make changes. "
                f"In those WHITE areas only, apply: {prompt}. "
                f"Keep all BLACK areas of the mask completely unchanged - do not modify them at all. "
                f"The first image is the original photo. Edit ONLY the white mask areas. "
                f"High quality, photorealistic, seamless blend."
            )
            
            input_data = {
                "prompt": full_prompt,
                "image_urls": [photo_url, mask_url],
                "output_format": "png",
                "image_size": "3:4",
            }
        else:
            # No mask URL - use prompt-based editing for the whole image
            # Include mask instruction in prompt to guide the model
            if mask_bytes:
                # We have mask but can't use it directly - inform about the limitation
                logger.warning("Mask bytes provided but KIE doesn't support data URLs. Using prompt-based editing.")
            
            full_prompt = (
                f"Edit the image: {prompt}. "
                f"High quality, photorealistic, maintain overall style and keep other areas unchanged."
            )
            
            input_data = {
                "prompt": full_prompt,
                "image_urls": [photo_url],
                "output_format": "png",
                "image_size": "3:4",
            }
        
        task_id = await asyncio.to_thread(self.create_task_with_fallback, model, input_data)
        result = await self.poll_task(task_id)
        if "resultUrls" in result and result["resultUrls"]:
            return {"image": await self.download_image(result["resultUrls"][0])}
        raise ValueError("No image in result")
    
    async def upscale_image(
        self,
        source_image_url: str,
    ) -> dict:
        """
        recraft/crisp-upscale orqali rasmni upscale qiladi
        source_image_url — vaqtinchalik (yangi nom bilan) rasm URL
        """
        model = "recraft/crisp-upscale"

        input_data = {
            "image": source_image_url
        }

        task_id = await asyncio.to_thread(
            self.create_task,
            model,
            input_data
        )

        result = await self.poll_task(task_id)

        if "resultUrls" in result and result["resultUrls"]:
            image_url = result["resultUrls"][0]
            image_bytes = await self.download_image(image_url)
            return {"image": image_bytes}

        raise ValueError("No upscale image in result")


kie_service = KIEService()
