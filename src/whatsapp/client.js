import axios from 'axios';
import { config } from '../config.js';

const AGENT_BASE_URL = 'https://api.whatsapp.com/agent/v1';
let activePhoneNumberId = config.phoneNumberId;

export function setActivePhoneNumberId(id) {
  if (id) {
    activePhoneNumberId = id;
    console.log(`📱 Active WhatsApp Phone Number ID set to: ${id} ✅`);
  }
}

export { downloadAndSaveMedia, uploadMedia, sendMediaMessage } from './media.js';

export function getActivePhoneNumberId() {
  return activePhoneNumberId || config.phoneNumberId;
}

/**
 * Send an outbound message to a WhatsApp user.
 * Primary: WhatsApp Agent Platform (https://api.whatsapp.com/agent/v1/messages)
 * Fallback: Meta Cloud API (graph.facebook.com)
 *
 * @param {string} to  Recipient identifier (e.g. user:50972923564215)
 * @param {string} text  Message body
 */
export async function sendMessage(to, text) {
  const token = config.whatsappToken;

  if (!token || token.includes('your_token')) {
    console.log(`\n💬 [WhatsApp Simulation -> ${to}]:`);
    console.log(`   ${text.replace(/\n/g, '\n   ')}\n`);
    return { status: 'simulated', to, text };
  }

  // 1. WhatsApp Agent Platform (Direct Agent API)
  try {
    const res = await axios.post(
      `${AGENT_BASE_URL}/messages`,
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
        timeout: 15000,
      }
    );
    console.log(`🚀 [Agent API] Successfully sent WhatsApp reply to ${to}! (wamid: ${res.data?.messages?.[0]?.id || 'ok'})`);
    return res.data;
  } catch (agentErr) {
    const agentErrData = agentErr.response?.data;
    console.warn(`⚠️ Agent Platform send status ${agentErr.response?.status || 'error'}:`, agentErrData || agentErr.message);

    // 2. Fallback to Meta Cloud API if a Phone Number ID is present
    const phoneId = getActivePhoneNumberId();
    if (phoneId) {
      try {
        const cloudRes = await axios.post(
          `https://graph.facebook.com/v19.0/${phoneId}/messages`,
          {
            messaging_product: 'whatsapp',
            to: to.replace(/^user:/, ''),
            type: 'text',
            text: { body: text },
          },
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
            timeout: 15000,
          }
        );
        console.log(`🚀 [Cloud API Fallback] Sent WhatsApp reply to ${to}!`);
        return cloudRes.data;
      } catch (cloudErr) {
        console.error(`❌ Cloud API send error:`, cloudErr.response?.data || cloudErr.message);
      }
    }
    return null;
  }
}

/**
 * Download WhatsApp media by mediaId.
 */
export async function downloadMedia(mediaId) {
  const token = config.whatsappToken;
  if (!token || token.includes('your_token')) {
    console.warn(`[Mock Media] Skipping media download for ID ${mediaId} (no token)`);
    return null;
  }

  // Try WhatsApp Agent Platform media endpoint
  try {
    const res = await axios.get(`${AGENT_BASE_URL}/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${token}` },
      responseType: 'arraybuffer',
    });
    return {
      buffer: Buffer.from(res.data),
      mimeType: res.headers['content-type'],
      fileSize: res.data.length,
    };
  } catch (err) {
    console.error(`⚠️ Failed to download media ${mediaId}:`, err.message);
    return null;
  }
}
