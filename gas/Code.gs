/**
 * KuApp Backend — Google Apps Script
 *
 * Этот скрипт служит бэкендом для платформы KuApp.
 * Все операции с Google Sheets проходят через него.
 *
 * Настройка:
 *   1. Создайте новый проект Google Apps Script (script.google.com)
 *   2. Вставьте этот код в Code.gs
 *   3. Добавьте Script Property:
 *        SPREADSHEET_ID = <ID вашей Google Таблицы>
 *      (Файл → Настройки проекта → Свойства скрипта)
 *      SALT — соль для хэширования паролей. Создаётся автоматически при
 *      первом логине/регистрации, если не задана. Не меняйте её после
 *      появления пользователей — все хэши станут недействительными.
 *   4. Разверните как веб-приложение:
 *        Развернуть → Новое развёртывание → Веб-приложение
 *        Выполнять как: Я
 *        Доступ:       Все
 *   5. Скопируйте URL развёртывания и вставьте в KuApp
 *
 * Авторизация (см. раздел AUTH):
 *   - login / register выдают токен сессии (CacheService, 6 ч, продлевается).
 *   - Клиент передаёт его в теле запроса: { action, params, token }.
 *   - Без токена доступны: meta, чтение любых листов кроме sys_Users,
 *     запись в приложения (не sys_*), append в sys_Logs, действия room*.
 *   - Любая запись в sys_* (кроме append в sys_Logs и sys_Scores),
 *     addSheets / deleteSheet / deleteRows и чтение sys_Users — только admin.
 */

/* ═══════════════════════════════════════════════════
 * HELPERS
 * ═══════════════════════════════════════════════════ */

function getSpreadsheet() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID не настроен в Script Properties');
  return SpreadsheetApp.openById(id);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok(data)  { return json({ ok: true, data: data }); }
function fail(msg, code) {
  var out = { ok: false, error: msg };
  if (code) out.code = code;
  return json(out);
}

/** Ошибка авторизации: code уходит клиенту (AUTH_EXPIRED → разлогин). */
function AuthError(message, code) {
  this.name = 'AuthError';
  this.message = message;
  this.code = code || 'FORBIDDEN';
}
AuthError.prototype = Object.create(Error.prototype);
AuthError.prototype.constructor = AuthError;

/** Разбирает диапазон "SheetName!A2:G100" → { sheet, range } */
function parseRange(rangeStr) {
  rangeStr = String(rangeStr || '');
  var idx = rangeStr.indexOf('!');
  if (idx === -1) return { sheet: rangeStr, range: null };
  return { sheet: rangeStr.substring(0, idx), range: rangeStr.substring(idx + 1) };
}

