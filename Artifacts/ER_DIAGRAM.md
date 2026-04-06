# Модель данных (ER-диаграмма) — KuApp Platform

**Версия:** 1.0  
**Дата:** 06.04.2026  
**СУБД:** Google Sheets  
**Инструмент доступа:** Google Apps Script (`gas/Code.gs`)

---

## 1. Обзор

База данных KuApp реализована на Google Sheets. Каждая таблица представляет собой отдельную сущность или связь. Доступ осуществляется через GAS API (read/append/update/batchValues).

### 1.1 Типы таблиц

| Тип | Описание | Примеры |
|-----|----------|---------|
| **Системные** | Встроенные таблицы платформы | `sys_Users`, `sys_Sessions` |
| **Игровые** | Результаты и статистика игр | `gameplay_Scores` |
| **Приложенческие** | Создаются приложениями динамически | `dictionary_words`, `workout_logs`, `marketplace_listings` |

---

## 2. ER-диаграмма

```
┌─────────────────────────────┐
│       sys_Users             │
│                             │
│  PK  username       STRING  │
│      password       STRING  │
│      role           ENUM    │
│      createdAt      DATETIME│
│      lastLogin      DATETIME│
│      totalXP        INT     │
└──────────┬──────────────────┘
           │
           │ 1:N
           │
     ┌─────┴──────────────────┐
     │                        │
     │                        │
┌────▼──────────────┐  ┌──────▼───────────────┐
│   sys_Sessions    │  │   gameplay_Scores    │
│                   │  │                      │
│  PK  id    STRING │  │  PK  id       STRING │
│  FK  username STR │  │  FK  username  STRING│
│      appId  STRING│  │     gameId    STRING │
│      startedAt DT │  │     score     INT    │
│      duration INT │  │     xp        INT    │
│                   │  │     playedAt  DATETIME│
└───────────────────┘  └──────────────────────┘


┌─────────────────────────────┐
│    dictionary_words         │
│                             │
│  PK  (username, word)       │
│  FK  username       STRING  │
│      word           STRING  │
│      translation    STRING  │
│      level          INT     │
│      lastReviewed   DATETIME│
└─────────────┬───────────────┘
              │
              │ N:1
              │
              ▼
      (ссылается на sys_Users.username)


┌─────────────────────────────┐
│   dictionary_leaderboard    │
│                             │
│  PK  (username)             │
│  FK  username       STRING  │
│      wordsLearned   INT     │
│      quizzesPassed  INT     │
│      totalScore     INT     │
└─────────────┬───────────────┘
              │
              │ N:1
              │
              ▼
      (ссылается на sys_Users.username)


┌─────────────────────────────┐
│      workout_logs           │
│                             │
│  PK  id             STRING  │
│  FK  username       STRING  │
│      programId      STRING  │
│      completedAt    DATETIME│
│      duration       INT     │
│      exercisesCompleted INT │
│      exercisesTotal   INT   │
└─────────────┬───────────────┘
              │
              │ N:1
              │
              ▼
      (ссылается на sys_Users.username)


┌─────────────────────────────┐
│    marketplace_listings     │
│                             │
│  PK  id             STRING  │
│  FK  sellerUsername STRING │
│      title          STRING  │
│      description    TEXT    │
│      price          DECIMAL │
│      category       STRING  │
│      imageUrl       STRING  │
│      createdAt      DATETIME│
│      status         ENUM    │
└─────────────┬───────────────┘
              │
              │ N:1
              │
              ▼
      (ссылается на sys_Users.username)
```

---

## 3. Детальное описание таблиц

### 3.1 `sys_Users` — Пользователи

**Назначение:** Хранение учётных записей пользователей платформы.

| Столбец | Тип | Ограничения | Описание |
|---------|-----|-------------|----------|
| `username` | STRING | PK, UNIQUE, NOT NULL, 3-50 символов, `^[a-zA-Z0-9_]+$` | Уникальный логин пользователя |
| `password` | STRING | NOT NULL, min 32 символа | Хэш пароля (MD5/SHA256) |
| `role` | ENUM | NOT NULL, default `'user'`, значения: `'admin'`, `'user'` | Роль в системе |
| `createdAt` | DATETIME | NOT NULL | Дата и время регистрации (ISO 8601) |
| `lastLogin` | DATETIME | NULL | Дата и время последнего входа (ISO 8601) |
| `totalXP` | INT | NOT NULL, default `0`, ≥ 0 | Суммарный опыт пользователя |

