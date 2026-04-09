from __future__ import annotations

from typing import Any, Dict


def map_photo_error(raw_error: Any, *, context: str | None = None) -> Dict[str, Any]:
    raw_text = str(raw_error or "").strip()
    lowered = raw_text.lower()

    payload: Dict[str, Any] = {
        "code": "photo_operation_failed",
        "message": "Операция не завершилась. Повторите попытку.",
        "retryable": True,
        "category": "unknown",
        "http_status": 400,
    }
    if context:
        payload["context"] = str(context)

    if not raw_text:
        return payload

    if "unauthorized" in lowered:
        return {
            **payload,
            "code": "photo_unauthorized",
            "message": "Сессия истекла. Обновите страницу и войдите снова.",
            "retryable": False,
            "category": "auth",
            "http_status": 401,
        }

    if (
        "asset not found" in lowered
        or "не нашёл выбранное фото" in lowered
        or "photo not found on wb card" in lowered
    ):
        return {
            **payload,
            "code": "photo_asset_not_found",
            "message": "Не удалось найти выбранное изображение. Выберите фото заново.",
            "retryable": True,
            "category": "asset",
            "http_status": 400,
        }

    if (
        "source_url is required" in lowered
        or "cannot load source image" in lowered
        or "unsupported url" in lowered
        or ("unsupported" in lowered and "host" in lowered)
        or "redirected to an unsupported host" in lowered
        or "url does not point to an image" in lowered
        or "image is too large" in lowered
        or "не найдены загруженные фото" in lowered
        or "пришлите фото" in lowered
    ):
        return {
            **payload,
            "code": "photo_source_image_missing",
            "message": "Не удалось получить исходное фото. Загрузите или выберите другое изображение.",
            "retryable": True,
            "category": "input",
            "http_status": 400,
        }

    if "duplicate photo urls are not allowed" in lowered or "resolved photo list contains duplicates" in lowered:
        return {
            **payload,
            "code": "photo_duplicate_sources",
            "message": "В списке есть дубли фото. Удалите повторяющиеся изображения и повторите.",
            "retryable": True,
            "category": "input",
            "http_status": 400,
        }

    if (
        "no image in result" in lowered
        or "пустой результат" in lowered
        or "empty result" in lowered
        or "gemini вернул пустой результат" in lowered
    ):
        return {
            **payload,
            "code": "photo_generation_empty_result",
            "message": "Генерация не вернула изображение. Измените запрос и попробуйте снова.",
            "retryable": True,
            "category": "generation",
            "http_status": 502,
        }

    if "no video in result" in lowered:
        return {
            **payload,
            "code": "photo_generation_no_video",
            "message": "Видео не сгенерировалось в этой попытке. Попробуйте другой промпт.",
            "retryable": True,
            "category": "generation",
            "http_status": 502,
        }

    if (
        "wb media save failed" in lowered
        or "wb photo upload failed" in lowered
        or "wb photo replace failed" in lowered
        or "wb apply failed" in lowered
        or "wb media/file failed" in lowered
        or "did not return a photo url" in lowered
    ):
        return {
            **payload,
            "code": "photo_wb_apply_failed",
            "message": "Не удалось применить изменения в WB. Повторите попытку позже.",
            "retryable": True,
            "category": "wb_apply",
            "http_status": 502,
        }

    if (
        "timed out" in lowered
        or "timeout" in lowered
        or "readtimeout" in lowered
        or "connecttimeout" in lowered
        or "pooltimeout" in lowered
    ):
        return {
            **payload,
            "code": "photo_upstream_timeout",
            "message": "Внешний сервис не ответил вовремя. Повторите попытку через минуту.",
            "retryable": True,
            "category": "upstream",
            "http_status": 504,
        }

    if "insufficient" in lowered and "credit" in lowered:
        return {
            **payload,
            "code": "photo_insufficient_credits",
            "message": "Недостаточно кредитов для генерации. Пополните баланс и повторите.",
            "retryable": False,
            "category": "billing",
            "http_status": 402,
        }

    if "pose prompt not found" in lowered:
        return {
            **payload,
            "code": "photo_pose_not_found",
            "message": "Выбранная поза недоступна. Выберите другую позу.",
            "retryable": True,
            "category": "input",
            "http_status": 400,
        }

    if "scene item not found" in lowered:
        return {
            **payload,
            "code": "photo_scene_not_found",
            "message": "Выбранная сцена недоступна. Обновите каталог и попробуйте снова.",
            "retryable": True,
            "category": "input",
            "http_status": 400,
        }

    if "quick_action.type is required" in lowered:
        return {
            **payload,
            "code": "photo_action_missing",
            "message": "Не удалось определить действие. Выберите команду заново.",
            "retryable": True,
            "category": "input",
            "http_status": 400,
        }

    if "new_model_prompt or model_item_id is required" in lowered or "промпт не указан" in lowered:
        return {
            **payload,
            "code": "photo_prompt_missing",
            "message": "Нужен промпт или выбор модели из каталога.",
            "retryable": True,
            "category": "input",
            "http_status": 400,
        }

    if lowered.startswith("ошибка quick_action"):
        return {
            **payload,
            "code": "photo_quick_action_failed",
            "message": "Команда не выполнилась из-за технической ошибки. Повторите позже.",
            "retryable": True,
            "category": "generation",
            "http_status": 500,
        }

    return payload


def map_photo_error_message(raw_message: str) -> str:
    return str(map_photo_error(raw_message).get("message") or "Операция не завершилась. Повторите попытку.")