/** Буквенный столбец → номер (A=1, B=2, AA=27) */
function colLetterToNum(letters) {
  var n = 0;
  for (var i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n;
}

/** Преобразует 2D-массив значений в строки (совместимость с Sheets API v4) */
function stringify2D(data) {
  return data.map(function(row) {
    return row.map(function(cell) {
      if (cell instanceof Date) return cell.toISOString();
      if (cell === null || cell === undefined) return '';
      return String(cell);
    });
  });
}

/**
 * Пишет значения как текст.
 *  - setNumberFormat('@') не даёт автоконвертировать "0123" → 123,
 *    "12.05" → дату, "TRUE" → boolean.
 *  - Строки, начинающиеся с «=», setValues всё равно трактует как формулы
 *    (проверено: формат «@» не спасает), поэтому они экранируются ведущим
 *    апострофом — Sheets сохраняет такую строку как текст без апострофа.
 *    Ведущий апостроф пользователя тоже удваивается, чтобы не потеряться.
 */
function textSafe(v) {
  if (typeof v === 'string' && (v.charAt(0) === '=' || v.charAt(0) === "'")) return "'" + v;
  return v;
}

function setTextValues(range, values) {
  var safe = values.map(function (row) { return Array.isArray(row) ? row.map(textSafe) : row; });
  range.setNumberFormat('@');
  range.setValues(safe);
}

/* ═══════════════════════════════════════════════════
 * ENTRY POINTS
 * ═══════════════════════════════════════════════════ */

function doGet(e) {
  return ok({ service: 'KuApp Backend', version: '1.1' });
}

function doPost(e) {
  try {
    if (!e || !e.postData) throw new Error('Нет данных POST');
    var body   = JSON.parse(e.postData.contents);
    var action = body.action;
    var params = body.params || {};
    if (isRoomAction(action)) return ok(handleRoomAction(action, params));
    var ss     = getSpreadsheet();

    // Действия без сессии
    if (action === 'login')    return ok(doLogin(ss, params));
    if (action === 'register') return ok(doRegister(ss, params));
    if (action === 'logout')   { sessionDrop(body.token); return ok({ loggedOut: true }); }

    // Токен сессии: если передан, он должен быть действительным
    var sess = null;
    if (body.token) {
      sess = sessionLoad(body.token);
      if (!sess) throw new AuthError('Сессия истекла, войдите снова', 'AUTH_EXPIRED');
    }
    authorize(ss, action, params, sess);

    switch (action) {
      case 'me':           return ok(doMe(ss, sess, body.token));
      case 'addXP':        return ok(doAddXP(ss, sess, params));
      case 'read':         return ok(doRead(ss, params));
      case 'append':       return ok(doAppend(ss, params));
      case 'update':       return ok(doUpdate(ss, params));
      case 'batchValues':  return ok(doBatchValues(ss, params));
      case 'meta':         return ok(doMeta(ss));
      case 'addSheets':    return ok(doAddSheets(ss, params));
      case 'deleteSheet':  return ok(doDeleteSheet(ss, params));
      case 'deleteRows':   return ok(doDeleteRows(ss, params));
      default:             throw new Error('Неизвестное действие: ' + action);
    }
  } catch (err) {
    return fail(err.message, err.code);
  }
}

/** Действия, которым не нужна таблица (онлайн-комнаты). */
function isRoomAction(action) {
  return typeof action === 'string' && action.indexOf('room') === 0;
}

/* ═══════════════════════════════════════════════════
 * AUTH — пользователи, пароли, сессии
 *
 * sys_Users: [ID, Email(login), Password, Role, TotalXP, CreatedAt, Status]
 *             A   B             C         D     E        F          G
 * Password хранится как "sha256$<соль пользователя>$<hex>", где
 * hex = SHA-256(SALT + ':' + соль пользователя + ':' + пароль).
 * Старые пароли в открытом виде принимаются один раз и перезаписываются хэшем.
 * ═══════════════════════════════════════════════════ */

var SESSION_TTL_SEC = 21600;                        // 6 часов (максимум CacheService)
var USERS_SHEET     = 'sys_Users';
var SCORES_SHEET    = 'sys_Scores';
var USERS_HEADERS   = ['ID', 'Email', 'Password', 'Role', 'TotalXP', 'CreatedAt', 'Status'];
var SCORES_HEADERS  = ['Timestamp', 'Email', 'AppID', 'RawScore', 'XP'];
var HASH_PREFIX     = 'sha256$';
var U_ID = 0, U_LOGIN = 1, U_PASS = 2, U_ROLE = 3, U_XP = 4, U_CREATED = 5, U_STATUS = 6;

function isSysSheet(name)   { return /^sys_/i.test(String(name || '')); }
function isUsersSheet(name) { return String(name || '').toLowerCase() === USERS_SHEET.toLowerCase(); }
function isLogsSheet(name)  { return String(name || '').toLowerCase() === 'sys_logs'; }
function isScoresSheet(name){ return String(name || '').toLowerCase() === SCORES_SHEET.toLowerCase(); }

function withScriptLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ── Соль и хэш ── */

function getSalt() {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('SALT');
  if (salt) return salt;
  return withScriptLock(function () {
    var s = props.getProperty('SALT');
    if (!s) {
      s = Utilities.getUuid() + Utilities.getUuid();
      props.setProperty('SALT', s);
    }
    return s;
  });
}

function bytesToHex(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var h = (bytes[i] & 0xff).toString(16);
    out += h.length === 1 ? '0' + h : h;
  }
  return out;
}

function sha256Hex(str) {
  return bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8));
}

function hashPassword(password, userSalt) {
  userSalt = userSalt || Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return HASH_PREFIX + userSalt + '$' + sha256Hex(getSalt() + ':' + userSalt + ':' + password);
}