**Индексы:**
- PK: `username` (столбец A)
- Поиск по `role`: фильтр при чтении

**Бизнес-правила:**
- `admin` имеет полный доступ ко всем таблицам
- `user` видит только свои данные и публичные таблицы (рейтинг)
- При регистрации `role` всегда = `'user'`
- `totalXP` обновляется при отправке результатов игр

**Пример данных:**
```
username | password                         | role | createdAt             | lastLogin             | totalXP
---------|----------------------------------|------|-----------------------|-----------------------|--------
admin    | 5f4dcc3b5aa765d61d8327deb882cf99 | admin| 2024-01-01T00:00:00Z  | 2024-04-06T10:00:00Z  | 2500
user1    | e99a18c428cb38d5f260853678922e03 | user | 2024-01-15T10:30:00Z  | 2024-04-05T18:45:00Z  | 350
```

---

### 3.2 `sys_Sessions` — Сессии

**Назначение:** Логирование запусков приложений пользователями.

| Столбец | Тип | Ограничения | Описание |
|---------|-----|-------------|----------|
| `id` | STRING | PK, UUID v4, NOT NULL | Уникальный идентификатор сессии |
| `username` | STRING | FK → `sys_Users.username`, NOT NULL | Логин пользователя |
| `appId` | STRING | NOT NULL | ID запущенного приложения (`trainer`, `tetris`, `snake`, и т.д.) |
| `startedAt` | DATETIME | NOT NULL | Время начала сессии (ISO 8601) |
| `duration` | INT | NOT NULL, default `0`, ≥ 0 | Длительность сессии в секундах |

**Индексы:**
- PK: `id` (столбец A)
- Поиск по `username`: фильтр при чтении

**Бизнес-правила:**
- Сессия создаётся при запуске приложения
- `duration` обновляется при закрытии приложения
- Сессии хранятся для статистики и аналитики
- Старые сессии могут быть архивированы/удалены

**Пример данных:**
```
id                                    | username | appId    | startedAt             | duration
--------------------------------------|----------|----------|-----------------------|---------
550e8400-e29b-41d4-a716-446655440000 | user1    | trainer  | 2024-04-06T08:00:00Z  | 1800
550e8400-e29b-41d4-a716-446655440001 | user1    | tetris   | 2024-04-06T10:00:00Z  | 900
550e8400-e29b-41d4-a716-446655440002 | admin    | snake    | 2024-04-06T12:30:00Z  | 600
```

---

### 3.3 `gameplay_Scores` — Результаты игр

**Назначение:** Хранение результатов игр и начисления XP.

| Столбец | Тип | Ограничения | Описание |
|---------|-----|-------------|----------|
| `id` | STRING | PK, UUID v4, NOT NULL | Уникальный идентификатор записи |
| `username` | STRING | FK → `sys_Users.username`, NOT NULL | Логин пользователя |
| `gameId` | STRING | NOT NULL | ID игры (`tetris`, `snake`, `pong`, `breakout`, `2048`, `sudoku`, и т.д.) |
| `score` | INT | NOT NULL, ≥ 0 | Очки, набранные в игре |
| `xp` | INT | NOT NULL, ≥ 0 | Начисленный опыт за эту игру |
| `playedAt` | DATETIME | NOT NULL | Дата и время игры (ISO 8601) |

**Индексы:**
- PK: `id` (столбец A)
- Поиск по `username`: фильтр при чтении

**Бизнес-правила:**
- Запись создаётся через `Platform.gameplay.submitScore()`
- `xp` рассчитывается платформой на основе `score`
- `totalXP` в `sys_Users` обновляется агрегацией
- Рейтинг формируется суммированием `xp` записей

