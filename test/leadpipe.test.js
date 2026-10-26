/* Локальный тест-стенд: эмулирует Google Apps Script и гоняет leadpipe.gs
   (труба ПРОДАЖ — личная, отдельная от салона ÉCLAT).
   Запуск: node test/leadpipe.test.js                                    */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

/* ---------------- эмуляция таблиц ---------------- */
/* Google Sheets отдаёт значение парсеру: строка, начинающаяся с «+», «=», «@»,
   трактуется как ФОРМУЛА и превращается в #ERROR!. appendRow этому подвержен
   ДАЖЕ если колонку заранее пометили текстом (проверено на бою).
   А вот setValue в ячейку с форматом «@» пишет дословно — этим и лечим.      */
function sheetsParse(v) {
  if (typeof v === 'string' && /^[+=@]/.test(v)) return '#ERROR!';
  return v;
}
class Sheet {
  constructor(name) { this.name = name; this.v = []; this.fmt = {}; this.widths = {}; this.maxCols = 26;
                      this.maxRows = 1000; this.style = {}; this.resized = null; this.rowH = {}; }
  setColumnWidth(c, w) { this.widths[c] = w; return this; }
  deleteColumns(start, n) { this.maxCols = Math.min(this.maxCols, start - 1); return this; }
  getMaxColumns() { return this.maxCols; }
  getMaxRows() { return this.maxRows; }
  deleteRows(start, n) { this.maxRows = Math.max(1, start - 1); this.v = this.v.slice(0, start - 1); return this; }
  setRowHeight(r, h) { this.rowH[r] = h; return this; }
  autoResizeRows(start, n) { this.resized = [start, n]; return this; }
  setName(n) { this.name = n; return this; }
  setFrozenRows(n) { this.frozen = n; return this; }
  getName() { return this.name; }
  getLastRow() { return this.v.length; }
  getLastColumn() { return this.v.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(row) { this.v.push(row.map(sheetsParse)); return this; }
  deleteRow(i) { this.v.splice(i - 1, 1); }
  getDataRange() { const s = this; return { getValues: () => s.v.map(r => r.slice()) }; }
  getRange(r, c, nr, nc) {
    const s = this;
    nr = nr || 1; nc = nc || 1;
    const range = {
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = s.v[r - 1 + i] || [];
          const line = [];
          for (let j = 0; j < nc; j++) line.push(row[c - 1 + j] !== undefined ? row[c - 1 + j] : '');
          out.push(line);
        }
        return out;
      },
      getValue: () => { const row = s.v[r - 1] || []; return row[c - 1] !== undefined ? row[c - 1] : ''; },
      setValue: (val) => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) {
          const row = s.v[r - 1 + i]; if (!row) continue;
          const key = (r + i) + ':' + (c + j);
          row[c - 1 + j] = (s.fmt[key] === '@') ? val : sheetsParse(val);
        }
        return range;
      },
      setNumberFormat: (f) => {
        for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.fmt[(r + i) + ':' + (c + j)] = f;
        return range;
      },
      setWrap: (on) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':wrap'] = on !== false; return range; },
      setVerticalAlignment: (a) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':valign'] = a; return range; },
      setHorizontalAlignment: () => range,
      setFontWeight: (w) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':bold'] = w; return range; },
      setFontColor: (col) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':color'] = col; return range; },
      setBackground: (col) => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.style[(r + i) + ':' + (c + j) + ':bg'] = col; return range; },
      setValues: (rows2d) => {
        for (let i = 0; i < nr; i++) { const row = s.v[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = rows2d[i][j]; }
        return range;
      }
    };
    return range;
  }
}
class Spreadsheet {
  constructor(name) { this.name = name; this.sheets = []; }
  getName() { return this.name; }
  getUrl() { return 'https://docs.google.com/spreadsheets/d/FAKE'; }
  getSheetByName(n) { return this.sheets.filter(s => s.name === n)[0] || null; }
  getSheets() { return this.sheets.slice(); }
  insertSheet(n) { const s = new Sheet(n); this.sheets.push(s); return s; }
  deleteSheet(sh) { this.sheets = this.sheets.filter(x => x !== sh); return this; }
  getId() { return 'FAKE_' + this.name; }
}

/* ---------------- эмуляция сервисов Apps Script ---------------- */
const DB = new Spreadsheet('Венера — продажи');
const SENT_MAIL = [];
const CACHE = {};
const PROPS = {};
const LOGS = [];

global.SpreadsheetApp = { getActiveSpreadsheet: () => null, openById: () => DB, create: () => DB };
global.CacheService = {
  getScriptCache: () => ({
    get: k => (CACHE[k] !== undefined ? CACHE[k] : null),
    put: (k, v) => { CACHE[k] = String(v); },
    remove: k => { delete CACHE[k]; }
  })
};
global.PropertiesService = { getScriptProperties: () => ({ getProperty: k => PROPS[k], setProperty: (k, v) => { PROPS[k] = v; } }) };
global.MailApp = { sendEmail: (to, subj, body) => SENT_MAIL.push({ to, subj, body }) };
global.ScriptApp = { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) };
global.Logger = { log: (t) => LOGS.push(String(t)) };

