import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRMExpressionPresetName } from '@pixiv/three-vrm';
import { chat, proactive, observeTick, setPhaseCallback, setAutoplaySayCallback, isAutoplayActive } from './brain.js';
import { AvatarAnim } from './avatar.js';

const stage = document.getElementById('stage');
const bubble = document.getElementById('bubble');
const inputWrap = document.getElementById('input-wrap');
const chatInput = document.getElementById('chat');
const overlay = document.getElementById('overlay');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 20);
camera.position.set(0, 1.0, 3.4);

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setClearColor(0x000000, 0);
stage.appendChild(renderer.domElement);

scene.add(new THREE.AmbientLight(0xffffff, 0.75));
const dir = new THREE.DirectionalLight(0xffffff, 1.0);
dir.position.set(1, 1, 1);
scene.add(dir);

let vrm = null;
let bounds = null;
let flipped = false;
let talking = false;
let idleT = 0;
let blinkAt = 3;
let blinkPhase = 0;
let mouthPhase = 0;
let dragging = false;
let memory = {};
let bubbleTimer = null;
let lastKnownTitle = null;
let lastUserAt = Date.now();
let lastProactiveAt = 0;
let observeBusy = false;
let inputMode = 'voice';
let handling = false;
let voiceWanted = true;
let micStream = null;
let mediaRecorder = null;
let recChunks = [];
let spaceDown = false;
let micReady = false;
let wakeEnabled = true;
let wakeLoopBusy = false;
let wakeCommandMode = false;
let wakeListenTimer = null;
let speechWake = null;
let useSpeechWake = false;
let wakeDebounceAt = 0;
let audioCtx = null;
let wakeAnalyser = null;
let appConfig = {};

