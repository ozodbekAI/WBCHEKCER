# backend/services/kie_service/ui_config.py

KIE_UI_CONFIG = {
    "product_card": {
        "per_result": 1
    },
    "normalize": {
        "own_model": 2,
        "new_model": 2
    },
    "video": {
        "balance": {
            "cost": 3,
            "model": "grok-imagine/image-to-video",
            "duration": "~6 сек",
            "resolution": "720P"
        },
        "pro_6": {
            "cost": 6,
            "model": "hailuo/2-3-image-to-video-pro",
            "duration": "~6 сек",
            "resolution": "768P"
        },
        "pro_10": {
            "cost": 8,
            "model": "hailuo/2-3-image-to-video-pro",
            "duration": "~10 сек",
            "resolution": "768P"
        },
        "super_6": {
            "cost": 10,
            "model": "hailuo/2-3-image-to-video-pro",
            "duration": "~6 сек",
            "resolution": "1080P"
        }
    },
    "photo": {
        "scene_change": 1,
        "pose_change": 1,
        "custom_scenario": 1
    }
}
