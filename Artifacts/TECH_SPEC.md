# Техническая спецификация (Tech Spec) — KuApp Platform

**Версия:** 1.0  
**Дата:** 06.04.2026  
**Статус:** Актуально  
**Автор:** AI-generated

---

## 1. Обзор

KuApp — это Progressive Web Application (PWA), представляющее собой единую платформу, объединяющую фитнес-инструменты, образовательные приложения и набор мини-игр. Проект построен на архитектуре **zero-build, zero-dependency** — весь фронтенд работает без сборщиков и npm-пакетов, а бэкенд полностью заменяется Google Sheets через Google Apps Script.

### 1.1 Ключевые характеристики

| Параметр | Значение |
|----------|----------|
| Хостинг | GitHub Pages (ветка `main`) |
| Фронтенд | Vanilla HTML5/CSS3/JS (ES2022), inline в single-file HTML |
| Бэкенд | Google Apps Script (прокси к Google Sheets) |
| База данных | Google Sheets (таблицы: `sys_Users`, `sys_Sessions`, `gameplay_Scores` и др.) |
| PWA | Service Worker (`sw.js`), Web App Manifest (`manifest.json`) |
| Аутентификация | Кастомная (username/password через Google Sheets) |
| Язык интерфейса | Русский |
| URL развёртывания | https://kutya001.github.io/KuApp/ |

### 1.2 Модульная структура

| Категория | Кол-во | Приложения |
|-----------|--------|------------|
| Фитнес | 2 | Тренер (`trainer.html`), Конструктор программ (`TrainingProgramBuilder.html`) |
| Образование | 1 | Словарь (`dictionary.html`) |
| Аркады | 6 | Змейка, Пинг-понг, Арканоид, Флаппи, Дино, Баскетбол |
| Головоломки | 6 | 2048, Пятнашки, Судоку, Сапёр, Сортировка цветов, Найди пару |
| Логика | 3 | Крестики-нолики, Реверси, Слово |
| Утилиты | 1 | СтройМаркет (marketplace) |
| **Итого** | **20 приложений** | |

---

## 2. Архитектура

### 2.1 Общая схема

