const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  screen,
  dialog,
  desktopCapturer,
  shell,
  session,
  nativeImage,
  globalShortcut,
} = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const { exec } = require('child_process');
const os = require('os');
const { URL } = require('url');

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));

function loadSecrets() {
  try {
    const p = path.join(__dirname, 'secrets.json');
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {}
  return {};
}

function getGeminiKey() {
  return (
    process.env.YUKI_GEMINI_API_KEY ||
    loadSecrets().geminiApiKey ||
    CONFIG.geminiApiKey ||
    ''
  ).trim();
}

function getSecret(name, envName) {
  const s = loadSecrets();
  return (process.env[envName] || s[name] || CONFIG[name] || '').trim();
}

function isQuotaError(err) {
  const m = String(err?.message || err || '').toLowerCase();
  return /429|quota|rate.?limit|resource.?exhausted|too many requests|billing|exceeded/i.test(m);
}

/** OpenAI-совместимый чат: OpenRouter / Groq / DeepSeek */
function callOpenAICompat(baseUrl, apiKey, payload, label = 'API') {
  return new Promise((resolve, reject) => {
    const u = new URL(baseUrl.replace(/\/$/, '') + '/chat/completions');
    const bodyObj = {
      model: payload.model,
      messages: payload.messages,
      temperature: payload.temperature ?? CONFIG.temperature ?? 0.7,
      max_tokens: payload.max_tokens ?? CONFIG.chatMaxTokens ?? 400,
      stream: false,
    };
    // vision: messages уже в openai формате с image_url
    const body = JSON.stringify(bodyObj);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'http:' ? 80 : 443),
        path: u.pathname + u.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://yuki-neurona.local',
          'X-Title': 'Yuki Neurona',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 90000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`${label} HTTP ${res.statusCode}: ${raw.slice(0, 280)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`${label} parse: ${e.message}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error(`${label} timeout`)));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function callProvider(name, payload) {
  const n = String(name || '').toLowerCase();
  if (n === 'gemini') return callGemini(payload);
  if (n === 'lmstudio') {
    const hasVision = (payload.messages || []).some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((p) => p?.type === 'image_url' || p?.type === 'input_audio')
    );
    const model =
      payload.model ||
      (hasVision ? CONFIG.visionModel : CONFIG.textModel || CONFIG.agentModel) ||
      undefined;
    return callLm({
      model,
      messages: payload.messages,
      temperature: payload.temperature ?? CONFIG.temperature,
      max_tokens: payload.max_tokens ?? (hasVision ? CONFIG.visionMaxTokens : CONFIG.chatMaxTokens) ?? 200,
      stream: false,
    }, hasVision ? 180000 : 120000);
  }
  if (n === 'openrouter') {
    const key = getSecret('openrouterApiKey', 'YUKI_OPENROUTER_API_KEY');
    if (!key) throw new Error('Нет openrouterApiKey в secrets.json');
    const hasMedia = (payload.messages || []).some(
      (m) => Array.isArray(m.content) && m.content.some((p) => p?.type === 'image_url' || p?.type === 'input_audio')
    );
    return callOpenAICompat(
      'https://openrouter.ai/api/v1',
      key,
      {
        ...payload,
        model:
          payload.model ||
          (hasMedia
            ? CONFIG.openrouterVisionModel || CONFIG.openrouterModel || 'google/gemini-2.0-flash-exp:free'
            : CONFIG.openrouterModel || 'google/gemini-2.0-flash-exp:free'),
      },
      'OpenRouter'
    );
  }
  if (n === 'groq') {
    const key = getSecret('groqApiKey', 'YUKI_GROQ_API_KEY');
    if (!key) throw new Error('Нет groqApiKey в secrets.json');
    // Groq — быстрый текст; vision ограничен
    return callOpenAICompat(
      'https://api.groq.com/openai/v1',
      key,
      { ...payload, model: payload.model || CONFIG.groqModel || 'llama-3.3-70b-versatile' },
      'Groq'
    );
  }
  if (n === 'deepseek') {
    const key = getSecret('deepseekApiKey', 'YUKI_DEEPSEEK_API_KEY');
    if (!key) throw new Error('Нет deepseekApiKey в secrets.json');
    return callOpenAICompat(
      'https://api.deepseek.com',
      key,
      { ...payload, model: payload.model || CONFIG.deepseekModel || 'deepseek-chat' },
      'DeepSeek'
    );
  }
  throw new Error(`Unknown provider: ${name}`);
}

async function callWithFallback(payload) {
  const primary = (CONFIG.provider || 'gemini').toLowerCase();
  const chain = [primary];
  const fb = CONFIG.providerFallback;
  // Строго: только primary + список из config (gemini → groq, без lmstudio и т.п.)
  if (Array.isArray(fb)) {
    chain.push(...fb.map((x) => String(x).toLowerCase()).filter(Boolean));
  } else if (fb && fb !== 'none') {
    chain.push(String(fb).toLowerCase());
  }

  const hasVision = (payload.messages || []).some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p?.type === 'image_url' || p?.type === 'input_audio' || p?.type === 'audio_url')
  );

  const tried = [];
  let lastErr = null;
  for (const name of chain) {
    if (tried.includes(name)) continue;
    tried.push(name);
    try {
      if (name === 'gemini' && !getGeminiKey()) continue;
      if (name === 'openrouter' && !getSecret('openrouterApiKey', 'YUKI_OPENROUTER_API_KEY')) continue;
      if (name === 'groq' && !getSecret('groqApiKey', 'YUKI_GROQ_API_KEY')) continue;
      if (name === 'deepseek' && !getSecret('deepseekApiKey', 'YUKI_DEEPSEEK_API_KEY')) continue;
      // Groq — только текст; скрины остаются на Gemini
      if (name === 'groq' && hasVision) {
        console.warn('[LLM] skip groq for vision');
        continue;
      }
      console.log('[LLM] try', name);
      const data = await callProvider(name, payload);
      console.log('[LLM] ok via', name);
      return { data, provider: name };
    } catch (e) {
      lastErr = e;
      console.warn('[LLM]', name, 'fail:', e.message);
      // На следующий (Groq) — только при квоте/лимите
      if (isQuotaError(e)) continue;
      throw e;
    }
  }
  throw lastErr || new Error('Все провайдеры недоступны');
}

let win = null;
const memoryPath = path.join(__dirname, 'memory.json');

function loadMemory() {
  try {
    return JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
  } catch {
    return { facts: [], modelPath: null, flipModel: false, windowWidth: 360, windowHeight: 640 };
  }
}

