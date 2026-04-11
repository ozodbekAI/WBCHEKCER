# Photo Studio Chat Backend

Bu hujjat Photo Studio chat backendining hozirgi yakuniy holatini yozadi:

- qaysi backend fayllar o'zgargani
- eski holatdan yangi holatga nimalar o'tgani
- model / repository / controller / planner logikasi
- endpoint contractlari
- SSE contract
- deprecated va compatibility holatlari

Bu fayl Photo Studio chat uchun backend reference sifatida ishlatiladi.

## 1. Refaktor Natijasi

Photo Studio chat endi session-only chat emas.

Yangi yakuniy arxitektura:

- user uchun bitta canonical `photo_chat_session` mavjud
- shu session ichida persistent media library saqlanadi
- chatning o'zi esa `thread`lar bo'yicha yuradi
- har bir message endi `thread_id` va `request_id` bilan bog'langan
- thread state endi JSON `context_state` ichida saqlanadi
- planner endi butun session media kutubxonasini emas, faqat shu request + thread context + shu threadning oxirgi 12 ta messageini oladi
- SSE endi bitta normal ko'rinishga keltirilgan: `event: message`

## 2. O'zgargan Backend Fayllar

Quyidagi backend fayllar ushbu refaktor doirasida o'zgardi:

- `app/models/photo_chat.py`
- `app/services/photo_chat_repository.py`
- `app/schemas/photo_chat.py`
- `alembic/versions/c3f4b8a1d9e2_add_photo_chat_threads_and_message_context.py`
- `app/routers/photo_chat.py`
- `app/controllers/photo_chat_controller.py`
- `app/services/photo_chat_agent.py`
- `app/services/media_storage.py`
- `app/core/config.py`

Test va contract fayllari:

- `tests/test_photo_chat_repository.py`
- `tests/test_photo_chat_contract.py`
- `tests/test_photo_chat_stream_contract.py`
- `tests/test_photo_chat_planner_helpers.py`

## 3. Eski Holatdan Nima O'zgardi

### 3.1 Session modeli

Eski holat:

- chat sessionga bog'liq edi
- `client_session_id` logikada muhimroq rol o'ynardi
- follow-up editlarda session-level state va dead helperlar ishlatilardi

Yangi holat:

- canonical root session foydalanuvchi bo'yicha aniqlanadi
- `client_session_id` compatibility uchun qoldirilgan, lekin canonical behaviorga ta'sir qilmaydi
- persistent media session darajasida qoladi
- conversation state threadga ko'chirildi

### 3.2 Chat state

Eski holat:

- `pending_asset_ids` kabi session helper logikalari bor edi
- follow-up editlar aniq va barqaror targetga ega emasdi

Yangi holat:

- session helper olib tashlandi
- uning o'rniga thread `context_state` ishlatiladi
- follow-up editlar threaddagi active working image(lar)ga tayanadi

### 3.3 History va clear logikasi

Eski holat:

- history session chat sifatida ko'rilardi
- clear ham umumiy chat clearga yaqin edi

Yangi holat:

- history thread-based
- `GET /api/photo/chat/history` endi thread info + context state qaytaradi
- `POST /api/photo/chat/clear` endi `messages|context|all` rejimlariga ega
- persistent media clear bilan o'chmaydi

### 3.4 SSE logikasi

Eski holat:

- turli event nomlari va eskirgan payload shakllari mavjud edi

Yangi holat:

- SSE event nomi faqat bitta: `message`
- client branch qilishni `payload.type` bo'yicha qiladi
- har bir payloadda `type`, `request_id`, `thread_id` bo'ladi

### 3.5 Planner / agent logikasi

Eski holat:

- forced Russian behavior bor edi
- follow-up editlar ko'pincha guessed edit bo'lib ketardi
- promptlarni sanitization qilish ba'zan `Image 1`, `Image 2` referencelarini buzardi
- `generate_image` va `edit_image` orasida controller tarafida majburiy rewrite bor edi

Yangi holat:

- forced Russian olib tashlangan
- locale thread contextdan olinadi, bo'lmasa latest real user message tilidan aniqlanadi
- `Image 1`, `Image 2` positional referencelar saqlanadi
- ambiguous request `intent=question` bo'ladi
- planner real `thread_context` bilan ishlaydi
- controller tarafida `generate_image -> edit_image` coercion yo'q

## 4. Final Arxitektura

### 4.1 Canonical session

Canonical session root:

- har bir authenticated user uchun `photo_chat_sessions` ichida session mavjud
- persistent media library shu sessionga tegishli
- generated / uploaded / imported assetlar shu yerda saqlanadi

### 4.2 Thread-based chat

Har bir session ichida bir nechta thread bo'lishi mumkin:

- bitta active thread
- eski threadlar saqlanib qoladi
- `POST /api/photo/threads/new` yangi active thread yaratadi