function isHashed(stored) {
  return typeof stored === 'string' && stored.indexOf(HASH_PREFIX) === 0;
}

/** Сравнение строк за постоянное время. */
function safeEqual(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Проверяет пароль против сохранённого значения.
 * → { match: boolean, needsRehash: boolean }
 * needsRehash = true, если в ячейке лежал пароль в открытом виде (миграция).
 */
function verifyPassword(password, stored) {
  stored = (stored === null || stored === undefined) ? '' : String(stored);
  if (isHashed(stored)) {
    var parts = stored.split('$');                   // ['sha256', userSalt, hex]
    if (parts.length !== 3) return { match: false, needsRehash: false };
    return { match: safeEqual(hashPassword(password, parts[1]), stored), needsRehash: false };
  }
  if (stored === '') return { match: false, needsRehash: false };
  var match = safeEqual(stored, password);
  // Старый клиент писал пароль через setValues: "0077" превратился в 77.
  if (!match && /^\d+$/.test(password) && safeEqual(stored, String(Number(password)))) match = true;
  return { match: match, needsRehash: true };
}

/* ── Сессии (CacheService) ── */

function sessCache()      { return CacheService.getScriptCache(); }
function sessKey(token)   { return 'sess:' + token; }

function sessionCreate(login, role) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  sessCache().put(sessKey(token), JSON.stringify({ login: login, role: role }), SESSION_TTL_SEC);
  return token;
}

/** Возвращает { login, role } или null. Действительный токен продлевается. */
function sessionLoad(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{32,128}$/.test(token)) return null;
  var raw = sessCache().get(sessKey(token));
  if (!raw) return null;
  sessCache().put(sessKey(token), raw, SESSION_TTL_SEC);
  return JSON.parse(raw);
}

function sessionUpdate(token, login, role) {
  if (typeof token !== 'string') return;
  sessCache().put(sessKey(token), JSON.stringify({ login: login, role: role }), SESSION_TTL_SEC);
}

function sessionDrop(token) {
  if (typeof token === 'string' && token) sessCache().remove(sessKey(token));
}

/* ── Лист пользователей ── */

function ensureSheet(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (sh) return sh;
  sh = ss.insertSheet(name);
  setTextValues(sh.getRange(1, 1, 1, headers.length), [headers]);
  return sh;
}

function usersSheet(ss) {
  var sh = ss.getSheetByName(USERS_SHEET);
  if (!sh) throw new Error('Лист ' + USERS_SHEET + ' не найден. Зарегистрируйте первого пользователя.');
  return sh;
}

function usersRows(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, USERS_HEADERS.length).getValues();
}

/** → { rowNum (1-based, -1 если нет), row, count } */
function findUserRow(sh, login) {
  var rows = usersRows(sh);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][U_LOGIN]) === login) return { rowNum: i + 2, row: rows[i], count: rows.length };
  }
  return { rowNum: -1, row: null, count: rows.length };
}

function userRole(row)    { return String(row[U_ROLE] || 'user').toLowerCase() || 'user'; }
function userBlocked(row) { return String(row[U_STATUS] || '').toLowerCase() === 'blocked'; }

function userPublic(row, token) {
  var out = { login: String(row[U_LOGIN]), role: userRole(row), total_xp: parseInt(row[U_XP], 10) || 0 };
  if (token) out.token = token;
  return out;
}

function validLogin(login) {
  login = String(login === undefined || login === null ? '' : login).trim();
  if (!login) throw new Error('Введите логин');
  if (login.length > 64) throw new Error('Логин слишком длинный');
  if (/[\u0000-\u001f]/.test(login)) throw new Error('Недопустимые символы в логине');
  return login;
}

function validPassword(password, forRegister) {
  password = String(password === undefined || password === null ? '' : password);
  if (!password) throw new Error('Введите пароль');
  if (forRegister && password.length < 4) throw new Error('Пароль — минимум 4 символа');
  if (password.length > 128) throw new Error('Пароль слишком длинный');
  return password;
}

/* ── Действия ── */

/**
 * Вход. params: { login, password } → { login, role, total_xp, token }
 * Пароль в открытом виде (старые аккаунты) принимается и сразу заменяется хэшем.
 */
