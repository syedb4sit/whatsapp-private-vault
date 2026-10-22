import fs from 'node:fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';

let genAI = null;

function getGenAI() {
  if (!genAI && config.geminiApiKey) {
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return genAI;
}

const TRANSCRIBE_MODELS = [
  'gemini-flash-latest',
  'gemini-3.5-flash',
  'gemini-3.1-flash-lite',
];

/**
 * Transcribe an audio file (.ogg, .mp3, .m4a, .wav) into text using Gemini.
 *
 * @param {string} filePath
 * @param {string} [mimeType='audio/ogg']
 * @returns {Promise<string | null>}
 */
export async function transcribeAudio(filePath, mimeType = 'audio/ogg') {
  if (!filePath || !fs.existsSync(filePath)) {
    return null;
  }

  const client = getGenAI();
  if (!client) return null;

  try {
    const audioBuffer = fs.readFileSync(filePath);
    if (audioBuffer.length < 100) {
      console.warn('⚠️ Audio file too small for transcription, skipping.');
      return null;
    }

    const base64Audio = audioBuffer.toString('base64');

    // Clean MIME type
    let cleanMime = mimeType.split(';')[0].trim().toLowerCase();
    if (cleanMime === 'audio/ogg' || cleanMime === 'audio/opus') {
      cleanMime = 'audio/ogg';
    } else if (cleanMime === 'audio/mp4' || cleanMime === 'audio/m4a') {
      cleanMime = 'audio/mp4';
    } else if (cleanMime === 'audio/mpeg' || cleanMime === 'audio/mp3') {
      cleanMime = 'audio/mp3';
    } else if (!cleanMime.startsWith('audio/')) {
      cleanMime = 'audio/ogg';
    }

    for (const modelName of TRANSCRIBE_MODELS) {
      try {
        const model = client.getGenerativeModel({ model: modelName }, { apiVersion: 'v1beta' });
        const res = await model.generateContent([
          {
            inlineData: {
              mimeType: cleanMime,
              data: base64Audio,
            },
          },
          'Transcribe the exact spoken words in this audio recording. Output ONLY the raw transcription without commentary or formatting. If the speaker uses English, Urdu, or mixed language, transcribe faithfully.',
        ]);

        const text = res.response.text().trim();
        if (text) {
          console.log(`🎙️ [Audio Transcribed with ${modelName}]: "${text}"`);
          return text;
        }
      } catch (err) {
        console.warn(`⚠️ [Transcriber] Model ${modelName} error (${err.message}), trying next...`);
      }
    }
  } catch (err) {
    console.error('❌ Audio transcription failed:', err.message);
  }

  return null;
}
