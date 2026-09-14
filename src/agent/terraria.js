/*
 * Terraria Agent v6 — Neuro-sama style
 *
 * Что нового:
 *  - План КОНКРЕТНЫЙ: press_key → move → move_mouse → chop
 *  - Модель пишет "наведи мышь на (x,y)" а не "иду к дереву"
 *  - Тактика раз в 500ms, только смерть/HP/враг. НЕ спамит Space.
 *  - move_mouse и press_key — полноценные действия
 *  - duration до 15 сек (длинные move — это НОРМА)
 */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function textOf(message) {
  if (!message) return '';
  if (typeof message === 'string') return message;
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((x) => x?.text || '').join(' ');
  }
  return message.text || message.reasoning_content || '';
}

function jsonOf(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1].trim() : s;
  try { return JSON.parse(source); } catch (_) {}
  let depth = 0, begin = -1, inString = false, escaped = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') { inString = true; continue; }
    if (c === '{') { if (depth === 0) begin = i; depth++; }
    else if (c === '}') {
      depth--;
      if (depth === 0 && begin >= 0) {
        try { return JSON.parse(source.slice(begin, i + 1)); } catch (_) {}
        begin = -1;
      }
    }
  }
  return null;
}

const DEFAULT_STATE = {
  alive: true,
  hp: null,
  hpMax: null,
  mana: null,
  screen: 'unknown',
  player: { visible: false, x: 0.5, y: 0.5, direction: 'right', onGround: true },
  enemies: [],
  npc: [],
  target: { kind: 'none', x: 0.5, y: 0.5 },
  resources: [],
  inventoryVisible: false,
  boss: { visible: false, name: '', x: 0.5, y: 0.5 },
  terrain: { wallAhead: false, gapAhead: false, slope: 'flat' },
  death: false,
  menu: false,
  text: '',
};

export class TerrariaAgent {
  constructor({ llm, act, capture, getWindow, say, phase } = {}) {
    this.llm = llm;
    this.act = act;
    this.capture = capture;
    this.getWindow = getWindow;
    this.say = say || (() => {});
    this.phase = phase || (() => {});

    this.running = false;
    this.loopPromise = null;
    this.startedAt = 0;

    // === VISION ===
    this.lastVision = 0;
    this.minVisionInterval = 5000;      // скрин не чаще 5 сек
    this.lastState = structuredClone(DEFAULT_STATE);
    this.prevState = null;

    // === МОЗГ ===
    this.lastDecisionAt = 0;
    this.minDecisionInterval = 3000;
    this.currentDecision = null;
    this.currentGoal = null;

    // === ТАКТИКА ===
    this.tacticalInterval = 500;         // 2 Hz вместо 16 Hz — не спамит
    this.tacticalPausedUntil = 0;
    this.lastTacticalAt = 0;

    // === ПАМЯТЬ ===
    this.recentActions = [];
    this.history = [];

    this.stats = {
      deaths: 0, bosses: 0, actions: 0,
      decisions: 0, visions: 0, tactical: 0,
      startedAt: 0,
    };

    this.mode = 'bootstrap';
    this.hint = '';
    this.lastDamageAt = 0;
    this.lastHp = null;
  }

  isRunning() { return this.running; }

  start(focus = '') {
    if (this.running) return false;
    this.running = true;
    this.startedAt = Date.now();
    this.stats.startedAt = this.startedAt;
    this.stats.actions = 0;
    this.stats.decisions = 0;
    this.stats.visions = 0;
    this.stats.tactical = 0;
    this.currentDecision = null;
    this.currentGoal = null;
    this.recentActions = [];
    this.mode = 'bootstrap';
    this.hint = String(focus || '');

    this.loopPromise = this.loop().catch((e) => {
      console.warn('[TerrariaAgent]', e.message);
      this.say('У меня сломался игровой цикл.');
      this.stop();
    });
    return true;
  }

  stop() {
    this.running = false;
    this.currentDecision = null;
    this.currentGoal = null;
    this.mode = 'stopped';
  }

  addHint(text) {
    const t = String(text || '').trim();
    if (!t) return 'Скажи конкретнее.';
    this.hint = `${this.hint ? this.hint + ' | ' : ''}${t}`.slice(-1500);
    this.say(`Приняла: ${t.slice(0, 150)}`);
    return 'Подсказку передала.';
  }

