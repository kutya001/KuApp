# API Contract (OpenAPI 3.0) — KuApp Platform

**Версия:** 1.0  
**Дата:** 06.04.2026  
**Бэкенд:** Google Apps Script (`gas/Code.gs`)  
**База данных:** Google Sheets

---

## 1. Общая информация

### 1.1 Базовый URL

```
{GAS_DEPLOYMENT_URL}
```

URL Google Apps Script Web App (настраивается пользователем при первом запуске).

### 1.2 Метод аутентификации

Все запросы передают `username` в теле запроса. Авторизация проверяется по таблице `sys_Users`.

### 1.3 Формат запроса

Все эндпоинты принимают **HTTP POST** с `Content-Type: application/json`.

### 1.4 Формат ответа

Стандартный формат ответа для всех эндпоинтов:

```json
{
  "success": true,
  "data": { ... },
  "error": null
}
```

```json
{
  "success": false,
  "data": null,
  "error": "Описание ошибки"
}
```

### 1.5 Коды ошибок

| Код | Описание |
|-----|----------|
| `AUTH_FAILED` | Неверный логин или пароль |
| `NOT_FOUND` | Запрашиваемый ресурс не найден |
| `INVALID_PARAMS` | Неверные параметры запроса |
| `PERMISSION_DENIED` | У пользователя нет прав на операцию |
| `SHEET_ERROR` | Ошибка при работе с Google Sheets |
| `RATE_LIMITED` | Превышен лимит запросов |
| `INTERNAL_ERROR` | Внутренняя ошибка сервера |

---

## 2. OpenAPI Specification