function normalizeWakeText(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[.,!?;:…«»"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasWakeWord(text) {
  const t = normalizeWakeText(text);
  if (!t) return false;
  return (
    /(?:^|\s)(?:юки|yuki|юка|юк)(?:\s|$)/.test(t) ||
    t.includes('юки') ||
    t.includes('yuki') ||
    /ю\s*ки/.test(t)
  );
}

function extractAfterWake(text) {
  const s = String(text || '').trim();
  const m = s.match(/(?:юки|yuki|юка)\s*[,.!?]?\s*(.*)/i);
  if (m && m[1]?.trim()) return m[1].trim();
  return s.replace(/(?:юки|yuki|юка)/gi, '').replace(/^[\s,.!?-]+/, '').trim();
}

function resumeWakeIfNeeded() {
  if (wakeEnabled && inputMode === 'voice' && voiceWanted && !talking && !handling && !spaceDown && !mediaRecorder) {
    startWakeLoop();
  }
}

const micStatus = document.getElementById('mic-status');
const hintEl = document.getElementById('hint');

function setMicStatus(text, cls = '') {
  if (!micStatus) return;
  if (!text || inputMode !== 'voice') {
    micStatus.className = '';
    micStatus.style.display = 'none';
    micStatus.textContent = '';
    return;
  }
  micStatus.style.display = 'block';
  micStatus.className = 'show ' + cls;
  micStatus.textContent = text;
}

const anim = new AvatarAnim();

function fit() {
  const w = stage.clientWidth || 1;
  const h = stage.clientHeight || 1;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  if (!vrm) {
    camera.updateProjectionMatrix();
    return;
  }
  if (!bounds) {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    bounds = { size, center };
  }
  const fov = (camera.fov * Math.PI) / 180;
  let dist = bounds.size.y / 2 / Math.tan(fov / 2);
  const distW = bounds.size.x / 2 / (Math.tan(fov / 2) * camera.aspect);
  if (camera.aspect < (bounds.size.x / bounds.size.y) * 0.92) dist = Math.max(dist, distW);
  dist *= 1.06;
  camera.position.set(bounds.center.x, bounds.center.y, dist);
  camera.lookAt(bounds.center.x, bounds.center.y, 0);
  camera.updateProjectionMatrix();
}
new ResizeObserver(fit).observe(stage);

function sanitizeUiText(text) {
  let s = String(text || '').trim();
  if (!s) return '';
  if (/"say"\s*:/.test(s) || /^\s*\{/.test(s)) {
    const m = s.match(/"say"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (m) {
      try {
        s = JSON.parse(`"${m[1]}"`);
      } catch {
        s = m[1];
      }
    } else {
      s = 'Секунду, делаю…';
    }
  }
  s = s.replace(/[A-Za-z]:\\[^\s"'<>]+/g, '').replace(/\s+/g, ' ').trim();
  if (s.length > 240) s = s.slice(0, 237) + '…';
  return s;
}

function hideBubble() {
  bubble.style.display = 'none';
  if (bubbleTimer) clearTimeout(bubbleTimer);
}

function showBubble(text, autoHide = true, force = false) {
  if (inputMode === 'voice' && !force) {
    hideBubble();
    return;
  }
  bubble.style.display = 'block';
  bubble.textContent = sanitizeUiText(text);
  if (bubbleTimer) clearTimeout(bubbleTimer);
  if (autoHide) {
    bubbleTimer = setTimeout(() => {
      bubble.style.display = 'none';
    }, 6000);
  }
}

function setState(name) {
  if (name === 'idle' && talking) return;
  anim.setState(name);
  if (name === 'thinking' && !talking && inputMode === 'text') showBubble('думаю…', false);
}

setPhaseCallback((p) => {
  if (talking) return;
  if (p === 'thinking' || p === 'working' || p === 'idle') setState(p);
});

// Комментарии Юки во время автоигры
setAutoplaySayCallback((text) => {
  if (!text || talking || handling || mediaRecorder) return;
  speak(text).catch(() => {});
});

function setEmotion(emotion) {
  if (!emotion || emotion === 'neutral') {
    anim.setEmotion('calm');
    return;
  }
  const busy = ['thinking', 'working', 'talking'].includes(anim.state);
  if (!talking && !busy && ['happy', 'sad', 'angry', 'surprised'].includes(emotion)) {
    anim.setState(emotion);
  }
  anim.setEmotion(emotion);
}

const loader = new GLTFLoader();
loader.register((p) => new VRMLoaderPlugin(p));

function loadModel(filePath) {
  const url = /^https?:\/\//i.test(filePath) || String(filePath).startsWith('blob:')
    ? filePath
    : `file:///${String(filePath).replace(/\\/g, '/')}`;
  console.log('[VRM] fetching', url);
  loader.load(
    url,
    (gltf) => {
      const next = gltf.userData.vrm;
      if (!next) {
        console.error('[VRM] no vrm in gltf');
        showBubble('VRM битый :(', true, true);
        return;
      }
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      VRMUtils.rotateVRM0(next);
      scene.add(next.scene);
      vrm = next;
      bounds = null;
      anim.setVRM(vrm);
      const h = vrm.humanoid;
      if (h) {
        const L = h.getNormalizedBoneNode?.('leftUpperLeg');
        const R = h.getNormalizedBoneNode?.('rightUpperLeg');
        const Ll = h.getNormalizedBoneNode?.('leftLowerLeg');
        const Rl = h.getNormalizedBoneNode?.('rightLowerLeg');
        if (L) L.rotation.set(0.05, 0, 0);
        if (R) R.rotation.set(0.05, 0, 0);
        if (Ll) Ll.rotation.set(-0.08, 0, 0);
        if (Rl) Rl.rotation.set(-0.08, 0, 0);
      }
      overlay.classList.remove('show');
      fit();
    },
    undefined,
    (err) => {
      console.error('[VRM] load fail', err);
      showBubble('Не загрузила VRM :(', true, true);
      overlay.classList.add('show');
    }
  );
}

window.yuki.onLoadModel(loadModel);
window.yuki.onNoModel(() => overlay.classList.add('show'));
window.yuki.onFlip((v) => { flipped = !!v; });

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = clock.getDelta();
  if (vrm) {
    idleT += dt;
    anim.update(dt);
    vrm.scene.position.y = Math.sin(idleT * 2) * 0.0025;
    vrm.scene.rotation.y = flipped ? Math.PI : 0;

    if (vrm.expressionManager) {
      blinkAt -= dt;
      if (blinkAt <= 0 && blinkPhase === 0) blinkPhase = 0.0001;
      if (blinkPhase > 0) {
        blinkPhase += dt;
        const t = blinkPhase / 0.07;
        const v = t < 0.5 ? t * 2 : Math.max(0, 2 - t * 2);
        vrm.expressionManager.setValue(VRMExpressionPresetName.Blink, v * 0.22);
        if (t >= 1) {
          blinkPhase = 0;
          blinkAt = 3.5 + Math.random() * 5;
        }
      }
      if (talking) {
        mouthPhase += dt * 5.2;
        const seg = Math.floor(mouthPhase) % 4;
        const local = mouthPhase - Math.floor(mouthPhase);
        const shapes = [
          { s: VRMExpressionPresetName.Aa, a: 0.11 },
          { s: VRMExpressionPresetName.Ih, a: 0.06 },
          { s: VRMExpressionPresetName.Ou, a: 0.09 },
          { s: VRMExpressionPresetName.Oh, a: 0.08 },
        ];
        shapes.forEach(({ s, a }, i) => {
          if (!s) return;
          vrm.expressionManager.setValue(s, i === seg ? Math.sin(local * Math.PI) * a : 0);
        });
      } else {
        [VRMExpressionPresetName.Aa, VRMExpressionPresetName.Ih, VRMExpressionPresetName.Ou, VRMExpressionPresetName.Oh]
          .forEach((s) => s && vrm.expressionManager.setValue(s, 0));
      }
    }
    vrm.update(dt);
  }
  renderer.render(scene, camera);
}
loop();

// TTS
let audio = null;
async function speak(text) {
  if (!text) return;
  const clean = sanitizeUiText(text).replace(/[\u{1F000}-\u{1FFFF}]/gu, '').replace(/\s+/g, ' ').trim() || 'Ок';
  stopWakeLoop();
  stopRecording(false);
  if (audio) { audio.pause(); audio = null; }
  const res = await window.yuki.ttsSpeak(clean).catch(() => null);
  if (!res?.ok || !res.audioBase64) {
    if (!('speechSynthesis' in window)) {
      resumeWakeIfNeeded();
      return;
    }
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'ru-RU';
    u.onstart = () => { talking = true; setState('talking'); setMicStatus('🗣 говорю…', ''); };
    u.onend = () => {
      talking = false;
      setState('idle');
      if (inputMode === 'voice') setMicStatus('👂 «Юки»… или зажми ПРОБЕЛ', 'ok');
      resumeWakeIfNeeded();
    };
    speechSynthesis.speak(u);
    return;
  }
  audio = new Audio(`data:audio/mpeg;base64,${res.audioBase64}`);
  audio.onplay = () => { talking = true; setState('talking'); setMicStatus('🗣 говорю…', ''); };
  audio.onended = () => {
    talking = false;
    setState('idle');
    audio = null;
    if (inputMode === 'voice') setMicStatus('👂 «Юки»… или зажми ПРОБЕЛ', 'ok');
    resumeWakeIfNeeded();
  };
  audio.onerror = () => {
    talking = false;
    setState('idle');
    audio = null;
    if (inputMode === 'voice') setMicStatus('👂 «Юки»… или зажми ПРОБЕЛ', 'ok');
    resumeWakeIfNeeded();
  };
  try { await audio.play(); } catch {
    if (inputMode === 'voice') setMicStatus('👂 «Юки»… или зажми ПРОБЕЛ', 'ok');
    resumeWakeIfNeeded();
  }
}

async function refreshMemory() {
  memory = await window.yuki.getMemory();
  return memory;
}
refreshMemory();

async function handle(msg) {
  if (!msg?.trim() || handling) return;
  handling = true;
  setState('thinking');
  if (inputMode === 'text') {
    const low = msg.trim().toLowerCase();
    if (/экран|скрин/.test(low)) showBubble('смотрю экран…', false);
    else showBubble('думаю…', false);
  } else {
    hideBubble();
    setMicStatus('⏳ думаю…', '');
  }
  try {
    const reply = await chat(msg.trim(), memory);
    if (inputMode === 'text') showBubble(reply.text, false);
    else hideBubble();
    setEmotion(reply.emotion);
    await speak(reply.text);
    await window.yuki.updateMemory({ lastActivitySummary: msg.trim() });
    await refreshMemory();
    lastUserAt = Date.now();
  } catch (e) {
    console.error(e);
    setState('idle');
    if (inputMode === 'text') showBubble(`❌ ${e.message || 'ошибка'}`, false, true);
    else {
      setMicStatus('⚠ ошибка, повтори', 'err');
      await speak('Что-то отвалилось, повтори.');
    }
  } finally {
    handling = false;
  }
}

async function ensureMic() {
  if (micStream) return true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    micReady = true;
    try {
      audioCtx = audioCtx || new AudioContext();
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      const src = audioCtx.createMediaStreamSource(micStream);
      wakeAnalyser = audioCtx.createAnalyser();
      wakeAnalyser.fftSize = 512;
      src.connect(wakeAnalyser);
    } catch (e) {
      console.warn('[mic analyser]', e);
    }
    console.log('[mic] ok');
    return true;
  } catch (e) {
    console.error('[mic]', e);
    micReady = false;
    setMicStatus('⚠ нет доступа к микрофону', 'err');
    return false;
  }
}

function blobToBase64(blob) {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const step = 0x8000;
    for (let i = 0; i < bytes.length; i += step) {
      bin += String.fromCharCode(...bytes.subarray(i, i + step));
    }
    return btoa(bin);
  });
}

async function transcribeBlob(blob, mimeType) {
  const b64 = await blobToBase64(blob);
  const type = String(mimeType || blob.type || '');
  return window.yuki.transcribeAudio({ base64: b64, mimeType: type.split(';')[0] });
}

function recordForMs(ms) {
  return new Promise((resolve) => {
    if (!micStream) {
      resolve(null);
      return;
    }
    const mime = pickMime();
    let rec;
    try {
      rec = mime ? new MediaRecorder(micStream, { mimeType: mime }) : new MediaRecorder(micStream);
    } catch {
      resolve(null);
      return;
    }
    const chunks = [];
    rec.ondataavailable = (ev) => {
      if (ev.data?.size) chunks.push(ev.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mime || 'audio/webm';
      resolve(chunks.length ? new Blob(chunks, { type }) : null);
    };
    rec.start(200);
    setTimeout(() => {
      try {
        if (rec.state === 'recording') rec.stop();
      } catch {
        resolve(null);
      }
    }, ms);
  });
}

async function processVoiceCommand(text) {
  const msg = String(text || '').trim();
  if (!msg) {
    resumeWakeIfNeeded();
    return;
  }
  stopWakeLoop();
  setMicStatus(`💬 ${msg.slice(0, 42)}${msg.length > 42 ? '…' : ''}`, 'ok');
  try {
    await handle(msg);
  } finally {
    resumeWakeIfNeeded();
  }
}

async function afterWakeDetected(partialText) {
  wakeCommandMode = true;
  setMicStatus('💜 слушаю…', 'rec');
  let cmd = extractAfterWake(partialText);
  if (cmd.length >= 2) {
    wakeCommandMode = false;
    await processVoiceCommand(cmd);
    return;
  }
  if (useSpeechWake && speechWake) {
    wakeCommandMode = false;
    setMicStatus('💜 говори команду…', 'rec');
    return;
  }
  const cmdMs = Math.max(3000, Number(appConfig.wakeCommandMs) || 5500);
  const blob = await recordForMs(cmdMs);
  wakeCommandMode = false;
  if (!blob || blob.size < 400) {
    setMicStatus('🤷 не расслышала команду', 'err');
    resumeWakeIfNeeded();
    return;
  }
  setMicStatus('👂 распознаю…', '');
  try {
    const stt = await transcribeBlob(blob, blob.type);
    const text = String(stt?.text || '').trim();
    cmd = extractAfterWake(text) || text;
    if (!stt?.ok || !cmd) {
      setMicStatus('🤷 не расслышала', 'err');
      resumeWakeIfNeeded();
      return;
    }
    await processVoiceCommand(cmd);
  } catch (e) {
    console.error('[wake cmd]', e);
    setMicStatus('⚠ сбой распознавания', 'err');
    resumeWakeIfNeeded();
  }
}

async function onWakePhrase(text) {
  const phrase = String(text || '').trim();
  if (!phrase || !hasWakeWord(phrase)) return;
  if (talking || handling || mediaRecorder || spaceDown) return;
  if (Date.now() - wakeDebounceAt < 1200) return;
  wakeDebounceAt = Date.now();
  console.log('[wake] hit:', phrase);
  stopWakeLoop();
  setMicStatus('💜 да?', 'rec');
  const cmd = extractAfterWake(phrase);
  if (cmd.length >= 2) {
    await processVoiceCommand(cmd);
    return;
  }
  await afterWakeDetected(phrase);
}

async function wakeListenOnce() {
  if (!wakeEnabled || !voiceWanted || inputMode !== 'voice' || useSpeechWake) return;
  if (wakeLoopBusy || wakeCommandMode || talking || handling || spaceDown || mediaRecorder) return;
  wakeLoopBusy = true;
  try {
    const listenMs = Math.max(2800, Number(appConfig.wakeListenMs) || 3500);
    const blob = await recordForMs(listenMs);
    if (!blob || blob.size < 300) return;
    setMicStatus('👂 проверяю…', '');
    const stt = await transcribeBlob(blob, blob.type);
    const text = String(stt?.text || '').trim();
    console.log('[wake cloud]', text);
    if (text && hasWakeWord(text)) await onWakePhrase(text);
  } catch (e) {
    console.warn('[wake cloud]', e);
  } finally {
    wakeLoopBusy = false;
    if (inputMode === 'voice' && wakeEnabled && !talking && !handling && !useSpeechWake) {
      setMicStatus('👂 «Юки»… (облако)', 'ok');
    }
  }
}

function startGeminiWakeLoop() {
  if (wakeListenTimer) return;
  const tick = Math.max(2800, Number(appConfig.wakeListenMs) || 3500);
  wakeListenTimer = setInterval(() => {
    wakeListenOnce().catch((e) => console.warn(e));
  }, tick + 600);
  wakeListenOnce().catch(() => {});
  setMicStatus('👂 «Юки»… (облако)', 'ok');
  console.log('[wake] cloud loop on');
}

function startSpeechWakeLoop() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  try {
    speechWake = new SR();
  } catch (e) {
    console.warn('[wake speech] create fail', e);
    return false;
  }
  useSpeechWake = true;
  speechWake.lang = 'ru-RU';
  speechWake.continuous = true;
  speechWake.interimResults = true;
  speechWake.maxAlternatives = 3;

  speechWake.onresult = (ev) => {
    if (talking || handling || mediaRecorder || spaceDown) return;
    let text = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      text += ev.results[i][0].transcript;
      for (let j = 1; j < ev.results[i].length; j++) {
        const alt = ev.results[i][j].transcript;
        if (hasWakeWord(alt)) text = alt + ' ' + text;
      }
    }
    text = text.trim();
    if (!text) return;
    onWakePhrase(text).catch((e) => console.warn('[wake phrase]', e));
  };

  speechWake.onerror = (e) => {
    console.warn('[wake speech error]', e.error);
    if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network') {
      useSpeechWake = false;
      try { speechWake?.stop(); } catch {}
      speechWake = null;
      startGeminiWakeLoop();
    }
  };

  speechWake.onend = () => {
    if (!useSpeechWake || !wakeEnabled || inputMode !== 'voice') return;
    if (talking || handling || mediaRecorder || spaceDown) return;
    try {
      speechWake.start();
    } catch (e) {
      console.warn('[wake speech restart]', e);
      useSpeechWake = false;
      speechWake = null;
      startGeminiWakeLoop();
    }
  };

  try {
    speechWake.start();
    setMicStatus('👂 «Юки» слушаю…', 'ok');
    console.log('[wake] speech recognition on');
    return true;
  } catch (e) {
    console.warn('[wake speech start]', e);
    useSpeechWake = false;
    speechWake = null;
    return false;
  }
}