/* --- эмуляция Telegram Bot API и Z.ai: запоминаем все обращения --- */
const TG_CALLS = [];
const SLEEPS = [];
const AI_CALLS = [];
let TG_UPDATES = [];
let TG_ME = { ok: true, result: { username: 'venera_sites_02_bot', first_name: 'Заявки' } };
function tgResp(obj) { return { getResponseCode: () => 200, getContentText: () => JSON.stringify(obj) }; }
global.UrlFetchApp = {
  fetch: (url, opts) => {
    opts = opts || {};
    if (/api\.z\.ai/.test(url)) {
      let payload = {};
      try { payload = JSON.parse(opts.payload || '{}'); } catch (e) {}
      const auth = (opts.headers || {})['Authorization'] || '';
      AI_CALLS.push({ auth, payload });
      const aiOk = () => tgResp({ choices: [{ message: { content: '**ИИ отвечает:** сайт для салона — от 30 000 ₽, оплата 50/50.' } }] });
      const ai429 = () => ({ getResponseCode: () => 429,
        getContentText: () => '{"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}' });
      if (/GOODKEY/.test(auth)) return aiOk();
      if (/LIMITKEY/.test(auth)) return AI_CALLS.filter(c => /LIMITKEY/.test(c.auth)).length > 1 ? aiOk() : ai429();
      if (/GREEDYKEY/.test(auth)) return ai429();
      return { getResponseCode: () => 401, getContentText: () => '{"error":"invalid key"}' };
    }
    const tg = /api\.telegram\.org\/bot([^/]+)\/(\w+)/.exec(url);
    if (tg) {
      const method = tg[2];
      let payload = {};
      try { payload = JSON.parse(opts.payload || '{}'); } catch (e) {}
      TG_CALLS.push({ method, payload, token: tg[1] });
      if (method === 'getMe') return tgResp(TG_ME);
      if (method === 'getUpdates') return tgResp({ ok: true, result: TG_UPDATES });
      if (method === 'sendMessage') {
        return tgResp(payload.chat_id ? { ok: true, result: { message_id: TG_CALLS.length } }
                                      : { ok: false, description: 'Bad Request: chat_id is empty' });
      }
      return tgResp({ ok: true, result: true });
    }
    return { getContentText: () => '', getResponseCode: () => 200 };
  }
};
global.Utilities = {
  sleep: () => SLEEPS.push(1),
  getUuid: () => 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  formatDate: (d, tz, pattern) => {
    const p = n => String(n).padStart(2, '0');
    return pattern
      .replace('yyyy', d.getFullYear()).replace('MM', p(d.getMonth() + 1)).replace('dd', p(d.getDate()))
      .replace('HH', p(d.getHours())).replace('mm', p(d.getMinutes())).replace('ss', p(d.getSeconds()));
  }
};
global.Session = { getScriptTimeZone: () => 'Etc/GMT' };
global.ContentService = {
  MimeType: { JAVASCRIPT: 'javascript', JSON: 'JSON' },
  createTextOutput: (t) => ({ setMimeType: () => ({ getContent: () => t, text: t }) })
};

/* ---------------- загружаем сам сервер ---------------- */
const SRC = fs.readFileSync(path.join(__dirname, '..', 'leadpipe.gs'), 'utf8');
const TOKEN = 'VENERA-TEST-TOKEN';
const LEAD_TOKEN = '8612067963:TEST-LEAD-BOT';
const AI_KEY = 'GOODKEY-ZAI-TEST';
(0, eval)(SRC
  .replace("var ADMIN_TOKEN = 'ВСТАВЬТЕ_СВОЙ_ТОКЕН';", 'var ADMIN_TOKEN = ' + JSON.stringify(TOKEN) + ';')
  .replace("var LEAD_BOT_TOKEN = 'ВСТАВЬТЕ_ТОКЕН_БОТА_ЗАЯВОК';", 'var LEAD_BOT_TOKEN = ' + JSON.stringify(LEAD_TOKEN) + ';')
  .replace(/var ZAI_KEY\s*=\s*'ВСТАВЬТЕ_КЛЮЧ_ZAI';/, 'var ZAI_KEY = ' + JSON.stringify(AI_KEY) + ';'));

assert.notStrictEqual(global.ADMIN_TOKEN, 'ВСТАВЬТЕ_СВОЙ_ТОКЕН', 'тест не подменил ADMIN_TOKEN');
assert.strictEqual(global.hasAi(), true, 'тест не подменил ZAI_KEY');
assert.strictEqual(global.hasBot(), true, 'тест не подменил LEAD_BOT_TOKEN');

/* ---------------- хелперы ---------------- */
let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log('  ✓ ' + name); }
  catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
const call = (params) => JSON.parse(global.doGet({ parameter: params }).getContent());
const tgPost = (tgParam, update) =>
  JSON.parse(global.doPost({ parameter: { tg: tgParam }, postData: { contents: JSON.stringify(update) } }).getContent());
const tgSent = () => TG_CALLS.filter(c => c.method === 'sendMessage');
const secret = () => PROPS['SALES_TG_SECRET'];
const leadRows = () => DB.getSheetByName('Заявки').v;

console.log('\n=== ВЕНЕРА — ПРОДАЖИ: тесты отдельной трубы ===\n');