```yaml
openapi: 3.0.3
info:
  title: KuApp Platform API
  description: API для взаимодействия с платформой KuApp через Google Apps Script
  version: 1.0.0
  contact:
    name: KuApp Team

servers:
  - url: '{GAS_DEPLOYMENT_URL}'
    description: URL развёртывания Google Apps Script
    variables:
      GAS_DEPLOYMENT_URL:
        default: https://script.google.com/macros/s/{SCRIPT_ID}/exec
        description: Deployment URL из Google Apps Script

components:
  schemas:
    # === REQUEST SCHEMAS ===
    
    ReadRequest:
      type: object
      required: [action, sheetName]
      properties:
        action:
          type: string
          enum: [read]
          description: Действие — чтение данных
        sheetName:
          type: string
          description: Название таблицы
        range:
          type: string
          description: Диапазон ячеек в формате A1 (например, "A1:D10")
          example: "A1:Z100"
        username:
          type: string
          description: Логин пользователя для авторизации

    AppendRequest:
      type: object
      required: [action, sheetName, rows]
      properties:
        action:
          type: string
          enum: [append]
          description: Действие — добавление строк
        sheetName:
          type: string
          description: Название таблицы
        rows:
          type: array
          description: Массив строк для добавления (каждая строка — массив значений)
          items:
            type: array
            items:
              type: string
          example: [["user1", "admin", "2024-01-15T10:30:00Z"]]
        username:
          type: string

    UpdateRequest:
      type: object
      required: [action, sheetName, range, values]
      properties:
        action:
          type: string
          enum: [update]
          description: Действие — обновление ячеек
        sheetName:
          type: string
          description: Название таблицы
        range:
          type: string
          description: Диапазон ячеек в формате A1
          example: "B2"
        values:
          type: array
          description: Значения для записи (двумерный массив)
          items:
            type: array
            items:
              type: string
          example: [["new_value"]]
        username:
          type: string

    BatchValuesRequest:
      type: object
      required: [action, updates]
      properties:
        action:
          type: string
          enum: [batchValues]
          description: Пакетное обновление диапазонов
        updates:
          type: array
          description: Массив обновлений
          items:
            type: object
            required: [range, values]
            properties:
              range:
                type: string
                description: Диапазон в формате A1
                example: "A1:B2"
              values:
                type: array
                description: Двумерный массив значений
                items:
                  type: array
                  items:
                    type: string
        username:
          type: string

    MetaRequest:
      type: object
      required: [action]
      properties:
        action:
          type: string
          enum: [meta]
          description: Получить метаданные всех таблиц
        username:
          type: string

    AddSheetsRequest:
      type: object
      required: [action, sheets]
      properties:
        action:
          type: string
          enum: [addSheets]
          description: Создание новых таблиц
        sheets:
          type: array
          description: Список таблиц для создания
          items:
            type: object
            required: [name]
            properties:
              name:
                type: string
                description: Название новой таблицы
                example: "my_custom_table"
        username:
          type: string

    DeleteSheetRequest:
      type: object
      required: [action, sheetId]
      properties:
        action:
          type: string
          enum: [deleteSheet]
          description: Удаление таблицы
        sheetId:
          type: integer
          description: Внутренний ID таблицы (gid)
          example: 0
        username:
          type: string

    DeleteRowsRequest:
      type: object
      required: [action, sheetName, startRow, endRow]
      properties:
        action:
          type: string
          enum: [deleteRows]
          description: Удаление строк по индексу
        sheetName:
          type: string
          description: Название таблицы
        startRow:
          type: integer
          description: Начальный индекс строки (1-based)
          example: 5
        endRow:
          type: integer
          description: Конечный индекс строки (1-based, включительно)
          example: 10
        username:
          type: string

    # === RESPONSE SCHEMAS ===

    SuccessResponse:
      type: object
      properties:
        success:
          type: boolean
          example: true
        data:
          type: object
          description: Данные ответа (структура зависит от action)
        error:
          type: "null"
          example: null

    ErrorResponse:
      type: object
      properties:
        success:
          type: boolean
          example: false
        data:
          type: "null"
        error:
          type: string
          description: Описание ошибки
          example: "Таблица не найдена"

    ReadResponseData:
      type: object
      properties:
        values:
          type: array
          description: Двумерный массив ячеек
          items:
            type: array
            items:
              type: string
          example:
            - ["username", "role", "createdAt"]
            - ["user1", "admin", "2024-01-15T10:30:00Z"]
            - ["user2", "user", "2024-01-16T14:20:00Z"]

    MetaResponseData:
      type: object
      properties:
        sheets:
          type: array
          description: Список всех таблиц
          items:
            type: object
            properties:
              name:
                type: string
                description: Название таблицы
                example: "sys_Users"
              id:
                type: integer
                description: Внутренний ID таблицы (gid)
                example: 0

    # === SECURITY SCHEMAS ===

    UsernameAuth:
      type: apiKey
      in: body
      name: username
      description: Логин пользователя передаётся в теле каждого запроса

paths:
  # === READ ===
  /:
    post:
      summary: Чтение данных из таблицы
      description: Читает указанный диапазон ячеек из указанной таблицы
      operationId: readData
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ReadRequest'
            example:
              action: read
              sheetName: sys_Users
              range: "A1:E100"
              username: admin
      responses:
        '200':
          description: Успешное чтение
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/SuccessResponse'
                  - type: object
                    properties:
                      data:
                        $ref: '#/components/schemas/ReadResponseData'
        '400':
          description: Ошибка в параметрах
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

    # === APPEND ===
    post:
      summary: Добавление строк в таблицу
      description: Добавляет один или несколько строк в конец указанной таблицы
      operationId: appendData
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AppendRequest'
            example:
              action: append
              sheetName: sys_Sessions
              rows:
                - ["sess_001", "user1", "trainer", "2024-04-06T10:00:00Z", 1800]
              username: admin
      responses:
        '200':
          description: Строки успешно добавлены
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/SuccessResponse'
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          appendedRows:
                            type: integer
                            description: Количество добавленных строк
                            example: 1
        '400':
          description: Ошибка в параметрах
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

  # === UPDATE ===
  /:
    post:
      summary: Обновление ячеек
      description: Обновляет указанный диапазон ячеек в таблице
      operationId: updateData
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/UpdateRequest'
            example:
              action: update
              sheetName: sys_Users
              range: "D2"
              values: [["2024-04-06T12:00:00Z"]]
              username: admin
      responses:
        '200':
          description: Ячейки успешно обновлены
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SuccessResponse'
        '400':
          description: Ошибка в параметрах
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

  # === BATCH VALUES ===
  /:
    post:
      summary: Пакетное обновление диапазонов
      description: Обновляет несколько диапазонов за один запрос
      operationId: batchUpdateValues
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/BatchValuesRequest'
            example:
              action: batchValues
              updates:
                - range: "A1"
                  values: [["value1"]]
                - range: "B1"
                  values: [["value2"]]
              username: admin
      responses:
        '200':
          description: Пакетное обновление выполнено
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SuccessResponse'
        '400':
          description: Ошибка в параметрах
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

  # === META ===
  /:
    post:
      summary: Получение метаданных таблиц
      description: Возвращает список всех таблиц с названиями и ID
      operationId: getMeta
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/MetaRequest'
            example:
              action: meta
              username: admin
      responses:
        '200':
          description: Метаданные получены
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/SuccessResponse'
                  - type: object
                    properties:
                      data:
                        $ref: '#/components/schemas/MetaResponseData'
        '400':
          description: Ошибка в параметрах
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

  # === ADD SHEETS ===
  /:
    post:
      summary: Создание новых таблиц
      description: Создаёт одну или несколько новых таблиц в Google Sheets
      operationId: addSheets
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/AddSheetsRequest'
            example:
              action: addSheets
              sheets:
                - name: "my_custom_table"
              username: admin
      responses:
        '200':
          description: Таблицы успешно созданы
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SuccessResponse'
        '400':
          description: Ошибка в параметрах
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

  # === DELETE SHEET ===
  /:
    post:
      summary: Удаление таблицы
      description: Удаляет таблицу по её внутреннему ID (gid)
      operationId: deleteSheet
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/DeleteSheetRequest'
            example:
              action: deleteSheet
              sheetId: 123456789
              username: admin
      responses:
        '200':
          description: Таблица удалена
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SuccessResponse'
        '400':
          description: Ошибка в параметрах
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'

  # === DELETE ROWS ===
  /:
    post:
      summary: Удаление строк по индексу
      description: Удаляет диапазон строк из таблицы
      operationId: deleteRows
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/DeleteRowsRequest'
            example:
              action: deleteRows
              sheetName: sys_Sessions
              startRow: 5
              endRow: 10
              username: admin
      responses:
        '200':
          description: Строки удалены
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/SuccessResponse'
        '400':
          description: Ошибка в параметрах
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/ErrorResponse'
```