function startWakeLoop() {
  stopWakeLoop();
  if (!wakeEnabled || inputMode !== 'voice') return;
  if (startSpeechWakeLoop()) return;
  startGeminiWakeLoop();
}

function stopWakeLoop() {
  if (wakeListenTimer) {
    clearInterval(wakeListenTimer);
    wakeListenTimer = null;
  }
  useSpeechWake = false;
  if (speechWake) {
    try {
      speechWake.onend = null;
      speechWake.onresult = null;
      speechWake.onerror = null;
      speechWake.stop();
    } catch {}
    speechWake = null;
  }
}

function pickMime() {
  const list = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  for (const m of list) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

function startRecording(fromGlobal = false) {
  if (!micStream || talking || handling || mediaRecorder) return;
  stopWakeLoop();
  recChunks = [];
  const mime = pickMime();
  try {
    mediaRecorder = mime
      ? new MediaRecorder(micStream, { mimeType: mime })
      : new MediaRecorder(micStream);
  } catch (e) {
    console.error('[rec]', e);
    setMicStatus('⚠ не пишется звук', 'err');
    mediaRecorder = null;
    return;
  }
  mediaRecorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) recChunks.push(ev.data);
  };
  mediaRecorder.onstop = async () => {
    const type = mediaRecorder?.mimeType || mime || 'audio/webm';
    mediaRecorder = null;
    window.yuki.setRecording?.(false);
    const blob = new Blob(recChunks, { type });
    recChunks = [];
    resumeWakeIfNeeded();
    if (blob.size < 600) {
      setMicStatus('🤷 тихо / не расслышала — ещё раз', 'err');
      setTimeout(() => {
        if (inputMode === 'voice' && !talking) setMicStatus('👂 «Юки»… или зажми ПРОБЕЛ', 'ok');
      }, 1600);
      return;
    }
    setMicStatus('👂 распознаю…', '');
    try {
      const stt = await transcribeBlob(blob, type);
      let text = String(stt?.text || '').trim();
      console.log('[voice]', stt);
      if (!stt?.ok || !text) {
        setMicStatus(stt?.error ? `⚠ ${stt.error.slice(0, 40)}` : '🤷 не расслышала', 'err');
        setTimeout(() => {
          if (inputMode === 'voice' && !talking) setMicStatus('👂 «Юки»… или зажми ПРОБЕЛ', 'ok');
        }, 1800);
        return;
      }
      if (hasWakeWord(text)) text = extractAfterWake(text) || text;
      if (!text) {
        await afterWakeDetected(stt.text);
        return;
      }
      await processVoiceCommand(text);
    } catch (e) {
      console.error('[stt]', e);
      setMicStatus('⚠ сбой распознавания', 'err');
    }
  };
  mediaRecorder.start(200);
  window.yuki.setRecording?.(true);
  setMicStatus(fromGlobal ? '🔴 Alt+Y — говори…' : '🔴 говорю… отпусти ПРОБЕЛ', 'rec');
}

