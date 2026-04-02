# WB Card Optimizer

Сервис для автоматической оптимизации карточек товаров на Wildberries.

## Возможности

- 🔗 **Подключение магазинов** - подключайте несколько магазинов WB по API-ключу
- 📊 **Анализ карточек** - автоматический анализ всех карточек с оценкой качества
- 🔍 **Обнаружение проблем** - выявление критических ошибок, предупреждений и точек роста
- 💡 **Рекомендации** - автоматические предложения по исправлению
- 📈 **Система оценок** - Score 0-100 для каждой карточки
- 👥 **RBAC** - ролевая модель доступа (admin, manager, user)

## Категории проблем

| Категория | Описание |
|-----------|----------|
| 🔴 **Критические** | Блокируют показы или продажи |
| 🟡 **Предупреждения** | Снижают конверсию |
| 🟢 **Точки роста** | Возможности улучшения |
| ⏸️ **Отложенные** | Задачи на потом |

## Технологии

- **Backend**: FastAPI, SQLAlchemy, Alembic
- **Database**: PostgreSQL
- **Auth**: JWT + RBAC
- **API**: Wildberries Content API v2

## Установка

### 1. Клонировать репозиторий

```bash
git clone <repo-url>
cd wb-optimizer
```

### 2. Создать виртуальное окружение

```bash
python -m venv venv
source venv/bin/activate  # Linux/Mac
# или
.\venv\Scripts\activate  # Windows
```

### 3. Установить зависимости

```bash
pip install -r requirements.txt
```

### 4. Настроить переменные окружения

```bash
cp .env.example .env
# Отредактируйте .env файл
```

### 5. Создать базу данных

```bash
createdb wb_optimizer
```

### 6. Применить миграции

```bash
alembic upgrade head
```

### 7. Запустить сервер

```bash
uvicorn app.main:app --reload --port 8002
```

## API Endpoints

### Аутентификация

| Метод | Endpoint | Описание |
|-------|----------|----------|
| POST | `/auth/register` | Регистрация |
| POST | `/auth/login` | Вход |
| POST | `/auth/refresh` | Обновление токена |
| GET | `/auth/me` | Текущий пользователь |

### Магазины

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/stores` | Список магазинов |
| POST | `/stores` | Создать магазин |
| GET | `/stores/{id}` | Информация о магазине |
| POST | `/stores/{id}/validate` | Проверить API-ключ |
| POST | `/stores/{id}/sync` | Синхронизировать карточки |
| POST | `/stores/{id}/analyze` | Запустить анализ |

### Карточки

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/stores/{id}/cards` | Список карточек |
| GET | `/stores/{id}/cards/{card_id}` | Детали карточки |
| POST | `/stores/{id}/cards/{card_id}/analyze` | Анализ карточки |

### Проблемы

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/stores/{id}/issues` | Список проблем |
| GET | `/stores/{id}/issues/grouped` | Проблемы по группам |
| POST | `/stores/{id}/issues/{issue_id}/fix` | Исправить |
| POST | `/stores/{id}/issues/{issue_id}/skip` | Пропустить |
| POST | `/stores/{id}/issues/{issue_id}/postpone` | Отложить |

### Dashboard

| Метод | Endpoint | Описание |
|-------|----------|----------|
| GET | `/dashboard` | Общая статистика |
| GET | `/dashboard/stores/{id}` | Статистика магазина |

## Workflow использования

1. **Регистрация** → Создайте аккаунт
2. **Добавление магазина** → Введите API-ключ WB
3. **Валидация** → Проверка ключа и получение данных магазина
4. **Синхронизация** → Загрузка карточек из WB
5. **Анализ** → Автоматический анализ всех карточек
6. **Исправление** → Работа с проблемами по категориям

## Структура проекта

```
wb-optimizer/
├── app/
│   ├── core/           # Конфигурация, БД, безопасность
│   ├── models/         # SQLAlchemy модели
│   ├── schemas/        # Pydantic схемы
│   ├── services/       # Бизнес-логика
│   ├── routers/        # API роутеры
│   └── main.py         # FastAPI приложение
├── alembic/            # Миграции
├── requirements.txt
└── README.md
```

## Лицензия

MIT
