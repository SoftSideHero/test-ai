"""Локальный TTS для Yuki Neurona (Edge TTS). Без платных API."""
import asyncio
import base64
import json
import os
import re
import time

from flask import Flask, request, jsonify
import edge_tts

app = Flask(__name__)

VOICE = 'ru-RU-SvetlanaNeural'
RATE = '+10%'
PITCH = '+20Hz'
PORT = 8009

try:
    cfg_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
    with open(cfg_path, 'r', encoding='utf-8') as f:
        cfg = json.load(f)
    VOICE = cfg.get('ttsVoice', VOICE)
    RATE = cfg.get('ttsRate', RATE)
    PITCH = cfg.get('ttsPitch', PITCH)
    PORT = int(cfg.get('ttsPort', PORT))
except Exception:
    pass


def safe_rate(value: str) -> str:
    m = re.match(r'^([+-]?\d+)%?$', str(value).strip())
    n = int(m.group(1)) if m else 0
    n = max(-50, min(50, n))
    return f'{n:+d}%'


def safe_pitch(value: str) -> str:
    m = re.match(r'^([+-]?\d+)\s*(?:Hz)?$', str(value).strip(), re.IGNORECASE)
    n = int(m.group(1)) if m else 0
    n = max(-60, min(60, n))
    return f'{n:+d}Hz'


RATE = safe_rate(RATE)
PITCH = safe_pitch(PITCH)


def clean_text(text: str) -> str:
    reps = {
        'YouTube': 'ютуб', 'youtube': 'ютуб',
        'Google': 'гугл', 'google': 'гугл',
        'Discord': 'дискорд', 'discord': 'дискорд',
        'GitHub': 'гитхаб', 'github': 'гитхаб',
        'Telegram': 'телеграм', 'Windows': 'виндовс',
    }
    for a, b in reps.items():
        text = text.replace(a, b)
    text = re.sub(
        '['
        '\U0001F600-\U0001F64F'
        '\U0001F300-\U0001F5FF'
        '\U0001F680-\U0001F6FF'
        '\U0001F900-\U0001F9FF'
        ']+',
        '',
        text,
        flags=re.UNICODE,
    )
    return re.sub(r'\s+', ' ', text).strip()


async def synth(text: str) -> bytes:
    communicate = edge_tts.Communicate(text, VOICE, rate=RATE, pitch=PITCH)
    chunks = []
    async for chunk in communicate.stream():
        if chunk['type'] == 'audio':
            chunks.append(chunk['data'])
    return b''.join(chunks)


@app.get('/health')
def health():
    return jsonify({'ok': True, 'voice': VOICE, 'rate': RATE, 'pitch': PITCH})


@app.post('/speak')
def speak():
    data = request.get_json(force=True) or {}
    text = clean_text((data.get('text') or '').strip())
    if not text:
        return jsonify({'error': 'empty'}), 400
    try:
        t0 = time.time()
        mp3 = asyncio.run(synth(text))
        print(f'[TTS] {len(mp3)} bytes in {time.time() - t0:.2f}s')
        return jsonify({'audio_base64': base64.b64encode(mp3).decode('ascii'), 'format': 'mp3'})
    except Exception as e:
        print('[TTS]', e)
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print(f'Yuki TTS: {VOICE} rate={RATE} pitch={PITCH}')
    print(f'http://127.0.0.1:{PORT}')
    app.run(host='127.0.0.1', port=PORT)