function doLogin(ss, params) {
  var login    = validLogin(params.login);
  var password = validPassword(params.password, false);
  return withScriptLock(function () {
    var sh = usersSheet(ss);
    var f  = findUserRow(sh, login);
    if (!f.row) throw new AuthError('Неверный логин или пароль', 'BAD_CREDENTIALS');
    var v = verifyPassword(password, f.row[U_PASS]);
    if (!v.match) throw new AuthError('Неверный логин или пароль', 'BAD_CREDENTIALS');
    if (userBlocked(f.row)) throw new AuthError('Аккаунт заблокирован', 'BLOCKED');
    if (v.needsRehash) {
      setTextValues(sh.getRange(f.rowNum, U_PASS + 1), [[hashPassword(password)]]);
    }
    var token = sessionCreate(String(f.row[U_LOGIN]), userRole(f.row));
    return userPublic(f.row, token);
  });
}

/**
 * Регистрация. params: { login, password } → { login, role, total_xp, token }
 * Первый пользователь получает роль admin.
 */
function doRegister(ss, params) {
  var login    = validLogin(params.login);
  var password = validPassword(params.password, true);
  if (login.length < 3) throw new Error('Логин — минимум 3 символа');
  return withScriptLock(function () {
    var sh = ensureSheet(ss, USERS_SHEET, USERS_HEADERS);
    var f  = findUserRow(sh, login);
    if (f.row) throw new Error('Пользователь уже существует');
    var role = f.count === 0 ? 'admin' : 'user';
    var row  = ['u_' + new Date().getTime().toString(36), login, hashPassword(password), role, '0', new Date().toISOString(), 'active'];
    setTextValues(sh.getRange(sh.getLastRow() + 1, 1, 1, row.length), [row]);
    var token = sessionCreate(login, role);
    return userPublic(row, token);
  });
}

/** Текущий профиль по токену (актуальные роль/XP из таблицы). */
function doMe(ss, sess, token) {
  var f = findUserRow(usersSheet(ss), sess.login);
  if (!f.row || userBlocked(f.row)) {
    sessionDrop(token);
    throw new AuthError('Сессия истекла, войдите снова', 'AUTH_EXPIRED');
  }
  sessionUpdate(token, sess.login, userRole(f.row));
  return userPublic(f.row, null);
}

/**
 * Начисление XP залогиненному пользователю (строка ищется по логину).
 * params: { appId, rawScore, xp } → { total_xp }
 * Пишет строку в sys_Scores и увеличивает TotalXP в sys_Users.
 */
function doAddXP(ss, sess, params) {
  var appId = String(params.appId || '').slice(0, 64);
  var raw   = Number(params.rawScore);
  var xp    = Math.round(Number(params.xp));
  if (!isFinite(raw)) raw = 0;
  if (!isFinite(xp) || xp < 0 || xp > 1000000) throw new Error('Некорректное значение XP');
  return withScriptLock(function () {
    var scores = ensureSheet(ss, SCORES_SHEET, SCORES_HEADERS);
    setTextValues(scores.getRange(scores.getLastRow() + 1, 1, 1, SCORES_HEADERS.length),
                  [[new Date().toISOString(), sess.login, appId, String(raw), String(xp)]]);
    var sh = usersSheet(ss);
    var f  = findUserRow(sh, sess.login);
    if (!f.row) throw new AuthError('Пользователь не найден', 'AUTH_EXPIRED');
    var total = (parseInt(f.row[U_XP], 10) || 0) + xp;
    setTextValues(sh.getRange(f.rowNum, U_XP + 1), [[String(total)]]);
    return { total_xp: total };
  });
}

/* ── Проверка прав ── */

function requireAuth(sess) {
  if (!sess) throw new AuthError('Требуется вход в аккаунт', 'AUTH_REQUIRED');
}

/** Роль admin проверяется по таблице, а не по кэшу сессии. */
function requireAdmin(ss, sess) {
  requireAuth(sess);
  var f = findUserRow(usersSheet(ss), sess.login);
  if (!f.row || userBlocked(f.row) || userRole(f.row) !== 'admin') {
    throw new AuthError('Требуются права администратора', 'FORBIDDEN');
  }
}

