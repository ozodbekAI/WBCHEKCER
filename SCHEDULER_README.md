# Card Scheduler — Avtomatik Sinxronizatsiya

## Nima qiladi?

`CardScheduler` har 10 daqiqada (default) barcha **ACTIVE** magazinlarni WB API'dan sinxronizatsiya qiladi va o'zgargan kartochkalarni qayta tahlil qiladi.

## Qanday ishlaydi?

### 1. **Ishga tushirish**
Server ishga tushganda `app/main.py` da avtomatik ishga tushadi:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    card_scheduler.start_background()  # ← Bu yerda
    yield
    card_scheduler.stop()
```

### 2. **Har 10 daqiqada bajaradi:**
1. Barcha `status=ACTIVE` magazinlarni topadi
2. Har bir magazin uchun:
   - WB API'dan barcha kartochkalarni oladi (pagination bilan)
   - `updatedAt` maydonini DB bilan solishtiradi
   - Faqat o'zgargan kartochkalarni qayta tahlil qiladi
3. `skip_next_reanalyze=True` bo'lgan kartochkalarni o'tkazib yuboradi (bizning fix qilgan kartochkalar)

### 3. **Skip Logic**
Agar siz kartochkani to'g'rilab WB'ga yuklasangiz:
- Kartochka `skip_next_reanalyze=True` bo'lib belgilanadi
- Keyingi scheduler tick'ida u kartochka qayta tahlil qilinmaydi
- Bu infinite loop'dan qochish uchun (biz fix qilgan → WB updatedAt o'zgardi → qayta tahlil → yana fix → ...)

## Status tekshirish

### API orqali:
```bash
curl http://localhost:8002/api/scheduler/status
```

Javob:
```json
{
  "is_running": true,
  "interval_sec": 600,
  "last_tick_at": "2026-03-06T10:30:00",
  "next_tick_at": "2026-03-06T10:40:00",
  "next_tick_in_sec": 450
}
```

### Loglardan:
```bash
tail -f logs/app.log | grep card-scheduler
```

Misol:
```
[card-scheduler] started, interval=600s
[card-scheduler] checking 3 store(s)
[card-scheduler] store_id=1 'My Store' sync started
[card-scheduler] store_id=1 page 1: fetched 100 cards
[card-scheduler] store_id=1 fetched 250 cards from WB
[card-scheduler] store_id=1 re-analyzing 15 changed card(s)
[card-scheduler] store_id=1 nm_id=123456 re-analyzed (1/15)
[card-scheduler] store_id=1 completed: 15 analyzed, 0 failed
```

## Sozlamalar

`.env` faylida:
```bash
# Interval (sekundlarda), default: 600 (10 daqiqa)
CARD_SCHEDULER_INTERVAL_SEC=600

# Debug rejimida ko'proq log
DEBUG=true
```

## Xatolik bartaraf qilish

### Scheduler ishlamayapti
1. Server ishga tushganini tekshiring:
   ```bash
   curl http://localhost:8002/health
   ```

2. Loglarni tekshiring:
   ```bash
   tail -f logs/app.log | grep scheduler
   ```

3. Status API'ni tekshiring:
   ```bash
   curl http://localhost:8002/api/scheduler/status
   ```

### WB API xatolari
```
[card-scheduler] store_id=1 WB API error (page 1): Invalid token
```
- API key'ni tekshiring
- WB'da token hali active ekanligini tekshiring

### Kartochkalar qayta tahlil qilinmayapti
```
[card-scheduler] store_id=1 no changes detected
```
- Bu normal - WB'da hech narsa o'zgarmagan
- Manual test qilish:
  ```bash
  # WB'da kartochkani o'zgartiring, keyin
  curl -X POST http://localhost:8002/api/stores/1/sync
  ```

## Manual Sinxronizatsiya

Scheduler kutmasdan darhol sinxronizatsiya qilish:

```bash
# Barcha kartochkalar
POST /api/stores/{store_id}/sync

# Faqat tanlangan kartochkalar
POST /api/stores/{store_id}/sync
{
  "nm_ids": [123456, 789012]
}
```

## To'xtatish / qayta ishga tushirish

Scheduler faqat server qayta ishga tushganda to'xtaydi va qayta ishga tushadi:

```bash
# Server restart
pkill -f "uvicorn app.main:app"
uvicorn app.main:app --reload --host 0.0.0.0 --port 8002
```

Scheduler avtomatik qayta ishga tushadi `lifespan` hook orqali.
