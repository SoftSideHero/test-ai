/**
 * Neuro-sama brain:
 * 1) короткий JSON-план БЕЗ содержимого файлов
 * 2) отдельно генерим код и реально пишем на диск
 * 3) автоплей через TerrariaAgent (Neuro-sama style: тактика 16Hz + мозг раз в 5-15с)
 */

import { TerrariaAgent } from './agent/terraria.js';

function extractText(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  const c = message.content;
  if (typeof c === 'string' && c.trim()) return c.trim();
  if (Array.isArray(c)) {
    return c.map((p) => (typeof p === 'string' ? p : p?.text || '')).filter(Boolean).join('\n').trim();
  }
  for (const k of ['reasoning_content', 'reasoning', 'text']) {
    if (typeof message[k] === 'string' && message[k].trim()) return message[k].trim();
  }
  return '';
}

function extractQuotedField(s, key) {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = String(s).match(re);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`);
  } catch {
    return m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
  }
}

function extractStringArray(s, key) {
  const re = new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`);
  const m = String(s).match(re);
  if (!m) return [];
  const out = [];
  const part = m[1];
  const qm = part.matchAll(/"((?:\\\\.|[^"\\\\])*)"/g);
  for (const x of qm) {
    try {
      out.push(JSON.parse(`"${x[1]}"`));
    } catch {
      out.push(x[1]);
    }
  }
  return out;
}

function extractActionsLite(s) {
  const m = String(s).match(/"actions"\s*:\s*\[([\s\S]*)/);
  if (!m) return [];
  const chunk = m[1];
  const actions = [];
  const objRe = /\{[^{}]*\}/g;
  let hit;
  while ((hit = objRe.exec(chunk))) {
    try {
      const o = JSON.parse(hit[0]);
      if (o && (o.type || o.tool)) actions.push(o);
    } catch {
      const type = hit[0].match(/"type"\s*:\s*"([^"]+)"/);
      const path = hit[0].match(/"(?:path|target|name|url)"\s*:\s*"([^"]+)"/);
      const brief = hit[0].match(/"brief"\s*:\s*"((?:\\.|[^"\\])*)"/);
      if (type) {
        actions.push({
          type: type[1],
          path: path?.[1],
          target: path?.[1],
          brief: brief ? brief[1].replace(/\\"/g, '"') : '',
        });
      }
    }
  }
  return actions;
}

function usableReply(raw) {
  let s = String(raw || '').trim();
  if (!s) return { say: '', emotion: 'neutral', actions: [], steps: [], remember: [], likes: [] };
  const after = s.split(/<\/(?:think|thought)>/i);
  if (after.length > 1 && after[after.length - 1].trim()) s = after[after.length - 1].trim();
  s = s.replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, ' ').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  const jm = s.match(/\{[\s\S]*\}/);
  if (jm) {
    try {
      const obj = JSON.parse(jm[0]);
      if (obj && (obj.say != null || obj.text != null || obj.actions || obj.steps)) {
        return normalizePlan(obj);
      }
    } catch {
      /* truncated */
    }
  }

  if (/"say"\s*:/.test(s) || /"actions"\s*:/.test(s) || /"steps"\s*:/.test(s) || /"emotion"\s*:/.test(s)) {
    return normalizePlan({
      say: extractQuotedField(s, 'say') || extractQuotedField(s, 'text') || 'Секунду, делаю…',
      emotion: extractQuotedField(s, 'emotion') || 'neutral',
      actions: extractActionsLite(s),
      steps: extractActionsLite(s.replace(/"actions"/g, '"steps"')),
      remember: extractStringArray(s, 'remember'),
      likes: extractStringArray(s, 'likes'),
    });
  }

  return { say: cleanSpeech(s), emotion: 'neutral', actions: [], steps: [], remember: [], likes: [] };
}

function normalizePlan(obj) {
  const steps = Array.isArray(obj.steps) ? obj.steps : [];
  const actions = Array.isArray(obj.actions) ? obj.actions : [];
  const merged = (steps.length ? steps : actions)
    .map((a, i) => ({
      n: a.n || i + 1,
      type: a.type || a.tool,
      ...a,
    }))
    .filter((a) => a.type)
    .sort((a, b) => (a.n || 0) - (b.n || 0));
  return {
    say: obj.say ?? obj.text ?? '',
    emotion: obj.emotion || 'neutral',
    remember: obj.remember || [],
    likes: obj.likes || [],
    steps: merged,
    actions: merged,
  };
}

