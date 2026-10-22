import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Generate a British English voice note (.mp3) from text.
 * Uses British English (en-GB) TTS.
 *
 * @param {string} text
 * @returns {Promise<string | null>} Local file path to the audio file
 */
export async function textToSpeech(text) {
  if (!text) return null;

  try {
    // Strip markdown formatting and emojis for clean, natural speech
    const cleanText = text
      .replace(/[*_#`~•]/g, '')
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 250);

    if (!cleanText) return null;

    const encoded = encodeURIComponent(cleanText);
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-GB&client=tw-ob&q=${encoded}`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (!res.ok) {
      console.warn(`⚠️ TTS request failed with status: ${res.status}`);
      return null;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const fileName = `voice_${Date.now()}.mp3`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    fs.writeFileSync(filePath, buffer);
    console.log(`🎙️ [TTS] Generated British voice note (${buffer.length} bytes) at ${filePath}`);
    return filePath;
  } catch (err) {
    console.error('❌ Text to speech failed:', err.message);
    return null;
  }
}