```
┌─────────────────────────────────────────────────────────────┐
│                      GitHub Pages (CDN)                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  index.html  │  │   sw.js      │  │  manifest.json   │   │
│  │  (Platform)  │  │ (Cache mgr)  │  │  (PWA config)    │   │
│  └──────┬───────┘  └──────────────┘  └──────────────────┘   │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              apps/ (20 HTML-файлов)                   │   │
│  │  trainer.html, dictionary.html, tetris.html, ...     │   │
│  └──────────────────────────────────────────────────────┘   │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │           workouts/ (7 JSON-файлов)                   │   │
│  │  mcgill_531.json, shoulder_rehab_p*.json, ...        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS POST
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              Google Apps Script (gas/Code.gs)                │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  REST-прокси: read, append, update, batchValues,     │   │
│  │  meta, addSheets, deleteSheet, deleteRows            │   │
│  └────────────────────────┬─────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    Google Sheets (БД)                        │
│  Таблицы: sys_Users, sys_Sessions, gameplay_Scores, ...    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 Компоненты фронтенда

#### 2.2.1 Platform Hub (`index.html`)

Центральный оркестратор всей платформы (~1673 строки).

**Ответственность:**
- Аутентификация и авторизация (login/register/setup)
- Навигация (5 вкладок: Приложения, Статистика, Рейтинг, Браузер данных, Настройки)
- Предоставление `PlatformAPI` для всех дочерних приложений
- Трекинг сессий (логирование запусков и длительности)
- Адаптивная вёрстка (sidebar на desktop, bottom nav на mobile)
- Immersive mode — загрузка приложений в полноэкранном `<iframe>`

**Навигационная структура:**

| Вкладка | Описание |
|---------|----------|
| Приложения | Сетка 20+ приложений, сгруппированных по категориям |
| Статистика | Персональная статистика пользователя (сессии, XP, очки) |
| Рейтинг | Таблица лидеров (leaderboard) |
| Браузер данных | CRUD-интерфейс к Google Sheets таблицам |
| Настройки | Управление аккаунтом, конфигурация GAS URL, очистка кэша |

#### 2.2.2 Service Worker (`sw.js`)

**Версия кэша:** `app-v5`

**Стратегии кэширования:**

| Ресурс | Стратегия |
|--------|-----------|
| App shell (`index.html`, `manifest.json`, иконки) | Cache-First |
| Файлы приложений (`apps/*.html`) | Network-First |
| Workout JSON (`workouts/*.json`) | Network-First |
| Внешние API (Google Sheets, OAuth, шрифты, CDN) | Bypass (не кэшируются) |

**postMessage API:**

| Команда | Описание |
|---------|----------|
| `CLEAR_CACHE` | Полная очистка кэша |
| `GET_CACHE_INFO` | Информация о текущем кэше |
| `SKIP_WAITING` | Принудительная активация новой версии SW |

#### 2.2.3 PWA Manifest (`manifest.json`)

```json
{
  "display": "standalone",
  "orientation": "portrait",
  "theme_color": "#0a0a0f",
  "background_color": "#0a0a0f",
  "categories": ["health", "fitness", "sports"],
  "lang": "ru"
}
```

### 2.3 PlatformAPI

`window.parent.PlatformAPI` — единый интерфейс, предоставляемый платформом всем iframe-приложениям.

#### 2.3.1 Модуль `Platform.user`

| Метод | Возвращает | Описание |
|-------|-----------|----------|
| `getProfile()` | `{username, role, ...}` | Профиль текущего пользователя |
| `isAdmin()` | `boolean` | Является ли пользователь администратором |
| `getRole()` | `string` | Роль пользователя (`admin`/`user`) |

#### 2.3.2 Модуль `Platform.db`

| Метод | Описание |
|-------|----------|
| `read(sheetName, range)` | Чтение данных из таблицы |
| `append(sheetName, rows)` | Добавление строк в конец таблицы |
| `update(sheetName, range, values)` | Обновление ячеек |
| `batchValues(updates)` | Пакетное обновление нескольких диапазонов |
| `batchStructural(operations)` | Пакетная структурная операция (создание/удаление таблиц) |
| `ensureTables(tableDefs)` | Гарантированное наличие таблиц (создаёт если нет) |

#### 2.3.3 Модуль `Platform.gameplay`

| Метод | Описание |
|-------|----------|
| `submitScore(gameId, score, xp)` | Отправка результата игры с начислением XP |

#### 2.3.4 Модуль `Platform.ui`

| Метод | Описание |
|-------|----------|
| `showToast(message, type)` | Показ уведомления (`success`, `error`, `info`) |
| `showLoader(visible)` | Показать/скрыть индикатор загрузки |
| `openSettings()` | Открыть вкладку настроек |

#### 2.3.5 Модуль `Platform.system`

| Метод | Описание |
|-------|----------|
| `logSession(appId, duration)` | Логирование сессии (запуск + длительность) |
| `log(event, data)` | Общее логирование событий |

### 2.4 Бэкенд (Google Apps Script)

Файл: `gas/Code.gs`

**Развёртывание:** GAS Web App с доступом «Anyone» (публичный URL).

**Конфигурация:** Через Script Properties:
- `SPREADSHEET_ID` — ID основной Google Sheets таблицы
- `SA_JSON` (опционально) — JSON сервисного аккаунта

#### 2.4.1 API эндпоинты

Все запросы — HTTP POST с JSON-телом: `{action, params}`.

| Action | Params | Описание |
|--------|--------|----------|
| `read` | `{sheetName, range}` | Чтение диапазона ячеек |
| `append` | `{sheetName, rows}` | Добавление строк в конец |
| `update` | `{sheetName, range, values}` | Обновление ячеек |
| `batchValues` | `{updates: [{range, values}]}` | Пакетное обновление |
| `meta` | — | Список всех таблиц с ID и названиями |
| `addSheets` | `{sheets: [{name}]}` | Создание новых таблиц |
| `deleteSheet` | `{sheetId}` | Удаление таблицы |
| `deleteRows` | `{sheetName, startRow, endRow}` | Удаление строк по индексу |

#### 2.4.2 Схема ответа

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

---

## 3. Модель данных (Google Sheets)

### 3.1 Системные таблицы

#### `sys_Users` — Пользователи

| Столбец | Тип | Описание |
|---------|-----|----------|
| `username` | string | Уникальный логин (PK) |
| `password` | string | Хэш пароля |
| `role` | string | `admin` / `user` |
| `createdAt` | timestamp | Дата регистрации |
| `lastLogin` | timestamp | Дата последнего входа |
| `totalXP` | number | Суммарный опыт |

#### `sys_Sessions` — Сессии

| Столбец | Тип | Описание |
|---------|-----|----------|
| `id` | string | UUID сессии (PK) |
| `username` | string | Логин пользователя (FK → sys_Users) |
| `appId` | string | ID запущенного приложения |
| `startedAt` | timestamp | Время начала |
| `duration` | number | Длительность (секунды) |

#### `gameplay_Scores` — Результаты игр

| Столбец | Тип | Описание |
|---------|-----|----------|
| `id` | string | UUID записи (PK) |
| `username` | string | Логин пользователя (FK → sys_Users) |
| `gameId` | string | ID игры |
| `score` | number | Очки |
| `xp` | number | Начисленный опыт |
| `playedAt` | timestamp | Дата игры |

### 3.2 Пользовательские таблицы

Создаются динамически через `Platform.db.ensureTables()`:

| Таблица | Назначение |
|---------|------------|
| `dictionary_words` | Слова и прогресс изучения |
| `dictionary_leaderboard` | Таблица лидеров словаря |
| `marketplace_listings` | Объявления marketplace |
| `workout_logs` | Логи тренировок |
| _и другие_ | Определяются приложениями |

---

## 4. Формат тренировочных программ

Файлы в `workouts/*.json`.

### 4.1 Структура JSON

```json
{
  "id": "unique_program_id",
  "name": "Название программы",
  "description": "Описание",
  "category": "rehab | hiit | strength",
  "estimatedTime": "30-45 мин",
  "exercisesDetails": [
    {
      "name": "Bird-Dog",
      "goal": "10 повторений",
      "start": "На четвереньках",
      "move": "Вытянуть противоположные руку и ногу"
    }
  ],
  "protocol": [
    {
      "type": "prep | work | rest | finish",
      "duration": 30,
      "exerciseIndex": 0,
      "cue": "Приготовьтесь!"
    }
  ]
}
```

### 4.2 Типы шагов протокола

| Тип | Описание |
|-----|----------|
| `prep` | Подготовка (объявление упражнения) |
| `work` | Выполнение (рабочий интервал) |
| `rest` | Отдых между упражнениями |
| `finish` | Завершение программы |

### 4.3 Озвучка

Приложение `trainer.html` использует **Web Speech API** (`SpeechSynthesis`) для голосового сопровождения каждого шага протокола.

---

## 5. Описание приложений

### 5.1 Фитнес

| Приложение | Файл | Ключевые особенности |
|------------|------|---------------------|
| **Тренер** | `trainer.html` | Пошаговый таймер, голосовые подсказки, загрузка программ из `workouts/` |
| **Конструктор программ** | `TrainingProgramBuilder.html` | React 18 + Babel (CDN), drag-and-drop, визуальный редактор, экспорт JSON |

### 5.2 Образование

| Приложение | Файл | Ключевые особенности |
|------------|------|---------------------|
| **Словарь** | `dictionary.html` | Изучение лексики, карточки, квизы, таблица лидеров, сохранение прогресса |

### 5.3 Аркады

| Приложение | Файл | Управление |
|------------|------|------------|
| **Змейка** | `snake.html` | Стрелки / свайпы |
| **Пинг-понг** | `pong.html` | Мышь / тач |
| **Арканоид** | `breakout.html` | Мышь / тач, power-ups |
| **Флаппи** | `flappy.html` | Тап / пробел |
| **Дино** | `dino.html` | Тап / пробел |
| **Баскетбол** | `basketball.html` | Физический движок, drag-and-release |

### 5.4 Головоломки

| Приложение | Файл | Особенности |
|------------|------|-------------|
| **2048** | `2048.html` | Слияние тайлов до 2048 |
| **Пятнашки** | `fifteen.html` | Слайдинг 4×4 |
| **Судоку** | `sudoku.html` | 9×9 с подсказками |
| **Сапёр** | `minesweeper.html` | Долгое нажатие для флажков |
| **Сортировка цветов** | `watersort.html` | Сортировка жидкостей по пробиркам |
| **Найди пару** | `memory.html` | Memory matching карт |

### 5.5 Логика

| Приложение | Файл | Особенности |
|------------|------|-------------|
| **Крестики-нолики** | `tictac.html` | 3×3 против AI |
| **Реверси** | `reversi.html` | 8×8 против AI |
| **Слово** | `wordle.html` | Угадывание слова за 6 попыток |

### 5.6 Утилиты

| Приложение | Файл | Особенности |
|------------|------|-------------|
| **СтройМаркет** | `marketplace.html` | Маркетплейс строительных материалов |

---

## 6. Каталог приложений

Файл: `apps/index.json`

Приложения группируются по 4 категориям:

| Категория | ID | Приложения |
|-----------|-----|------------|
| Другое | `other` | marketplace, TrainingProgramBuilder, tetris, clicker |
| Аркады | `arcade` | snake, pong, breakout, flappy, dino, basketball |
| Головоломки | `puzzle` | 2048, fifteen, sudoku, minesweeper, watersort, memory |
| Логика | `logic` | tictac, reversi, wordle |

> **Примечание:** `trainer.html` и `dictionary.html` не входят в `index.json` — они запускаются напрямую платформой.

---

## 7. Аутентификация

### 7.1 Flow

```
1. Пользователь вводит username/password
2. Platform проверяет credentials через GAS (read из sys_Users)
3. При успехе — сохраняет профиль в localStorage (`mcg_user`)
4. При первом входе — настройка GAS URL и Service Account
```

### 7.2 localStorage ключи

| Ключ | Описание |
|------|----------|
| `mcg_config` | ID Google Sheets таблицы |
| `wl_sa` | JSON сервисного аккаунта |
| `mcg_user` | Профиль текущего пользователя |
| `mcg_launches` | Timestamp'ы последних запусков приложений |

### 7.2 Роли

| Роль | Права |
|------|-------|
| `admin` | Полный доступ: CRUD всех таблиц, управление пользователями |
| `user` | Стандартный доступ: свои данные, отправка результатов игр |

---

## 8. Тренировочные программы

### 8.1 Доступные программы

| Файл | Категория | Описание |
|------|-----------|----------|
| `mcgill_531.json` | rehab | McGill Big 3: Bird-Dog, Side Bridge, Curl-Up по протоколу 5-3-1 |
| `shoulder_rehab_p1.json` | rehab | Реабилитация плеча, фаза 1: защита, снятие боли (0-4 недели) |
| `shoulder_rehab_p2.json` | rehab | Фаза 2: восстановление амплитуды движений (4-8 недель) |
| `shoulder_rehab_p3.json` | rehab | Фаза 3: укрепление вращательной манжеты (8-12 недель) |
| `shoulder_rehab_p4.json` | rehab | Фаза 4: возвращение к активности (12+ недель) |
| `home_hiit_fatloss_001.json` | hiit | Домашнее HIIT: 3 круга, 6 упражнений, без оборудования |

### 8.2 Добавление новой программы

1. Создать JSON-файл в `workouts/` по схеме из §4
2. Добавить запись в `workouts/index.json`
3. Приложение «Тренер» автоматически подхватит новую программу

---

## 9. Инфраструктура и развёртывание

### 9.1 GitHub Pages

```bash
git add -A
git commit -m "описание изменений"
git push origin main
```

GitHub Pages автоматически публикует изменения из ветки `main`.

### 9.2 Обновление Service Worker

После деплоя необходимо вручную увеличить `CACHE_NAME` в `sw.js` для инвалидации кэша:

```js
const CACHE_NAME = 'app-v5'; // → 'app-v6'
```

### 9.3 Google Apps Script деплой

1. Открыть проект в Google Apps Script
2. Заменить код в `Code.gs` содержимым из `gas/Code.gs`
3. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone
4. Скопировать URL деплоя и вставить в настройки платформы

---

## 10. Стек технологий

| Слой | Технология |
|------|-----------|
| Фронтенд | Vanilla HTML5/CSS3/JS (ES2022), inline в single-file HTML |
| Шрифты | Google Fonts: Manrope, JetBrains Mono (CDN) |
| PWA | Service Worker + Web App Manifest |
| Бэкенд | Google Apps Script |
| База данных | Google Sheets |
| TTS (озвучка) | Web Speech API (SpeechSynthesis) |
| TrainingProgramBuilder | React 18 + Babel (CDN), Drag-Drop-Touch, Lucide Icons |
| Хостинг | GitHub Pages |

---

## 11. Добавление нового приложения

### 11.1 Шаблон

Каждое приложение — single-file HTML, загружаемый в `<iframe>`.

```html
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Название приложения</title>
  <style>/* Стили */</style>
