# Код-ревью KuApp — 17.10.2026

Обзор платформы (`index.html`, `gas/Code.gs`, `sw.js`) и мини-игр (`apps/*.html`).
Находки отсортированы по серьёзности. В этом же проходе добавлен сетевой режим
(см. раздел «Что исправлено в этом проходе»), остальные пункты — задел на следующие итерации.

Серьёзность: **critical** — безопасность/потеря данных, **high** — функция не работает,
**medium** — заметный дефект, **low** — косметика.

---

## 1. Платформа и бэкенд

### 1.1 [critical] Бэкенд GAS без авторизации
`gas/Code.gs` (doPost), `gas/appsscript.json` (`access: ANYONE_ANONYMOUS`, `executeAs: USER_DEPLOYING`).
URL веб-приложения захардкожен в `index.html` (HARDCODED_GAS_URL) и виден всем. Любой может POST-ом вызвать
`deleteSheet`, `deleteRows {startIndex:0,endIndex:100000}`, `update sys_Users!D2 = admin`, прочитать `sys_Users`.
Проверка роли есть только в UI.
**Исправление:** в `doPost` требовать токен сессии (Script Property + выдача после логина), проверять роль
admin на сервере для `deleteSheet/deleteRows/addSheets` и для записи в `sys_*`.

### 1.2 [critical] Пароли в открытом виде, таблица пользователей целиком уходит на клиент
`index.html` — `loginUser` читает `sys_Users!A2:G5000` и сравнивает пароль строкой; `registerUser` пишет пароль как есть;
`loadAdminUsers` тоже получает колонку Password. `PlatformAPI.db.read` валидирует только имя листа, поэтому любое
приложение в iframe (или гость из DevTools) делает `PlatformAPI.db.read('sys_Users!A2:G5000')` и получает все пароли.
Роль хранится в localStorage (`mcg_user`) и редактируется во вкладке «Настройки → Кэш» → `role:"admin"`.
**Исправление:** login/register перенести в GAS (`action: 'login'`), хранить хэш (SHA-256 + соль через
`Utilities.computeDigest`), клиенту отдавать только `{login, role, token}`; запретить `sys_` в `validateSheetRange`.

### 1.3 [high] Инъекция формул в Google Sheets
`gas/Code.gs` — `doAppend/doUpdate/doBatchValues` пишут через `setValues`, строки, начинающиеся с `=`, выполняются как формулы.
Гость вызывает `PlatformAPI.system.log('x','e','=IMPORTXML(...)')` и формула выполняется в таблице владельца.
**Исправление:** `range.setNumberFormat('@')` перед `setValues` либо экранирование `= + - @` апострофом.
Заодно закрывает п. 1.7.

### 1.4 [high] Stored XSS: `esc()` не экранирует кавычки
`index.html` — `esc` экранирует только `& < >`, а значения подставляются в атрибуты и inline-обработчики
(`title="${esc(val)}"`, `ondblclick="editDataCell(...,'${esc(val)}')"`, `data-app="${esc(r.app)}"`,
`onclick="openDataSheet('${esc(name)}')"`). Гость логирует строку с `" onmouseover="…` → вкладка «Статистика»
(доступна всем) выполняет JS.
**Исправление:** добавить в `esc` замену `"`→`&quot;`, `'`→`&#39;`; в обработчики передавать индексы, не значения.

### 1.5 [high] Service Worker: Cache First навсегда для `apps/*.html` и `apps/index.json`
`sw.js` — всё same-origin кэшируется при первом запросе и больше не перезапрашивается, пока не сменится `CACHE_NAME`.
README обещает Network First для приложений — это не так. Обновили игру без правки `sw.js` → пользователи
видят старую версию бесконечно. В `externalHosts` нет `ipapi.co`, `api.ipify.org`.
**Исправление:** для `/apps/` и `*.json` — Network First с fallback в кэш (или stale-while-revalidate).
*В этом проходе кэш поднят до `app-v8`, чтобы доехали сетевые игры.*