/* ---------- 1. диагностика ---------- */
t('ping отвечает ok и честно про себя: проект venera-sales, версия 1.3', () => {
  const r = call({ action: 'ping' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.project, 'venera-sales');
  assert.strictEqual(r.version, 1.3);
  assert.strictEqual(r.bot, true, 'бот не подключён');
  assert.strictEqual(r.ai, true, 'ключ Z.ai не подхватился');
  assert.ok(/venera-sales\/$/.test(r.landing), 'лендинг: ' + r.landing);
});
t('ping НЕ знает ничего про салон: записей, мастеров, каталога тут нет', () => {
  const r = call({ action: 'ping' });
  assert.strictEqual(r.bookings, undefined);
  assert.strictEqual(r.services, undefined);
  assert.strictEqual(r.masters, undefined);
});
t('неизвестное действие возвращает понятную подсказку', () => {
  const r = call({ action: 'ololo' });
  assert.strictEqual(r.ok, false);
  assert.ok(/setupBot/.test(r.hint), r.hint);
});
t('JSONP-обёртка работает (cb=имя)', () => {
  const raw = global.doGet({ parameter: { action: 'ping', cb: 'usl_cb_x1' } }).getContent();
  assert.ok(/^usl_cb_x1\(\{/.test(raw), raw.slice(0, 40));
});
t('админ-действия без токена не работают', () => {
  ['test', 'setupBot', 'botOff', 'aiTest', 'tidy', 'list'].forEach(a => {
    const r = call({ action: a });
    assert.strictEqual(r.ok, false, a + ' открыт всем!');
    assert.ok(/токен/i.test(r.ru || ''), a + ': нет понятного отказа');
  });
});

/* ---------- 2. заявка с лендинга ---------- */
t('lead: заявка падает в СВОЮ таблицу «Заявки» и шлёт письмо', () => {
  const before = SENT_MAIL.length;
  const r = call({ action: 'lead', salon: 'Локон', name: 'Мария', contact: '+7 900 123-45-67',
                   want: 'Сайт с онлайн-записью', comment: 'Казань, 4 мастера', src: 'landing' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.sheet, true); assert.strictEqual(r.mail, true);
  const row = leadRows()[1];
  assert.strictEqual(row[1], 'Локон');
  assert.strictEqual(row[3], '+7 900 123-45-67', 'телефон: ' + row[3]);
  assert.strictEqual(row[4], 'Сайт с онлайн-записью');
  assert.strictEqual(row[6], 'новый');
  assert.strictEqual(row[7], 'лендинг');
  assert.strictEqual(SENT_MAIL.length, before + 1);
  assert.ok(/Локон/.test(SENT_MAIL[SENT_MAIL.length - 1].body));
});
t('телефон с плюсом НЕ превращается в #ERROR! (двухпроходная запись)', () => {
  call({ action: 'lead', salon: 'Плюс', name: 'Т', contact: '+7 917 000-00-00', want: 'Бот', comment: '' });
  const row = leadRows()[leadRows().length - 1];
  assert.strictEqual(row[3], '+7 917 000-00-00', 'в ячейке: ' + row[3]);
  assert.ok(row.indexOf('#ERROR!') < 0, 'в строке #ERROR!: ' + row.join('|'));
});
t('старое имя leadusl тоже понимается (лендинг мог прислать его)', () => {
  const n = leadRows().length;
  const r = call({ action: 'leadusl', salon: 'Старое имя', name: 'А', contact: '70000000001', want: 'Сайт', comment: '' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(leadRows().length, n + 1);
});
t('src=telegram-miniapp отмечается как «мини-апп Telegram» — в таблице и в письме', () => {
  const r = call({ action: 'lead', salon: 'Бархат', name: 'Ольга', contact: '+7 917 000-00-00',
                   want: 'Бот', comment: '3 мастера', src: 'telegram-miniapp' });
  assert.strictEqual(r.src, 'мини-апп Telegram');
  assert.strictEqual(leadRows()[leadRows().length - 1][7], 'мини-апп Telegram');
  assert.ok(/мини-апп Telegram/.test(SENT_MAIL[SENT_MAIL.length - 1].body));
});
t('длинный комментарий (25 000 знаков) сохраняется ЦЕЛИКОМ', () => {
  const long = Array.from({ length: 500 }, (_, i) => 'Клиент: строка номер ' + (i + 1) + ' — вопрос про сайт и цены.').join('\n');
  assert.ok(long.length > 25000, 'тестовый текст короткий: ' + long.length);
  const r = call({ action: 'lead', salon: 'Длинный', name: 'Т', contact: '70000000008', want: 'Сайт', comment: long });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const row = leadRows()[leadRows().length - 1];
  assert.strictEqual(row[5], long, 'сохранено ' + row[5].length + ' из ' + long.length);
});
t('без токена бота заявка всё равно сохраняется (таблица + письмо)', () => {
  const saved = global.LEAD_BOT_TOKEN;
  global.LEAD_BOT_TOKEN = 'ВСТАВЬТЕ_ТОКЕН_БОТА_ЗАЯВОК';
  TG_CALLS.length = 0;
  const mails = SENT_MAIL.length;
  const r = call({ action: 'lead', salon: 'БезБота', name: 'Н', contact: '70000000002', want: 'Сайт', comment: '' });
  global.LEAD_BOT_TOKEN = saved;
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.tg, false, 'телеграм «отправился» без токена');
  assert.strictEqual(tgSent().length, 0);
  assert.strictEqual(SENT_MAIL.length, mails + 1, 'письмо не ушло');
});

/* ---------- 3. настройка бота ---------- */
t('setupBot: сам находит chat_id, ставит мини-апп кнопку, команды и вебхук', () => {
  TG_CALLS.length = 0;
  TG_UPDATES = [{ update_id: 1, message: { message_id: 1, from: { id: 8710449510 },
    chat: { id: 8710449510, type: 'private', first_name: 'Венера' }, text: 'привет' } }];
  const r = call({ action: 'setupBot', token: TOKEN });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.chatId, '8710449510');
  assert.strictEqual(r.bot, 'venera_sites_02_bot');
  const methods = TG_CALLS.map(c => c.method);
  ['getMe', 'getUpdates', 'setChatMenuButton', 'setMyCommands', 'setDescription', 'setWebhook', 'sendMessage']
    .forEach(m => assert.ok(methods.indexOf(m) >= 0, 'не вызван ' + m + '; было: ' + methods.join(',')));
  const mb = TG_CALLS.filter(c => c.method === 'setChatMenuButton')[0];
  assert.strictEqual(mb.payload.menu_button.type, 'web_app', 'кнопка-меню не мини-апп');
  assert.ok(/venera-sales\/$/.test(mb.payload.menu_button.web_app.url), 'мини-апп ведёт не на лендинг продаж: ' + mb.payload.menu_button.web_app.url);
  assert.ok(!/eclat-studio\/uslugi/.test(mb.payload.menu_button.web_app.url), 'мини-апп всё ещё ведёт в папку салона');
  const wh = TG_CALLS.filter(c => c.method === 'setWebhook')[0];
  assert.ok(/[?&]tg=[a-z0-9]{16,}$/.test(wh.payload.url), 'вебхук без секрета: ' + wh.payload.url);
  assert.ok(TG_CALLS.every(c => c.token === LEAD_TOKEN), 'бот дёргается чужим токеном');
  assert.ok(secret(), 'секрет вебхука не сохранён');
});
t('setupBot пишет в «Журнал» — видно, что настройка была', () => {
  const j = DB.getSheetByName('Журнал');
  assert.ok(j && j.getLastRow() > 1, 'журнал пуст');
  assert.ok(j.v.slice(1).some(r => /бот настроен/.test(String(r[1]))), 'в журнале нет записи о настройке');
});
t('setupBot без токена бота ругается по-русски, а не падает', () => {
  const saved = global.LEAD_BOT_TOKEN;
  global.LEAD_BOT_TOKEN = 'ВСТАВЬТЕ_ТОКЕН_БОТА_ЗАЯВОК';
  const r = call({ action: 'setupBot', token: TOKEN });
  global.LEAD_BOT_TOKEN = saved;
  assert.strictEqual(r.ok, false);
  assert.ok(/LEAD_BOT_TOKEN/.test(r.steps.join(' ')), JSON.stringify(r));
});
t('заявка с лендинга приходит в Telegram владелице', () => {
  TG_CALLS.length = 0;
  const r = call({ action: 'lead', salon: 'Глянец', name: 'Ирина', contact: '+7 917 111-22-33',
                   want: 'Всё вместе', comment: 'СПб', src: 'landing' });
  assert.strictEqual(r.tg, true, 'телеграм не отправлен: ' + JSON.stringify(r));
  assert.strictEqual(tgSent().length, 1);
  assert.strictEqual(String(tgSent()[0].payload.chat_id), '8710449510');
  ['Глянец', 'Ирина', '+7 917 111-22-33', 'Всё вместе', 'лендинг'].forEach(x =>
    assert.ok(tgSent()[0].payload.text.indexOf(x) >= 0, 'в сообщении нет «' + x + '»'));
});

/* ---------- 4. бот отвечает людям ---------- */
t('бот отвечает на /start кнопкой мини-аппа (лендинг продаж)', () => {
  TG_CALLS.length = 0;
  const r = tgPost(secret(), { update_id: 9, message: { message_id: 9, from: { id: 555 },
    chat: { id: 555, type: 'private' }, text: '/start' } });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(tgSent().length, 1);
  const kb = tgSent()[0].payload.reply_markup.inline_keyboard[0][0];
  assert.ok(kb.web_app && /venera-sales\/$/.test(kb.web_app.url), 'в /start нет кнопки мини-аппа');
});
t('/price отвечает ценами «от 30 000 ₽» и условием 50/50', () => {
  TG_CALLS.length = 0;
  tgPost(secret(), { update_id: 11, message: { chat: { id: 555 }, text: '/price' } });
  const txt = tgSent()[0].payload.text;
  assert.ok((txt.match(/30 000 ₽/g) || []).length >= 3, 'цены не все: ' + txt);
  assert.ok(/50\/50/.test(txt), 'нет условия оплаты');
  assert.ok(/ориентировочн/i.test(txt), 'не сказано, что цены ориентировочные');
  assert.ok(!/шаблон/i.test(txt), 'в ценах прозвучало слово «шаблон»');
});
t('/site даёт кнопку мини-аппа и ничего лишнего', () => {
  TG_CALLS.length = 0;
  tgPost(secret(), { update_id: 15, message: { chat: { id: 999 }, text: '/site' } });
  assert.strictEqual(tgSent().length, 1);
  assert.ok(/venera-sales\/$/.test(tgSent()[0].payload.reply_markup.inline_keyboard[0][0].web_app.url));
});
t('просто «привет» — приветствие без лишнего уведомления владелице', () => {
  TG_CALLS.length = 0;
  tgPost(secret(), { update_id: 14, message: { from: { id: 999 }, chat: { id: 999, type: 'private' }, text: 'привет' } });
  assert.strictEqual(tgSent().length, 1, 'сообщений: ' + tgSent().length);
  assert.strictEqual(tgSent()[0].payload.chat_id, 999);
});
t('живой вопрос: отвечает НЕЙРОСЕТЬ, владелица получает уведомление со ссылкой «ответить»', () => {
  TG_CALLS.length = 0; AI_CALLS.length = 0;
  tgPost(secret(), { update_id: 20, message: { from: { id: 888, username: 'salon_kzn' },
    chat: { id: 888, type: 'private' }, text: 'Сколько стоит сайт для салона в Казани?' } });
  assert.strictEqual(AI_CALLS.length, 1, 'нейросеть не вызвана');
  assert.ok(/Bearer GOODKEY/.test(AI_CALLS[0].auth), 'ключ не передан: ' + AI_CALLS[0].auth);
  assert.strictEqual(AI_CALLS[0].payload.model, 'glm-4.5-flash');
  assert.ok(TG_CALLS.some(c => c.method === 'sendChatAction'), 'не показали «печатает…»');
  const toUser = tgSent().filter(c => c.payload.chat_id === 888);
  assert.strictEqual(toUser.length, 1);
  assert.ok(/30 000 ₽/.test(toUser[0].payload.text), 'ответ не от ИИ: ' + toUser[0].payload.text);
  assert.ok(!/\*\*/.test(toUser[0].payload.text), 'в ответе остался markdown');
  assert.ok(toUser[0].payload.reply_markup.inline_keyboard[0][0].web_app, 'в ответе ИИ пропала кнопка мини-аппа');
  const note = tgSent().filter(c => String(c.payload.chat_id) === '8710449510');
  assert.strictEqual(note.length, 1, 'владелице не пришло уведомление');
  assert.ok(/salon_kzn/.test(note[0].payload.text) && /t\.me\/salon_kzn/.test(note[0].payload.text), 'нет ссылки «ответить»');
});
t('системный промпт ИИ: только честные факты (цены, 50/50, демо, контакты, без «шаблона»)', () => {
  const sys = AI_CALLS[0].payload.messages[0];
  assert.strictEqual(sys.role, 'system');
  ['от 30 000 ₽', '50/50', '+7 927 850-44-16', 'venera.web.4@gmail.com', 'ДЕМО', 'не выдумывай', 'Личных встреч не предлагаем']
    .forEach(x => assert.ok(sys.content.indexOf(x) >= 0, 'в промпте нет «' + x + '»'));
  assert.ok(/Не говори слово «шаблон»/.test(sys.content), 'слово «шаблон» не запрещено ИИ');
});
t('бот помнит диалог: во второй вопрос уходит история', () => {
  AI_CALLS.length = 0;
  tgPost(secret(), { update_id: 21, message: { from: { id: 888 }, chat: { id: 888, type: 'private' }, text: 'А сколько по времени делать?' } });
  const m = AI_CALLS[0].payload.messages;
  assert.ok(m.length >= 4, 'история не передана: ' + m.length + ' сообщ.');
  assert.strictEqual(m[0].role, 'system');
  assert.strictEqual(m[1].role, 'user', 'вторым должно идти воспоминание о прошлой реплике');
  assert.ok(/сайт для салона/i.test(m[1].content), 'прошлая реплика потерялась: ' + m[1].content);
  assert.ok(m.some(x => x.role === 'assistant' && /30 000 ₽/.test(x.content)), 'прошлый ОТВЕТ бота не запомнен');
  assert.strictEqual(m[m.length - 1].content, 'А сколько по времени делать?');
  assert.ok(m.length <= 12, 'память разрастается без предела: ' + m.length);
});
t('переписка ложится в лист «Переписка с ботом» целиком', () => {
  const sh = DB.getSheetByName('Переписка с ботом');
  assert.ok(sh, 'листа переписки нет');
  const row = sh.v[sh.v.length - 1];
  assert.strictEqual(sh.v[0].length, 6, 'шапка: ' + sh.v[0].join('|'));
  assert.ok(/сколько по времени/i.test(row[3]), 'текст человека: ' + row[3]);
  assert.ok(/30 000/.test(row[4]), 'ответ бота не сохранён: ' + row[4]);
  assert.strictEqual(String(row[2]), '888', 'id чата: ' + row[2]);
});
t('человек оставил телефон — он сразу ложится в лиды как тёплый', () => {
  TG_CALLS.length = 0;
  const before = leadRows().length;
  tgPost(secret(), { update_id: 22, message: { from: { id: 4242, first_name: 'Ирина', last_name: 'П.' },
    chat: { id: 4242, type: 'private' }, text: 'Хочу сайт, мой телефон 8 (917) 222-33-44' } });
  assert.strictEqual(leadRows().length, before + 1, 'строка лида не добавилась');
  const row = leadRows()[leadRows().length - 1];
  assert.strictEqual(row[3], '+7 917 222-33-44', 'контакт: ' + row[3]);
  assert.strictEqual(row[7], 'чат с ботом', 'источник: ' + row[7]);
  assert.ok(/Хочу сайт/.test(row[5]), 'текст клиента не сохранён');
  const owner = tgSent().filter(c => String(c.payload.chat_id) === '8710449510');
  assert.strictEqual(owner.length, 1, 'владелице пришло ' + owner.length + ' сообщений');
  assert.ok(/ТЕПЛЫЙ ЛИД/.test(owner[0].payload.text), owner[0].payload.text);
  assert.ok(/Ирина/.test(owner[0].payload.text), 'в уведомлении нет имени');
});
t('«12 мастеров, салон с 2010 года» телефоном НЕ считается (ложных лидов нет)', () => {
  TG_CALLS.length = 0;
  const before = leadRows().length;
  tgPost(secret(), { update_id: 25, message: { from: { id: 3131 }, chat: { id: 3131, type: 'private' },
    text: 'У нас 12 мастеров, салон работает с 2010 года, бюджет примерно 300000' } });
  assert.strictEqual(leadRows().length, before, 'в таблицу лёг ложный лид');
  const owner = tgSent().filter(c => String(c.payload.chat_id) === '8710449510');
  assert.strictEqual(owner.length, 1);
  assert.ok(!/ТЕПЛЫЙ ЛИД/.test(owner[0].payload.text), owner[0].payload.text);
});
t('телефон в любом написании узнаётся: 89172223344, +7 917 222 33 44, (917)222-33-44', () => {
  ['мой номер 89172223344', 'пишите на +7 917 222 33 44', 'тел (917)222-33-44'].forEach(txt => {
    const before = leadRows().length;
    tgPost(secret(), { update_id: 26, message: { from: { id: 5150 }, chat: { id: 5150, type: 'private' }, text: txt } });
    assert.strictEqual(leadRows().length, before + 1, 'не распознан телефон в «' + txt + '»');
    assert.strictEqual(leadRows()[leadRows().length - 1][3], '+7 917 222-33-44', txt);
  });
});
t('без ключа Z.ai бот не молчит: вежливая запасная фраза + уведомление владелице', () => {
  const saved = global.ZAI_KEY;
  global.ZAI_KEY = 'ВСТАВЬТЕ_КЛЮЧ_ZAI';
  TG_CALLS.length = 0; AI_CALLS.length = 0;
  tgPost(secret(), { update_id: 23, message: { from: { id: 555 }, chat: { id: 555, type: 'private' }, text: 'здравствуйте, расскажите про бота' } });
  global.ZAI_KEY = saved;
  assert.strictEqual(AI_CALLS.length, 0, 'без ключа полезли в нейросеть');
  const toUser = tgSent().filter(c => c.payload.chat_id === 555);
  assert.strictEqual(toUser.length, 1);
  assert.ok(/Венер|ответит лично/i.test(toUser[0].payload.text), toUser[0].payload.text);
  assert.ok(!/401|invalid key|ошибка/i.test(toUser[0].payload.text), 'клиенту показали техническую ошибку');
  assert.strictEqual(tgSent().filter(c => String(c.payload.chat_id) === '8710449510').length, 1, 'владелица не узнала');
});
t('если Z.ai ответил ошибкой — клиент получает запасную фразу, а не тишину', () => {
  const saved = global.ZAI_KEY;
  global.ZAI_KEY = 'BADKEY-401-TEST-ZAI';
  TG_CALLS.length = 0;
  tgPost(secret(), { update_id: 24, message: { from: { id: 666 }, chat: { id: 666, type: 'private' }, text: 'а что входит в сайт?' } });
  global.ZAI_KEY = saved;
  const toUser = tgSent().filter(c => c.payload.chat_id === 666);
  assert.strictEqual(toUser.length, 1);
  assert.ok(!/BADKEY|401/.test(toUser[0].payload.text), toUser[0].payload.text);
  assert.ok(toUser[0].payload.text.length > 40, 'ответ слишком короткий');
});
t('бесплатный ключ Z.ai: после 429 «голова» пробует ещё раз и отвечает', () => {
  const saved = global.ZAI_KEY;
  global.ZAI_KEY = 'LIMITKEY-429-TEST-ZAI';
  AI_CALLS.length = 0; SLEEPS.length = 0;
  const r = call({ action: 'chat', m: 'Сколько стоит сайт для салона?', s: 'retry-1' });
  global.ZAI_KEY = saved;
  assert.strictEqual(r.ai, true, 'после 429 не повторили запрос: ' + JSON.stringify(r));
  assert.ok(AI_CALLS.length >= 2, 'попыток: ' + AI_CALLS.length);
  assert.ok(/30 000 ₽/.test(r.reply), r.reply);
  assert.ok(SLEEPS.length >= 1, 'между попытками не выдержали паузу');
});
t('если лимит Z.ai не отпускает — запасная фраза и честная причина (aiWhy)', () => {
  const saved = global.ZAI_KEY;
  global.ZAI_KEY = 'GREEDYKEY-429-TEST-ZAI';
  const r = call({ action: 'chat', m: 'Расскажите про сайт', s: 'retry-2' });
  global.ZAI_KEY = saved;
  assert.strictEqual(r.ai, false);
  assert.ok(/Спасибо, что написали/.test(r.reply), r.reply);
  assert.ok(/429/.test(String(r.aiWhy)), 'aiWhy: ' + r.aiWhy);
  assert.ok(/1113|Insufficient balance/.test(String(r.aiWhy)), 'aiWhy: ' + r.aiWhy);
});
t('неверный ключ (401) повторно не дёргаем — не тратим чужой лимит', () => {
  const saved = global.ZAI_KEY;
  global.ZAI_KEY = 'BADKEY-401-TEST-ZAI';
  AI_CALLS.length = 0;
  const r = call({ action: 'chat', m: 'Здравствуйте', s: 'retry-3' });
  global.ZAI_KEY = saved;
  assert.strictEqual(r.ai, false);
  assert.strictEqual(AI_CALLS.length, 1, 'попыток: ' + AI_CALLS.length);
});
t('AI_TRY вынесен в настройки (сколько раз пробуем достучаться до Z.ai)', () => {
  assert.ok(Number(global.AI_TRY) >= 2, 'AI_TRY: ' + global.AI_TRY);
  assert.ok(/var AI_TRY\s*=/.test(SRC), 'AI_TRY не в настройках файла');
});
t('testAiHead: проверка «головы» из редактора пишет в журнал и в Telegram', () => {
  TG_CALLS.length = 0;
  const r = global.testAiHead();
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.ok(/30 000/.test(r.answer), r.answer);
  assert.ok(tgSent().some(c => /ПРОВЕРКА|Проверка/.test(c.payload.text)), 'нет сообщения о проверке');
});
t('aiTest по ссылке требует токен и возвращает ответ ИИ', () => {
  assert.strictEqual(call({ action: 'aiTest' }).ok, false, 'aiTest работает без токена!');
  const r = call({ action: 'aiTest', token: TOKEN });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.ai, true);
  assert.ok(/30 000/.test(r.answer), r.answer);
});
t('чужой запрос на вебхук (неверный секрет) бота не дёргает', () => {
  TG_CALLS.length = 0;
  const r = tgPost('неверный-секрет', { update_id: 13, message: { chat: { id: 1 }, text: '/start' } });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(tgSent().length, 0);
});
t('doPost с обычными данными лендинга работает как GET', () => {
  const r = JSON.parse(global.doPost({ parameter: {}, postData: { contents: JSON.stringify({ action: 'ping' }) } }).getContent());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.project, 'venera-sales');
});
t('doPost принимает заявку формой (если лендинг перейдёт с JSONP на fetch)', () => {
  const before = leadRows().length;
  const r = JSON.parse(global.doPost({ parameter: {}, postData: { contents: JSON.stringify(
    { action: 'lead', salon: 'POST-форма', name: 'П', contact: '70000000003', want: 'Сайт', comment: '', src: 'landing' }) } }).getContent());
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(leadRows().length, before + 1);
});

/* ---------- 5. красота таблиц ---------- */
t('таблица «Заявки»: ровно 8 колонок, пустых справа нет, шапка по-русски', () => {
  global.tidyAll();
  const sh = DB.getSheetByName('Заявки');
  assert.strictEqual(sh.maxCols, 8, 'колонок: ' + sh.maxCols);
  assert.deepStrictEqual(sh.v[0], ['Дата', 'Салон', 'Контактное лицо', 'Контакт', 'Что интересует', 'Комментарий', 'Статус', 'Источник']);
  sh.v[0].forEach(h => assert.ok(h && /[а-яА-Я]/.test(h), 'заголовок не по-русски: ' + h));
});
t('шапка оформлена: фирменный фон, белый жирный текст, закреплена', () => {
  const sh = DB.getSheetByName('Заявки');
  assert.strictEqual(sh.style['1:1:bg'], '#4C2E9E', 'фон шапки: ' + sh.style['1:1:bg']);
  assert.strictEqual(sh.style['1:1:color'], '#FFFFFF');
  assert.strictEqual(sh.style['1:8:bold'], 'bold');
  assert.strictEqual(sh.frozen, 1, 'шапка не закреплена');
});
t('длинный текст — с переносом, в широкой колонке, высота строк подобрана', () => {
  const sh = DB.getSheetByName('Заявки');
  const n = sh.v.length;
  assert.ok(sh.widths[6] >= 520, 'колонка «Комментарий» узкая: ' + sh.widths[6]);
  for (let r = 2; r <= n; r++) assert.strictEqual(sh.style[r + ':6:wrap'], true, 'в строке ' + r + ' нет переноса');
  assert.deepStrictEqual(sh.resized, [2, n - 1], 'высота строк не подобрана');
  assert.strictEqual(sh.style['2:1:valign'], 'top');
});
t('лист «Переписка с ботом» тоже по размеру и с переносом', () => {
  const sh = DB.getSheetByName('Переписка с ботом');
  global.tidyAll();
  assert.strictEqual(sh.maxCols, 6, 'колонок: ' + sh.maxCols);
  assert.strictEqual(sh.widths[4], 520, 'ширина текста: ' + sh.widths[4]);
  assert.strictEqual(sh.style['1:4:bg'], '#4C2E9E', 'шапка не оформлена');
  assert.strictEqual(sh.frozen, 1);
});
t('старая шапка на 7 колонок сама доучивается до 8', () => {
  const sh = DB.getSheetByName('Заявки');
  sh.v[0] = ['Дата', 'Салон', 'Контактное лицо', 'Контакт', 'Что интересует', 'Комментарий', 'Статус'];
  call({ action: 'lead', salon: 'Ремонт шапки', name: 'А', contact: '70000000004', want: 'Сайт', comment: '' });
  assert.strictEqual(sh.v[0].length, 8, 'шапка не починена: ' + sh.v[0].join('|'));
  assert.strictEqual(sh.v[0][7], 'Источник');
});
t('новая таблица создаётся без пустой вкладки «Sheet1»', () => {
  const fresh = new Spreadsheet('свежая');
  fresh.sheets.push(new Sheet('Sheet1'));
  const savedCreate = global.SpreadsheetApp.create, savedOpen = global.SpreadsheetApp.openById, savedId = PROPS['SALES_DB_ID'];
  global.SpreadsheetApp.create = () => fresh;
  global.SpreadsheetApp.openById = () => fresh;
  PROPS['SALES_DB_ID'] = 'FRESH_ID';
  const r = call({ action: 'lead', salon: 'Свежая', name: 'Т', contact: '70000000009', want: 'Сайт', comment: 'первая заявка' });
  global.SpreadsheetApp.create = savedCreate; global.SpreadsheetApp.openById = savedOpen;
  if (savedId === undefined) delete PROPS['SALES_DB_ID']; else PROPS['SALES_DB_ID'] = savedId;
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(fresh.getSheets().length, 1, 'вкладок: ' + fresh.getSheets().map(x => x.name).join(','));
  assert.strictEqual(fresh.getSheets()[0].name, 'Заявки');
  assert.strictEqual(fresh.getSheets()[0].maxCols, 8, 'пустые колонки остались');
});
t('tidyAll убирает пустую вкладку «Sheet1» и не трогает рабочие листы', () => {
  DB.sheets.push(new Sheet('Sheet1'));
  call({ action: 'tidy', token: TOKEN });
  assert.strictEqual(DB.getSheetByName('Sheet1'), null, 'пустая вкладка не удалена');
  assert.ok(DB.getSheetByName('Заявки'), 'рабочие листы задеты');
});

/* ---------- 6. отчёты ---------- */
t('test (по токену) показывает состояние: таблица, бот, ИИ, лендинг', () => {
  const r = call({ action: 'test', token: TOKEN });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.project, 'venera-sales');
  assert.strictEqual(r.botTokenSet, true);
  assert.strictEqual(r.chatIdSet, true);
  assert.strictEqual(r.aiKeySet, true);
  assert.ok(r.leads > 5, 'заявок посчитано: ' + r.leads);
  assert.ok(/docs\.google\.com/.test(r.dbUrl), 'нет ссылки на таблицу: ' + r.dbUrl);
});
t('list (по токену) отдаёт последние заявки, начиная со свежих', () => {
  const r = call({ action: 'list', token: TOKEN, limit: 3 });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.count, 3);
  assert.ok(r.leads[0].дата >= r.leads[2].дата, 'порядок не обратный');
  assert.ok(r.leads[0].контакт, 'нет контакта');
});