**Пример данных:**
```
id                                    | username | gameId   | score | xp  | playedAt
--------------------------------------|----------|----------|-------|-----|-----------------------
660e8400-e29b-41d4-a716-446655440000 | user1    | tetris   | 12500 | 150 | 2024-04-06T14:30:00Z
660e8400-e29b-41d4-a716-446655440001 | user1    | snake    | 3200  | 45  | 2024-04-05T20:15:00Z
660e8400-e29b-41d4-a716-446655440002 | admin    | 2048     | 68400 | 200 | 2024-04-06T09:00:00Z
```

---

### 3.4 `dictionary_words` — Слова словаря

**Назначение:** Отслеживание прогресса изучения слов.

| Столбец | Тип | Ограничения | Описание |
|---------|-----|-------------|----------|
| `username` | STRING | FK → `sys_Users.username`, NOT NULL, часть PK | Логин пользователя |
| `word` | STRING | NOT NULL, часть PK, max 100 символов | Изучаемое слово |
| `translation` | STRING | NOT NULL, max 200 символов | Перевод слова |
| `level` | INT | NOT NULL, 0-5 | Уровень освоения (0 = не изучено, 5 = освоено) |
| `lastReviewed` | DATETIME | NULL | Дата последнего повторения (ISO 8601) |

**Составной PK:** `(username, word)`

**Индексы:**
- PK: `username` + `word` (столбцы A+B)

**Бизнес-правила:**
- `level` обновляется после каждого квиза:
  - Правильный ответ → `level += 1`
  - Неправильный ответ → `level = max(0, level - 1)`
- Слова с `level = 5` считаются освоенными
- Алгоритм повторения приоритизирует слова с низким `level`

**Уровни освоения:**

| Level | Статус | Описание |
|-------|--------|----------|
| 0 | Не изучено | Слово добавлено, но не изучалось |
| 1 | Начинающий | Угадано 1 раз |
| 2 | Знакомый | Угадано 2-3 раза |
| 3 | Средний | Угадано 4-5 раз |
| 4 | Продвинутый | Угадано 6-7 раз |
| 5 | Освоенный | Угадано 8+ раз, не требует повторения |

**Пример данных:**
```
username | word      | translation | level | lastReviewed
---------|-----------|-------------|-------|-----------------------
user1    | apple     | яблоко      | 5     | 2024-04-06T10:00:00Z
user1    | house     | дом         | 3     | 2024-04-05T18:00:00Z
user1    | beautiful | красивый    | 1     | 2024-04-04T12:00:00Z
user1    | elephant  | слон        | 0     | NULL
```

---

### 3.5 `dictionary_leaderboard` — Рейтинг словаря

**Назначение:** Таблица лидеров для приложения «Словарь».

| Столбец | Тип | Ограничения | Описание |
|---------|-----|-------------|----------|
| `username` | STRING | PK, FK → `sys_Users.username`, NOT NULL | Логин пользователя |
| `wordsLearned` | INT | NOT NULL, default `0`, ≥ 0 | Количество освоенных слов (level = 5) |
| `quizzesPassed` | INT | NOT NULL, default `0`, ≥ 0 | Количество пройденных квизов |
| `totalScore` | INT | NOT NULL, default `0`, ≥ 0 | Суммарный рейтинг в квизах |

**Индексы:**
- PK: `username` (столбец A)

**Бизнес-правила:**
- `wordsLearned` = COUNT слов с `level = 5`
- `quizzesPassed` инкрементируется при завершении квиза
- `totalScore` суммирует очки за правильные ответы

**Пример данных:**
```
username | wordsLearned | quizzesPassed | totalScore
---------|-------------|---------------|-----------
user1    | 45          | 120           | 3400
admin    | 200         | 500           | 15000
user7    | 12          | 30            | 850
```

---

### 3.6 `workout_logs` — Логи тренировок

**Назначение:** Логирование выполненных тренировочных программ.