### 1.6 [medium] Гонки без LockService и адресация строк по позиции
`gas/Code.gs` — `doAppend` берёт `getLastRow()+1` без блокировки: два одновременных `append` пишут в одну строку.
`index.html` `submitScore` — read-modify-write TotalXP без блокировки, строка ищется по индексу, который мог
сдвинуться после `deleteRows`. То же в `adminToggleRole/Block`.
**Исправление:** `LockService.getScriptLock().waitLock(10000)` в `doAppend/doUpdate`; серверное действие
`updateUserXP`, ищущее строку по логину.

### 1.7 [medium] Автоконвертация типов при записи ломает логин
`setValues` превращает `"0123"` в `123`, `"12.05"` в дату, `"TRUE"` в boolean. Пароль `0077` → «Неверный логин или пароль».
**Исправление:** `setNumberFormat('@')` перед записью (см. 1.3).

### 1.8 [medium] Утечка IP и геолокации гостей
`index.html` `getGuestIdentity` запрашивает ipapi.co и пишет `Гость (IP · Город, Страна)` в `sys_Logs`;
вкладка «Статистика» доступна всем гостям.
**Исправление:** случайный `guest_<id>` в localStorage; IP логировать только на сервере при необходимости.

### 1.9 [medium] `openDataSheet` читает `A1:ZZ5000`, бэкенд не ограничивает ширину
`gas/Code.gs doRead` обрезает строки по `getLastRow()`, но колонки берёт из запроса (ZZ = 702).
Лист в 2000 строк → 1.4 млн ячеек → таймаут GAS.
**Исправление:** `numCols = Math.min(ref.getNumColumns(), sh.getLastColumn() - col + 1)`.

### 1.10 [medium] SW устанавливается при неудачном `addAll`, offline-fallback падает
`sw.js` — `.catch(console.warn)` глотает ошибку установки; при офлайне `caches.match('./index.html')` может
вернуть `undefined` → `respondWith(undefined)` → TypeError.
**Исправление:** убрать catch; `caches.match(...).then(r => r || new Response('Offline', {status:503}))`.

### 1.11 [low] Мёртвая ветка настройки подключения
`loadCfg()` всегда перезаписывает `cfg.gasUrl` хардкодом, поэтому экран setup и «Изменить подключение» бесполезны.

### 1.12 [low] `closeAllModals` не определена
Escape вне iframe → `ReferenceError`.

### 1.13 [low] `sandbox="allow-scripts allow-same-origin"` не изолирует приложения
Такая комбинация равна отсутствию sandbox для same-origin. Плитка «GAS WebApp» открывает `doGet`, который
возвращает JSON и запрещает фрейминг — бесполезна.

### 1.14 [low] `gasCall` не умеет не-JSON ответы и не имеет таймаута
При превышении квоты GAS отдаёт HTML со статусом 200 → «Unexpected token <».

### 1.15 [low] `submitScore` рапортует об успехе при неудаче
Ошибки записи глотаются, затем показывается «🏆 Очки сохранены».

Дополнительно: `apps/dictionary.html` вызывает `Platform.db.batchStructural`, которого в PlatformAPI нет.

---

## 2. Игры

### pong.html
- **[high]** `Paddle.update`: блок интерполяции игрока стоит внутри `if (this.isAI)`, ветки `else` нет → ракетка
  игрока не двигается ни мышью, ни тачем, ни клавишами; ИИ-ракетка притягивается к начальному `targetX`.
- **[medium]** `checkScoring`: пока все мячи неактивны, `setTimeout(spawnBall, 1000)` ставится каждый кадр, ни один
  не очищается → мяч «дёргается» после гола, спавнится в меню.

### tetris.html
- **[high]** `G.lines` нигде не инкрементируется → уровень всегда 1, скорость не растёт, HUD «Линии» = 0, спринт
  на 40 линий никогда не завершается.