/* ---------- 7. разделение с салоном ---------- */
t('в трубе продаж НЕТ ничего салонного: записи, мастера, catalog, book', () => {
  ['book', 'busy', 'addBlock', 'manualBook', 'getDay', 'getStats', 'reload'].forEach(a => {
    const r = call({ action: a, token: TOKEN });
    assert.strictEqual(r.ok, false, a + ' не должен работать в трубе продаж');
  });
  assert.strictEqual(global.catalog, undefined, 'в трубе продаж остался каталог салона');
  assert.strictEqual(global.doBook, undefined, 'в трубе продаж осталась запись клиентов салона');
});
t('в коде трубы продаж нет ссылок на таблицу и трубу салона', () => {
  assert.ok(!/Записи|Мастер|site-data\.js|ÉCLAT STUDIO — база/.test(SRC), 'в коде остались следы салона');
});


/* ---------- 8. ассистент на лендинге (действие chat) ---------- */
t('chat: пустое сообщение — вежливо отказывает, не молчит', () => {
  const r = call({ action: 'chat', s: 'wempty' });
  assert.strictEqual(r.ok, false, JSON.stringify(r));
});
t('chat: «голова» ИИ отвечает и переписка ложится в «Переписка с ботом»', () => {
  const sh = DB.getSheetByName('Переписка с ботом');
  const before = sh.getLastRow();
  const r = call({ action: 'chat', s: 'wtest1', m: 'Здравствуйте! Сколько стоит сайт с онлайн-записью?' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.ai, true, 'ИИ не ответил');
  assert.ok(/30 000/.test(r.reply), 'ответ: ' + r.reply);
  assert.ok(!/\*\*/.test(r.reply), 'markdown не вычищен: ' + r.reply);
  const rows = sh.v;
  assert.strictEqual(rows.length, before + 1, 'строка переписки не добавилась');
  const last = rows[rows.length - 1];
  assert.strictEqual(last[1], 'сайт (ассистент)', 'кто: ' + last[1]);
  assert.strictEqual(last[2], 'web-wtest1', 'сессия: ' + last[2]);
  assert.ok(last[4].length > 10, 'ответ не сохранён');
});
t('chat: память сессии — второй вопрос приходит с историей', () => {
  call({ action: 'chat', s: 'wmem', m: 'Привет, хочу сайт для салона' });
  AI_CALLS.length = 0;
  call({ action: 'chat', s: 'wmem', m: 'А сколько это стоит?' });
  assert.ok(AI_CALLS.length >= 1, 'второй вопрос не дошёл до ИИ');
  const msgs = AI_CALLS[AI_CALLS.length - 1].payload.messages;
  assert.ok(msgs.length >= 4, 'история не приложена: ' + msgs.length);
  assert.strictEqual(msgs[1].role, 'user');
  assert.strictEqual(msgs[2].role, 'assistant');
});
t('chat: сессии не смешиваются (у каждой своя память)', () => {
  call({ action: 'chat', s: 'wa1', m: 'Меня зовут Алина, салон Локон' });
  AI_CALLS.length = 0;
  call({ action: 'chat', s: 'wa2', m: 'Привет' });
  const txt = JSON.stringify(AI_CALLS[AI_CALLS.length - 1].payload.messages);
  assert.ok(!/Алина/.test(txt), 'чужая история попала в другую сессию');
});
t('chat: телефон в сообщении — сразу тёплый лид с источником «чат на сайте»', () => {
  const before = leadRows().length;
  const r = call({ action: 'chat', s: 'wphone', m: 'Перезвоните мне, пожалуйста: +7 927 850-44-16' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(leadRows().length, before + 1, 'лид не создан');
  const row = leadRows()[leadRows().length - 1];
  assert.strictEqual(row[7], 'чат на сайте', 'источник: ' + row[7]);
  assert.ok(/850-44-16|9278504416/.test(String(row[3])), 'контакт: ' + row[3]);
});
t('chat: без ключа ИИ не молчит — отдаёт запасную фразу и ведёт к форме', () => {
  const saved = global.ZAI_KEY;
  global.ZAI_KEY = 'ВСТАВЬТЕ_КЛЮЧ_ZAI';
  const r = call({ action: 'chat', s: 'wnoai', m: 'Здравствуйте!' });
  global.ZAI_KEY = saved;
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.ai, false);
  assert.ok(/Венеры/.test(r.reply) && /форм/.test(r.reply), 'запасная фраза: ' + r.reply);
});
t('chat: публичный — работает без токена администратора', () => {
  const r = call({ action: 'chat', s: 'wpub', m: 'Цены?' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
});

console.log('\n=== ' + pass + ' пройдено, ' + fail + ' провалено ===');
console.log('Писем: ' + SENT_MAIL.length + ', заявок в таблице: ' + (leadRows().length - 1) +
            ', строк переписки: ' + (DB.getSheetByName('Переписка с ботом').getLastRow() - 1) + '\n');
process.exit(fail ? 1 : 0);