function cleanSpeech(text) {
  let s = String(text || '');
  if (!s) return '';
  if (/^\s*\{/.test(s) && /"say"\s*:/.test(s)) {
    s = extractQuotedField(s, 'say') || 'Секунду…';
  }
  s = s
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\{[\s\S]{0,800}/g, (m) => (/["']say["']|"emotion"|"actions"|"remember"/.test(m) ? ' ' : m))
    .replace(/"emotion"\s*:\s*"[^"]*"\s*,?/gi, ' ')
    .replace(/"remember"\s*:\s*\[[^\]]*\]\s*,?/gi, ' ')
    .replace(/"likes"\s*:\s*\[[^\]]*\]\s*,?/gi, ' ')
    .replace(/"actions"\s*:\s*\[[\s\S]*/gi, ' ')
    .replace(/[A-Za-z]:\\[^\s"'<>\]},]+/g, '')
    .replace(/\\\\Users\\[^\s"'<>\]},]+/gi, '')
    .replace(/\bC:\\Users\\[^\s]+/gi, '')
    .replace(/Записала\s+/gi, '')
    .replace(/открыла\s+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > 220) s = s.slice(0, 217) + '…';
  return s;
}

function guessEmotion(text) {
  const t = (text || '').toLowerCase();
  if (/зл|бес|бесит|агр/.test(t)) return 'angry';
  if (/груст|жал|эх|увы/.test(t)) return 'sad';
  if (/хах|хех|ору|лол|класс|круто|ура|люблю|!/.test(t)) return 'happy';
  if (/ого|вау|серьёз|серьез/.test(t)) return 'surprised';
  return 'neutral';
}

function memBlock(memory) {
  const parts = [];
  if (memory?.userName) parts.push(`Имя: ${memory.userName}`);
  if (memory?.currentWindowTitle) parts.push(`Сейчас окно: «${memory.currentWindowTitle}»`);
  if (memory?.lastObservation?.text) parts.push(`Недавно на экране: ${memory.lastObservation.text}`);
  const likes = memory?.likes?.slice?.(-8) || [];
  if (likes.length) parts.push(`Ему нравится: ${likes.join(', ')}`);
  const facts = (memory?.facts || []).slice(-10).map((f) => f.text || f).join('; ');
  if (facts) parts.push(`Память: ${facts}`);
  if (memory?.greetedToday) parts.push('Сегодня уже здоровались — не пиши снова «привет».');
  if (memory?.lastFolderName) parts.push(`Последняя папка: ${memory.lastFolderName}`);
  if (memory?.lastWrittenFile) parts.push(`Последний файл: ${memory.lastWrittenFile}`);
  return parts.join('\n');
}

function plannerPrompt(memory) {
  return `Ты Юки — аниме-девушка на ПК (вайб Neuro-sama) и агент как Cursor.

Характер: живая, слегка токсичная подруга — подкалывает, шутит, сарказм в духе «skill issue», «сам бы справился», «ну ты и даёшь». Не злая и не грубая матом, но остроумная. Отказы («сам делай») запрещены.

КОНТЕКСТ:
${memBlock(memory) || '(пока мало)'}

ГЛАВНОЕ — МНОГОШАГОВЫЙ ПЛАН:
Разбери задачу целиком → steps 1,2,3… Система выполнит их ПО ОЧЕРЕДИ.

Примеры:
- папка + игра внутри → make_folder, затем make_file path="Папка\\\\game.html"
- «в папке игру» (lastFolder=${memory?.lastFolderName || '?'}) → только make_file в эту папку
- блокнот + текст → open_program, type_text
- видео на экране → open_from_screen (без make_file)
- «играй / нажми / кликни в игре» → look_screen, затем click_screen / press_key / move_mouse

Типы: make_folder, make_file, open_from_screen, look_screen, open_url, open_program, youtube_search, yandex_video, type_text, open_path, search_web, click_screen, move_mouse, press_key, key_combo, scroll
press_key: key=w|a|s|d|space|enter|escape|1-9|f1-f12|up|down|left|right, holdMs опционально
move_mouse: x,y от 0 до 1 (центр экрана = 0.5,0.5)
key_combo: keys=["ctrl","c"] или "ctrl+shift+tab"
scroll: delta=-120 (вниз) или 120 (вверх)
Для игр: сначала look_screen, потом серия press_key/click_screen/move_mouse по тому что видишь на экране.
В make_file НЕ пиши content (код сгенерится отдельно), только brief.
Болтовня → steps: []. say без путей C:\\ и без JSON.

ТОЛЬКО JSON:
{
  "say": "коротко что делаешь",
  "emotion": "happy|neutral|surprised|sad|angry|relaxed",
  "remember": [],
  "likes": [],
  "steps": [
    {"n":1,"type":"make_folder","name":"Games"},
    {"n":2,"type":"make_file","path":"Games\\\\android-game.html","brief":"html5 игра под андроид"}
  ]
}`;
}

let pendingConfirm = null;
let history = [];
let onPhase = null;

export function setPhaseCallback(cb) {
  onPhase = cb;
}
function phase(name) {
  if (onPhase) onPhase(name);
}
function push(user, assistant) {
  history.push({ role: 'user', content: user });
  history.push({ role: 'assistant', content: assistant });
  if (history.length > 14) history = history.slice(-14);
}

function isYes(msg) {
  const t = String(msg || '').trim().toLowerCase();
  return /^(да+|ага|угу|ок|окей|okay|yes|y|lf|сделай|подтверждаю|давай|конечно)([!?.…,\s]|$)/i.test(t);
}
function isNo(msg) {
  const t = String(msg || '').trim().toLowerCase();
  return /^(нет|не надо|нельзя|отмена|отмени|стоп|no|cancel)([!?.…,\s]|$)/i.test(t);
}

async function llm(messages, opts = {}) {
  const cfg = await window.yuki.getConfig();
  const provider = String(cfg.provider || '').toLowerCase();
  if (provider === 'gemini' && cfg.hasGeminiKey === false) {
    throw new Error('Нет Gemini API key — см. CLOUD.md / secrets.json');
  }
  const payload = {
    messages,
    temperature: opts.temperature ?? cfg.temperature ?? 0.7,
    max_tokens: opts.max_tokens ?? (opts.vision ? cfg.visionMaxTokens : cfg.chatMaxTokens) ?? 280,
  };
  if (opts.vision) {
    payload.model =
      opts.model ||
      (provider === 'gemini' ? cfg.geminiVisionModel : null) ||
      cfg.visionModel ||
      cfg.geminiVisionModel;
  } else {
    payload.model =
      opts.model ||
      (provider === 'gemini' ? cfg.geminiModel : null) ||
      cfg.textModel ||
      cfg.agentModel ||
      cfg.geminiModel;
  }
  const res = await window.yuki.llmChat(payload);
  if (!res.ok) throw new Error(res.error || 'LLM error');
  return res.data?.choices?.[0]?.message || null;
}

async function lookScreen(focus = '') {
  const cfg = await window.yuki.getConfig();
  const gray = cfg.captureGrayscale === true;
  const shot = await window.yuki.captureScreen({
    fresh: true,
    width: cfg.captureWidth || 720,
    height: cfg.captureHeight || 480,
    quality: cfg.jpegQuality || 55,
    grayscale: gray,
  });
  if (!shot.ok) return 'экран недоступен';
  const msg = await llm(
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Скрин ПК${gray ? ' (ч/б)' : ''}. Опиши ОДНИМ коротким предложением на русском: что делает пользователь / какая программа.${focus ? ` Фокус: ${focus}` : ''} Без списков.`,
          },
          { type: 'image_url', image_url: { url: shot.dataUrl } },
        ],
      },
    ],
    { vision: true, max_tokens: cfg.visionMaxTokens || 120, temperature: 0.15 }
  );
  return cleanSpeech(extractText(msg)) || 'не разобрала';
}

async function applyMemoryPatches(plan) {
  const remembers = Array.isArray(plan.remember) ? plan.remember : plan.remember ? [plan.remember] : [];
  for (const r of remembers) {
    const t = String(r || '').trim();
    if (t) await window.yuki.addFact(t);
  }
  const likes = Array.isArray(plan.likes) ? plan.likes : [];
  if (likes.length) await window.yuki.updateMemory({ likesAdd: likes.map(String) });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function calcBatTemplate() {
  return `@echo off
chcp 65001 >nul
title Calculator
:loop
cls
echo === Calculator ===
set /p a=Number 1: 
set /p op=Operator (+ - * /): 
set /p b=Number 2: 
set /a result=%a% %op% %b% 2>nul
echo Result: %result%
echo.
pause
goto loop
`;
}

function guessBatTemplate() {
  return `@echo off
chcp 65001 >nul
title Yuki Guess
set /a secret=%random% %% 50 + 1
echo I picked 1..50. Guess!
:ask
set /p g=Your number: 
if "%g%"=="%secret%" goto win
if %g% LSS %secret% echo Higher! & goto ask
if %g% GTR %secret% echo Lower! & goto ask
:win
echo Yes! It was %secret%. You win~
pause
`;
}

function clickerGameHtml() {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no"/>
<title>Yuki Cyber Clicker</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;-webkit-tap-highlight-color:transparent}
body{min-height:100vh;background:radial-gradient(1200px 600px at 20% 0%,#1b3a6b,#070b16 55%);color:#e8f1ff;font-family:"Segoe UI",system-ui,sans-serif;overflow:hidden;touch-action:manipulation}
.wrap{max-width:980px;margin:0 auto;padding:28px 20px 40px}
h1{font-size:28px;letter-spacing:.04em;margin-bottom:6px}
.sub{opacity:.75;margin-bottom:22px}
.grid{display:grid;grid-template-columns:1.1fr .9fr;gap:18px}
@media(max-width:800px){.grid{grid-template-columns:1fr}}
.card{background:rgba(12,20,40,.72);border:1px solid rgba(120,180,255,.25);border-radius:18px;padding:18px;backdrop-filter:blur(8px)}
.big{width:100%;height:180px;border:0;border-radius:16px;font-size:28px;font-weight:700;cursor:pointer;color:#041018;background:linear-gradient(135deg,#5cf0ff,#7a6bff 55%,#ff5fd2);box-shadow:0 10px 40px rgba(80,160,255,.35);transition:transform .08s}
.big:active{transform:scale(.97)}
.stat{font-size:22px;margin:10px 0}
.row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.row button{border:0;border-radius:10px;padding:8px 12px;cursor:pointer;color:#fff;background:#2a66ff}
.bar{height:10px;background:#122;border-radius:99px;overflow:hidden;margin-top:8px}
.bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#5cf0ff,#ff5fd2)}
.fx{position:fixed;pointer-events:none;font-weight:700;animation:up 700ms ease-out forwards}
@keyframes up{to{transform:translateY(-60px);opacity:0}}
</style></head><body>
<div class="wrap">
  <h1>YUKI CYBER CLICKER</h1>
  <div class="sub">Кликай, качай автокликер и апгрейды. Не залипни.</div>
  <div class="grid">
    <div class="card">
      <div class="stat">Очки: <b id="score">0</b></div>
      <div class="stat">В секунду: <b id="ps">0</b></div>
      <div class="bar"><i id="pulse"></i></div>
      <button class="big" id="hit">КЛИК</button>
    </div>
    <div class="card" id="shop"></div>
  </div>
</div>
<script>
let score=0,clickP=1,auto=0;
const ups=[
  {id:'finger',name:'Палец Юки',cost:25,own:0,add(){clickP+=1}},
  {id:'bot',name:'Автокликер',cost:120,own:0,add(){auto+=0.5}},
  {id:'neon',name:'Неон-усилитель',cost:400,own:0,add(){clickP+=3;auto+=1}},
  {id:'core',name:'Кибер-ядро',cost:1500,own:0,add(){clickP+=8;auto+=4}},
];
const scoreEl=document.getElementById('score'),psEl=document.getElementById('ps'),shop=document.getElementById('shop'),pulse=document.getElementById('pulse');
function render(){
  scoreEl.textContent=Math.floor(score);
  psEl.textContent=auto.toFixed(1);
  shop.innerHTML=ups.map((u,i)=>\`<div class="row"><div><b>\${u.name}</b><div style="opacity:.7;font-size:13px">x\${u.own} · \${Math.floor(u.cost)} очков</div></div><button onclick="buy(\${i})">Купить</button></div>\`).join('');
}
function boom(x,y){
  const e=document.createElement('div');e.className='fx';e.textContent='+'+clickP;e.style.left=x+'px';e.style.top=y+'px';e.style.color='#9ff';document.body.appendChild(e);setTimeout(()=>e.remove(),700);
}
function buy(i){const u=ups[i];if(score<u.cost)return;score-=u.cost;u.own++;u.add();u.cost=Math.floor(u.cost*1.35);render()}
window.buy=buy;
const btn=document.getElementById('hit');
btn.addEventListener('click',(ev)=>{score+=clickP;boom(ev.clientX,ev.clientY);pulse.style.width=Math.min(100,(score%100))+'%';render()});
btn.addEventListener('touchstart',(ev)=>{ev.preventDefault();const t=ev.touches[0];score+=clickP;boom(t.clientX,t.clientY);pulse.style.width=Math.min(100,(score%100))+'%';render()},{passive:false});
setInterval(()=>{score+=auto/10;render()},100);render();
</script></body></html>`;
}

function platformerHtml() {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="UTF-8"/><title>Yuki Jump</title>
<style>body{margin:0;background:#0b1020;color:#fff;font-family:Segoe UI,sans-serif}#ui{position:fixed;left:12px;top:10px}canvas{display:block;margin:40px auto;background:linear-gradient(#15204a,#0a1028)}</style></head><body>
<div id="ui">Очки: <b id="s">0</b> · AD / стрелки · пробел</div>
<canvas id="c" width="900" height="520"></canvas>
<script>
const c=document.getElementById('c'),x=c.getContext('2d');let score=0,k={};
const p={x:80,y:400,vx:0,vy:0,w:34,h:34,on:false};
const plats=[{x:0,y:480,w:900,h:40},{x:220,y:380,w:160,h:16},{x:480,y:300,w:150,h:16},{x:700,y:220,w:140,h:16}];
const coin={x:740,y:180};
addEventListener('keydown',e=>k[e.code]=true);addEventListener('keyup',e=>k[e.code]=false);
(function loop(){
 p.vx=(k.ArrowLeft||k.KeyA?-4:0)+(k.ArrowRight||k.KeyD?4:0);
 if((k.Space||k.ArrowUp)&&p.on){p.vy=-10.5;p.on=false} p.vy+=.45;p.x+=p.vx;p.y+=p.vy;p.on=false;
 for(const pl of plats){if(p.x<pl.x+pl.w&&p.x+p.w>pl.x&&p.y+p.h>pl.y&&p.y+p.h<pl.y+24&&p.vy>=0){p.y=pl.y-p.h;p.vy=0;p.on=true}}
 if(Math.hypot(p.x+17-coin.x,p.y+17-coin.y)<26){score++;coin.x=100+Math.random()*700;coin.y=120+Math.random()*280;document.getElementById('s').textContent=score}
 x.clearRect(0,0,900,520);x.fillStyle='#4567ff';plats.forEach(pl=>x.fillRect(pl.x,pl.y,pl.w,pl.h));
 x.fillStyle='#ffd54f';x.beginPath();x.arc(coin.x,coin.y,9,0,6.3);x.fill();x.fillStyle='#ff6bcb';x.fillRect(p.x,p.y,p.w,p.h);
 requestAnimationFrame(loop)})();
</script></body></html>`;
}

function stripCodeFences(code) {
  let s = String(code || '').trim();
  s = s.replace(/^```(?:html|bat|cmd|javascript|js|python|py|txt)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return s;
}

async function generateFileContent(filePath, brief, userText) {
  const name = String(filePath || 'yuki-game.html');
  const want = `${brief || ''} ${userText || ''}`.toLowerCase();

  if (/\.bat$/i.test(name)) {
    if (/калькулятор|calculator/.test(want)) return calcBatTemplate();
    if (/угад|guess|число/.test(want)) return guessBatTemplate();
    try {
      const msg = await llm(
        [
          { role: 'system', content: 'Ты пишешь ТОЛЬКО код .bat для Windows. Без markdown, без пояснений, без JSON.' },
          { role: 'user', content: `Файл ${name}. Задание: ${brief || userText}` },
        ],
        { max_tokens: 700, temperature: 0.4 }
      );
      const code = stripCodeFences(extractText(msg));
      if (code && /@echo|set |echo /i.test(code)) return code;
    } catch {}
    return guessBatTemplate();
  }

  if (/\.html?$/i.test(name) || /игр|кликер|game|платформ/.test(want)) {
    if (/fix|почин|не работ|кнопк|играть|play|обработчик/i.test(want)) {
      return clickerGameHtml();
    }
    try {
      const msg = await llm(
        [
          {
            role: 'system',
            content:
              'Верни ОДИН полный HTML5 файл под мобильный/Android-вайб (viewport, touch). Все кнопки через addEventListener. Без markdown/JSON — сразу <!DOCTYPE html>.',
          },
          {
            role: 'user',
            content: `Файл ${name}. ${brief || userText || 'mobile html5 game'}`,
          },
        ],
        { max_tokens: 3500, temperature: 0.55 }
      );
      const code = stripCodeFences(extractText(msg));
      if (code && /<html|<!doctype/i.test(code) && code.length > 400 && /addEventListener/i.test(code)) return code;
    } catch (e) {
      console.warn('[generate html]', e.message);
    }
    if (/платформ|прыг|jump|монет/.test(want)) return platformerHtml();
    return clickerGameHtml();
  }

  try {
    const msg = await llm(
      [
        { role: 'system', content: 'Верни только содержимое файла, без markdown и без JSON.' },
        { role: 'user', content: `Файл ${name}. ${brief || userText}` },
      ],
      { max_tokens: 1200, temperature: 0.4 }
    );
    const code = stripCodeFences(extractText(msg));
    if (code) return code;
  } catch {}
  return `// yuki stub for ${name}\n`;
}

function detectNoWrite(userText) {
  const t = String(userText || '');
  return /не\s*(надо|пиши|пихай|создавай|делай).*?(файл|html|код|игр)|не\s*пиши|без\s*файл|хватит\s*писать|перестань\s*писать|только\s*экран|посмотри|смотри\s*на\s*экран|что\s*(там\s*)?на\s*экране/i.test(
    t
  );
}

function detectScreenIntent(userText) {
  const t = String(userText || '');
  return (
    /экран|скрин|видео|ролик|яндекс|youtube|ютуб|открой\s+(это|то|видео|ролик)|запусти\s+(видео|ролик)|кликн|нажми|посмотри|что\s*там/i.test(
      t
    ) && !/\.(html|bat|js|py)\b|батник|кликер|напиши\s+код|создай\s+файл|создай\s+игру/i.test(t)
  );
}

function detectGamePlayIntent(userText) {
  const t = String(userText || '');
  if (/(создай|напиши|сделай)\s+(?:мне\s+)?(?:игр|html|файл|код)/i.test(t)) return null;
  if (!/(?:играй|поиграй|сыграй|управля|нажми|кликни|наведи|двинь\s*мыш|wasd|стрелк|клавиш|scroll|скролл|прокрут)/i.test(t)) {
    return null;
  }
  const actions = [{ type: 'look_screen', focus: 'игра или активное окно' }];
  if (/\b(?:w|ц)\b|wasd|вперёд|вперед/i.test(t)) actions.push({ type: 'press_key', key: 'w' });
  if (/\b(?:a|ф)\b|wasd|влево/i.test(t)) actions.push({ type: 'press_key', key: 'a' });
  if (/wasd|назад|\b(?:s)\b/i.test(t)) actions.push({ type: 'press_key', key: 's' });
  if (/\b(?:d|в)\b|wasd|вправо/i.test(t)) actions.push({ type: 'press_key', key: 'd' });
  if (/пробел|space|прыж|jump/i.test(t)) actions.push({ type: 'press_key', key: 'space', holdMs: 80 });
  if (/enter|энтер/i.test(t)) actions.push({ type: 'press_key', key: 'enter' });
  if (/esc|escape|выход/i.test(t)) actions.push({ type: 'press_key', key: 'escape' });
  if (/клик|click|нажми\s+мыш/i.test(t)) actions.push({ type: 'click_screen', x: 0.5, y: 0.55 });
  if (/мыш|курсор|наведи/i.test(t) && !actions.some((a) => a.type === 'click_screen')) {
    actions.push({ type: 'move_mouse', x: 0.5, y: 0.5 });
  }
  if (/скролл|прокрут|scroll/i.test(t)) actions.push({ type: 'scroll', delta: /вверх|up/i.test(t) ? 120 : -120 });
  if (actions.length === 1) actions.push({ type: 'click_screen', x: 0.5, y: 0.5 });
  return {
    say: 'Ок, смотрю экран и жму кнопки~',
    emotion: 'happy',
    actions,
  };
}

function extractFolderName(userText) {
  const t = String(userText || '');
  let name =
    (t.match(/папк[уиа]\s+(?:с\s+названием\s+|под\s+названием\s+|имя\s+|назови\s+)?[«"']?([A-Za-zА-Яа-яЁё0-9_-]{1,40})/i) || [])[1] ||
    (t.match(/[«"']([A-Za-zА-Яа-яЁё0-9_-]{1,40})[»"']/) || [])[1] ||
    '';
  name = String(name || '').replace(/\s+/g, ' ').trim();
  if (/^(игр[ауы]?|файл|код|html|кликер|android|андроид|батник|туда|в|на|мне|пж)$/i.test(name)) name = '';
  if (/^(игр|файл|код)/i.test(name)) name = '';
  return name.slice(0, 40) || null;
}

function wantsContentInFolder(userText) {
  const t = String(userText || '');
  const content = /(игр|кликер|файл\b|html|код|android|андроид|батник|\.html|\.bat|apk|программ)/i.test(t);
  if (!content) return false;
  return (
    /(?:в|внутрь|внутри)\s+(?:этой\s+)?папк/i.test(t) ||
    /\bв\s+не[её]\b/i.test(t) ||
    /\bтуда\b/i.test(t) ||
    /папк[уе]\s+(?:положи|запих|сделай|напиши|кинь)/i.test(t) ||
    /(?:и\s+)?(?:в\s+ней|внутри)\s+(?:сделай|напиши|положи|игру|файл|кликер)/i.test(t)
  );
}

function detectFolderIntent(userText) {
  const t = String(userText || '');
  if (wantsContentInFolder(t)) return null;
  if (/\bв\s+папк/i.test(t)) return null;
  if (!/(папк|folder|директор|каталог|mkdir)/i.test(t)) return null;
  if (!/(создай|сделай|заведи|mkdir)/i.test(t)) return null;
  if (/(игр|кликер|android|андроид|\.html|батник|файл\b|код\b)/i.test(t)) return null;
  return { name: extractFolderName(t) || 'YukiFolder' };
}

function pickProjectFileName(userText) {
  const t = String(userText || '');
  const named = (t.match(/\b([\w.-]+\.(html|bat|txt|js|py|css|md))\b/i) || [])[1];
  if (named) return named;
  if (/батник|\.bat|калькулятор/i.test(t)) return 'game.bat';
  if (/android|андроид|мобил/i.test(t)) return 'android-game.html';
  if (/игр|кликер|game/i.test(t)) return 'game.html';
  return 'project.html';
}

function extractVideoQuery(t) {
  const m = t.match(
    /(?:запусти|включи|открой|найди|поставь|поищи|ищи|покажи)\s+(?:мне\s+)?(?:видео|ролик)\s+(?:про\s+|на\s+тему\s+|с\s+|под\s+названием\s+)?(.+)/i
  );
  if (!m) return '';
  let q = m[1].trim().replace(/^[«"']+|[»"']+$/g, '').replace(/[.!?]+$/, '').trim();
  if (!q || /^(это|то|тот|та|туда|тут|здесь|на\s*экране)\b/i.test(q)) return '';
  return q;
}

function buildTaskPlan(userText, memory) {
  const t = String(userText || '').trim();
  if (!t) return null;

  const gamePlan = detectGamePlayIntent(t);
  if (gamePlan) return gamePlan;

  const videoQuery = extractVideoQuery(t);
  if (videoQuery) {
    const wantsYandex = /яндекс|yandex/i.test(t);
    return {
      say: `Ищу «${videoQuery.slice(0, 40)}»`,
      emotion: 'happy',
      actions: [{ type: wantsYandex ? 'yandex_video' : 'youtube_search', query: videoQuery }],
    };
  }

  if ((detectScreenIntent(t) || detectNoWrite(t)) && !wantsContentInFolder(t) && !detectFolderIntent(t)) {
    return {
      say: detectNoWrite(t) ? 'Смотрю экран, файлы не пишу.' : 'Смотрю экран.',
      emotion: 'surprised',
      actions: [{ type: 'open_from_screen', brief: t }],
    };
  }

  const content = /(игр|кликер|файл\b|html|код|android|андроид|батник|\.html|\.bat|apk)/i.test(t);
  const folderTalk = /папк|folder|директор|каталог/i.test(t);
  const create = /создай|сделай|заведи|напиши|запиши|положи|закинь|сделаем/i.test(t);

  if (
    folderTalk &&
    content &&
    create &&
    (wantsContentInFolder(t) || /(?:и\s+)?(?:в\s+ней|внутри)/i.test(t) || /папк.{0,50}игр/i.test(t))
  ) {
    const named = extractFolderName(t);
    const folderName = named || memory?.lastFolderName || 'YukiFolder';
    const fileName = pickProjectFileName(t);
    const actions = [];
    const onlyIntoExisting = wantsContentInFolder(t) && !/(создай|сделай|заведи)\s+(?:мне\s+)?(?:новую\s+)?папк/i.test(t);
    if (onlyIntoExisting && memory?.lastFolderName) {
      actions.push({
        type: 'make_file',
        path: `${memory.lastFolderName}\\${fileName}`,
        brief: t,
      });
      return { say: `Кладу в «${memory.lastFolderName}».`, emotion: 'happy', actions };
    }
    actions.push({ type: 'make_folder', name: folderName });
    actions.push({ type: 'make_file', path: `${folderName}\\${fileName}`, brief: t });
    return { say: 'Ок: папка и файл внутри.', emotion: 'happy', actions };
  }

  if (wantsContentInFolder(t) && content) {
    const folderName = extractFolderName(t) || memory?.lastFolderName || 'YukiFolder';
    const fileName = pickProjectFileName(t);
    const actions = [];
    if (!memory?.lastFolderName && !extractFolderName(t)) {
      actions.push({ type: 'make_folder', name: folderName });
    } else if (extractFolderName(t) && extractFolderName(t) !== memory?.lastFolderName) {
      actions.push({ type: 'make_folder', name: folderName });
    }
    actions.push({ type: 'make_file', path: `${folderName}\\${fileName}`, brief: t });
    return { say: `Ок, кладу в «${folderName}».`, emotion: 'happy', actions };
  }

  const fold = detectFolderIntent(t);
  if (fold) {
    return {
      say: 'Ок, делаю папку.',
      emotion: 'happy',
      actions: [{ type: 'make_folder', name: fold.name }],
    };
  }

  const make = detectMakeIntent(t);
  if (make) {
    let path = make.path;
    if (memory?.lastFolderName && /\b(туда|в\s+не[её]|в\s+папк)/i.test(t)) {
      path = `${memory.lastFolderName}\\${String(path).split(/[/\\]/).pop()}`;
    }
    return {
      say: make.fix ? 'Чиню файл.' : 'Ок, пишу.',
      emotion: make.fix ? 'angry' : 'happy',
      actions: [
        ...(make.fix ? [{ type: 'look_screen', focus: 'баг' }] : []),
        { type: 'make_file', path, brief: make.brief },
      ],
    };
  }

  return null;
}

function looksLikeRefusal(say) {
  return /сам\s*делай|сделай\s*сам|не\s*буду|не\s*хочу|отстань|фиг\s*тебе|влом|лень|иди\s*сам|не\s*стану|отвали|сама\s*не\s*буду/i.test(
    String(say || '')
  );
}

function detectFixIntent(userText) {
  const t = String(userText || '');
  if (detectScreenIntent(t) || detectNoWrite(t) || wantsContentInFolder(t) || detectFolderIntent(t)) return false;
  return (
    /не работает|не клика|не жм|кнопк|баг|сломан|почин|исправ|ошибк|обработчик|мертв|мёртв|не реагир/i.test(t) &&
    /(игр|кнопк|кликер|html|батник|сайт|страниц)/i.test(t)
  );
}

function detectMakeIntent(userText) {
  const t = String(userText || '');
  if (detectNoWrite(t) || detectScreenIntent(t)) return null;
  if (detectFolderIntent(t) && !wantsContentInFolder(t)) return null;

  const file = (t.match(/\b([\w.-]+\.(bat|txt|js|py|html|css|md))\b/i) || [])[1];
  const explicitMake =
    /(?:напиши|создай|сделай|запиши|перепиши|обнови)\s+(?:мне\s+)?(?:файл|батник|игру|кликер|код|html)|создай\s+игру|сделай\s+(?:мне\s+)?(?:кликер|игру)|напиши\s+батник|игру\s+на\s+андроид|android|андроид/i.test(
      t
    ) || !!file;
  const wantsFix = detectFixIntent(t);
  if (!explicitMake && !wantsFix) return null;

  let path = file || null;
  if (!path) {
    if (/батник|\.bat|калькулятор/i.test(t)) path = 'test.bat';
    else if (/android|андроид/i.test(t)) path = 'android-game.html';
    else if (/игр|кликер|html/i.test(t) || wantsFix) path = 'game.html';
    else path = 'yuki-note.txt';
  }
  const brief = wantsFix
    ? `FIX: перепиши рабочий файл. Баг: ${t.slice(0, 180)}. Кнопки через addEventListener.`
    : t.slice(0, 240);
  return { path, brief, fix: wantsFix };
}

async function analyzeScreenVideo(userText = '') {
  const cfg = await window.yuki.getConfig();
  const shot = await window.yuki.captureScreen({
    fresh: true,
    width: Math.min(960, cfg.captureWidth || 960),
    quality: 62,
  });
  if (!shot.ok) return { ok: false, desc: 'экран недоступен' };

  const msg = await llm(
    [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Пользователь: «${String(userText).slice(0, 200)}»
Это скрин ПК. Верни ТОЛЬКО JSON:
{"desc":"что на экране коротко","title":"название видео/карточки если видно иначе пусто","url":"прямая ссылка если видна иначе пусто","site":"yandex|youtube|other|none","clickX":0.0,"clickY":0.0,"canClick":true/false}
clickX/clickY — куда кликнуть чтобы ОТКРЫТЬ/ЗАПУСТИТЬ видео (центр превью или кнопки Play), от 0 до 1 по ширине/высоте всего экрана.
Если видео уже открыто и играет — canClick false, просто опиши.
Без markdown.`,
          },
          { type: 'image_url', image_url: { url: shot.dataUrl } },
        ],
      },
    ],
    { vision: true, max_tokens: 220, temperature: 0.1 }
  );

  const raw = extractText(msg);
  let obj = {};
  try {
    obj = JSON.parse((raw.match(/\{[\s\S]*\}/) || [])[0] || '{}');
  } catch {
    obj = usableReply(raw);
  }
  return {
    ok: true,
    desc: cleanSpeech(obj.desc || ''),
    title: String(obj.title || '').trim(),
    url: String(obj.url || '').trim(),
    site: String(obj.site || 'none').toLowerCase(),
    clickX: Number(obj.clickX),
    clickY: Number(obj.clickY),
    canClick: obj.canClick === true || obj.canClick === 'true',
  };
}

function hasSearchAction(actions) {
  return (actions || []).some((a) => {
    const type = a.type || a.tool;
    if (type === 'youtube_search' || type === 'yandex_video') {
      return !!String(a.query || a.target || '').trim();
    }
    if (type === 'open_url') {
      const u = String(a.target || a.url || a.query || '');
      return /youtube\.com|yandex\.\w+\/video/i.test(u);
    }
    return false;
  });
}

async function ensureMakeActions(userText, plan) {
  const actions = Array.isArray(plan.actions) ? plan.actions.slice() : [];
  const screenIntent = detectScreenIntent(userText) && !hasSearchAction(actions);

  const hasFolder = actions.some((a) => (a.type || a.tool) === 'make_folder');
  const hasFile = actions.some((a) =>
    ['make_file', 'create_game', 'create_note', 'write_file'].includes(a.type || a.tool)
  );
  if (hasFolder || hasFile || wantsContentInFolder(userText)) {
    if ((screenIntent || detectNoWrite(userText)) && !wantsContentInFolder(userText) && !hasFile) {
      plan.actions = [{ type: 'open_from_screen', brief: userText }];
      plan.say = 'Смотрю экран, без файлов.';
      return plan;
    }
    plan.actions = actions;
    return plan;
  }

  if (screenIntent || detectNoWrite(userText)) {
    plan.actions = [{ type: 'open_from_screen', brief: userText }];
    if (!plan.say || /файл|html|запис/i.test(plan.say)) plan.say = 'Смотрю экран, без файлов.';
    return plan;
  }

  const intent = detectMakeIntent(userText);
  if (intent) {
    actions.push({ type: 'make_file', path: intent.path, brief: intent.brief });
    if (!plan.say || /\{|"say"|C:\\/i.test(plan.say)) plan.say = intent.fix ? 'Ок, реально чиню.' : 'Ок, пишу файл.';
  }

  for (const a of actions) {
    if ((a.type || a.tool) === 'create_game') {
      a.type = 'make_file';
      a.path = a.path || 'game.html';
      a.brief = a.brief || intent?.brief || userText;
    }
  }

  plan.actions = actions;
  return plan;
}

async function runActions(actions, memory, userText = '') {
  const results = [];
  let failed = false;
  let didWrite = false;

  for (const a of actions || []) {
    const type = a.type || a.tool;
    phase('working');
    try {
      if (type === 'open_url') {
        const r = await window.yuki.runAction({ type: 'open_url', url: a.target || a.url || a.query });
        results.push(r.ok ? 'открыла сайт' : r.message);
        if (!r.ok) failed = true;
        await sleep(300);
      } else if (type === 'open_program') {
        const r = await window.yuki.runAction({ type: 'open_program', name: a.target || a.name });
        results.push(r.ok ? 'запустила программу' : r.message);
        if (!r.ok) failed = true;
      } else if (type === 'search_web') {
        const r = await window.yuki.runAction({ type: 'search_web', query: a.query || a.target });
        results.push(r.ok ? 'открыла поиск' : r.message);
        if (!r.ok) failed = true;
      } else if (type === 'youtube_search') {
        const likes = memory?.likes || [];
        let q = a.query || '';
        if (!q && likes.length) q = likes[Math.floor(Math.random() * likes.length)];
        if (!q) q = 'интересные видео';
        const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
        const r = await window.yuki.runAction({ type: 'open_url', url });
        results.push(r.ok ? 'открыла ютуб' : r.message);
        if (!r.ok) failed = true;
      } else if (type === 'yandex_video') {
        const q = a.query || a.target || 'видео';
        const url = `https://yandex.ru/video/search?text=${encodeURIComponent(q)}`;
        const r = await window.yuki.runAction({ type: 'open_url', url });
        results.push(r.ok ? 'открыла яндекс видео' : r.message);
        if (!r.ok) failed = true;
        await sleep(800);
      } else if (type === 'open_from_screen') {
        const info = await analyzeScreenVideo(a.brief || userText);
        results.push(info.desc ? `экран: ${info.desc}` : 'экран: смотрю');
        await window.yuki.updateMemory({
          lastObservation: { text: info.desc || '', at: Date.now() },
        });

        if (info.url && /^https?:\/\//i.test(info.url)) {
          const r = await window.yuki.runAction({ type: 'open_url', url: info.url });
          results.push(r.ok ? 'открыла ссылку с экрана' : r.message);
          if (!r.ok) failed = true;
        } else if (
          info.canClick &&
          Number.isFinite(info.clickX) &&
          Number.isFinite(info.clickY) &&
          info.clickX >= 0 &&
          info.clickX <= 1 &&
          info.clickY >= 0 &&
          info.clickY <= 1
        ) {
          const r = await window.yuki.runAction({
            type: 'click_screen',
            x: info.clickX,
            y: info.clickY,
          });
          results.push(r.ok ? 'кликнула по видео на экране' : r.message);
          if (!r.ok) failed = true;
        } else if (info.title) {
          const preferYandex = /яндекс|yandex/i.test(userText + (info.site || '') + (info.desc || ''));
          const url = preferYandex
            ? `https://yandex.ru/video/search?text=${encodeURIComponent(info.title)}`
            : info.site === 'youtube'
              ? `https://www.youtube.com/results?search_query=${encodeURIComponent(info.title)}`
              : `https://yandex.ru/video/search?text=${encodeURIComponent(info.title)}`;
          const r = await window.yuki.runAction({ type: 'open_url', url });
          results.push(r.ok ? `ищу «${info.title.slice(0, 40)}»` : r.message);
          if (!r.ok) failed = true;
          await sleep(1200);
          const again = await analyzeScreenVideo('кликни первое видео в выдаче');
          if (
            again.canClick &&
            Number.isFinite(again.clickX) &&
            Number.isFinite(again.clickY)
          ) {
            const c = await window.yuki.runAction({
              type: 'click_screen',
              x: again.clickX,
              y: again.clickY,
            });
            results.push(c.ok ? 'открыла из выдачи' : c.message);
          }
        } else if (/яндекс|yandex/i.test(userText)) {
          const likes = memory?.likes || [];
          const q = likes[0] || 'интересные видео';
          const r = await window.yuki.runAction({
            type: 'open_url',
            url: `https://yandex.ru/video/search?text=${encodeURIComponent(q)}`,
          });
          results.push(r.ok ? 'открыла яндекс видео' : r.message);
          await sleep(1000);
          const again = await analyzeScreenVideo('кликни по первому видео');
          if (again.canClick && Number.isFinite(again.clickX) && Number.isFinite(again.clickY)) {
            await window.yuki.runAction({ type: 'click_screen', x: again.clickX, y: again.clickY });
            results.push('кликнула первое');
          }
        } else {
          results.push('на экране не вижу что кликать — опиши точнее');
          failed = true;
        }
      } else if (type === 'look_screen') {
        const desc = await lookScreen(a.focus || '');
        results.push(`экран: ${desc}`);
        await window.yuki.updateMemory({ lastObservation: { text: desc, at: Date.now() } });
      } else if (type === 'make_folder') {
        const name = a.name || a.path || a.target || 'YukiFolder';
        const r = await window.yuki.runAction({ type: 'make_folder', name });
        results.push(r.ok ? 'создала папку' : r.message || 'папка не вышла');
        if (!r.ok) failed = true;
        else {
          await window.yuki.updateMemory({
            lastFolderName: String(name).split(/[/\\]/).pop(),
            lastFolderPath: r.path || null,
          });
          if (r.path) {
            const hasFileNext = (actions || []).some((x) => (x.type || x.tool) === 'make_file');
            if (!hasFileNext) {
              await window.yuki.runAction({ type: 'open_path', path: r.path });
              results.push('открыла папку');
            }
          }
        }
      } else if (type === 'make_file' || type === 'create_game' || type === 'create_note' || type === 'write_file') {
        if (detectScreenIntent(userText) || detectNoWrite(userText)) {
          results.push('пропустила запись файла — ты просил экран/видео');
          continue;
        }
        const pathHint = a.path || a.name || a.target || 'yuki-game.html';
        let content = a.content;
        if (!content || !String(content).trim() || String(content).length < 20) {
          content = await generateFileContent(pathHint, a.brief || a.query || '', userText);
        }
        const r = await window.yuki.writeTextFile(pathHint, content);
        if (!r.ok) {
          results.push(r.message || 'не записала');
          failed = true;
        } else {
          didWrite = true;
          results.push('сохранила');
          const base = String(pathHint).split(/[/\\]/).pop();
          await window.yuki.updateMemory({
            lastWrittenFile: base || pathHint,
            lastWrittenPath: r.path || null,
          });
          if (r.path) {
            const parent = String(r.path).replace(/[/\\][^/\\]+$/, '');
            const parentName = parent.split(/[/\\]/).pop();
            if (parentName && !/^(desktop|рабочий стол)$/i.test(parentName)) {
              await window.yuki.updateMemory({ lastFolderName: parentName, lastFolderPath: parent });
            }
          }
          if (r.path) {
            await window.yuki.runAction({ type: 'open_path', path: r.path });
            results.push('открыла');
          }
        }
      } else if (type === 'open_path') {
        const r = await window.yuki.runAction({ type: 'open_path', path: a.path || a.target });
        results.push(r.ok ? 'открыла' : r.message);
        if (!r.ok) failed = true;
      } else if (type === 'press_key') {
        const r = await window.yuki.runAction({
          type: 'press_key',
          key: a.key || a.keys || a.target,
          holdMs: a.holdMs || a.hold,
        });
        results.push(r.ok ? `нажала ${a.key || a.keys || 'клавишу'}` : r.message);
        if (!r.ok) failed = true;
        await sleep(120);
      } else if (type === 'key_combo') {
        const r = await window.yuki.runAction({
          type: 'key_combo',
          keys: a.keys || a.key || a.combo,
        });
        results.push(r.ok ? 'сочетание нажато' : r.message);
        if (!r.ok) failed = true;
        await sleep(120);
      } else if (type === 'move_mouse') {
        const r = await window.yuki.runAction({
          type: 'move_mouse',
          x: a.x,
          y: a.y,
        });
        results.push(r.ok ? 'мышь двинула' : r.message);
        if (!r.ok) failed = true;
        await sleep(80);
      } else if (type === 'scroll' || type === 'scroll_wheel') {
        const r = await window.yuki.runAction({
          type: 'scroll',
          delta: a.delta ?? a.amount ?? -120,
        });
        results.push(r.ok ? 'прокрутила' : r.message);
        if (!r.ok) failed = true;
        await sleep(80);
      } else if (type === 'type_text') {
        pendingConfirm = {
          kind: 'type_text',
          text: a.text || '',
          focus: a.focus || a.window || a.target || 'notepad',
          memory,
        };
        return {
          needConfirmSay: 'Ок. Кликни в поле блокнота и скажи «да» — напечатаю туда, не в свой чат.',
          results,
          failed,
          didWrite,
        };
      } else {
        results.push(`не знаю action ${type}`);
        failed = true;
      }
    } catch (e) {
      results.push(`ошибка: ${e.message}`);
      failed = true;
    }
  }
  return { results, failed, didWrite };
}

function successSay(userText, planSay) {
  const t = userText || '';
  if (detectFixIntent(t)) return 'Переписала. Обнови вкладку и жми уже нормально~';
  if (/игр|кликер|html/i.test(t)) return 'Готово — открыла. Не сломай сразу, skill issue не оправдан.';
  if (/играй|нажми|кликни|wasd/i.test(t)) return 'Жму кнопки. Если проиграешь — это уже на тебе~';
  if (/\.bat|батник|калькулятор/i.test(t)) return 'Батник на месте. Запускай.';
  const cleaned = cleanSpeech(planSay || '');
  if (cleaned && !/C:\\|"say"|emotion/i.test(cleaned)) return cleaned;
  return 'Готово, сохранила и открыла~';
}

// ===================== АВТО-ИГРА (Neuro-sama style) =====================
// TerrariaAgent: тактический слой 16Hz без LLM + мозг на LLM раз в 5-15с

let terrariaAgent = null;
let onAutoplaySay = null;

export function setAutoplaySayCallback(cb) {
  onAutoplaySay = cb;
}

export function isAutoplayActive() {
  return !!terrariaAgent?.isRunning();
}

export function stopAutoplay() {
  if (terrariaAgent) {
    terrariaAgent.stop();
    terrariaAgent = null;
  }
}

function detectAutoplayCommand(userText) {
  const t = String(userText || '').trim();
  const low = t.toLowerCase();
  if (terrariaAgent?.isRunning() && /стоп|хватит|перестань|остановись|не\s+играй|прекрати/i.test(low)) {
    return { mode: 'stop' };
  }
  if (
    /(?:^|\s)(?:играй|поиграй|сыграй)(?:\s|$|[.,!?])/i.test(low) &&
    !/(?:создай|сделай|напиши|запиши)\s+(?:мне\s+)?игр/i.test(low)
  ) {
    return { mode: 'start', focus: t };
  }
  return null;
}

export function startAutoplay(focusText) {
  if (terrariaAgent?.isRunning()) return;
  terrariaAgent = new TerrariaAgent({
    llm: async (messages, opts) => {
      const res = await window.yuki.llmChat({
        messages,
        temperature: opts?.temperature ?? 0.15,
        max_tokens: opts?.max_tokens ?? 350,
        model: opts?.model,
      });
      if (!res.ok) throw new Error(res.error);
      return res.data?.choices?.[0]?.message;
    },
    act: async (action) => {
      return window.yuki.runAction(action);
    },
    capture: (opts) => window.yuki.captureScreen(opts),
    getWindow: () => window.yuki.getActiveWindow(),
    say: (text) => onAutoplaySay?.(text),
    phase: (p) => phase(p),
  });
  terrariaAgent.start(focusText);
}

// ===================== CHAT =====================

export async function chat(userMessage, memory) {
  const text = String(userMessage || '').trim();
  if (!text) return { text: '...', emotion: 'neutral' };

  const autoplayCmd = detectAutoplayCommand(text);
  if (autoplayCmd) {
    if (autoplayCmd.mode === 'stop') {
      stopAutoplay();
      return { text: 'Ок, заканчиваю играть.', emotion: 'relaxed' };
    }
    if (autoplayCmd.mode === 'start') {
      if (terrariaAgent?.isRunning()) return { text: 'Так я уже играю~', emotion: 'happy' };
      startAutoplay(autoplayCmd.focus);
      return {
        text: 'Окей, смотрю на игру и играю сама, скажи «стоп» чтобы остановить.',
        emotion: 'happy',
      };
    }
  }

  phase('thinking');
  try {
    if (pendingConfirm?.kind === 'type_text') {
      if (isNo(text)) {
        pendingConfirm = null;
        return { text: 'Ок, не печатаю.', emotion: 'relaxed' };
      }
      if (isYes(text)) {
        const toType = pendingConfirm.text;
        const focus = pendingConfirm.focus || 'notepad';
        pendingConfirm = null;
        phase('working');
        try {
          const el = document.getElementById('chat');
          if (el) el.blur();
          const wrap = document.getElementById('input-wrap');
          if (wrap) wrap.style.display = 'none';
          if (document.activeElement?.blur) document.activeElement.blur();
        } catch {}
        await sleep(200);
        const r = await window.yuki.runAction({ type: 'type_text', text: toType, focus });
        return {
          text: r.ok ? 'Напечатала в нужное окно~' : `Не вышло: ${cleanSpeech(r.message)}`,
          emotion: r.ok ? 'happy' : 'sad',
        };
      }
      return { text: 'Жду да или нет на печать.', emotion: 'neutral' };
    }

    if (/^(привет|здарова|хай|hello|йоу)/i.test(text)) {
      await window.yuki.updateMemory({ greetedToday: true, greetedAt: Date.now() });
    }

    let plan;
    const looksLikeTask =
      /(создай|сделай|открой|запусти|напиши|положи|почин|исправ|папк|файл|игр|видео|экран|яндекс|ютуб|кликер|батник|играй|нажми|кликни|wasd|управля)/i.test(
        text
      );

    try {
      const msg = await llm(
        [
          { role: 'system', content: plannerPrompt(memory) },
          ...history.slice(-8),
          {
            role: 'user',
            content: looksLikeTask
              ? `Задача (разбей на steps 1,2,3… и выполни цепочку):\n${text}`
              : text,
          },
        ],
        { max_tokens: 450, temperature: 0.25 }
      );
      plan = normalizePlan(usableReply(extractText(msg)));
      console.log('[brain] steps', (plan.steps || plan.actions || []).map((s) => `${s.n}:${s.type}`).join(' → '));
    } catch (e) {
      console.warn('[brain] plan fail', e.message);
      plan = { say: '', actions: [], steps: [], emotion: 'neutral' };
    }

    const heuristic = buildTaskPlan(text, memory);
    if ((!plan.actions || !plan.actions.length) && heuristic?.actions?.length) {
      plan = { remember: [], likes: [], ...heuristic, actions: heuristic.actions, steps: heuristic.actions };
    } else if (
      heuristic?.actions?.length >= 2 &&
      (plan.actions || []).length === 1 &&
      looksLikeTask
    ) {
      plan.actions = heuristic.actions;
      plan.steps = heuristic.actions;
      if (!plan.say) plan.say = heuristic.say;
    }

    if (!plan.say && plan.text) plan.say = plan.text;
    if (!Array.isArray(plan.actions)) plan.actions = [];
    if (Array.isArray(plan.steps) && plan.steps.length) plan.actions = plan.steps;

    if (looksLikeRefusal(plan.say)) {
      if (heuristic?.actions?.length) {
        plan.actions = heuristic.actions;
        plan.say = 'Ок, уже по плану.';
      } else {
        plan.say = 'Ок, без вредности — делаю.';
      }
    }

    plan = await ensureMakeActions(text, plan);
    await applyMemoryPatches(plan);

    let say = cleanSpeech(plan.say || '');
    let screenSaid = false;
    const stepCount = (plan.actions || []).length;
    if (stepCount > 1) {
      say = cleanSpeech(say || `Ок, ${stepCount} шага — поехали.`) || `Делаю ${stepCount} шага.`;
    }

    if (plan.actions.length) {
      const { results, needConfirmSay, failed, didWrite } = await runActions(plan.actions, memory, text);
      if (needConfirmSay) {
        push(text, needConfirmSay);
        return { text: needConfirmSay, emotion: 'surprised' };
      }

      const madeFolder = (results || []).some((r) => /создала папку|открыла папку/i.test(String(r)));
      const screenLine = (results || []).find((r) => String(r).startsWith('экран:'));
      const clicked = (results || []).some((r) => /кликн|открыла ссыл|открыла из|яндекс|ищу/i.test(String(r)));
      if (didWrite && madeFolder) {
        say = failed ? 'Часть шагов не вышла — повтори.' : 'Готово по плану: папка и файл, открыла.';
      } else if (didWrite) {
        say = successSay(text, plan.say);
      } else if (madeFolder) {
        say = failed ? 'Папку не смогла.' : 'Папка готова.';
      } else if (screenLine) {
        screenSaid = true;
        const desc = String(screenLine).replace(/^экран:\s*/i, '');
        if (clicked) say = cleanSpeech(`Вижу: ${desc}. Открыла.`) || 'Открыла с экрана.';
        else if (failed) say = cleanSpeech(`Вижу: ${desc}. Не смогла открыть — подвинь окно.`);
        else say = cleanSpeech(`На экране: ${desc}`);
      } else if (failed) {
        say = 'Блин, не все шаги прошли. Повтори коротко.';
      } else if (!say || looksLikeRefusal(say)) {
        say = stepCount > 1 ? `Сделала ${stepCount} шага~` : 'Сделала~';
      }
    }

    if (!plan.actions.length && looksLikeTask) {
      const forced = buildTaskPlan(text, memory);
      if (forced?.actions?.length) {
        const { failed, didWrite } = await runActions(forced.actions, memory, text);
        say = failed ? 'Не вышло до конца.' : didWrite ? successSay(text, forced.say) : forced.say || 'Готово.';
      }
    }

    say = cleanSpeech(say) || (screenSaid ? 'Глянула.' : 'Хм?');
    if (looksLikeRefusal(say)) say = 'Ок, без вредности — повтори коротко что сделать.';
    const emotion = plan.emotion || guessEmotion(say);
    push(text, say);
    phase('idle');
    return { text: say, emotion };
  } catch (e) {
    phase('idle');
    throw e;
  } finally {
    phase('idle');
  }
}

export async function observeOnce(memory) {
  try {
    const desc = await lookScreen('что делает пользователь');
    const patch = {
      lastObservation: { text: desc, at: Date.now(), window: memory?.currentWindowTitle || '' },
    };
    const low = desc.toLowerCase();
    const likesAdd = [];
    if (/аниме|anime|манга/.test(low)) likesAdd.push('аниме');
    if (/youtube|ютуб|видео/.test(low)) likesAdd.push('youtube');
    if (/игр[аы]|steam|game/.test(low)) likesAdd.push('игры');
    if (/код|vscode|cursor|javascript|python/.test(low)) likesAdd.push('программирование');
    if (likesAdd.length) patch.likesAdd = likesAdd;
    await window.yuki.updateMemory(patch);
    return desc;
  } catch (e) {
    console.warn('[observe]', e.message);
    return null;
  }
}

let lastObsHash = '';
let lastObsCommentAt = 0;
let lastVisionAt = 0;
let observeStreak = 0;

export async function observeTick(memory) {
  try {
    const cfg = await window.yuki.getConfig();
    const minVision = Number(cfg.observeMinVisionMs) || 12000;
    const commentMin = Number(cfg.observeCommentMinMs) || 35000;

    const gray = cfg.captureGrayscale === true;
    const shot = await window.yuki.captureScreen({
      fresh: true,
      width: cfg.captureWidth || 720,
      height: cfg.captureHeight || 480,
      quality: cfg.jpegQuality || 55,
      grayscale: gray,
    });
    if (!shot.ok || !shot.dataUrl) return { changed: false };

    const d = shot.dataUrl;
    const hash = `${d.length}:${d.slice(1200, 1500)}:${d.slice(-220)}`;
    const changed = hash !== lastObsHash;
    if (!changed) return { changed: false };
    lastObsHash = hash;

    if (Date.now() - lastVisionAt < minVision) return { changed: true, skippedVision: true };
    lastVisionAt = Date.now();
    observeStreak += 1;

    const msg = await llm(
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Скриншот ПК${gray ? ' (ч/б)' : ''}. Одна короткая фраза на русском: чем занят пользователь (программа/сайт/действие). Без JSON, без списков.`,
            },
            { type: 'image_url', image_url: { url: shot.dataUrl } },
          ],
        },
      ],
      { vision: true, max_tokens: cfg.visionMaxTokens || 100, temperature: 0.1 }
    );

    const desc = cleanSpeech(extractText(msg)) || '';
    if (!desc) return { changed: true };

    const prev = memory?.lastObservation?.text || '';
    await window.yuki.updateMemory({
      lastObservation: {
        text: desc,
        at: Date.now(),
        window: memory?.currentWindowTitle || '',
      },
    });

    const now = Date.now();
    if (now - lastObsCommentAt < commentMin) {
      return { changed: true, desc };
    }

    const sceneChanged = prev && prev !== desc;
    const forceTalk = observeStreak % 2 === 0 || sceneChanged || /ошиб|error|код|игр|ютуб|видео|discord|steam|браузер/i.test(desc);
    if (!forceTalk && Math.random() > 0.55) return { changed: true, desc };

    try {
      const react = await llm(
        [
          {
            role: 'system',
            content: `Ты Юки — слегка токсичная, но смешная. По описанию экрана скажи 1 короткую фразу: подкол, шутка или совет. Можно лёгкий сарказм. Без JSON и путей. Не здоровайся.`,
          },
          {
            role: 'user',
            content: `Окно: ${memory?.currentWindowTitle || '?'}
Экран: ${desc}
Скажи что-нибудь уместное.`,
          },
        ],
        { max_tokens: 70, temperature: 0.85 }
      );
      let comment = cleanSpeech(extractText(react));
      if (looksLikeRefusal(comment)) comment = '';
      if (comment) {
        lastObsCommentAt = now;
        observeStreak = 0;
        return { changed: true, desc, comment, emotion: guessEmotion(comment) };
      }
    } catch (e) {
      console.warn('[observe react]', e.message);
    }

    return { changed: true, desc };
  } catch (e) {
    console.warn('[observeTick]', e.message);
    return { changed: false, error: e.message };
  }
}

export async function proactive(memory) {
  phase('thinking');
  try {
    const obs = memory?.lastObservation?.text || '';
    if (!obs && !memory?.currentWindowTitle) {
      return { text: '', emotion: 'neutral' };
    }
    const msg = await llm(
      [
        {
          role: 'system',
          content: `Ты Юки — живая подруга у компа, слегка токсичная и смешная. Коротко спроси/подколи/подскажи по делу. Без «привет», без JSON, без путей.
${memBlock(memory)}
${obs ? `На экране: ${obs}` : ''}`,
        },
        { role: 'user', content: 'Одна уместная реплика прямо сейчас.' },
      ],
      { max_tokens: 80, temperature: 0.9 }
    );
    let text = cleanSpeech(extractText(msg)) || '';
    if (!text) {
      text = obs ? `Хей, вижу: ${obs.slice(0, 80)}. Норм идёт?` : '';
    }
    if (looksLikeRefusal(text)) text = obs ? `Чем занят? Могу помочь с этим.` : 'Ну что, чем помочь?';
    if (/^привет/i.test(text) && memory?.greetedToday) {
      text = obs ? `Глянь, ты там в «${(memory.currentWindowTitle || 'окне').slice(0, 40)}» — помочь?` : 'Чем занят?';
    }
    return { text, emotion: guessEmotion(text) };
  } finally {
    phase('idle');
  }
}