| Столбец | Тип | Ограничения | Описание |
|---------|-----|-------------|----------|
| `id` | STRING | PK, UUID v4, NOT NULL | Уникальный идентификатор записи |
| `username` | STRING | FK → `sys_Users.username`, NOT NULL | Логин пользователя |
| `programId` | STRING | NOT NULL | ID программы (`mcgill_531`, `shoulder_rehab_p1`, `home_hiit_fatloss_001`) |
| `completedAt` | DATETIME | NOT NULL | Дата и время завершения тренировки (ISO 8601) |
| `duration` | INT | NOT NULL, ≥ 0 | Фактическая длительность в секундах |
| `exercisesCompleted` | INT | NOT NULL, ≥ 0 | Количество выполненных упражнений |
| `exercisesTotal` | INT | NOT NULL, > 0 | Общее количество упражнений в программе |

**Индексы:**
- PK: `id` (столбец A)
- Поиск по `username`: фильтр при чтении

**Бизнес-правила:**
- Запись создаётся при завершении тренировки в приложении «Тренер»
- `exercisesCompleted` ≤ `exercisesTotal`
- Процент выполнения = `exercisesCompleted / exercisesTotal * 100`
- XP начисляется за завершение (полное или частичное)

**Пример данных:**
```
id                                    | username | programId             | completedAt           | duration | exercisesCompleted | exercisesTotal
--------------------------------------|----------|-----------------------|-----------------------|----------|-------------------|---------------
770e8400-e29b-41d4-a716-446655440000 | user1    | mcgill_531            | 2024-04-06T08:30:00Z  | 1800     | 9                 | 12
770e8400-e29b-41d4-a716-446655440001 | user1    | home_hiit_fatloss_001 | 2024-04-05T07:00:00Z  | 1200     | 18                | 18
770e8400-e29b-41d4-a716-446655440002 | admin    | shoulder_rehab_p1     | 2024-04-04T16:00:00Z  | 900      | 6                 | 8
```

---

### 3.7 `marketplace_listings` — Объявления маркетплейса

**Назначение:** Хранение объявлений о строительных материалах.

| Столбец | Тип | Ограничения | Описание |
|---------|-----|-------------|----------|
| `id` | STRING | PK, UUID v4, NOT NULL | Уникальный идентификатор объявления |
| `sellerUsername` | STRING | FK → `sys_Users.username`, NOT NULL | Логин продавца |
| `title` | STRING | NOT NULL, max 200 символов | Заголовок объявления |
| `description` | TEXT | NOT NULL, max 2000 символов | Описание товара |
| `price` | DECIMAL | NOT NULL, > 0 | Цена (в рублях) |
| `category` | STRING | NOT NULL | Категория (`цемент`, `доски`, `кирпич`, `инструменты`, и т.д.) |
| `imageUrl` | STRING | NULL, URL | Ссылка на изображение |
| `createdAt` | DATETIME | NOT NULL | Дата создания объявления (ISO 8601) |
| `status` | ENUM | NOT NULL, default `'active'`, значения: `'active'`, `'sold'`, `'archived'` | Статус объявления |

**Индексы:**
- PK: `id` (столбец A)
- Поиск по `sellerUsername`: фильтр при чтении

**Бизнес-правила:**
- Только автор объявления может редактировать/удалять его
- `admin` может управлять всеми объявлениями
- По умолчанию `status = 'active'`
- При `status = 'sold'` объявление скрывается из общего списка

**Пример данных:**
```
id                                    | sellerUsername | title           | description        | price  | category    | imageUrl | createdAt             | status
--------------------------------------|----------------|-----------------|--------------------|--------|-------------|----------|-----------------------|--------
880e8400-e29b-41d4-a716-446655440000 | user1          | Цемент М500 50кг| Портландцемент, ...| 450.00 | цемент      | https:// | 2024-04-06T10:00:00Z  | active
880e8400-e29b-41d4-a716-446655440001 | user7          | Доска 50x150 6м | Сосна, сухая     | 350.00 | доски       | https:// | 2024-04-05T14:30:00Z  | active
880e8400-e29b-41d4-a716-446655440002 | admin          | Кирпич красный| Облицовочный, ...  | 25.00  | кирпич      | NULL     | 2024-04-04T09:00:00Z  | sold
```

---

## 4. Связи между таблицами

### 4.1 Диаграмма связей