### 4.3 Thread context

Har bir thread JSON context saqlaydi:

```json
{
  "last_generated_asset_id": null,
  "working_asset_ids": [],
  "pending_question": null,
  "last_action": null,
  "locale": null
}
```

Field ma'nolari:

- `last_generated_asset_id`: oxirgi yaratilgan asset
- `working_asset_ids`: follow-up editlar uchun active target assetlar
- `pending_question`: assistant so'ragan oxirgi clarification
- `last_action`: oxirgi bajarilgan action metadata
- `locale`: thread uchun tanlangan locale

## 5. Database va Migration O'zgarishlari

Migration:

- `alembic/versions/c3f4b8a1d9e2_add_photo_chat_threads_and_message_context.py`

Kiritilgan o'zgarishlar:

- yangi `photo_chat_threads` jadvali qo'shildi
- `photo_chat_messages` ga `thread_id` qo'shildi
- `photo_chat_messages` ga `request_id` qo'shildi
- legacy message'lar har bir session uchun default active threadga backfill qilindi
- shundan keyin `thread_id` non-null qilindi

Final model holati:

- `photo_chat_sessions`
- `photo_chat_threads`
- `photo_chat_messages`
- `photo_chat_media`

## 6. Repository Final Behavior

`app/services/photo_chat_repository.py` dagi muhim methodlar:

- `get_or_create_active_thread`
- `create_new_thread`
- `get_thread`
- `list_thread_messages`
- `clear_thread_messages`
- `get_thread_context`
- `update_thread_context`
- `reset_thread_context`

Muhim behavior:

- active thread bo'lmasa avtomatik yaratiladi
- bir session ichida faqat bitta active thread saqlanadi
- thread context har safar normalize qilinadi
- clear faqat thread messages/contextga ta'sir qiladi
- session media libraryga tegilmaydi

Compatibility helperlar:

- `set_pending_assets`
- `pop_pending_assets`

Bu helperlar endi session magic emas, active thread `working_asset_ids` bilan ishlaydi.

## 7. Controller va Planner Final Logic

## 7.1 History context build

Planner context build qilinayotganda quyidagilar ishlatiladi:

- current request `asset_ids`
- thread `context_state`
- shu threadning oxirgi 12 ta messagei

Default bo'yicha butun session media library plannerga context sifatida berilmaydi.

## 7.2 Edit target resolution

`edit_image` flow uchun target tanlash tartibi:

1. planner qaytargan `selected_asset_ids`
2. current request `asset_ids`
3. thread `working_asset_ids`
4. thread history ichidagi oxirgi relevant assetlar
5. `last_generated_asset_id`

Agar baribir aniq target topilmasa:

- guessed edit qilinmaydi
- `question` qaytariladi

## 7.3 Locale behavior

Locale tanlash qoidasi:

1. agar `thread_context.locale` bo'lsa, shu ishlatiladi
2. bo'lmasa latest real user message tilidan detect qilinadi
3. fallback: `en`

Supported behavior:

- Russian-only forced output yo'q
- Uzbek locale real qo'llab-quvvatlanadi

## 7.4 Prompt behavior

Prompt bilan bog'liq final qoida:

- `Image 1`, `Image 2` positional reference saqlanadi
- `_strip_multi_words()` collage/grid kabi multi-image so'zlarni olib tashlashi mumkin
- lekin positional image referencesni buzmaydi
- `_make_single_image_prompt()` endi majburiy ravishda same background / same outfit / full-body kiritmaydi

## 7.5 Final generation flow

Image generation/edit tugagach:

1. `generation_complete` chunk(lar)i yuboriladi
2. thread context update qilinadi
3. yakunda `chat` chunk yuboriladi
4. undan keyin `context_state` chunk yuboriladi

Bu frontendga active working image holatini darhol update qilish imkonini beradi.

## 7.6 File URL generation

Media URL final behavior:

- avval request'dan kelgan `base_url`
- keyin `MEDIA_PUBLIC_BASE_URL`
- keyin `PUBLIC_BASE_URL`

Demak backend endi localhost fallbackni ko'r-ko'rona ishlatmaydi.

## 8. Endpointlar

Quyida Photo Studio chat backendning final endpoint contractlari berilgan.

### 8.1 `POST /api/photo/assets/upload`

Vazifasi:

- user assetni canonical session media libraryga yuklaydi

Request:

```http
Content-Type: multipart/form-data
```

Form fields:

- `file`: required
- `client_session_id`: optional, deprecated

Response:

```json
{
  "asset_id": 101,
  "seq": 1,
  "file_url": "https://backend.example.com/media/photos/abc.jpg",
  "file_name": "abc.jpg",
  "caption": "Optional caption"
}
```

### 8.2 `POST /api/photo/assets/import`

Vazifasi:

- tashqi URL'dagi image'ni canonical session media libraryga import qiladi

Request:

```json
{
  "source_url": "https://example.com/image.jpg",
  "client_session_id": "deprecated"
}
```

Response:

```json
{
  "asset_id": 102,
  "seq": 2,
  "file_url": "https://backend.example.com/media/photos/imported.jpg",
  "file_name": "imported.jpg",
  "caption": ""
}
```

### 8.3 `POST /api/photo/threads/new`

Vazifasi:

- yangi active thread yaratadi

Behavior:

- new thread darhol active bo'ladi
- old threadlar saqlanadi
- persistent session media saqlanib qoladi
- old active threaddagi `locale` bo'lsa, yangi threadga ko'chiriladi

Response:

```json
{
  "session_key": "42",
  "thread_id": 56,
  "active_thread_id": 56,
  "context_state": {
    "last_generated_asset_id": null,
    "working_asset_ids": [],
    "pending_question": null,
    "last_action": null,
    "locale": "uz"
  },
  "message_count": 0,
  "limit": null,
  "locked": false,
  "messages": [],
  "assets": [
    {
      "asset_id": 101,
      "seq": 1,
      "kind": "image",
      "source": "upload",
      "file_url": "https://backend.example.com/media/photos/abc.jpg",
      "file_name": "abc.jpg",
      "prompt": null,
      "caption": "",
      "meta": {}
    }
  ]
}
```

### 8.4 `GET /api/photo/chat/history`

Vazifasi:

- active thread yoki request qilingan thread historysini qaytaradi

Query params:

- `thread_id`: optional

Response:

```json
{
  "session_key": "42",
  "thread_id": 55,
  "active_thread_id": 56,
  "context_state": {
    "last_generated_asset_id": 103,
    "working_asset_ids": [103],
    "pending_question": null,
    "last_action": {
      "type": "generate_image",
      "status": "completed"
    },
    "locale": "uz"
  },
  "message_count": 2,
  "limit": null,
  "locked": false,
  "messages": [
    {
      "id": 901,
      "role": "user",
      "msg_type": "text",
      "content": "shu rasmni oq qil",
      "meta": {
        "asset_ids": [103]
      },
      "thread_id": 55,
      "request_id": "req_123",
      "created_at": "2026-04-10T10:10:10.000000"
    }
  ],
  "assets": [
    {
      "asset_id": 103,
      "seq": 3,
      "kind": "image",
      "source": "generated",
      "file_url": "https://backend.example.com/media/photos/generated.jpg",
      "file_name": "generated.jpg",
      "prompt": "Make the image white",
      "caption": "",
      "meta": {}
    }
  ]
}
```

Muhim:

- `messages` thread-scoped
- `assets` session-scoped persistent media
- `context_state` thread-scoped

### 8.5 `POST /api/photo/chat/messages/delete`

Vazifasi:

- active thread yoki ko'rsatilgan thread ichidagi message'larni o'chiradi

Request:

```json
{
  "thread_id": 55,
  "message_ids": [901, 902]
}
```

Response:

```json
{
  "thread_id": 55,
  "active_thread_id": 56,
  "deleted": 2,
  "deleted_media": 0,
  "message_count": 0,
  "limit": null,
  "locked": false
}
```

Muhim:

- media o'chmaydi
- faqat message row'lar o'chadi

### 8.6 `POST /api/photo/chat/clear`

Vazifasi:

- thread messages, thread context yoki ikkalasini tozalaydi

Request:

```json
{
  "thread_id": 55,
  "clear_mode": "all"
}
```

Allowed `clear_mode`:

- `messages`
- `context`
- `all`

Behavior:

- `messages`: faqat thread messages o'chadi
- `context`: faqat `context_state` reset bo'ladi
- `all`: messages + `context_state` reset bo'ladi
- persistent media saqlanadi

Response:

```json
{
  "thread_id": 55,
  "active_thread_id": 56,
  "clear_mode": "all",
  "deleted": 3,
  "deleted_media": 0,
  "context_state": {
    "last_generated_asset_id": null,
    "working_asset_ids": [],
    "pending_question": null,
    "last_action": null,
    "locale": null
  },
  "message_count": 0,
  "limit": null,
  "locked": false
}
```

### 8.7 `POST /api/photo/chat/stream`

Vazifasi:

- asosiy chat/planner/edit/generation SSE endpoint

Canonical request:

```json
{
  "message": "shu rasmni oq qil",
  "asset_ids": [103],
  "quick_action": {
    "type": "change-background",
    "scene_item_id": 12
  },
  "thread_id": 55,
  "request_id": "req_123",
  "locale": "uz"
}
```

Compatibility request fields hali schema ichida mavjud:

- `photo_urls`
- `photo_url`
- `client_session_id`

Lekin final frontend/backend contract uchun tavsiya etiladigan canonical input:

- `message`
- `asset_ids`
- `quick_action`
- `thread_id`
- `request_id`
- `locale`

Rulelar:

- `thread_id` bo'lmasa active thread ishlatiladi
- `request_id` bo'lmasa backend generatsiya qiladi
- `locale` bo'lsa thread contextga yozilishi mumkin
- planner context faqat relevant request/thread context bilan build qilinadi

## 9. SSE Contract

Final SSE event nomi:

```text
event: message
```

Har bir payloadda bo'lishi kerak:

- `type`
- `request_id`
- `thread_id`

Canonical `type` qiymatlari:

- `ack`
- `chat`
- `question`
- `generation_start`
- `images_start`
- `image_started`
- `generation_complete`
- `error`
- `limit_reached`
- `context_state`

Compatibility note:

- backendda ayrim legacy branchlarda `response` payload type uchrashi mumkin
- yangi client contract uchun `chat` va `question` canonical hisoblanadi

### 9.1 Ack

```text
event: message
data: {"type":"ack","request_id":"req_123","thread_id":55,"user_message_id":901}
```

### 9.2 Chat

```text
event: message
data: {"type":"chat","request_id":"req_123","thread_id":55,"content":"Tayyor bo'ldi","message_id":902}
```

### 9.3 Question

```text
event: message
data: {"type":"question","request_id":"req_123","thread_id":55,"content":"Qaysi rasmni edit qilishim kerak?","message_id":903}
```

### 9.4 Generation Start

```text
event: message
data: {"type":"generation_start","request_id":"req_123","thread_id":55,"prompt":"Make background white"}
```

### 9.5 Images Start / Image Started

```text
event: message
data: {"type":"images_start","request_id":"req_123","thread_id":55,"total":2}

event: message
data: {"type":"image_started","request_id":"req_123","thread_id":55,"index":1,"total":2}
```

### 9.6 Generation Complete

```text
event: message
data: {
  "type": "generation_complete",
  "request_id": "req_123",
  "thread_id": 55,
  "image_url": "https://backend.example.com/media/photos/generated.jpg",
  "file_name": "generated.jpg",
  "prompt": "Make background white",
  "asset_id": 103,
  "message_id": 904,
  "index": 1,
  "total": 1
}
```

### 9.7 Error

```text
event: message
data: {
  "type": "error",
  "request_id": "req_123",
  "thread_id": 55,
  "message": "Unsupported URL host",
  "code": "photo_invalid_source",
  "retryable": false,
  "error": {
    "message": "Unsupported URL host"
  }
}
```

### 9.8 Limit Reached

```text
event: message
data: {
  "type": "limit_reached",
  "request_id": "req_123",
  "thread_id": 55,
  "message": "The message limit has been reached. Delete some messages or clear the chat to continue.",
  "limit": null
}
```

### 9.9 Final Context State

```text
event: message
data: {
  "type": "context_state",
  "request_id": "req_123",
  "thread_id": 55,
  "context_state": {
    "last_generated_asset_id": 103,
    "working_asset_ids": [103],
    "pending_question": null,
    "last_action": {
      "type": "edit_image",
      "status": "completed",
      "source_asset_ids": [101],
      "generated_asset_ids": [103],
      "image_count": 1
    },
    "locale": "uz"
  }
}
```

## 10. Quick Summary: Frontend Nimani To'g'ri Tushunishi Kerak

- `thread_id` authoritative identifier
- `history.messages` thread-scoped
- `history.assets` session-wide persistent media
- `context_state` thread-scoped
- `clear_mode=all` messages + contextni reset qiladi, media'ni emas
- `New chat` conversationni tozalaydi, lekin media libraryni o'chirmaydi
- follow-up editlar `working_asset_ids` va `last_generated_asset_id` bilan bog'lanadi
- `question` oddiy final answer emas, clarification state
- `context_state` kelgach active working image UI darhol update qilinishi kerak

## 11. Deprecated va Compatibility Holatlari

Quyidagilar compatibility uchun qoldirilgan:

- `client_session_id`
- `photo_url`
- `photo_urls`

Lekin final contract nuqtai nazaridan:

- `client_session_id` required emas
- canonical media reference `asset_id`
- canonical thread reference `thread_id`

## 12. Yakuniy Backend Holati

Qisqa qilib aytganda, Photo Studio chat backend endi quyidagi statega kelgan:

- persistence thread-based
- media library session-based
- planner thread-aware
- locale-aware
- follow-up editlar active working imagega tayanadi
- ambiguous request guessed edit emas, `question`
- SSE normal ko'rinishga keltirilgan
- clear/new-thread behavior aniq ajratilgan
- history endpoint thread + context + persistent assetsni qaytaradi

Shu hujjat Photo Studio chat backendning hozirgi to'liq yakuniy contracti va change summarysi hisoblanadi.