function stopRecording(process = true) {
  if (!mediaRecorder) return;
  if (!process) {
    try {
      mediaRecorder.ondataavailable = null;
      mediaRecorder.onstop = null;
      mediaRecorder.stop();
    } catch {}
    mediaRecorder = null;
    recChunks = [];
    window.yuki.setRecording?.(false);
    return;
  }
  try {
    if (mediaRecorder.state === 'recording') mediaRecorder.stop();
  } catch {}
}

async function enableVoiceMode() {
  voiceWanted = true;
  inputMode = 'voice';
  inputWrap.style.display = 'none';
  hideBubble();
  if (hintEl) hintEl.textContent = '«Юки» всегда слушает · ПРОБЕЛ · в игре Alt+Y';
  try {
    await window.yuki.focusApp?.();
  } catch {}
  const ok = await ensureMic();
  if (!ok) return;
  setMicStatus('👂 «Юки»… или зажми ПРОБЕЛ', 'ok');
  startWakeLoop();
}

document.addEventListener('keydown', async (e) => {
  if (inputMode !== 'voice' || !voiceWanted) return;
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (e.repeat) return;
  if (document.activeElement === chatInput) return;
  e.preventDefault();
  if (spaceDown || talking || handling) return;
  spaceDown = true;
  const ok = await ensureMic();
  if (!ok) {
    spaceDown = false;
    return;
  }
  startRecording();
});

