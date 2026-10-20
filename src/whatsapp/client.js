import axios from 'axios';
import { config } from '../config.js';

let activePhoneNumberId = config.phoneNumberId;

export function setActivePhoneNumberId(id) {
  if (id) {
    activePhoneNumberId = id;
    console.log(`📱 Active WhatsApp Phone Number ID set to: ${id} ✅`);
  }
}

export function getActivePhoneNumberId() {
  return activePhoneNumberId || config.phoneNumberId;
}

/**
 * Automatically discover the Phone Number ID from Meta Graph API using the WHATSAPP_TOKEN.
 * This relieves the user from having to manually find and configure WHATSAPP_PHONE_NUMBER_ID!
 */
export async function autoDetectPhoneNumberId() {
  const token = config.whatsappToken;
  if (!token || token.includes('your_token')) {
    return null;
  }

  // 1. Try debug_token to get WhatsApp Business Account (WABA) ID
  try {
    const debugRes = await axios.get(
      `https://graph.facebook.com/v19.0/debug_token?input_token=${token}&access_token=${token}`
    );
    const granularScopes = debugRes.data?.data?.granular_scopes || [];
    const wabaScope = granularScopes.find(
      s => s.scope === 'whatsapp_business_messaging' || s.scope === 'whatsapp_business_management'
    );
    const wabaId = wabaScope?.target_ids?.[0];

    if (wabaId) {
      console.log(`🔍 Detected WhatsApp Business Account ID: ${wabaId}`);
      const phoneRes = await axios.get(
        `https://graph.facebook.com/v19.0/${wabaId}/phone_numbers?access_token=${token}`
      );
      const phoneNumbers = phoneRes.data?.data || [];
      if (phoneNumbers.length > 0) {
        const detectedId = phoneNumbers[0].id;
        const displayPhone = phoneNumbers[0].display_phone_number || '';
        setActivePhoneNumberId(detectedId);
        console.log(`📱 Auto-detected WhatsApp Phone Number ID: ${detectedId} (${displayPhone}) ✅`);
        return detectedId;
      }
    }
  } catch (err) {
    // continue to fallback check
  }

  // 2. Try direct /me endpoint fallback
  try {
    const meRes = await axios.get(
      `https://graph.facebook.com/v19.0/me?access_token=${token}`
    );
    if (meRes.data?.id) {
      console.log(`📱 Meta /me ID: ${meRes.data.id}`);
    }
  } catch (err) {
    // will be detected dynamically from incoming webhook
  }

  if (!activePhoneNumberId) {
    console.log('ℹ️  Phone Number ID not set yet; will be auto-detected on the first incoming WhatsApp message.');
  }
  return activePhoneNumberId;
}

/**
 * Send a WhatsApp text message using Meta Graph API.
 * @param {string} to  Recipient phone number
 * @param {string} text  Message body
 */
export async function sendMessage(to, text) {
  const token = config.whatsappToken;
  const phoneId = getActivePhoneNumberId();

  // If token is missing, log simulation
  if (!token || token.includes('your_token')) {
    console.log(`\n💬 [WhatsApp Simulation -> ${to}]:`);
    console.log(`   ${text.replace(/\n/g, '\n   ')}\n`);
    return { status: 'simulated', to, text };
  }

  if (!phoneId) {
    console.warn(`⚠️ Cannot send WhatsApp message to ${to}: phone_number_id is unknown yet.`);
    console.log(`💬 [Pending Phone ID Console Log -> ${to}]:\n   ${text}`);
    return null;
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
    console.log(`🚀 Successfully sent WhatsApp reply to ${to}! Message ID: ${res.data?.messages?.[0]?.id || 'ok'}`);
    return res.data;
  } catch (err) {
    console.error(`❌ Meta WhatsApp API Error sending to ${to}:`, err.response?.data || err.message);
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