</head>
<body>
  <!-- Разметка -->
  <script>
    // Доступ к PlatformAPI:
    const { user, db, gameplay, ui, system } = window.parent.PlatformAPI;
    
    // Инициализация
    // ...
    
    // Отправка результата
    // gameplay.submitScore('myGame', score, xp);
  </script>
</body>
</html>
```

### 11.2 Регистрация в каталоге

Добавить запись в `apps/index.json`:

```json
{
  "id": "myApp",
  "name": "Моё приложение",
  "file": "myApp.html",
  "category": "puzzle",
  "icon": "🎮",
  "description": "Описание приложения"
}
```

---

## 12. Безопасность

| Аспект | Мера |
|--------|------|
| Хранение паролей | Хэширование в Google Sheets (не plaintext) |
| GAS доступ | Deploy as «Anyone», но валидация на уровне кода |
| iframe sandbox | Приложения работают в изолированном iframe |
| Service Worker | Bypass для всех внешних API — не кэширует чувствительные данные |
| localStorage | Конфигурация хранится локально, не передаётся |

---

## 13. Ограничения и известные проблемы

| Ограничение | Описание |
|-------------|----------|
| Rate limiting Google Sheets | ~100 запросов/100 сек для бесплатных аккаунтов |
| Максимальный размер Sheets | 10 млн ячеек на таблицу |
| GAS квота | 6 мин выполнения скрипта, 20k URL вызовов/день |
| Оффлайн режим | Только app shell; данные требуют сети |
| PWA иконки | Только 256×256 и 512×512 |

---

## 14. Changelog

| Версия | Дата | Изменения |
|--------|------|-----------|
| 1.0 | 06.04.2026 | Первичная документация |