document.addEventListener('keyup', (e) => {
  if (e.code !== 'Space' && e.key !== ' ') return;
  if (!spaceDown) return;
  spaceDown = false;
  e.preventDefault();
  stopRecording(true);
});

let lastClickAt = 0;
document.addEventListener('dblclick', async (e) => {
  if (inputMode !== 'voice' || talking || handling) return;
  if (inputWrap.contains(e.target)) return;
  e.preventDefault();
  const ok = await ensureMic();
  if (!ok) return;
  startRecording();
  setTimeout(() => stopRecording(true), 4000);
});

document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  window.yuki.showMenu();
});

document.addEventListener('mousedown', async (e) => {
  if (e.button !== 0) return;
  try {
    window.focus();
    window.yuki.focusApp?.();
    if (audioCtx?.state === 'suspended') await audioCtx.resume();
    if (wakeEnabled && inputMode === 'voice' && !speechWake && !wakeListenTimer) startWakeLoop();
  } catch {}
  if (inputWrap.contains(e.target)) return;
  dragging = true;
  lastClickAt = Date.now();
});
document.addEventListener('mouseup', () => { dragging = false; });
document.addEventListener('mouseleave', () => { dragging = false; });
document.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  window.yuki.moveWindow(e.movementX, e.movementY);
});

