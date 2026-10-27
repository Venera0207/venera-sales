/* =====================================================================
   АССИСТЕНТ НА ЛЕНДИНГЕ ПРОДАЖ (кнопка-робот + окошко чата)
   Живёт в репозитории venera-sales, подключается одной строкой в index.html:
       <script src="assistant-sales.js?v=1"></script>
   Разговаривает через трубу «Венера — продажи» (действие chat, та же
   «голова» ИИ, что у бота заявок). Пока адрес трубы в window.SALES.pipeUrl
   пустой — честно говорит, что ещё подключается, и ведёт к форме заявки.
   Никаких ключей и токенов в этом файле нет.
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.SALES || {};
  var PIPE = String(CFG.pipeUrl || '');
  var ROBOT = 'img/robot.png?v=2';

  /* ---------- стили (всё внутри, внешних файлов нет) ---------- */
  var css = '' +
    '.vs-btn{position:fixed;right:20px;bottom:20px;width:76px;height:76px;padding:0;border:none;border-radius:50%;' +
    'overflow:hidden;cursor:pointer;background:#DDEBFF;z-index:9998;' +
    'box-shadow:0 12px 32px rgba(124,58,237,.45),0 8px 20px rgba(0,0,0,.45);animation:vsFloat 4s ease-in-out infinite}' +
    '.vs-btn:hover{filter:brightness(1.08)}' +
    '.vs-btn img{width:100%;height:100%;object-fit:contain;object-position:50% 50%;padding:6px;box-sizing:border-box;display:block}' +
    '@keyframes vsFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}' +
    '.vs-bubble{position:fixed;right:24px;bottom:106px;max-width:230px;background:#151522;color:#edebf4;' +
    'border:1px solid #26263a;border-radius:14px 14px 4px 14px;padding:10px 13px;font:14px/1.45 "Segoe UI",system-ui,sans-serif;' +
    'box-shadow:0 10px 30px rgba(0,0,0,.4);z-index:9998;display:none}' +
    '.vs-bubble.show{display:block}' +
    '.vs-panel{position:fixed;right:20px;bottom:106px;width:350px;max-width:calc(100vw - 28px);height:480px;' +
    'max-height:calc(100vh - 130px);background:#10101b;color:#edebf4;border:1px solid #26263a;border-radius:18px;' +
    'box-shadow:0 18px 50px rgba(0,0,0,.5);display:none;flex-direction:column;overflow:hidden;z-index:9999;' +
    'font:15px/1.5 "Segoe UI",system-ui,sans-serif}' +
    '.vs-panel.open{display:flex}' +
    '.vs-head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:#151522;border-bottom:1px solid #26263a}' +
    '.vs-head img{width:42px;height:42px;border-radius:50%;object-fit:contain;object-position:50% 50%;padding:3px;box-sizing:border-box}' +
    '.vs-head b{display:block;font-size:15px}' +
    '.vs-head span{display:block;font-size:12px;color:#9a96ae}' +
    '.vs-close{margin-left:auto;background:none;border:none;color:#9a96ae;font-size:20px;cursor:pointer;padding:4px 6px}' +
    '.vs-msgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px}' +
    '.vs-m{max-width:85%;padding:9px 12px;border-radius:14px;white-space:pre-wrap;word-wrap:break-word;font-size:14px}' +
    '.vs-m.bot{background:#1b1b2c;border:1px solid #26263a;border-radius:14px 14px 14px 4px;align-self:flex-start}' +
    '.vs-m.me{background:linear-gradient(90deg,#7c3aed,#ff2ec4);color:#fff;border-radius:14px 14px 4px 14px;align-self:flex-end}' +
    '.vs-m.sys{align-self:center;background:none;border:none;color:#9a96ae;font-size:12.5px;text-align:center;padding:2px 8px}' +
    '.vs-typing{display:inline-flex;gap:4px;padding:4px 2px}' +
    '.vs-typing i{width:6px;height:6px;border-radius:50%;background:#9a96ae;animation:vsT 1s infinite}' +
    '.vs-typing i:nth-child(2){animation-delay:.15s}.vs-typing i:nth-child(3){animation-delay:.3s}' +
    '@keyframes vsT{0%,100%{opacity:.25}50%{opacity:1}}' +
    '.vs-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 8px}' +
    '.vs-chips button{background:#151522;border:1px solid #26263a;color:#edebf4;border-radius:999px;padding:6px 11px;' +
    'font:13px "Segoe UI",system-ui,sans-serif;cursor:pointer}' +
    '.vs-chips button:hover{border-color:#7c3aed}' +
    '.vs-in{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #26263a;background:#151522}' +
    '.vs-in input{flex:1;background:#0b0b14;border:1px solid #26263a;border-radius:10px;color:#edebf4;' +
    'padding:9px 11px;font:14px "Segoe UI",system-ui,sans-serif;outline:none}' +
    '.vs-in input:focus{border-color:#7c3aed}' +
    '.vs-in button{border:none;border-radius:10px;background:linear-gradient(90deg,#7c3aed,#ff2ec4);color:#fff;' +
    'padding:0 16px;font:14px "Segoe UI",system-ui,sans-serif;cursor:pointer}' +
    '.vs-in button:disabled{opacity:.5;cursor:default}' +
    '@media (prefers-reduced-motion: reduce){.vs-btn{animation:none}}' +
    '@media (max-width:480px){.vs-btn{width:64px;height:64px;right:14px;bottom:14px}' +
    '.vs-panel{right:14px;bottom:92px}.vs-bubble{right:18px;bottom:92px}}';

  function sid() {
    var k = 'vs_sid', v = '';
    try { v = localStorage.getItem(k) || ''; } catch (e) {}
    if (!v) {
      v = 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { localStorage.setItem(k, v); } catch (e2) {}
    }
    return v;
  }
  var SID = sid();

  /* ---------- jsonp: трубы Google не любят CORS-preflight, а jsonp надёжен ---------- */
  function jsonp(url, params, cb, fail) {
    var name = 'vs_cb_' + Math.random().toString(36).slice(2);
    var sc = document.createElement('script'), done = false;
    var timer = setTimeout(function () { cleanup(); if (fail) fail(); }, 20000);
    function cleanup() {
      clearTimeout(timer);
      try { delete window[name]; } catch (e) {}
      if (sc.parentNode) sc.parentNode.removeChild(sc);
    }
    window[name] = function (d) { if (done) return; done = true; cleanup(); cb(d); };
    params.callback = name;
    sc.onerror = function () { if (done) return; done = true; cleanup(); if (fail) fail(); };
    sc.src = url + (url.indexOf('?') >= 0 ? '&' : '?') + Object.keys(params).map(function (k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
    }).join('&');
    document.head.appendChild(sc);
  }

  /* ---------- разметка ---------- */
  function build() {
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

    var btn = document.createElement('button');
    btn.className = 'vs-btn'; btn.type = 'button';
    btn.setAttribute('aria-label', 'Чат с ассистентом Венеры');
    btn.innerHTML = '<img src="' + ROBOT + '" alt="" aria-hidden="true">';
    document.body.appendChild(btn);

    var bub = document.createElement('div');
    bub.className = 'vs-bubble';
    bub.textContent = 'Привет! Я помощник Венеры 💜 Расспросите меня про сайты для салонов — или оставьте заявку, Венера ответит лично.';
    document.body.appendChild(bub);

    var panel = document.createElement('div');
    panel.className = 'vs-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Чат с ассистентом');
    panel.innerHTML =
      '<div class="vs-head"><img src="' + ROBOT + '" alt="">' +
      '<div><b>Помощник Венеры</b><span>' + (PIPE ? 'на связи · отвечает сразу' : 'подключается · заявку примет форма') + '</span></div>' +
      '<button class="vs-close" type="button" aria-label="Закрыть чат">×</button></div>' +
      '<div class="vs-msgs"></div>' +
      '<div class="vs-chips"></div>' +
      '<form class="vs-in"><input type="text" maxlength="500" placeholder="Напишите вопрос…" autocomplete="off">' +
      '<button type="submit">➤</button></form>';
    document.body.appendChild(panel);

    return { btn: btn, bub: bub, panel: panel,
             msgs: panel.querySelector('.vs-msgs'), chips: panel.querySelector('.vs-chips'),
             form: panel.querySelector('.vs-in'), input: panel.querySelector('.vs-in input'),
             send: panel.querySelector('.vs-in button'), close: panel.querySelector('.vs-close') };
  }

  function init() {
    var U = build();
    var busy = false;

    function add(cls, text) {
      var d = document.createElement('div');
      d.className = 'vs-m ' + cls;
      d.textContent = text;
      U.msgs.appendChild(d);
      U.msgs.scrollTop = U.msgs.scrollHeight;
      return d;
    }
    function typing(on) {
      var old = U.msgs.querySelector('.vs-typing-wrap');
      if (old) old.parentNode.removeChild(old);
      if (!on) return;
      var d = document.createElement('div');
      d.className = 'vs-m bot vs-typing-wrap';
      d.innerHTML = '<span class="vs-typing"><i></i><i></i><i></i></span>';
      U.msgs.appendChild(d);
      U.msgs.scrollTop = U.msgs.scrollHeight;
    }
    function chips(list) {
      U.chips.innerHTML = '';
      (list || []).forEach(function (c) {
        var b = document.createElement('button');
        b.type = 'button'; b.textContent = c;
        b.onclick = function () { ask(c); };
        U.chips.appendChild(b);
      });
    }
    function toForm() {
      var f = document.getElementById('zayavka');
      if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function ask(text) {
      text = String(text || '').trim().slice(0, 500);
      if (!text || busy) return;
      add('me', text);
      U.input.value = '';
      busy = true; U.send.disabled = true; typing(true);

      /* трубы ещё нет — ассистент честно уводит к форме */
      if (!PIPE) {
        setTimeout(function () {
          typing(false);
          add('bot', 'Я ещё подключаюсь: Венера как раз настраивает мне «трубу».\nНо заявка уже работает — оставьте её в форме ниже, и Венера ответит лично, обычно в течение пары часов 💜');
          var b = add('sys', 'открыть форму заявки ↓');
          b.style.cursor = 'pointer';
          b.onclick = toForm;
          busy = false; U.send.disabled = false;
          chips(['Цены', 'Что входит в сайт', 'Живой пример']);
        }, 600);
        return;
      }

      /* есть труба: шлём вопрос, при сбое — две повторные попытки (трубы Google
         иногда отвечают 400 на частые запросы, лечим повтором) */
      var tries = 0;
      function attempt() {
        tries++;
        jsonp(PIPE, { action: 'chat', s: SID, m: text },
          function (d) {
            typing(false);
            if (d && d.ok && d.reply) {
              add('bot', d.reply);
              if (/(\+?\d[\d\s()-]{7,})/.test(text)) {
                add('sys', 'контакт замечен — Венера увидит его в заявках сразу');
              }
              chips(['Цены', 'Как начать', 'Оставить заявку']);
            } else {
              add('sys', 'что-то сбилось в трубе, попробуйте ещё раз');
              chips(['Повторить']);
            }
            busy = false; U.send.disabled = false;
          },
          function () {
            if (tries < 3) { setTimeout(attempt, tries === 1 ? 2500 : 9000); return; }
            typing(false);
            add('sys', 'связь с трубой потерялась — проверьте интернет и попробуйте ещё раз');
            chips(['Повторить']);
            busy = false; U.send.disabled = false;
          });
      }
      attempt();
    }

    /* «Оставить заявку» в чипах ведёт к форме, остальные — вопросы ассистенту */
    U.chips.addEventListener('click', function (e) {
      if (e.target && e.target.textContent === 'Оставить заявку') toForm();
    });

    U.form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = U.input.value;
      if (v.trim().toLowerCase() === 'оставить заявку') { toForm(); return; }
      ask(v);
    });

    var opened = false;
    function open() {
      opened = true;
      U.panel.classList.add('open');
      U.bub.classList.remove('show');
      if (!U.msgs.children.length) {
        add('bot', PIPE
          ? 'Здравствуйте! Я помощник Венеры 💜 Подскажу по ценам, срокам и что входит в сайт для салона. Спросите что угодно или выберите готовый вопрос ниже.'
          : 'Здравствуйте! Я помощник Венеры 💜 Пока меня подключают, но заявка уже работает: оставьте её в форме — Венера ответит лично.');
        chips(['Цены', 'Что входит в сайт', 'Живой пример']);
      }
      setTimeout(function () { U.input.focus(); }, 50);
    }
    function close() { opened = false; U.panel.classList.remove('open'); }

    U.btn.onclick = function () { if (opened) close(); else open(); };
    U.close.onclick = close;
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    /* пузырёк-приветствие: один раз, через 6 секунд, если чат не открывали */
    var seen = false;
    try { seen = !!localStorage.getItem('vs_bubble_seen'); } catch (e) {}
    if (!seen) {
      setTimeout(function () {
        if (!opened) U.bub.classList.add('show');
        setTimeout(function () { U.bub.classList.remove('show'); }, 9000);
        try { localStorage.setItem('vs_bubble_seen', '1'); } catch (e) {}
      }, 6000);
    }
    U.bub.onclick = open;

    /* ссылка …/#assistent или ?chat=1 сразу открывает чат */
    if (location.hash === '#assistent' || /[?&]chat=1/.test(location.search)) open();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