  // =========================================================
  // ТАКТИКА — ТОЛЬКО ЭКСТРЕННОЕ. Без спама.
  // =========================================================

  async tacticalTick() {
    if (!this.running) return false;
    const now = Date.now();
    if (now < this.tacticalPausedUntil) return false;
    if (now - this.lastTacticalAt < this.tacticalInterval) return false;
    this.lastTacticalAt = now;

    const s = this.lastState;
    if (!s) return false;

    // 1. СМЕРТЬ
    if (s.death || s.screen === 'death' || s.alive === false) {
      this.stats.tactical++;
      this.say('Возрождаюсь.');
      await this.press('enter', 80);
      await sleep(1600);
      this.tacticalPausedUntil = Date.now() + 1500;
      return true;
    }

    // 2. HP < 15% — хилка + отход
    const hp = Number(s.hp);
    const hpMax = Number(s.hpMax);
    if (Number.isFinite(hp) && Number.isFinite(hpMax) && hpMax > 0 && hp / hpMax < 0.15) {
      this.stats.tactical++;
      await this.press('h', 60);
      await sleep(80);
      await this.act({ type: 'key_hold', key: 'a', holdMs: 500 });
      return true;
    }

    // 3. Враг вплотную (не босс)
    const enemies = s.enemies || [];
    const near = enemies.find((e) => e.distance === 'near');
    if (near && !s.boss?.visible) {
      this.stats.tactical++;
      const px = s.player?.x ?? 0.5;
      const dir = near.x < px ? 'a' : 'd';
      await this.act({ type: 'key_hold', key: dir, holdMs: 200 });
      await this.act({ type: 'mouse_hold', button: 'left', holdMs: 600 });
      return true;
    }

    return false;
  }

  // =========================================================
  // VISION
  // =========================================================