window.yuki.onInputMode(async (mode) => {
  if (mode === 'text') {
    voiceWanted = false;
    inputMode = 'text';
    stopWakeLoop();
    stopRecording(false);
    inputWrap.style.display = 'block';
    chatInput.focus();
    setMicStatus('');
    if (hintEl) hintEl.textContent = 'ПКМ — меню · текстовый режим';
    showBubble('Текстовый режим', true, true);
  } else {
    await enableVoiceMode();
  }
});

window.yuki.onWakeWordToggle?.((enabled) => {
  wakeEnabled = !!enabled;
  if (wakeEnabled && inputMode === 'voice') startWakeLoop();
  else stopWakeLoop();
  if (inputMode === 'voice') {
    setMicStatus(wakeEnabled ? '👂 «Юки»… или зажми ПРОБЕЛ' : '🎤 только ПРОБЕЛ / Alt+Y', 'ok');
  }
});

let globalPttOn = false;
window.yuki.onGlobalPtt?.(async (phase) => {
  if (inputMode !== 'voice' || !voiceWanted) return;
  if (phase === 'down' && !globalPttOn && !talking && !handling) {
    globalPttOn = true;
    const ok = await ensureMic();
    if (!ok) {
      globalPttOn = false;
      return;
    }
    startRecording(true);
    return;
  }
  if (phase === 'up' && globalPttOn) {
    globalPttOn = false;
    stopRecording(true);
    return;
  }
  if (phase === 'toggle') {
    if (globalPttOn || mediaRecorder) {
      globalPttOn = false;
      stopRecording(true);
      return;
    }
    const ok = await ensureMic();
    if (!ok) return;
    globalPttOn = true;
    startRecording(true);
    setTimeout(() => {
      if (globalPttOn) {
        globalPttOn = false;
        stopRecording(true);
      }
    }, 6000);
  }
});