function saveMemory(patch) {
  const mem = { ...loadMemory() };
  const p = patch || {};
  // likesAdd: merge unique likes without wiping the rest of memory
  if (Array.isArray(p.likesAdd) && p.likesAdd.length) {
    const likes = Array.isArray(mem.likes) ? mem.likes.slice() : [];
    for (const raw of p.likesAdd) {
      const s = String(raw || '').trim().toLowerCase();
      if (s && !likes.includes(s)) likes.push(s);
    }
    mem.likes = likes.slice(-24);
    delete p.likesAdd;
  }
  Object.assign(mem, p);
  // reset "greeted today" after midnight-ish (12h)
  if (mem.greetedAt && Date.now() - Number(mem.greetedAt) > 12 * 3600 * 1000) {
    mem.greetedToday = false;
  }
  fs.writeFileSync(memoryPath, JSON.stringify(mem, null, 2), 'utf8');
  return mem;
}

function resolveModel() {
  const mem = loadMemory();
  const candidates = [
    mem.modelPath,
    path.join(__dirname, 'Yuki.vrm'),
    path.join(__dirname, 'model', 'Yuki.vrm'),
    path.join(__dirname, 'models', 'Yuki.vrm'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

let uiPort = 0;

function modelToHttpUrl(absPath) {
  if (!absPath) return null;
  if (/^https?:\/\//i.test(absPath)) return absPath;
  const port = uiPort || 0;
  if (!port) return null;
  const resolved = path.resolve(absPath);
  const rel = path.relative(__dirname, resolved);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
    return `http://127.0.0.1:${port}/${rel.split(path.sep).join('/')}`;
  }
  // модель вне папки проекта — через спец-URL
  return `http://127.0.0.1:${port}/__yuki_model?t=${Date.now()}`;
}

function sendLoadModel(target, absPath) {
  const url = modelToHttpUrl(absPath);
  console.log('[VRM] load', absPath, '->', url);
  if (!url) {
    target.send('no-model');
    return;
  }
  target.send('load-model', url);
}

function createStaticServer() {
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.vrm': 'model/gltf-binary',
    '.glb': 'model/gltf-binary',
    '.wasm': 'application/wasm',
  };
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      try {
        let u = decodeURIComponent((req.url || '/').split('?')[0]);
        if (u === '/') u = '/index.html';

        // VRM вне корня проекта
        if (u === '/__yuki_model') {
          const mp = resolveModel();
          if (!mp || !fs.existsSync(mp)) {
            res.writeHead(404);
            res.end('model missing');
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'model/gltf-binary',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
          });
          fs.createReadStream(mp).pipe(res);
          return;
        }

        const fp = path.normalize(path.join(__dirname, u.replace(/^\//, '')));
        const root = path.resolve(__dirname).toLowerCase();
        if (!path.resolve(fp).toLowerCase().startsWith(root)) {
          res.writeHead(403);
          res.end('forbidden');
          return;
        }
        if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
          res.writeHead(404);
          res.end('not found');
          return;
        }
        const ext = path.extname(fp).toLowerCase();
        res.writeHead(200, {
          'Content-Type': types[ext] || 'application/octet-stream',
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(fp).pipe(res);
      } catch (e) {
        res.writeHead(500);
        res.end(String(e.message || e));
      }
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

let topmostTimer = null;
let pttHoldTimer = null;

function assertTopmost() {
  if (!win || win.isDestroyed()) return;
  try {
    win.setAlwaysOnTop(true, 'screen-saver', 1);
    win.moveTop();
  } catch {}
}

/** На время ввода в игру/окно — отпустить alwaysOnTop у Юки. */
async function releaseTopmostBriefly(ms = 700) {
  let prevTop = false;
  try {
    if (win && !win.isDestroyed()) {
      prevTop = win.isAlwaysOnTop();
      win.setAlwaysOnTop(false);
      try {
        win.blur();
      } catch {}
    }
  } catch {}
  await new Promise((r) => setTimeout(r, ms));
  try {
    if (win && !win.isDestroyed() && prevTop) assertTopmost();
  } catch {}
}

function startTopmostKeeper() {
  clearInterval(topmostTimer);
  const ms = Math.max(800, Number(CONFIG.topmostRefreshMs) || 1800);
  topmostTimer = setInterval(assertTopmost, ms);
}

/** Пока идёт запись голоса (пробел/Alt+Y зажаты) — не дёргаем setAlwaysOnTop/moveTop.
 *  Периодический topmost-рефреш может вызвать blur окна, а Chromium на blur
 *  сбрасывает физически зажатые клавиши (защита от «залипания») — из-за этого
 *  запись обрывалась сама через пару секунд, даже пока пробел реально держали. */
ipcMain.on('recording-state', (_e, isRecording) => {
  if (isRecording) {
    clearInterval(topmostTimer);
    topmostTimer = null;
  } else if (win && !win.isDestroyed()) {
    startTopmostKeeper();
  }
});

function stopGlobalPttHoldWatch() {
  if (pttHoldTimer) {
    clearInterval(pttHoldTimer);
    pttHoldTimer = null;
  }
}

/** Удержание Alt+Y — PTT даже когда игра перехватила фокус. */
function watchGlobalPttHold() {
  stopGlobalPttHoldWatch();
  if (!win || win.isDestroyed()) return;
  win.webContents.send('global-ptt', 'down');
  pttHoldTimer = setInterval(() => {
    exec(
      `powershell -NoProfile -Command "Add-Type -Name K -Namespace W -MemberDefinition '[DllImport(\\\"user32.dll\\\")]public static extern short GetAsyncKeyState(int v);'; $a=([W.K]::GetAsyncKeyState(0x12)-band 0x8000)-ne 0; $y=([W.K]::GetAsyncKeyState(0x59)-band 0x8000)-ne 0; if($a -and $y){'HOLD'}else{'UP'}"`,
      { windowsHide: true, timeout: 1200 },
      (_err, stdout) => {
        const s = String(stdout || '').trim();
        if (s === 'UP') {
          stopGlobalPttHoldWatch();
          if (win && !win.isDestroyed()) win.webContents.send('global-ptt', 'up');
        }
      }
    );
  }, 45);
}

function registerGlobalShortcuts() {
  try {
    globalShortcut.unregisterAll();
  } catch {}
  const accel = String(CONFIG.globalPttShortcut || 'Alt+Y').trim();
  try {
    const ok = globalShortcut.register(accel, () => watchGlobalPttHold());
    if (!ok) console.warn('[Yuki] global shortcut not registered:', accel);
    else console.log('[Yuki] global PTT:', accel);
  } catch (e) {
    console.warn('[Yuki] globalShortcut fail', e.message);
  }
  try {
    globalShortcut.register('Control+Shift+Space', () => {
      if (!win || win.isDestroyed()) return;
      win.webContents.send('global-ptt', 'toggle');
    });
  } catch {}
}

function createWindow(localPort) {
  uiPort = localPort;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const mem = loadMemory();
  const w = Number(mem.windowWidth) || 360;
  const h = Number(mem.windowHeight) || 640;

  win = new BrowserWindow({
    width: w,
    height: h,
    minWidth: 200,
    minHeight: 320,
    x: width - w - 24,
    y: height - h - 24,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: true,
    hasShadow: false,
    skipTaskbar: true,
    focusable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  assertTopmost();
  startTopmostKeeper();
  win.on('blur', () => setTimeout(assertTopmost, 120));
  win.on('show', assertTopmost);
  // http://127.0.0.1 нужен, иначе микрофон на file:// часто мертв
  win.loadURL(`http://127.0.0.1:${localPort}/`);

  let resizeTimer = null;
  win.on('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (!win) return;
      const [nw, nh] = win.getSize();
      saveMemory({ windowWidth: nw, windowHeight: nh });
    }, 400);
  });

  win.webContents.once('did-finish-load', async () => {
    win.webContents.send('set-model-flip', !!loadMemory().flipModel);
    const model = resolveModel();
    if (model) {
      sendLoadModel(win.webContents, model);
      return;
    }
    win.webContents.send('no-model');
    const result = await dialog.showOpenDialog(win, {
      title: 'Выбери VRM-модель',
      properties: ['openFile'],
      filters: [{ name: 'VRM', extensions: ['vrm'] }],
    });
    if (!result.canceled && result.filePaths[0]) {
      saveMemory({ modelPath: result.filePaths[0] });
      sendLoadModel(win.webContents, result.filePaths[0]);
    }
  });
}

app.whenReady().then(async () => {
  saveMemory({ appRoot: __dirname });

  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    if (permission === 'media' || permission === 'microphone' || permission === 'audioCapture') {
      callback(true);
      return;
    }
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
    return permission === 'media' || permission === 'microphone' || permission === 'audioCapture';
  });

  const srv = await createStaticServer();
  const port = srv.address().port;
  console.log('[Yuki] local UI http://127.0.0.1:' + port);
  createWindow(port);
  registerGlobalShortcuts();
});
app.on('window-all-closed', () => {
  stopGlobalPttHoldWatch();
  clearInterval(topmostTimer);
  try {
    globalShortcut.unregisterAll();
  } catch {}
  if (process.platform !== 'darwin') app.quit();
});
app.on('will-quit', () => {
  stopGlobalPttHoldWatch();
  try {
    globalShortcut.unregisterAll();
  } catch {}
});

// ——— UI ———
ipcMain.on('move-window', (_e, dx, dy) => {
  if (!win) return;
  const [x, y] = win.getPosition();
  win.setPosition(x + dx, y + dy);
});

ipcMain.handle('focus-app', async () => {
  if (!win || win.isDestroyed()) return false;
  try {
    win.show();
    assertTopmost();
    win.focus();
    return true;
  } catch {
    return false;
  }
});

ipcMain.on('show-menu', (event) => {
  const mem = loadMemory();
  Menu.buildFromTemplate([
    { label: '💬 Текст (пузырь)', click: () => event.sender.send('input-mode', 'text') },
    { label: '🎤 Голос (без пузыря)', click: () => event.sender.send('input-mode', 'voice') },
    {
      label: mem.wakeWordEnabled === false ? '🔇 Wake «Юки» выкл' : '👂 Wake «Юки» вкл',
      click: () => {
        const enabled = mem.wakeWordEnabled !== false;
        const updated = saveMemory({ wakeWordEnabled: !enabled });
        event.sender.send('wake-word-toggle', updated.wakeWordEnabled !== false);
      },
    },
    { type: 'separator' },
    {
      label: mem.flipModel ? '↩ Развернуть обратно' : '🔄 Развернуть 180°',
      click: () => {
        const updated = saveMemory({ flipModel: !mem.flipModel });
        event.sender.send('set-model-flip', !!updated.flipModel);
      },
    },
    {
      label: 'Загрузить VRM…',
      click: async () => {
        const result = await dialog.showOpenDialog(win, {
          properties: ['openFile'],
          filters: [{ name: 'VRM', extensions: ['vrm'] }],
        });
        if (!result.canceled && result.filePaths[0]) {
          saveMemory({ modelPath: result.filePaths[0] });
          sendLoadModel(event.sender, result.filePaths[0]);
        }
      },
    },
    { type: 'separator' },
    { label: 'Перезапуск', click: () => win.reload() },
    { label: 'Выход', click: () => app.quit() },
  ]).popup({ window: win });
});

// ——— Cloud LLM (Gemini) + optional LM Studio fallback ———
function httpsJson(method, urlStr, bodyObj, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const body = bodyObj == null ? null : JSON.stringify(bodyObj);
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`Gemini HTTP ${res.statusCode}: ${raw.slice(0, 280)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`Gemini parse: ${e.message}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Gemini timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function openaiMessagesToGemini(messages) {
  let systemText = '';
  const contents = [];
  for (const m of messages || []) {
    if (m.role === 'system') {
      systemText += (systemText ? '\n' : '') + (typeof m.content === 'string' ? m.content : '');
      continue;
    }
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = [];
    if (typeof m.content === 'string') {
      parts.push({ text: m.content });
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (typeof p === 'string') parts.push({ text: p });
        else if (p?.type === 'text' && p.text) parts.push({ text: p.text });
        else if (p?.type === 'image_url' && p.image_url?.url) {
          const url = p.image_url.url;
          const m64 = url.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
          if (m64) {
            parts.push({ inlineData: { mimeType: m64[1], data: m64[2] } });
          }
        } else if (p?.type === 'input_audio' && p.input_audio?.data) {
          const mime = p.input_audio.format || p.input_audio.mimeType || 'audio/webm';
          parts.push({ inlineData: { mimeType: mime, data: p.input_audio.data } });
        } else if (p?.type === 'audio_url' && p.audio_url?.url) {
          const url = p.audio_url.url;
          const m64 = url.match(/^data:(audio\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
          if (m64) parts.push({ inlineData: { mimeType: m64[1], data: m64[2] } });
        }
      }
    }
    if (!parts.length) continue;
    // Gemini: consecutive same roles merge
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  }
  // Must start with user
  if (contents.length && contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '(start)' }] });
  }
  return { systemText, contents };
}

async function callGemini(payload) {
  const key = getGeminiKey();
  if (!key || key === 'PASTE_YOUR_KEY_HERE') {
    throw new Error('Нет Gemini API key. Создай secrets.json — см. CLOUD.md');
  }
  const hasImage = (payload.messages || []).some(
    (m) =>
      Array.isArray(m.content) &&
      m.content.some((p) => p?.type === 'image_url' || p?.type === 'input_audio' || p?.type === 'audio_url')
  );
  const model =
    payload.model ||
    (hasImage ? CONFIG.geminiVisionModel : CONFIG.geminiModel) ||
    'gemini-3.5-flash-lite';

  const { systemText, contents } = openaiMessagesToGemini(payload.messages);
  if (!contents.length) throw new Error('Пустые messages');

  const body = {
    contents,
    generationConfig: {
      temperature: payload.temperature ?? CONFIG.temperature ?? 0.75,
      maxOutputTokens: payload.max_tokens ?? CONFIG.chatMaxTokens ?? 220,
    },
  };
  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  console.log('[Gemini] model=', model, 'parts=', contents.length);
  const data = await httpsJson('POST', url, body, 90000);

  const parts = data?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || '').join('').trim();
  const finish = data?.candidates?.[0]?.finishReason;
  console.log('[Gemini] textLen=', text.length, 'finish=', finish);

  // OpenAI-compatible shape for renderer/brain
  return {
    choices: [
      {
        message: { role: 'assistant', content: text || '' },
        finish_reason: finish || 'stop',
      },
    ],
    usage: data?.usageMetadata,
  };
}