### watersort.html
- **[high]** `doPour`: цикл `k++` вместо `k--` → переливается ровно один сегмент, par-уровни недостижимы.
- **[medium]** `generateLevel`: нет проверки решаемости, уровни с одной пустой пробиркой бывают нерешаемы.

### basketball.html
- **[high]** Кнопка паузы вызывает `showScreen('pause')`, экрана нет → на телефоне софт-лок до перезагрузки.
- **[medium]** SURVIVAL: после попадания сцена меняется через `setTimeout(600)`, мяч успевает «потеряться» → гол и
  потеря мяча одновременно, двойная генерация сцены.

### minesweeper.html
- **[high]** «Сбросить всё» делает `localStorage.clear()` — стирает сессию платформы и сейвы всех игр.
- **[high]** В «Забеге» `initBoard` вызывается из рекурсии flood-fill, внешние циклы продолжают раскрывать клетки
  уже на новом поле → мгновенный проигрыш.
- **[medium]** Аккорд после взрыва продолжает раскрывать соседей и может дать победу поверх проигрыша; таймер
  оверлея не очищается.
- **[medium]** Пауза не останавливает таймер; `settings.safeFirst` ни на что не влияет.

### PlatformAPI / XP (кросс-игровое)
- **[medium]** `submitScore` вызывают только Wall Rush и Сапёр. Остальные 18 игр очки не отправляют → рейтинг
  платформы фактически по двум играм. В сапёре формула `100000/(sec+1)` одинакова для всех сложностей.

### billiard.html
- **[medium]** `initGame` не сбрасывал `ballsMoving/hitOccurred/turnValid/pocketedThisTurn`, а модалка победы
  вызывает `initGame` пока шары катятся → «ФОЛ: Промах» в только что начатой партии. *Исправлено в этом проходе.*

### Частота кадров (flappy, dino, pacman, pong, billiard)
- **[medium]** Физика привязана к кадру rAF, а не ко времени: на 120/144 Гц игры идут в 2–2.4× быстрее.

### pacman.html
- **[medium]** BLINKY после съедения не имеет правила выхода из домика → навсегда остаётся в нём.

### snake.html
- **[medium]** ENDLESS: ускорение пишется в `baseSpeed`, а тик использует `this.speed` → скорость не растёт.

### dino.html
- **[low]** Рекорд показывается как `best/10`, текущий счёт — целиком.

### clicker.html
- **[medium]** `renderShop()` пересоздаёт DOM 20 раз/с → клики по апгрейдам «не проходят»; прогресс не сохраняется.

### sudoku.html
- **[medium]** `generatePuzzle` синхронно считает решения для 57 клеток → секунды фриза UI; таймер идёт в паузе.

### reversi.html / tictac.html
- **[medium]** Реверси: `newGame()` не очищал таймеры ИИ → ИИ ходит первым на чистой доске. *Исправлено в этом проходе.*
  Угол с индексом 0 ложный в `cornerMove||…`; пас игрока не объявляется.
- **[medium]** Крестики: пауза в 1.6 с после конца партии отменяет автоперезапуск, доска остаётся `locked`.

Без существенных дефектов: 2048, memory, fifteen, wordle, breakout (мелочи).

---

## 3. Что исправлено в этом проходе
- Сетевой режим через GAS для крестиков-ноликов, реверси, Wall Rush и бильярда (`apps/kunet.js`, `gas/Code.gs` room*).
- `billiard.html`: `initGame` сбрасывает флаги хода.
- `reversi.html`: `newGame` очищает таймеры ИИ.
- `sw.js`: кэш `app-v8`.

## 4. Рекомендуемый порядок следующих исправлений
1. 1.1 + 1.2 — авторизация в GAS и хэширование паролей.
2. 1.3/1.7 — `setNumberFormat('@')` в Code.gs (одна строка, закрывает две проблемы).
3. 1.4 — `esc()` с кавычками.
4. 1.5 — Network First для `apps/`.
5. Игры: pong (ракетка), tetris (линии), watersort (`k--`), basketball (пауза), minesweeper (`localStorage.clear`).