---

## 3. Схемы данных бизнес-объектов

### 3.1 Пользователь (`sys_Users`)

```json
{
  "type": "object",
  "properties": {
    "username": {
      "type": "string",
      "description": "Уникальный логин",
      "minLength": 3,
      "maxLength": 50,
      "pattern": "^[a-zA-Z0-9_]+$"
    },
    "password": {
      "type": "string",
      "description": "Хэш пароля (не plaintext)",
      "minLength": 32
    },
    "role": {
      "type": "string",
      "enum": ["admin", "user"],
      "default": "user"
    },
    "createdAt": {
      "type": "string",
      "format": "date-time",
      "description": "Дата регистрации (ISO 8601)"
    },
    "lastLogin": {
      "type": "string",
      "format": "date-time",
      "description": "Дата последнего входа (ISO 8601)"
    },
    "totalXP": {
      "type": "integer",
      "minimum": 0,
      "description": "Суммарный опыт пользователя"
    }
  },
  "required": ["username", "password", "role"]
}
```

### 3.2 Сессия (`sys_Sessions`)

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid",
      "description": "UUID сессии"
    },
    "username": {
      "type": "string",
      "description": "Логин пользователя (FK → sys_Users)"
    },
    "appId": {
      "type": "string",
      "description": "ID запущенного приложения"
    },
    "startedAt": {
      "type": "string",
      "format": "date-time",
      "description": "Время начала сессии (ISO 8601)"
    },
    "duration": {
      "type": "integer",
      "minimum": 0,
      "description": "Длительность сессии в секундах"
    }
  },
  "required": ["id", "username", "appId", "startedAt"]
}
```

### 3.3 Результат игры (`gameplay_Scores`)

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid",
      "description": "UUID записи"
    },
    "username": {
      "type": "string",
      "description": "Логин пользователя (FK → sys_Users)"
    },
    "gameId": {
      "type": "string",
      "description": "ID игры (например, 'tetris', 'snake')"
    },
    "score": {
      "type": "integer",
      "minimum": 0,
      "description": "Очки в игре"
    },
    "xp": {
      "type": "integer",
      "minimum": 0,
      "description": "Начисленный опыт"
    },
    "playedAt": {
      "type": "string",
      "format": "date-time",
      "description": "Дата и время игры (ISO 8601)"
    }
  },
  "required": ["id", "username", "gameId", "score", "xp", "playedAt"]
}
```

