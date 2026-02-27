# services/promotion_math.py
import math

def calc_spend_rub(photos_count: int, views_per_photo: int, cpm_rub: int) -> int:
    raw = (photos_count * views_per_photo * cpm_rub) / 1000.0
    raw10 = raw * 1.1
    spend = max(raw10, 1000.0)
    return int(math.ceil(spend / 100.0) * 100)
