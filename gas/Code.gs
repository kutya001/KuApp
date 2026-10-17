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
 *   4. Разверните как веб-приложение:
 *        Развернуть → Новое развёртывание → Веб-приложение
 *        Выполнять как: Я
 *        Доступ:       Все
 *   5. Скопируйте URL развёртывания и вставьте в KuApp
 *
 * Если вы используете Service Account JSON:
 *   Сохраните его содержимое как Script Property SA_JSON
 *   (не требуется, если таблица доступна вашему аккаунту Google)
 */

/* ═══════════════════════════════════════════════════
 * HELPERS
 * ═══════════════════════════════════════════════════ */

function getSpreadsheet() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('SPREADSHEET_ID не настроен в Script Properties');
  return SpreadsheetApp.openById(id);
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok(data)  { return json({ ok: true, data: data }); }
function fail(msg) { return json({ ok: false, error: msg }); }

/** Разбирает диапазон "SheetName!A2:G100" → { sheet, range } */
function parseRange(rangeStr) {
  const idx = rangeStr.indexOf('!');
  if (idx === -1) return { sheet: rangeStr, range: null };
  return { sheet: rangeStr.substring(0, idx), range: rangeStr.substring(idx + 1) };
}

/** Буквенный столбец → номер (A=1, B=2, AA=27) */
function colLetterToNum(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
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

/* ═══════════════════════════════════════════════════
 * ENTRY POINTS
 * ═══════════════════════════════════════════════════ */

function doGet(e) {
  return ok({ service: 'KuApp Backend', version: '1.0' });
}

function doPost(e) {
  try {
    if (!e || !e.postData) throw new Error('Нет данных POST');
    var body   = JSON.parse(e.postData.contents);
    var action = body.action;
    var params = body.params || {};
    if (isRoomAction(action)) return ok(handleRoomAction(action, params));
    var ss     = getSpreadsheet();

    switch (action) {
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
    return fail(err.message);
  }
}

/** Действия, которым не нужна таблица (онлайн-комнаты). */
function isRoomAction(action) {
  return typeof action === 'string' && action.indexOf('room') === 0;
}

/* ═══════════════════════════════════════════════════
 * ACTIONS
 * ═══════════════════════════════════════════════════ */

/**
 * Чтение диапазона.
 * params: { range: "SheetName!A2:G5000" }
 * Возвращает: { values: [[...], ...] }
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

  var data = sh.getRange(startRow, ref.getColumn(), numRows, ref.getNumColumns()).getValues();
  return { values: stringify2D(data) };
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

  sh.getRange(lastRow + 1, startCol, values.length, values[0].length).setValues(values);
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

  sh.getRange(p.range).setValues(values);
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
    sh.getRange(p.range).setValues(item.values);
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
