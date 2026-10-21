import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '../../uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const AGENT_BASE_URL = 'https://api.whatsapp.com/agent/v1';

const EXT_MAP = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
  'audio/ogg': '.ogg',
  'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a',
  'video/mp4': '.mp4',
  'text/plain': '.txt',
};

/**
 * Download media from WhatsApp Agent Platform and save it to the local uploads directory.
 * Step 1: GET /agent/v1/media/<MEDIA_ID> -> returns download url.
 * Step 2: GET <url> with Bearer token -> returns raw file bytes.
 *
 * @param {string} mediaId
 * @param {string} [mimeTypeHint]
 * @returns {Promise<{ filePath: string, fileName: string, mimeType: string, fileSize: number } | null>}
 */
export async function downloadAndSaveMedia(mediaId, mimeTypeHint = 'image/jpeg') {
  const token = config.whatsappToken;
  if (!token || token.includes('your_token') || !mediaId) {
    return null;
  }

  try {
    console.log(`📥 [Media Download] Fetching metadata for mediaId: ${mediaId} ...`);

    // Step 1: Fetch metadata URL
    const metaRes = await axios.get(`${AGENT_BASE_URL}/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    });

    const downloadUrl = metaRes.data?.url;
    const mimeType = metaRes.data?.mime_type || mimeTypeHint;
    const fileSize = metaRes.data?.file_size || 0;

    if (!downloadUrl) {
      console.warn(`⚠️ No download URL returned for mediaId ${mediaId}`);
      return null;
    }

    // Step 2: Download the raw bytes from the downloadUrl
    console.log(`📥 [Media Download] Downloading bytes from ${downloadUrl.slice(0, 50)}...`);
    const fileRes = await axios.get(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
      timeout: 30000,
    });

    const ext = EXT_MAP[mimeType] || '.bin';
    const fileName = `media_${mediaId}${ext}`;
    const filePath = path.join(UPLOADS_DIR, fileName);

    fs.writeFileSync(filePath, Buffer.from(fileRes.data));
    console.log(`💾 [Media Download] Saved ${fileSize || fileRes.data.byteLength} bytes to ${filePath} ✅`);

    return {
      filePath,
      fileName,
      mimeType,
      fileSize: fileSize || fileRes.data.byteLength,
    };
  } catch (err) {
    console.error(`❌ Error downloading media ${mediaId}:`, err.response?.data || err.message);
    return null;
  }
}

/**
 * Upload a local file to WhatsApp Agent Platform to get a fresh outbound media handle.
 * Reference: POST /agent/v1/media
 *
 * @param {string} filePath
 * @param {string} mimeType
 * @returns {Promise<string | null>}
 */
export async function uploadMedia(filePath, mimeType = 'image/jpeg') {
  const token = config.whatsappToken;
  if (!token || token.includes('your_token') || !fs.existsSync(filePath)) {
    return null;
  }

  try {
    console.log(`📤 [Media Upload] Uploading ${filePath} (${mimeType}) ...`);
    const fileBuffer = fs.readFileSync(filePath);
    const fileName = path.basename(filePath);

    const formData = new FormData();
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', mimeType);
    formData.append('file', new Blob([fileBuffer], { type: mimeType }), fileName);

    const res = await fetch(`${AGENT_BASE_URL}/media`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`❌ Media upload failed (${res.status}):`, errText);
      return null;
    }

    const data = await res.json();
    console.log(`📤 [Media Upload] Successfully uploaded! Media ID: ${data.id} ✅`);
    return data.id;
  } catch (err) {
    console.error(`❌ Error uploading media ${filePath}:`, err.message);
    return null;
  }
}

/**
 * Send an image, document, or audio file directly to the user in their WhatsApp chat.
 *
 * @param {string} to  Recipient identifier (e.g. user:50972923564215)
 * @param {{ type?: string, filePath?: string, mediaId?: string, mimeType?: string, caption?: string }} options
 */
export async function sendMediaMessage(to, { type = 'image', filePath, mediaId, mimeType = 'image/jpeg', caption = '' }) {
  const token = config.whatsappToken;
  if (!token || token.includes('your_token')) {
    console.log(`\n💬 [Mock Media Send -> ${to}] (${type}): ${caption} [File: ${filePath || mediaId}]\n`);
    return { status: 'simulated' };
  }

  // If local file doesn't exist but we have mediaId from earlier, try downloading it first
  if ((!filePath || !fs.existsSync(filePath)) && mediaId) {
    console.log(`🔄 [Media] File not on disk; downloading mediaId ${mediaId} first...`);
    const dl = await downloadAndSaveMedia(mediaId, mimeType);
    if (dl) {
      filePath = dl.filePath;
      mimeType = dl.mimeType;
    }
  }

  let outboundMediaId = null;

  // Upload the file to get a fresh valid outbound handle
  if (filePath && fs.existsSync(filePath)) {
    outboundMediaId = await uploadMedia(filePath, mimeType);
  }

  // If upload failed but we still have an original mediaId, fallback to it
  if (!outboundMediaId && mediaId) {
    outboundMediaId = mediaId;
  }

  if (!outboundMediaId) {
    console.warn(`⚠️ Cannot send media: unable to obtain a valid outbound media ID.`);
    return null;
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type,
    [type]: {
      id: outboundMediaId,
    },
  };

  if (caption && (type === 'image' || type === 'video' || type === 'document')) {
    payload[type].caption = caption;
  }

  try {
    const res = await axios.post(`${AGENT_BASE_URL}/messages`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
    console.log(`🚀 [Media Send] Successfully sent ${type} to ${to}! (wamid: ${res.data?.messages?.[0]?.id || 'ok'})`);
    return res.data;
  } catch (err) {
    console.error(`❌ Failed to send media message to ${to}:`, err.response?.data || err.message);
    return null;
  }
}