chatInput.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') { inputWrap.style.display = 'none'; return; }
  if (e.key === 'Enter' && chatInput.value.trim()) {
    const m = chatInput.value.trim();
    chatInput.value = '';
    await handle(m);
  }
});

(async () => {
  try {
    appConfig = await window.yuki.getConfig();
    wakeEnabled = appConfig.wakeWordEnabled !== false;
    const mem0 = await window.yuki.getMemory();
    if (mem0?.wakeWordEnabled === false) wakeEnabled = false;
  } catch {}
  setTimeout(() => {
    enableVoiceMode().catch((e) => console.warn(e));
  }, 700);
})();

setInterval(async () => {
  try {
    const title = await window.yuki.getActiveWindow();
    if (!title) return;
    await window.yuki.updateMemory({ currentWindowTitle: title });
    await refreshMemory();
    lastKnownTitle = title;
  } catch {}
}, 5000);

(async () => {
  let cfg0 = {};
  try {
    cfg0 = await window.yuki.getConfig();
  } catch {}
  const OBSERVE_MS = Math.max(60000, Number(cfg0.observeIntervalMs) || 420000);
  const PROACTIVE_MS = Math.max(120000, Number(cfg0.proactiveMs) || 360000);

  setInterval(async () => {
    if (talking || dragging || observeBusy || handling || spaceDown) return;
    observeBusy = true;
    try {
      const tick = await observeTick(memory);
      await refreshMemory();
      if (tick?.comment && !talking && !handling) {
        lastProactiveAt = Date.now();
        setEmotion(tick.emotion || 'happy');
        if (inputMode === 'text') showBubble(tick.comment, true);
        else hideBubble();
        await speak(tick.comment);
      }
    } catch (e) {
      console.warn('observe', e);
    } finally {
      observeBusy = false;
    }
  }, OBSERVE_MS);

  setInterval(async () => {
    if (talking || dragging || handling || spaceDown) return;
    if (Date.now() - lastProactiveAt < PROACTIVE_MS) return;
    if (Date.now() - lastUserAt < 40000) return;
    if (Math.random() > 0.5) return;
    lastProactiveAt = Date.now();
    try {
      setState('thinking');
      const reply = await proactive(memory);
      if (reply?.text) {
        if (inputMode === 'text') showBubble(reply.text, false);
        else hideBubble();
        setEmotion(reply.emotion);
        await speak(reply.text);
      }
    } catch (e) {
      console.warn('proactive failed', e);
    } finally {
      if (!talking) setState('idle');
    }
  }, Math.min(PROACTIVE_MS, 20000));
})();