function callLm(payload, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: CONFIG.lmStudioPort || 1234,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: timeoutMs,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`LM HTTP ${res.statusCode}: ${raw.slice(0, 220)}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(new Error(`LM parse: ${e.message}`));
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('LM timeout — модель думает слишком долго')));
    req.on('error', (e) => reject(e));
    req.write(body);
    req.end();
  });
}

ipcMain.handle('llm-chat', async (_e, payload) => {
  try {
    const { data, provider } = await callWithFallback(payload);
    const msg = data?.choices?.[0]?.message;
    console.log('[LLM] ok via=', provider, 'contentLen=', String(msg?.content || '').length);
    return { ok: true, data, provider };
  } catch (e) {
    console.error('[LLM] fail', e.message);
    return { ok: false, error: e.message };
  }
});

/** Распознать речь из base64-аудио через Gemini */
ipcMain.handle('transcribe-audio', async (_e, payload) => {
  try {
    const b64 = String(payload?.base64 || '').replace(/^data:[^;]+;base64,/, '');
    const mime = String(payload?.mimeType || 'audio/webm').split(';')[0];
    if (!b64 || b64.length < 80) return { ok: false, error: 'пустое аудио', text: '' };
    const data = await callGemini({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Распознай русскую речь. Верни ТОЛЬКО текст фразы, без кавычек и пояснений. Если тишина/шум — верни пустую строку.',
            },
            { type: 'input_audio', input_audio: { data: b64, format: mime } },
          ],
        },
      ],
      max_tokens: 120,
      temperature: 0,
      model: CONFIG.geminiVisionModel || CONFIG.geminiModel,
    });
    let text = String(data?.choices?.[0]?.message?.content || '').trim();
    text = text.replace(/^["«]+|["»]+$/g, '').trim();
    console.log('[STT]', text.slice(0, 80));
    return { ok: true, text };
  } catch (e) {
    console.error('[STT] fail', e.message);
    return { ok: false, error: e.message, text: '' };
  }
});

ipcMain.handle('get-config', async () => {
  const key = getGeminiKey();
  return {
    ...CONFIG,
    hasGeminiKey: !!(key && key !== 'PASTE_YOUR_KEY_HERE'),
    hasOpenRouter: !!getSecret('openrouterApiKey', 'YUKI_OPENROUTER_API_KEY'),
    hasGroq: !!getSecret('groqApiKey', 'YUKI_GROQ_API_KEY'),
    hasDeepSeek: !!getSecret('deepseekApiKey', 'YUKI_DEEPSEEK_API_KEY'),
    geminiApiKey: key ? `${key.slice(0, 6)}…` : '',
  };
});

// ——— Screen (лёгкий: 720×480, ч/б JPEG) ———
let shotCache = null;
let shotAt = 0;

function toGrayscaleJpeg(nativeImg, quality) {
  try {
    const size = nativeImg.getSize();
    const w = size.width;
    const h = size.height;
    const buf = nativeImg.toBitmap();
    for (let i = 0; i < buf.length; i += 4) {
      // BGRA → gray
      const g = (buf[i] * 0.114 + buf[i + 1] * 0.587 + buf[i + 2] * 0.299) | 0;
      buf[i] = g;
      buf[i + 1] = g;
      buf[i + 2] = g;
    }
    const gray = nativeImage.createFromBitmap(buf, { width: w, height: h });
    return gray.toJPEG(quality);
  } catch (e) {
    console.warn('[capture] grayscale fail, color jpeg', e.message);
    return nativeImg.toJPEG(quality);
  }
}

ipcMain.handle('capture-screen', async (_e, opts = {}) => {
  try {
    const now = Date.now();
    const width = Math.min(960, Math.max(480, Number(opts?.width) || Number(CONFIG.captureWidth) || 720));
    const height = Math.min(720, Math.max(270, Number(opts?.height) || Number(CONFIG.captureHeight) || 480));
    const quality = Math.min(70, Math.max(35, Number(opts?.quality) || Number(CONFIG.jpegQuality) || 48));
    const gray = opts.grayscale != null ? !!opts.grayscale : CONFIG.captureGrayscale !== false;
    const cacheMs = Number(CONFIG.captureCacheMs) || 2000;
    if (!opts.fresh && shotCache && now - shotAt < cacheMs) {
      return { ok: true, dataUrl: shotCache, width, height, grayscale: gray };
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
    });
    if (!sources.length) return { ok: false, error: 'no screen' };
    const thumb = sources[0].thumbnail;
    const jpegBuf = gray ? toGrayscaleJpeg(thumb, quality) : thumb.toJPEG(quality);
    const dataUrl = `data:image/jpeg;base64,${jpegBuf.toString('base64')}`;
    shotCache = dataUrl;
    shotAt = now;
    console.log('[capture]', width, 'x', height, 'q=', quality, 'gray=', gray, 'bytes≈', jpegBuf.length);
    return { ok: true, dataUrl, width, height, grayscale: gray };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ——— TTS ———
function callTts(text) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ text });
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port: CONFIG.ttsPort || 8009,
        path: '/speak',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 35000,
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => (raw += c));
        res.on('end', () => {
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`TTS ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('TTS timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

ipcMain.handle('tts-speak', async (_e, text) => {
  try {
    const data = await callTts(text);
    const b64 = data.audio_base64 || data.audioBase64;
    if (!b64) throw new Error('empty audio');
    return { ok: true, audioBase64: b64, format: data.format || 'mp3' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ——— Memory ———
ipcMain.handle('get-memory', async () => loadMemory());
ipcMain.handle('update-memory', async (_e, patch) => saveMemory(patch || {}));
ipcMain.handle('add-fact', async (_e, text) => {
  const mem = loadMemory();
  const facts = Array.isArray(mem.facts) ? mem.facts.slice() : [];
  facts.push({ text: String(text), at: Date.now() });
  return saveMemory({ facts: facts.slice(-40) });
});

// ——— Desktop actions ———
const PROGRAMS = {
  steam: 'start steam://open/main',
  discord: 'start "" discord:',
  telegram: 'start "" tg:',
  spotify: 'start "" spotify:',
  explorer: 'start explorer',
  проводник: 'start explorer',
  notepad: 'start notepad',
  блокнот: 'start notepad',
  calc: 'start calc',
  калькулятор: 'start calc',
  cmd: 'start cmd',
  powershell: 'start powershell',
};

const SITES = {
  youtube: 'https://www.youtube.com',
  ютуб: 'https://www.youtube.com',
  google: 'https://www.google.com',
  гугл: 'https://www.google.com',
  vk: 'https://vk.com',
  вк: 'https://vk.com',
  github: 'https://github.com',
  twitch: 'https://www.twitch.tv',
  yandex: 'https://ya.ru',
  яндекс: 'https://ya.ru',
};

function runCmd(cmd) {
  return new Promise((resolve) => {
    exec(cmd, { windowsHide: true, timeout: 20000 }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err?.message });
    });
  });
}

/** Достаёт известный сайт из свободной фразы: «мне пж ютуб» → youtube */
function resolveSiteUrl(input) {
  const raw = String(input || '').trim();
  const key = raw.toLowerCase();
  if (!key) return null;
  if (SITES[key]) return SITES[key];
  if (/^https?:\/\//i.test(raw)) return raw;
  if (/^[\w.-]+\.(com|ru|org|net|io|tv)(\/.*)?$/i.test(key)) return `https://${key}`;
  // длинные ключи первыми (ютуб до «ю»)
  const names = Object.keys(SITES).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (key.includes(name)) return SITES[name];
  }
  return null;
}

function resolveProgramCmd(input) {
  const key = String(input || '').toLowerCase().trim();
  if (!key) return null;
  if (PROGRAMS[key]) return { cmd: PROGRAMS[key], label: key };
  const names = Object.keys(PROGRAMS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (key.includes(name)) return { cmd: PROGRAMS[name], label: name };
  }
  return null;
}

async function openUrl(input) {
  const url = resolveSiteUrl(input);
  if (!url) return { ok: false, message: `Не поняла сайт: ${input}` };
  await shell.openExternal(url);
  return { ok: true, message: `Открыла ${url}` };
}

async function openProgram(name) {
  const resolved = resolveProgramCmd(name);
  if (resolved) {
    const r = await runCmd(resolved.cmd);
    return { ok: r.ok, message: r.ok ? `Запустила ${resolved.label}` : `Не смогла запустить ${resolved.label}` };
  }
  // Только короткое «чистое» имя — не вся фраза «мне пж …»
  const clean = String(name || '').trim();
  if (!clean || clean.length > 40 || /\s{2,}/.test(clean) || /^(мне|пж|пожалуйста|давай|открой|запусти)\b/i.test(clean)) {
    return { ok: false, message: `Не нашла программу в «${name}»` };
  }
  const safe = clean.replace(/"/g, '');
  const r = await runCmd(`start "" "${safe}"`);
  if (r.ok) return { ok: true, message: `Запустила ${safe}` };
  const r2 = await runCmd(`start ${safe.toLowerCase()}`);
  return { ok: r2.ok, message: r2.ok ? `Запустила ${safe}` : `Не нашла программу «${name}»` };
}

/** Активирует чужое окно (не Юки), потом SendKeys туда. */
async function focusWindow(match) {
  const needle = String(match || '').trim();
  const tmp = path.join(os.tmpdir(), `yuki-focus-${Date.now()}.ps1`);
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class YukiWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$needle = @'
${needle.replace(/'/g, "''")}
'@
$procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle }
$hit = $null
if ($needle) {
  $hit = $procs | Where-Object { $_.MainWindowTitle -match [regex]::Escape($needle) -or $_.MainWindowTitle -like ("*"+$needle+"*") } | Select-Object -First 1
  if (-not $hit) {
    $hit = $procs | Where-Object { $_.ProcessName -match $needle } | Select-Object -First 1
  }
}
if (-not $hit) {
  $hit = $procs | Where-Object {
    $_.MainWindowTitle -match 'Notepad|Блокнот|notepad|\\.bat|\\.txt|Visual Studio Code|Cursor' -and
    $_.MainWindowTitle -notmatch 'Yuki|Neurona'
  } | Select-Object -First 1
}
if (-not $hit) { Write-Output "NO_WINDOW"; exit 2 }
$h = $hit.MainWindowHandle
if ([YukiWin]::IsIconic($h)) { [void][YukiWin]::ShowWindow($h, 9) } else { [void][YukiWin]::ShowWindow($h, 5) }
Start-Sleep -Milliseconds 120
[void][YukiWin]::SetForegroundWindow($h)
Start-Sleep -Milliseconds 180
Write-Output ("OK:" + $hit.MainWindowTitle)
`;
  try {
    fs.writeFileSync(tmp, script, 'utf8');
    const r = await runCmd(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`);
    const out = (r.stdout || '').trim();
    if (!r.ok || out.startsWith('NO_') || !out.startsWith('OK:')) {
      return { ok: false, message: `Не нашла окно «${needle || 'редактор'}»` };
    }
    return { ok: true, message: out.slice(3), title: out.slice(3) };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

/** Печать в целевое окно: сначала фокус туда, не в чат Юки. */
async function typeText(text, opts = {}) {
  const t = String(text || '');
  if (!t) return { ok: false, message: 'Пустой текст' };

  // Юки alwaysOnTop — на мгновение отпустить, иначе фокус не уйдёт
  let prevTop = false;
  try {
    if (win && !win.isDestroyed()) {
      prevTop = win.isAlwaysOnTop();
      win.setAlwaysOnTop(false);
      try {
        win.blur();
      } catch {}
    }
  } catch {}

  const focus = await focusWindow(opts.focus || opts.window || '');
  if (!focus.ok) {
    try {
      if (win && !win.isDestroyed() && prevTop) win.setAlwaysOnTop(true);
    } catch {}
    return focus;
  }

  await new Promise((r) => setTimeout(r, 250));

  const forKeys = t.replace(/[+\^%~()[\]{}]/g, (ch) => {
    if (ch === '{') return '{{';
    if (ch === '}') return '}}';
    return `{${ch}}`;
  }).replace(/\r?\n/g, '{ENTER}');

  const tmp = path.join(os.tmpdir(), `yuki-type-${Date.now()}.ps1`);
  const script = `Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 200
$t = @'
${forKeys.replace(/'@/g, "'@'")}
'@
[System.Windows.Forms.SendKeys]::SendWait($t)
`;
  try {
    fs.writeFileSync(tmp, script, 'utf8');
    const r = await runCmd(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`);
    return {
      ok: r.ok,
      message: r.ok ? `Напечатала в «${focus.title}»` : `Не смогла напечатать: ${r.error || r.stderr}`,
    };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    try {
      if (win && !win.isDestroyed() && prevTop) {
        setTimeout(() => {
          try {
            win.setAlwaysOnTop(true);
          } catch {}
        }, 800);
      }
    } catch {}
  }
}

async function searchWeb(query) {
  const q = encodeURIComponent(String(query || '').trim());
  const url = `https://www.google.com/search?q=${q}`;
  await shell.openExternal(url);
  return { ok: true, message: `Ищу: ${query}` };
}

function getActiveWindowTitle() {
  return new Promise((resolve) => {
    const ps = `powershell -NoProfile -Command "(Get-Process | Where-Object {$_.MainWindowTitle} | Sort-Object -Property Responding -Descending | Select-Object -First 1).MainWindowTitle"`;
    exec(ps, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      resolve((stdout || '').trim() || null);
    });
  });
}

const VK = {
  backspace: 0x08,
  tab: 0x09,
  enter: 0x0d,
  escape: 0x1b,
  space: 0x20,
  shift: 0x10,
  ctrl: 0x11,
  alt: 0x12,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  f1: 0x70,
  f2: 0x71,
  f3: 0x72,
  f4: 0x73,
  f5: 0x74,
  f6: 0x75,
  f7: 0x76,
  f8: 0x77,
  f9: 0x78,
  f10: 0x79,
  f11: 0x7a,
  f12: 0x7b,
};

function resolveVk(key) {
  const k = String(key || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
  if (!k) return null;
  if (VK[k] != null) return VK[k];
  if (/^[a-z0-9]$/.test(k)) return k.toUpperCase().charCodeAt(0);
  if (/^f(1[0-2]|[1-9])$/.test(k)) return VK[k];
  const aliases = {
    пробел: 'space',
    энтер: 'enter',
    enter: 'enter',
    esc: 'escape',
    стрелкаup: 'up',
    стрелкаdown: 'down',
    стрелкаleft: 'left',
    стрелкаright: 'right',
    shift: 'shift',
    ctrl: 'ctrl',
    control: 'ctrl',
    alt: 'alt',
  };
  const ali = aliases[k];
  if (ali && VK[ali] != null) return VK[ali];
  return null;
}

function psInputScript(body) {
  const tmp = path.join(os.tmpdir(), `yuki-input-${Date.now()}.ps1`);
  fs.writeFileSync(tmp, body, 'utf8');
  return tmp;
}

async function runPsInput(scriptBody) {
  const tmp = psInputScript(scriptBody);
  try {
    const r = await runCmd(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`);
    const out = (r.stdout || '').trim();
    return { ok: r.ok && !out.startsWith('ERR:'), out, r };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

/** Нажатие клавиши (SendInput) — для игр и окон. */
async function pressKey(key, opts = {}) {
  const vk = resolveVk(key);
  if (vk == null) return { ok: false, message: `Не знаю клавишу «${key}»` };
  const holdMs = Math.min(8000, Math.max(0, Number(opts.holdMs) || 40));
  await releaseTopmostBriefly(120);
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class YukiSend {
  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public int type; public InputUnion u; }
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion {
    [FieldOffset(0)] public KEYBDINPUT ki;
    [FieldOffset(0)] public MOUSEINPUT mi;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)]
  public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);
  public const int INPUT_KEYBOARD = 1;
  public const uint KEYEVENTF_KEYUP = 0x0002;
  public static void KeyDown(ushort vk) {
    INPUT[] a = new INPUT[1];
    a[0].type = INPUT_KEYBOARD;
    a[0].u.ki.wVk = vk;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void KeyUp(ushort vk) {
    INPUT[] a = new INPUT[1];
    a[0].type = INPUT_KEYBOARD;
    a[0].u.ki.wVk = vk;
    a[0].u.ki.dwFlags = KEYEVENTF_KEYUP;
    SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@
[YukiSend]::KeyDown(${vk})
Start-Sleep -Milliseconds ${holdMs}
[YukiSend]::KeyUp(${vk})
Write-Output "OK"
`;
  const r = await runPsInput(script);
  return { ok: r.ok, message: r.ok ? `нажала ${key}` : `клавиша не вышла: ${r.r?.error || r.r?.stderr || ''}` };
}

async function keyCombo(keys) {
  const list = (Array.isArray(keys) ? keys : String(keys || '').split(/[+,\s]+/))
    .map((k) => resolveVk(k))
    .filter((v) => v != null);
  if (!list.length) return { ok: false, message: 'Пустое сочетание клавиш' };
  await releaseTopmostBriefly(120);
  const down = list.map((vk) => `[YukiIn]::keybd_event([byte]${vk}, 0, 0, [UIntPtr]::Zero)`).join('\n');
  const up = [...list]
    .reverse()
    .map((vk) => `[YukiIn]::keybd_event([byte]${vk}, 0, [YukiIn]::KEYUP, [UIntPtr]::Zero)`)
    .join('\n');
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class YukiIn {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  public const uint KEYUP = 0x2;
}
"@
${down}
Start-Sleep -Milliseconds 60
${up}
Write-Output "OK"
`;
  const r = await runPsInput(script);
  return { ok: r.ok, message: r.ok ? 'сочетание нажато' : `combo fail: ${r.r?.error || ''}` };
}

async function moveMouseNorm(nx, ny) {
  const nxx = Math.min(0.98, Math.max(0.02, Number(nx) || 0.5));
  const nyy = Math.min(0.98, Math.max(0.02, Number(ny) || 0.5));
  const disp = screen.getPrimaryDisplay();
  const b = disp.bounds;
  const x = Math.round(b.x + b.width * nxx);
  const y = Math.round(b.y + b.height * nyy);
  await releaseTopmostBriefly(80);
  const script = `
Add-Type @"
using System.Runtime.InteropServices;
public class YukiMouse {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
}
"@
[YukiMouse]::SetCursorPos(${x}, ${y})
Write-Output "OK:${x},${y}"
`;
  const r = await runPsInput(script);
  return {
    ok: r.ok && String(r.out).startsWith('OK:'),
    message: r.ok ? `мышь ${x},${y}` : 'мышь не двинулась',
    x,
    y,
  };
}

async function scrollWheel(delta = -120) {
  const d = Math.round(Number(delta) || -120);
  await releaseTopmostBriefly(80);
  const script = `
Add-Type @"
using System.Runtime.InteropServices;
public class YukiMouse {
  [DllImport("user32.dll")] public static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);
  public const int WHEEL = 0x0800;
}
"@
[YukiMouse]::mouse_event([YukiMouse]::WHEEL, 0, 0, ${d}, 0)
Write-Output "OK"
`;
  const r = await runPsInput(script);
  return { ok: r.ok, message: r.ok ? 'прокрутила' : 'скролл не вышел' };
}

/** Клик по экрану: x/y от 0..1 относительно primary display bounds */
async function clickScreenNorm(nx, ny, opts = {}) {
  const nxx = Math.min(0.98, Math.max(0.02, Number(nx) || 0.5));
  const nyy = Math.min(0.98, Math.max(0.02, Number(ny) || 0.5));
  const disp = screen.getPrimaryDisplay();
  const b = disp.bounds;
  const x = Math.round(b.x + b.width * nxx);
  const y = Math.round(b.y + b.height * nyy);
  const dbl = !!opts.double;

  let prevTop = false;
  try {
    if (win && !win.isDestroyed()) {
      prevTop = win.isAlwaysOnTop();
      win.setAlwaysOnTop(false);
      try {
        win.blur();
      } catch {}
    }
  } catch {}

  const tmp = path.join(os.tmpdir(), `yuki-click-${Date.now()}.ps1`);
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class YukiClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public int type; public InputUnion u; }
  [StructLayout(LayoutKind.Explicit)] public struct InputUnion { [FieldOffset(0)] public MOUSEINPUT mi; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);
  public const int INPUT_MOUSE = 0;
  public const uint LEFTDOWN = 0x0002;
  public const uint LEFTUP = 0x0004;
  public static void LD() { INPUT[] a = new INPUT[1]; a[0].type = INPUT_MOUSE; a[0].u.mi.dwFlags = LEFTDOWN; SendInput(1, a, Marshal.SizeOf(typeof(INPUT))); }
  public static void LU() { INPUT[] a = new INPUT[1]; a[0].type = INPUT_MOUSE; a[0].u.mi.dwFlags = LEFTUP; SendInput(1, a, Marshal.SizeOf(typeof(INPUT))); }
}
"@
[YukiClick]::SetCursorPos(${x}, ${y})
Start-Sleep -Milliseconds 80
[YukiClick]::LD()
[YukiClick]::LU()
${dbl ? '[YukiClick]::LD()\n[YukiClick]::LU()' : ''}
Write-Output "OK:${x},${y}"
`;
  try {
    fs.writeFileSync(tmp, script, 'utf8');
    await new Promise((r) => setTimeout(r, 150));
    const r = await runCmd(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmp}"`);
    const out = (r.stdout || '').trim();
    return {
      ok: r.ok && out.startsWith('OK:'),
      message: r.ok ? `клик ${x},${y}` : `клик не вышел: ${r.error || r.stderr}`,
      x,
      y,
    };
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
    try {
      if (win && !win.isDestroyed() && prevTop) {
        setTimeout(() => {
          try {
            win.setAlwaysOnTop(true, 'screen-saver');
          } catch {}
        }, 600);
      }
    } catch {}
  }
}

ipcMain.handle('run-action', async (_e, action) => {
  try {
    switch (action?.type) {
      case 'open_url':
        return await openUrl(action.url || action.query || action.target);
      case 'open_program':
        return await openProgram(action.name || action.query || action.target);
      case 'search_web':
        return await searchWeb(action.query);
      case 'type_text':
        return await typeText(action.text || action.query || '', {
          focus: action.focus || action.window || action.target || '',
        });
      case 'focus_window':
        return await focusWindow(action.focus || action.window || action.target || action.query || '');
      case 'key_hold': {
        const vk = resolveVk(action.key);
        if (vk == null) return { ok: false, message: `не знаю клавишу ${action.key}` };
        const holdMs = Math.max(50, Math.min(15000, Number(action.holdMs) || 300));
        await releaseTopmostBriefly(80);
        const script = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class YukiSend {
        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public int type; public InputUnion u; }
        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion {
          [FieldOffset(0)] public KEYBDINPUT ki;
        }
        [StructLayout(LayoutKind.Sequential)]
        public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);
        public const int INPUT_KEYBOARD = 1;
        public const uint KEYEVENTF_KEYUP = 0x0002;
        public static void KeyDown(ushort vk) {
          INPUT[] a = new INPUT[1];
          a[0].type = INPUT_KEYBOARD;
          a[0].u.ki.wVk = vk;
          SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
        }
        public static void KeyUp(ushort vk) {
          INPUT[] a = new INPUT[1];
          a[0].type = INPUT_KEYBOARD;
          a[0].u.ki.wVk = vk;
          a[0].u.ki.dwFlags = KEYEVENTF_KEYUP;
          SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
        }
      }
      "@
      [YukiSend]::KeyDown(${vk})
      Start-Sleep -Milliseconds ${holdMs}
      [YukiSend]::KeyUp(${vk})
      Write-Output "OK"
      `;
        const r = await runPsInput(script);
        return { ok: r.ok, message: r.ok ? `держу ${action.key} ${holdMs}ms` : 'не вышло' };
      }

      case 'mouse_hold': {
        const holdMs = Math.max(50, Math.min(15000, Number(action.holdMs) || 500));
        await releaseTopmostBriefly(80);
        const script = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class YukiMouseSend {
        [StructLayout(LayoutKind.Sequential)]
        public struct INPUT { public int type; public InputUnion u; }
        [StructLayout(LayoutKind.Explicit)]
        public struct InputUnion {
          [FieldOffset(0)] public MOUSEINPUT mi;
        }
        [StructLayout(LayoutKind.Sequential)]
        public struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
        [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);
        public const int INPUT_MOUSE = 0;
        public const uint LEFTDOWN = 0x0002;
        public const uint LEFTUP = 0x0004;
        public static void LD() {
          INPUT[] a = new INPUT[1];
          a[0].type = INPUT_MOUSE;
          a[0].u.mi.dwFlags = LEFTDOWN;
          SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
        }
        public static void LU() {
          INPUT[] a = new INPUT[1];
          a[0].type = INPUT_MOUSE;
          a[0].u.mi.dwFlags = LEFTUP;
          SendInput(1, a, Marshal.SizeOf(typeof(INPUT)));
        }
      }
      "@
      [YukiMouseSend]::LD()
      Start-Sleep -Milliseconds ${holdMs}
      [YukiMouseSend]::LU()
      Write-Output "OK"
      `;
        const r = await runPsInput(script);
        return { ok: r.ok, message: r.ok ? `держу мышь ${holdMs}ms` : 'не вышло' };
      }
      case 'click_screen':
        return await clickScreenNorm(action.x, action.y, { double: !!action.double });
      case 'move_mouse':
        return await moveMouseNorm(action.x, action.y);
      case 'press_key':
        return await pressKey(action.key || action.keys, { holdMs: action.holdMs || action.hold });
      case 'key_combo':
        return await keyCombo(action.keys || action.key || action.combo);
      case 'scroll':
      case 'scroll_wheel':
        return await scrollWheel(action.delta ?? action.amount ?? -120);
      case 'make_folder': {
        const rawName = String(action.name || action.path || action.target || 'YukiFolder')
          .replace(/[<>:"/\\|?*\x00-\x1f]/g, '')
          .trim() || 'YukiFolder';
        const desks = desktopDirs();
        const desk = desks[0] || path.join(os.homedir(), 'Desktop');
        const full = path.join(desk, rawName);
        if (!isAllowedWritePath(full)) {
          return { ok: false, message: 'Сюда папку нельзя' };
        }
        fs.mkdirSync(full, { recursive: true });
        return { ok: true, message: 'создала папку', path: full };
      }
      case 'open_folder': {
        const p = action.path || action.query || os.homedir();
        await shell.openPath(p);
        return { ok: true, message: `Открыла папку ${p}` };
      }
      case 'open_path': {
        let p = action.path || action.target;
        if (p) p = resolveUserWritePath(p) || path.resolve(String(p));
        if (!p || !fs.existsSync(p)) return { ok: false, message: `Путь не найден: ${action.path}` };
        await shell.openPath(p);
        return { ok: true, message: `Открыла ${p}`, path: p };
      }
      default:
        return { ok: false, message: `Неизвестное действие: ${action?.type}` };
    }
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('get-active-window', async () => getActiveWindowTitle());

function isBlockedPath(p) {
  const n = path.resolve(p).toLowerCase();
  const bad = ['\\windows\\', '\\program files', '\\program files (x86)', '\\$recycle.bin'];
  if (bad.some((b) => n.includes(b))) return true;
  if (n === 'c:\\' || n === 'c:') return true;
  return false;
}

function desktopDirs() {
  const home = os.homedir();
  return [
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
  ].filter((p) => fs.existsSync(p));
}

function resolveUserWritePath(filePath) {
  let raw = String(filePath || '').trim().replace(/^["']|["']$/g, '');
  if (!raw) return null;
  raw = raw.replace(/\//g, '\\');

  const desks = desktopDirs();
  const desk = desks[0] || path.join(os.homedir(), 'Desktop');

  if (/^[a-zA-Z]:\\/.test(raw) || raw.startsWith('\\\\')) {
    return path.resolve(raw);
  }

  // Desktop\Foo\bar.html или Foo\bar.html → на рабочий стол с подпапками
  const cleaned = raw.replace(/^desktop[\\/]/i, '');
  // не сплющивать в один basename — сохраняем относительный путь
  return path.join(desk, cleaned);
}

function isAllowedWritePath(p) {
  const n = path.resolve(p);
  if (isBlockedPath(n)) return false;
  const home = os.homedir();
  const roots = [
    __dirname,
    ...desktopDirs(),
    path.join(home, 'Desktop'),
    path.join(home, 'OneDrive', 'Desktop'),
    path.join(home, 'Documents'),
    path.join(home, 'Downloads'),
    'D:\\',
    'E:\\',
    'F:\\',
  ];
  return roots.some((root) => n.toLowerCase().startsWith(path.resolve(root).toLowerCase()));
}

ipcMain.handle('get-special-path', async (_e, name) => {
  const home = os.homedir();
  if (name === 'desktop') {
    const a = path.join(home, 'Desktop');
    const b = path.join(home, 'OneDrive', 'Desktop');
    if (fs.existsSync(a)) return a;
    if (fs.existsSync(b)) return b;
    return a;
  }
  if (name === 'documents') return path.join(home, 'Documents');
  if (name === 'downloads') return path.join(home, 'Downloads');
  if (name === 'home') return home;
  if (name === 'app') return __dirname;
  return home;
});

ipcMain.handle('write-text-file', async (_e, filePath, content) => {
  try {
    const p = resolveUserWritePath(filePath);
    if (!p) return { ok: false, message: 'Пустой путь' };
    if (!isAllowedWritePath(p)) {
      return { ok: false, message: `Сюда писать нельзя: ${p}` };
    }
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, String(content ?? ''), 'utf8');
    return { ok: true, message: 'сохранила', path: p };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('read-text-file', async (_e, filePath) => {
  try {
    const p = path.resolve(String(filePath || ''));
    if (isBlockedPath(p) && !p.toLowerCase().startsWith(path.resolve(__dirname).toLowerCase())) {
      // чтение с C:\ тоже режем, кроме своей папки если вдруг на C
      if (!p.toLowerCase().includes('yuki')) {
        return { ok: false, message: 'Чтение с C:\\ ограничено' };
      }
    }
    if (!fs.existsSync(p)) return { ok: false, message: 'Файл не найден' };
    const text = fs.readFileSync(p, 'utf8');
    return { ok: true, message: text.slice(0, 14000), path: p };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('list-dir', async (_e, dirPath) => {
  try {
    const p = path.resolve(String(dirPath || __dirname));
    if (isBlockedPath(p) && !p.toLowerCase().startsWith(path.resolve(__dirname).toLowerCase())) {
      return { ok: false, message: 'Листинг C:\\ ограничен' };
    }
    const entries = fs.readdirSync(p, { withFileTypes: true }).slice(0, 100);
    const lines = entries.map((e) => `${e.isDirectory() ? '[D]' : '[F]'} ${e.name}`);
    return { ok: true, message: lines.join('\n'), path: p };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

const SHELL_PREFIXES = [
  'npm ', 'npm run ', 'npx ', 'node ', 'python ', 'py ', 'pip ',
  'dir ', 'echo ', 'type ', 'cd ', 'git status', 'git log', 'git diff', 'git branch',
  'winget search ', 'winget show ',
];

ipcMain.handle('run-shell', async (_e, command, cwd) => {
  try {
    const cmd = String(command || '').trim();
    if (!cmd) return { ok: false, message: 'Пустая команда' };
    const allowed = SHELL_PREFIXES.some((p) => cmd.toLowerCase().startsWith(p.toLowerCase()));
    if (!allowed) {
      return { ok: false, message: `Команда не в whitelist: ${cmd.slice(0, 80)}` };
    }
    const work = cwd && fs.existsSync(cwd) ? cwd : __dirname;
    const r = await new Promise((resolve) => {
      exec(cmd, { cwd: work, windowsHide: true, timeout: 45000, maxBuffer: 2 * 1024 * 1024 }, (err, stdout, stderr) => {
        resolve({
          ok: !err,
          message: (stdout || stderr || err?.message || '').toString().slice(0, 8000),
          stdout: String(stdout || '').slice(0, 8000),
          stderr: String(stderr || '').slice(0, 2000),
        });
      });
    });
    return r;
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