  async vision(force = false) {
    const now = Date.now();
    if (!force && now - this.lastVision < this.minVisionInterval) {
      return this.lastState;
    }
    this.lastVision = now;
    this.stats.visions++;

    const shot = await this.capture({
      fresh: true,
      width: 640,
      height: 360,
      quality: 55,
      grayscale: false,
    });

    if (!shot?.ok) return this.lastState;

    const prompt = `
Ты СЕНСОР игры Terraria. Опиши что реально видно на скриншоте.
НЕ ПЛАНИРУЙ. НЕ ПРИДУМЫВАЙ.

Ответ ТОЛЬКО JSON:

{
  "screen":"world" | "inventory" | "menu" | "death" | "unknown",
  "alive":true,
  "hp":100,
  "hpMax":100,
  "player":{"visible":true,"x":0.5,"y":0.5,"direction":"left|right","onGround":true},
  "enemies":[{"x":0.7,"y":0.5,"distance":"near|mid|far","boss":false}],
  "npc":[{"x":0.3,"y":0.5,"kind":"guide|merchant|other"}],
  "target":{"kind":"none|tree|ore|item|chest|npc|enemy","x":0.5,"y":0.5},
  "boss":{"name":"","visible":false,"x":0.5,"y":0.5},
  "terrain":{"wallAhead":false,"gapAhead":false,"slope":"flat|up|down"},
  "inventoryVisible":false,
  "text":""
}

Координаты x/y от 0 до 1 (0=левый/верхний край).
Если объекта нет — target.kind="none".
ВАЖНО: не переноси старую цель. Если дерева больше не видно — target.kind="none".
`;

    try {
      const msg = await this.llm(
        [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: shot.dataUrl } },
          ],
        }],
        { vision: true, max_tokens: 250, temperature: 0.01 }
      );

      const parsed = jsonOf(textOf(msg));
      if (parsed) {
        this.prevState = this.lastState;
        this.lastState = this.mergeState(parsed);
        this.detectEvents();
      }
    } catch (e) {
      console.warn('[Terraria vision]', e.message);
    }
    return this.lastState;
  }

  mergeState(p) {
    return {
      ...DEFAULT_STATE,
      ...this.lastState,
      ...p,
      player: { ...this.lastState.player, ...(p.player || {}) },
      terrain: { ...this.lastState.terrain, ...(p.terrain || {}) },
      enemies: Array.isArray(p.enemies) ? p.enemies.slice(0, 8) : [],
      npc: Array.isArray(p.npc) ? p.npc.slice(0, 8) : [],
      target: p.target || { kind: 'none', x: 0.5, y: 0.5 },
      boss: p.boss || { visible: false, name: '', x: 0.5, y: 0.5 },
    };
  }

  detectEvents() {
    const s = this.lastState;
    const old = this.prevState;

    if ((s.death || s.screen === 'death' || s.alive === false) &&
        !(old?.death || old?.screen === 'death' || old?.alive === false)) {
      this.stats.deaths++;
      this.say(`Умерла. Смерть №${this.stats.deaths}.`);
    }

    if (s.boss?.visible && !old?.boss?.visible) {
      this.stats.bosses++;
      this.say('Босс!');
    }

    this.history.push(structuredClone(s));
    if (this.history.length > 12) this.history.shift();
  }

  // =========================================================
  // МОЗГ — КОНКРЕТНЫЙ ПЛАН
  // =========================================================

  async decision() {
    const now = Date.now();
    if (now - this.lastDecisionAt < this.minDecisionInterval) return null;
    this.lastDecisionAt = now;

    const s = this.lastState;
    let windowTitle = '';
    try { windowTitle = await this.getWindow(); } catch (_) {}

    const recent = this.recentActions.slice(-10).map((a) => `- ${a}`).join('\n') || '(пока пусто)';

    const prompt = `
Ты управляешь персонажем в Terraria. Ты ОПЫТНЫЙ игрок.
Пиши КОНКРЕТНЫЙ план из шагов: какая клавиша, сколько держать, куда мышь.

==================================================
ФОРМАТ (ТОЛЬКО JSON):
==================================================
{
  "goal":"срубить дерево справа",
  "ttlMs":12000,
  "say":"беру топор и рублю дерево",
  "actions":[
    {"action":"press_key","key":"3"},
    {"action":"move","direction":"right","duration":2500},
    {"action":"move_mouse","x":0.72,"y":0.45},
    {"action":"chop","duration":2500},
    {"action":"move","direction":"right","duration":2000}
  ]
}

==================================================
ДЕЙСТВИЯ (все конкретные):
==================================================
{"action":"move","direction":"left|right","duration":2000}       — держать A/D
{"action":"jump","duration":100}                                  — Space
{"action":"press_key","key":"1|2|3|4|5|h|e|escape|enter"}         — нажать клавишу
{"action":"move_mouse","x":0.5,"y":0.5}                           — навести мышь (0..1)
{"action":"chop","duration":2000}                                 — держать ЛКМ (рубить/копать)
{"action":"attack","duration":1500}                               — держать ЛКМ (враг)
{"action":"wait","duration":300}

==================================================
ПРАВИЛА (ОЧЕНЬ ВАЖНО):
==================================================
1. СНАЧАЛА наведи мышь — ПОТОМ руби:
   {"action":"move_mouse","x":0.72,"y":0.45} → {"action":"chop","duration":2500}

2. Перед рубкой дерева выбери топор: {"action":"press_key","key":"3"}

3. Двигайся ДОЛГО — 2000-3000ms. Не 200ms. Один длинный move лучше 20 коротких.

4. Если "move right" повторялся 3 раза — смени на "left" или "jump".

5. say — комментарий для игрока. actions — реальные команды.
   Если в say пишешь "рублю дерево", в actions ДОЛЖЕН быть chop.

6. ЛОГИКА:
   - Видишь дерево/руду → press_key "3" → move к нему 2000 → move_mouse к стволу → chop 2500
   - Видишь врага → move_mouse к врагу → attack 1500 → move away 800
   - Ничего нет → ИССЛЕДУЙ: move right 3000 (или left если уже ходил вправо)
   - Пещера внизу → move down через прыжки/ходьбу

7. ttlMs: 5000..20000. Должен покрывать сумму duration.

8. Максимум 8 действий.

==================================================
КОНТЕКСТ:
==================================================
Окно: ${windowTitle}
Подсказка: ${this.hint || 'нет'}
Смертей: ${this.stats.deaths}
${this.currentGoal ? `Активная цель: ${this.currentGoal.text}` : ''}

Состояние:
${JSON.stringify(s)}

Последние действия:
${recent}
`;

    try {
      const msg = await this.llm(
        [
          { role: 'system', content: 'Ты игровой AI Terraria. Пиши КОНКРЕТНЫЕ шаги. Отвечай только JSON.' },
          { role: 'user', content: prompt },
        ],
        { max_tokens: 500, temperature: 0.2 }
      );

      const raw = textOf(msg);
      const parsed = jsonOf(raw);

      if (!parsed || !Array.isArray(parsed.actions)) {
        console.warn('[Terraria decision] Bad JSON:', raw?.slice(0, 200));
        return null;
      }

      const actions = parsed.actions.filter((a) => this.validateAction(a)).slice(0, 8);
      if (!actions.length) {
        console.warn('[Terraria decision] no valid actions from', JSON.stringify(parsed.actions).slice(0, 200));
        return null;
      }

      this.stats.decisions++;
      const ttl = Math.max(5000, Math.min(20000, Number(parsed.ttlMs) || 10000));

      const goalText = String(parsed.goal || '').slice(0, 150) || 'действовать';
      this.currentGoal = {
        text: goalText,
        until: Date.now() + ttl,
      };

      const result = {
        goal: goalText,
        ttlMs: ttl,
        say: String(parsed.say || '').slice(0, 150),
        emotion: parsed.emotion || 'neutral',
        actions,
        _execIdx: 0,
      };

      this.currentDecision = result;
      console.log('[Terraria PLAN]', result.goal, `ttl=${ttl}ms`, JSON.stringify(actions));
      if (result.say) this.say(result.say);
      return result;
    } catch (e) {
      console.warn('[Terraria decision]', e.message);
      return null;
    }
  }

  validateAction(a) {
    if (!a || typeof a !== 'object') return false;
    const action = String(a.action || '').toLowerCase();
    const allowed = ['move', 'jump', 'attack', 'chop', 'mine', 'use', 'wait', 'move_to', 'attack_at', 'move_mouse', 'press_key'];
    if (!allowed.includes(action)) return false;

    if (action === 'move_mouse') {
      const x = Number(a.x), y = Number(a.y);
      if (!Number.isFinite(x) || x < 0 || x > 1) return false;
      if (!Number.isFinite(y) || y < 0 || y > 1) return false;
      return true;
    }

    if (action === 'press_key') {
      const k = String(a.key || '').toLowerCase();
      if (!k) return false;
      if (!/^([1-9]|[a-z]|enter|escape|space|shift|tab|f([1-9]|1[0-2]))$/.test(k)) return false;
      return true;
    }

    const duration = Number(a.duration);
    if (!Number.isFinite(duration) || duration < 100 || duration > 15000) return false;

    if (action === 'move' && !['left', 'right'].includes(a.direction)) return false;
    if (action === 'use' && !['h','e','escape','1','2','3','4'].includes(String(a.key))) return false;
    if ((action === 'move_to' || action === 'attack_at')) {
      const x = Number(a.x);
      if (!Number.isFinite(x) || x < 0 || x > 1) return false;
    }
    return true;
  }

  // =========================================================
  // EXECUTION
  // =========================================================

  async executeAction(a) {
    if (!a) return false;
    const action = String(a.action || '').toLowerCase();
    const duration = Math.max(100, Math.min(Number(a.duration) || 500, 15000));

    this.stats.actions++;
    const label = `${action}${a.key ? ' ' + a.key : ''}${a.direction ? ' ' + a.direction : ''}${a.duration ? ' ' + duration + 'ms' : ''}${a.x != null ? ` (${a.x},${a.y})` : ''}`;
    this.recentActions.push(label);
    if (this.recentActions.length > 30) this.recentActions.shift();
    console.log('[exec]', label);

    // --- move: длинное движение сегментами ---
    if (action === 'move') {
      const key = a.direction === 'left' ? 'a' : 'd';
      let remaining = duration;
      while (remaining > 0 && this.running) {
        const chunk = Math.min(1500, remaining);
        await this.act({ type: 'key_hold', key, holdMs: chunk });
        remaining -= chunk;
        if (this.lastState.death || this.lastState.alive === false) return true;
        if (remaining > 0) await sleep(30);
      }
      return true;
    }

    if (action === 'jump') {
      await this.press('space', duration);
      return true;
    }

    if (action === 'press_key') {
      await this.act({ type: 'press_key', key: String(a.key), holdMs: 60 });
      await sleep(120);
      return true;
    }

    if (action === 'move_mouse') {
      await this.act({ type: 'move_mouse', x: Number(a.x), y: Number(a.y) });
      await sleep(80);
      return true;
    }

    if (action === 'attack') {
      await this.act({ type: 'mouse_hold', button: 'left', holdMs: duration });
      return true;
    }

    if (action === 'chop' || action === 'mine') {
      await this.act({ type: 'mouse_hold', button: 'left', holdMs: duration });
      return true;
    }

    if (action === 'use') {
      await this.press(String(a.key), duration);
      return true;
    }

    if (action === 'wait') {
      await sleep(duration);
      return true;
    }

    if (action === 'move_to') {
      const targetX = Number(a.x);
      let elapsed = 0;
      while (elapsed < duration && this.running) {
        const px = this.lastState.player?.x ?? 0.5;
        const diff = targetX - px;
        if (Math.abs(diff) < 0.06) break;
        const key = diff < 0 ? 'a' : 'd';
        const chunk = Math.min(500, duration - elapsed);
        await this.act({ type: 'key_hold', key, holdMs: chunk });
        elapsed += chunk;
        if (this.lastState.death || this.lastState.alive === false) return true;
      }
      return true;
    }

    if (action === 'attack_at') {
      const px = this.lastState.player?.x ?? 0.5;
      const targetX = Number(a.x);
      const dir = targetX < px ? 'a' : 'd';
      if (Math.abs(targetX - px) > 0.1) {
        await this.act({ type: 'key_hold', key: dir, holdMs: 250 });
      }
      await this.act({ type: 'mouse_hold', button: 'left', holdMs: duration });
      return true;
    }

    return false;
  }

  async press(key, holdMs = 80) {
    await this.act({ type: 'press_key', key, holdMs });
  }

  // =========================================================
  // MAIN LOOP
  // =========================================================

  async loop() {
    this.phase('working');
    await this.focusGame();
    await this.vision(true);

    let decision = await this.decision();
    let decisionStartedAt = Date.now();
    let lastVisionAt = Date.now();

    while (this.running) {
      if (Date.now() - this.startedAt > 1000 * 60 * 60 * 12) break;

      // ТАКТИКА (смерть/HP/враг) — раз в 500ms
      const tactical = await this.tacticalTick().catch(() => false);
      if (tactical) {
        await sleep(50);
        // после тактики план не сбрасываем — продолжаем
        continue;
      }

      // ЕСЛИ НЕТ РЕШЕНИЯ — ПОЛУЧИТЬ
      if (!decision || !decision.actions?.length) {
        if (Date.now() - lastVisionAt > 2500) {
          await this.vision(true);
          lastVisionAt = Date.now();
        }
        decision = await this.decision();
        decisionStartedAt = Date.now();
        if (!decision) {
          await sleep(400);
          continue;
        }
      }

      // ВЫПОЛНЯЕМ ОДНО ДЕЙСТВИЕ ИЗ СЕРИИ
      const idx = decision._execIdx || 0;
      if (idx >= decision.actions.length) {
        // серия кончилась — новое решение
        if (Date.now() - lastVisionAt > 3000) {
          await this.vision(true);
          lastVisionAt = Date.now();
        }
        decision = await this.decision();
        decisionStartedAt = Date.now();
        continue;
      }

      const action = decision.actions[idx];
      decision._execIdx = idx + 1;

      if (this.lastState.death || this.lastState.alive === false) {
        decision = null;
        continue;
      }

      await this.executeAction(action);
      await sleep(80);
    }

    this.stop();
    this.phase('idle');
  }

  async focusGame() {
    try {
      await this.act({ type: 'focus_window', focus: 'Terraria' });
    } catch (_) {}
  }
}