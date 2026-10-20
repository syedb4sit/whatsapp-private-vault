import axios from 'axios';
import { config } from '../config.js';

let activePhoneNumberId = config.phoneNumberId;

export function setActivePhoneNumberId(id) {
  if (id) {
    activePhoneNumberId = id;
  }
}

/**
 * Send a WhatsApp text message.
 * @param {string} to  Recipient phone number
 * @param {string} text  Message body
 */
export async function sendMessage(to, text) {
  const token = config.whatsappToken;
  const phoneId = activePhoneNumberId || config.phoneNumberId;

  // If token is not yet configured or is placeholder, log simulation for MVP
  if (!token || token.includes('your_token') || !phoneId) {
    console.log(`\n💬 [WhatsApp Simulation -> ${to}]:`);
    console.log(`   ${text.replace(/\n/g, '\n   ')}\n`);
    return { status: 'simulated', to, text };
  }

  const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
  try {
    const res = await axios.post(
      url,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    return res.data;
  } catch (err) {
    console.error(`⚠️ Failed to send WhatsApp message to ${to}:`, err.response?.data || err.message);
    // Still output to console so the reply is never lost
    console.log(`💬 [Fallback Console Log -> ${to}]: ${text}`);
    return null;
  }
}

/**
 * Download WhatsApp media by mediaId.
 * Returns { buffer, mimeType, fileSize } or null on failure.
 */
export async function downloadMedia(mediaId) {
  const token = config.whatsappToken;
  if (!token || token.includes('your_token')) {
    console.warn(`[Mock Media] Skipping media download for ID ${mediaId} (no token)`);
    return null;
  }

  try {
    const { data } = await axios.get(
      `https://graph.facebook.com/v19.0/${mediaId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const response = await axios.get(data.url, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });
    return {
      buffer: Buffer.from(response.data),
      mimeType: data.mime_type,
      fileSize: data.file_size,
    };
  } catch (err) {
    console.error(`⚠️ Failed to download media ${mediaId}:`, err.message);
    return null;
  }
}