```
sys_Users (1) ────┬──── (N) sys_Sessions
                  │
                  ├──── (N) gameplay_Scores
                  │
                  ├──── (N) dictionary_words
                  │
                  ├──── (1) dictionary_leaderboard
                  │
                  ├──── (N) workout_logs
                  │
                  └──── (N) marketplace_listings (via sellerUsername)
```

### 4.2 Таблица связей

| Родитель | Потомок | Тип | По связи | Описание |
|----------|---------|-----|----------|----------|
| `sys_Users.username` | `sys_Sessions.username` | 1:N | username | У одного пользователя много сессий |
| `sys_Users.username` | `gameplay_Scores.username` | 1:N | username | У одного пользователя много результатов игр |
| `sys_Users.username` | `dictionary_words.username` | 1:N | username | У одного пользователя много изучаемых слов |
| `sys_Users.username` | `dictionary_leaderboard.username` | 1:1 | username | Один пользователь — одна запись в рейтинге |
| `sys_Users.username` | `workout_logs.username` | 1:N | username | У одного пользователя много логов тренировок |
| `sys_Users.username` | `marketplace_listings.sellerUsername` | 1:N | sellerUsername | У одного продавца много объявлений |

---

## 5. Динамическое создание таблиц

Приложения могут создавать собственные таблицы через `Platform.db.ensureTables()`.

### 5.1 Механизм

```javascript
// Вызов из приложения
await Platform.db.ensureTables([
  {
    name: "my_app_data",
    headers: ["id", "username", "data", "createdAt"]
  }
]);
```

### 5.2 Соглашения об именовании

| Префикс | Назначение | Примеры |
|---------|-----------|---------|
| `sys_` | Системные таблицы | `sys_Users`, `sys_Sessions` |
| `gameplay_` | Игровая статистика | `gameplay_Scores` |
| `dictionary_` | Данные словаря | `dictionary_words`, `dictionary_leaderboard` |
| `workout_` | Данные тренировок | `workout_logs` |
| `marketplace_` | Данные маркетплейса | `marketplace_listings` |
| Без префикса | Пользовательские таблицы | `my_custom_table` |

---

## 6. Ограничения Google Sheets как БД

| Ограничение | Значение | Влияние на KuApp |
|-------------|----------|------------------|
| Макс. ячеек на таблицу | 10,000,000 | ~1M строк при 10 столбцах |
| Макс. столбцов | 18,278 (A GR) | Не критично для текущей схемы |
| Rate limit (бесплатный) | ~100 запросов/100 сек | Требуется батчинг через `batchValues` |
| Время выполнения GAS | 6 минут | Долгие операции могут быть прерваны |
| Макс. URL вызовов/день | 20,000 | ~200 запросов/минуту в пике |
| Транзакции | Нет | Возможны race conditions при одновременной записи |

### 6.1 Стратегии обхода ограничений

| Проблема | Решение |
|----------|---------|
| Rate limiting | Пакетные операции (`batchValues`, `batchStructural`) |
| Отсутствие транзакций | Оптимистичные блокировки (check-before-write) |
| Лимит ячеек | Архивация старых данных в отдельные таблицы |
| Отсутствие индексов | Чтение с последующей фильтрацией на клиенте |
| Нет внешних ключей | Валидация FK на уровне приложения |

---

## 7. Резервное копирование и восстановление

### 7.1 Резервное копирование

Google Sheets автоматически создаёт версии:
- **File → Version history** → история изменений (до 30 дней для бесплатных аккаунтов)
- **Ручной экспорт** → File → Download → Excel/CSV

### 7.2 Восстановление

1. Открыть таблицу в Google Sheets
2. File → Version history → See version history
3. Выбрать нужную версию → Restore

### 7.3 Рекомендации

- Регулярный экспорт в Excel (раз в неделю)
- Копирование таблицы в отдельный файл (backup)
- Мониторинг заполнения (предупреждение при 80% лимита)

---

## 8. Changelog

| Версия | Дата | Изменения |
|--------|------|-----------|
| 1.0 | 06.04.2026 | Первичная модель данных |