/**
 * Политика доступа по действиям.
 *   гость (без токена): meta; read всего кроме sys_Users; append в sys_Logs;
 *                       append/update/batchValues в листы приложений (не sys_*)
 *   пользователь:       + append в sys_Scores, addXP, me
 *   admin:              + любая запись в sys_*, read sys_Users,
 *                       addSheets / deleteSheet / deleteRows
 */
function authorize(ss, action, params, sess) {
  var sheet;
  switch (action) {
    case 'meta':
      return;
    case 'read':
      sheet = parseRange(params.range).sheet;
      if (isUsersSheet(sheet)) requireAdmin(ss, sess);
      return;
    case 'append':
      sheet = parseRange(params.range).sheet;
      if (!isSysSheet(sheet) || isLogsSheet(sheet)) return;
      if (isScoresSheet(sheet)) { requireAuth(sess); return; }
      requireAdmin(ss, sess);
      return;
    case 'update':
      sheet = parseRange(params.range).sheet;
      if (isSysSheet(sheet)) requireAdmin(ss, sess);
      return;
    case 'batchValues':
      var data = Array.isArray(params.data) ? params.data : [];
      for (var i = 0; i < data.length; i++) {
        if (isSysSheet(parseRange(data[i] && data[i].range).sheet)) { requireAdmin(ss, sess); return; }
      }
      return;
    case 'addSheets':
    case 'deleteSheet':
    case 'deleteRows':
      requireAdmin(ss, sess);
      return;
    case 'me':
    case 'addXP':
      requireAuth(sess);
      return;
    default:
      return;
  }
}

/* ═══════════════════════════════════════════════════
 * ACTIONS
 * ═══════════════════════════════════════════════════ */

/**
 * Чтение диапазона.
 * params: { range: "SheetName!A2:G5000" }
 * Возвращает: { values: [[...], ...] }
 * Для sys_Users столбец Password маскируется.
 */
function doRead(ss, params) {
  var p  = parseRange(params.range);
  var sh = ss.getSheetByName(p.sheet);
  if (!sh) return { values: [] };

  var lastRow = sh.getLastRow();
  if (lastRow === 0) return { values: [] };

  var ref      = sh.getRange(p.range);
  var startRow = ref.getRow();
  if (startRow > lastRow) return { values: [] };

  var endRow  = Math.min(ref.getLastRow(), lastRow);
  var numRows = endRow - startRow + 1;
  if (numRows <= 0) return { values: [] };

  var data = stringify2D(sh.getRange(startRow, ref.getColumn(), numRows, ref.getNumColumns()).getValues());

  if (isUsersSheet(p.sheet)) {
    var passCol = (U_PASS + 1) - ref.getColumn();
    if (passCol >= 0 && passCol < ref.getNumColumns()) {
      for (var r = 0; r < data.length; r++) {
        if (startRow + r >= 2 && data[r][passCol] !== '') data[r][passCol] = '***';
      }
    }
  }
  return { values: data };
}

/**
 * Добавление строк в конец листа.
 * params: { range: "SheetName!A:G", values: [[...], ...] }
 */
function doAppend(ss, params) {
  var p  = parseRange(params.range);
  var sh = ss.getSheetByName(p.sheet);
  if (!sh) throw new Error('Лист не найден: ' + p.sheet);

  var values = params.values;
  if (!values || !values.length) return { updatedRows: 0 };

  var lastRow  = sh.getLastRow();
  var startCol = 1;
  if (p.range) {
    var match = p.range.match(/([A-Z]+)/);
    if (match) startCol = colLetterToNum(match[1]);
  }

  setTextValues(sh.getRange(lastRow + 1, startCol, values.length, values[0].length), values);
  return { updatedRows: values.length };
}

/**
 * Обновление ячейки / диапазона.
 * params: { range: "SheetName!D5", values: "new_value" | ["a","b"] | [["a","b"]] }
 */
function doUpdate(ss, params) {
  var p  = parseRange(params.range);
  var sh = ss.getSheetByName(p.sheet);
  if (!sh) throw new Error('Лист не найден: ' + p.sheet);

  var values = params.values;
  if (!Array.isArray(values))         values = [[values]];
  else if (!Array.isArray(values[0])) values = [values];

  setTextValues(sh.getRange(p.range), values);
  return { updated: true };
}