### 3.4 Запись словаря (`dictionary_words`)

```json
{
  "type": "object",
  "properties": {
    "username": {
      "type": "string",
      "description": "Логин пользователя"
    },
    "word": {
      "type": "string",
      "description": "Изучаемое слово"
    },
    "translation": {
      "type": "string",
      "description": "Перевод слова"
    },
    "level": {
      "type": "integer",
      "minimum": 0,
      "maximum": 5,
      "description": "Уровень освоения (0 = не изучено, 5 = освоено)"
    },
    "lastReviewed": {
      "type": "string",
      "format": "date-time",
      "description": "Дата последнего повторения"
    }
  },
  "required": ["username", "word", "translation", "level"]
}
```

### 3.5 Лог тренировки (`workout_logs`)

```json
{
  "type": "object",
  "properties": {
    "username": {
      "type": "string",
      "description": "Логин пользователя"
    },
    "programId": {
      "type": "string",
      "description": "ID тренировочной программы"
    },
    "completedAt": {
      "type": "string",
      "format": "date-time",
      "description": "Дата завершения тренировки"
    },
    "duration": {
      "type": "integer",
      "minimum": 0,
      "description": "Длительность тренировки в секундах"
    },
    "exercisesCompleted": {
      "type": "integer",
      "minimum": 0,
      "description": "Количество выполненных упражнений"
    },
    "exercisesTotal": {
      "type": "integer",
      "minimum": 0,
      "description": "Общее количество упражнений в программе"
    }
  },
  "required": ["username", "programId", "completedAt", "duration"]
}
```

---

## 4. Примеры запросов

### 4.1 Аутентификация (чтение пользователя)

**Запрос:**
```http
POST {GAS_URL}/
Content-Type: application/json

{
  "action": "read",
  "sheetName": "sys_Users",
  "range": "A1:F100",
  "username": "admin"
}
```

**Ответ:**
```json
{
  "success": true,
  "data": {
    "values": [
      ["username", "password", "role", "createdAt", "lastLogin", "totalXP"],
      ["admin", "5f4dcc3b5aa765d61d8327deb882cf99", "admin", "2024-01-01T00:00:00Z", "2024-04-06T10:00:00Z", 1500],
      ["user1", "e99a18c428cb38d5f260853678922e03", "user", "2024-01-15T10:30:00Z", "2024-04-05T18:45:00Z", 350]
    ]
  },
  "error": null
}
```

### 4.2 Запись результата игры

**Запрос:**
```http
POST {GAS_URL}/
Content-Type: application/json

{
  "action": "append",
  "sheetName": "gameplay_Scores",
  "rows": [
    ["550e8400-e29b-41d4-a716-446655440000", "user1", "tetris", 12500, 150, "2024-04-06T14:30:00Z"]
  ],
  "username": "user1"
}
```

**Ответ:**
```json
{
  "success": true,
  "data": {
    "appendedRows": 1
  },
  "error": null
}
```

### 4.3 Создание таблицы для нового приложения

**Запрос:**
```http
POST {GAS_URL}/
Content-Type: application/json

{
  "action": "addSheets",
  "sheets": [
    { "name": "marketplace_listings" }
  ],
  "username": "admin"
}
```

**Ответ:**
```json
{
  "success": true,
  "data": {
    "created": ["marketplace_listings"]
  },
  "error": null
}
```

### 4.4 Логирование тренировки

**Запрос:**
```http
POST {GAS_URL}/
Content-Type: application/json

{
  "action": "append",
  "sheetName": "workout_logs",
  "rows": [
    ["user1", "mcgill_531", "2024-04-06T08:00:00Z", 1800, 9, 12]
  ],
  "username": "user1"
}
```

---

## 5. Rate Limiting и квоты

| Параметр | Значение |
|----------|----------|
| Макс. запросов/100 сек | ~100 (бесплатный аккаунт Google) |
| Макс. время выполнения скрипта | 6 минут |
| Макс. URL вызовов/день | 20,000 |
| Макс. ячеек в таблице | 10,000,000 |
| Макс. размер запроса | Ограничено GAS (~50 МБ) |

---

## 6. Changelog

| Версия | Дата | Изменения |
|--------|------|-----------|
| 1.0 | 06.04.2026 | Первичная спецификация API |