/**
 * Пакетное обновление значений.
 * params: { data: [{ range: "Sheet!B2", values: [["val"]] }, ...] }
 */
function doBatchValues(ss, params) {
  var data = params.data;
  for (var i = 0; i < data.length; i++) {
    var item = data[i];
    var p  = parseRange(item.range);
    var sh = ss.getSheetByName(p.sheet);
    if (!sh) throw new Error('Лист не найден: ' + p.sheet);
    setTextValues(sh.getRange(p.range), item.values);
  }
  return { updated: data.length };
}

/**
 * Метаданные всех листов.
 * Возвращает: { sheets: [{ title, sheetId }, ...] }
 */
function doMeta(ss) {
  var sheets = ss.getSheets();
  return {
    sheets: sheets.map(function(sh) {
      return { title: sh.getName(), sheetId: sh.getSheetId() };
    })
  };
}

/**
 * Создание новых листов.
 * params: { titles: ["sheet1", "sheet2"] }
 */
function doAddSheets(ss, params) {
  var titles = params.titles;
  for (var i = 0; i < titles.length; i++) {
    ss.insertSheet(titles[i]);
  }
  return { created: titles.length };
}

/**
 * Удаление листа по sheetId.
 * params: { sheetId: 12345 }
 */
function doDeleteSheet(ss, params) {
  var sheetId = params.sheetId;
  var sheets  = ss.getSheets();
  var target  = null;
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === sheetId) { target = sheets[i]; break; }
  }
  if (!target) throw new Error('Лист с ID ' + sheetId + ' не найден');
  ss.deleteSheet(target);
  return { deleted: true };
}

/**
 * Удаление строк (0-based индексы, endIndex не включается).
 * params: { sheetId: 12345, startIndex: 4, endIndex: 5 }
 */
function doDeleteRows(ss, params) {
  var sheetId    = params.sheetId;
  var startIndex = params.startIndex;
  var endIndex   = params.endIndex;

  var sheets = ss.getSheets();
  var target = null;
  for (var i = 0; i < sheets.length; i++) {
    if (sheets[i].getSheetId() === sheetId) { target = sheets[i]; break; }
  }
  if (!target) throw new Error('Лист не найден');

  // Удаляем снизу вверх, чтобы индексы не сбивались
  for (var r = endIndex; r > startIndex; r--) {
    target.deleteRow(r); // deleteRow использует 1-based индекс
  }
  return { deleted: endIndex - startIndex };
}

/* ═══════════════════════════════════════════════════
 * ONLINE ROOMS — сетевая игра для пошаговых игр
 *
 * Комнаты живут в CacheService (до 6 часов), таблица не нужна.
 * Модель: клиент, чей сейчас ход, присылает новое состояние
 * целиком (roomMove) с ожидаемой версией; сервер проверяет
 * токен игрока, очередь хода и версию, затем увеличивает ver.
 * Второй клиент опрашивает roomGet с последней известной ver
 * и получает { unchanged: true }, пока ничего не изменилось.
 *
 * Действия: roomCreate, roomJoin, roomGet, roomMove, roomReset,
 *           roomLeave, roomList
 * ═══════════════════════════════════════════════════ */

var ROOM_TTL_SEC     = 21600;                      // максимум CacheService
var ROOM_WAIT_MAX_MS = 30 * 60 * 1000;             // комната в ожидании живёт 30 мин
var ROOM_CODE_CHARS  = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
var ROOM_MAX_STATE   = 60000;                      // байт JSON состояния

function roomCache()        { return CacheService.getScriptCache(); }
function roomKey(id)        { return 'room:' + id; }
function roomIndexKey(game) { return 'rooms:' + game; }

function roomNow() { return new Date().getTime(); }

function roomLoad(id) {
  if (typeof id !== 'string' || !/^[A-Z0-9]{4,8}$/.test(id)) throw new Error('Некорректный код комнаты');
  var raw = roomCache().get(roomKey(id));
  return raw ? JSON.parse(raw) : null;
}

function roomSave(room) {
  room.updated = roomNow();
  roomCache().put(roomKey(room.id), JSON.stringify(room), ROOM_TTL_SEC);
}

function roomWithLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function roomIndexRead(game) {
  var raw = roomCache().get(roomIndexKey(game));
  return raw ? JSON.parse(raw) : [];
}
function roomIndexWrite(game, ids) {
  roomCache().put(roomIndexKey(game), JSON.stringify(ids), ROOM_TTL_SEC);
}
function roomIndexAdd(game, id) {
  var ids = roomIndexRead(game).filter(function (x) { return x !== id; });
  ids.push(id);
  roomIndexWrite(game, ids.slice(-50));
}
function roomIndexRemove(game, id) {
  roomIndexWrite(game, roomIndexRead(game).filter(function (x) { return x !== id; }));
}

function roomValidGame(game) {
  if (typeof game !== 'string' || !/^[a-z0-9_]{1,24}$/.test(game)) throw new Error('Некорректный идентификатор игры');
  return game;
}
function roomValidName(name) {
  name = String(name || '').trim().slice(0, 32);
  return name || 'Игрок';
}
function roomValidState(state) {
  var json = JSON.stringify(state === undefined ? null : state);
  if (json.length > ROOM_MAX_STATE) throw new Error('Состояние слишком большое');
  return state;
}

function roomGenCode() {
  for (var attempt = 0; attempt < 20; attempt++) {
    var code = '';
    for (var i = 0; i < 4; i++) code += ROOM_CODE_CHARS.charAt(Math.floor(Math.random() * ROOM_CODE_CHARS.length));
    if (!roomCache().get(roomKey(code))) return code;
  }
  throw new Error('Не удалось создать код комнаты, попробуйте ещё раз');
}

function roomSeatOf(room, token) {
  if (!token) return -1;
  for (var i = 0; i < room.players.length; i++) if (room.players[i].token === token) return i;
  return -1;
}

/** Публичное представление комнаты (без чужих токенов). */
function roomPublic(room, seat) {
  return {
    id: room.id, game: room.game, status: room.status,
    players: room.players.map(function (p) { return p.name; }),
    seat: seat, turn: room.turn, ver: room.ver, round: room.round,
    state: room.state, meta: room.meta || null, lastMove: room.lastMove || null,
    leftBy: typeof room.leftBy === 'number' ? room.leftBy : -1,
    created: room.created, updated: room.updated, now: roomNow()
  };
}

function handleRoomAction(action, params) {
  switch (action) {
    case 'roomCreate': return roomCreate(params);
    case 'roomJoin':   return roomJoin(params);
    case 'roomGet':    return roomGet(params);
    case 'roomMove':   return roomMove(params);
    case 'roomReset':  return roomReset(params);
    case 'roomLeave':  return roomLeave(params);
    case 'roomList':   return roomList(params);
    default:           throw new Error('Неизвестное действие: ' + action);
  }
}

/**
 * Создать комнату. params: { game, player, state, meta }
 * → публичная комната + token создателя (seat 0).
 */
function roomCreate(params) {
  var game  = roomValidGame(params.game);
  var name  = roomValidName(params.player);
  var state = roomValidState(params.state);
  return roomWithLock(function () {
    var room = {
      id: roomGenCode(), game: game, status: 'waiting',
      players: [{ name: name, token: Utilities.getUuid() }],
      turn: 0, ver: 1, round: 1, state: state, meta: params.meta || null,
      lastMove: null, created: roomNow()
    };
    roomSave(room);
    roomIndexAdd(game, room.id);
    var pub = roomPublic(room, 0); pub.token = room.players[0].token;
    return pub;
  });
}

/** Войти в комнату. params: { id, player } → публичная комната + token (seat 1). */
function roomJoin(params) {
  var id   = String(params.id || '').toUpperCase().trim();
  var name = roomValidName(params.player);
  return roomWithLock(function () {
    var room = roomLoad(id);
    if (!room) throw new Error('Комната ' + id + ' не найдена или уже закрыта');
    if (room.status !== 'waiting' || room.players.length >= 2) throw new Error('В комнате уже идёт игра');
    if (room.players[0].name === name) name = name + ' (2)';
    room.players.push({ name: name, token: Utilities.getUuid() });
    room.status = 'playing';
    room.ver++;
    roomSave(room);
    roomIndexRemove(room.game, room.id);
    var pub = roomPublic(room, 1); pub.token = room.players[1].token;
    return pub;
  });
}

/**
 * Получить состояние. params: { id, ver?, token? }
 * Если ver совпадает с текущей — { unchanged: true, ver, status, now }.
 */
function roomGet(params) {
  var room = roomLoad(String(params.id || '').toUpperCase().trim());
  if (!room) throw new Error('Комната не найдена или истекла');
  var seat = roomSeatOf(room, params.token);
  if (typeof params.ver === 'number' && params.ver === room.ver) {
    return { unchanged: true, ver: room.ver, status: room.status, now: roomNow() };
  }
  return roomPublic(room, seat);
}

/**
 * Сделать ход. params: { id, token, ver, state, turn, move?, finished? }
 * ver — версия, на которой построен ход (защита от гонок).
 */
function roomMove(params) {
  var id    = String(params.id || '').toUpperCase().trim();
  var state = roomValidState(params.state);
  var turn  = params.turn === 1 ? 1 : 0;
  return roomWithLock(function () {
    var room = roomLoad(id);
    if (!room) throw new Error('Комната не найдена или истекла');
    var seat = roomSeatOf(room, params.token);
    if (seat < 0) throw new Error('Вы не участник этой комнаты');
    if (room.status !== 'playing') throw new Error('Игра не идёт (' + room.status + ')');
    if (room.turn !== seat) throw new Error('Сейчас не ваш ход');
    if (typeof params.ver === 'number' && params.ver !== room.ver) {
      var pub = roomPublic(room, seat); pub.stale = true; return pub;
    }
    room.state = state;
    room.turn = turn;
    room.lastMove = { by: seat, move: params.move === undefined ? null : params.move, at: roomNow() };
    if (params.finished) room.status = 'finished';
    room.ver++;
    roomSave(room);
    return roomPublic(room, seat);
  });
}

/**
 * Начать новую партию в той же комнате. params: { id, token, state, round, turn? }
 * Идемпотентно: если партия с таким round уже начата — вернёт текущую комнату.
 */
function roomReset(params) {
  var id    = String(params.id || '').toUpperCase().trim();
  var state = roomValidState(params.state);
  return roomWithLock(function () {
    var room = roomLoad(id);
    if (!room) throw new Error('Комната не найдена или истекла');
    var seat = roomSeatOf(room, params.token);
    if (seat < 0) throw new Error('Вы не участник этой комнаты');
    if (room.status === 'closed') throw new Error('Соперник покинул комнату');
    if (room.players.length < 2) throw new Error('Соперник ещё не присоединился');
    var fromRound = typeof params.round === 'number' ? params.round : room.round;
    if (room.round !== fromRound) return roomPublic(room, seat);     // уже сброшено другим игроком
    room.round++;
    room.state = state;
    room.turn = params.turn === 1 ? 1 : 0;
    room.status = 'playing';
    room.lastMove = null;
    room.ver++;
    roomSave(room);
    return roomPublic(room, seat);
  });
}

/** Покинуть комнату. params: { id, token } */
function roomLeave(params) {
  var id = String(params.id || '').toUpperCase().trim();
  return roomWithLock(function () {
    var room = roomLoad(id);
    if (!room) return { closed: true };
    var seat = roomSeatOf(room, params.token);
    if (seat < 0) throw new Error('Вы не участник этой комнаты');
    room.status = 'closed';
    room.leftBy = seat;
    room.ver++;
    roomSave(room);
    roomIndexRemove(room.game, room.id);
    return roomPublic(room, seat);
  });
}

/** Список открытых комнат игры. params: { game } → { rooms: [{ id, host, created, meta }] } */
function roomList(params) {
  var game = roomValidGame(params.game);
  var ids = roomIndexRead(game), alive = [], out = [], now = roomNow();
  for (var i = 0; i < ids.length; i++) {
    var raw = roomCache().get(roomKey(ids[i]));
    if (!raw) continue;
    var room = JSON.parse(raw);
    if (room.status !== 'waiting' || now - room.created > ROOM_WAIT_MAX_MS) continue;
    alive.push(room.id);
    out.push({ id: room.id, host: room.players[0].name, created: room.created, meta: room.meta || null });
  }
  if (alive.length !== ids.length) roomIndexWrite(game, alive);
  out.sort(function (a, b) { return b.created - a.created; });
  return { rooms: out, now: now };
}
