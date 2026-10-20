import { config } from '../config.js';
import { dispatch } from '../router.js';
import { setActivePhoneNumberId } from './client.js';

/**
 * Parse a raw WhatsApp Cloud API webhook payload or custom agent payload,
 * and dispatch the extracted message to the vault router.
 *
 * @param {object} body  Raw parsed JSON from the POST /webhook body
 */
export async function handleInbound(body) {
  // Support simplified direct payload testing { from: "...", text: "..." }
  if (body && (body.text || body.message) && (body.from || body.sender)) {
    const from = String(body.from || body.sender);
    const text = String(body.text || body.message);
    console.log(`📩 Inbound test/direct message from ${from}: "${text}"`);
    await dispatch(from, { type: 'text', text });
    return;
  }

  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const messages = value?.messages;

  // Auto-detect and store the active WhatsApp phone number ID
  if (value?.metadata?.phone_number_id) {
    setActivePhoneNumberId(value.metadata.phone_number_id);
  }

  if (!messages || messages.length === 0) return;

  const msg = messages[0];
  const from = msg.from;

  // Security: only enforce owner restriction if OWNER_PHONE is explicitly set and not '*'
  if (config.ownerPhone && config.ownerPhone !== '*' && from !== config.ownerPhone) {
    console.warn(`[Security] Ignored message from unauthorized number: ${from}`);
    return;
  }

  let message = { type: msg.type };

  if (msg.type === 'text') {
    message.text = msg.text?.body || '';
  } else if (msg.type === 'image') {
    message.mediaId = msg.image?.id;
    message.mimeType = msg.image?.mime_type;
    message.caption = msg.image?.caption;
  } else if (msg.type === 'document') {
    message.mediaId = msg.document?.id;
    message.mimeType = msg.document?.mime_type;
    message.caption = msg.document?.caption || msg.document?.filename;
  } else if (msg.type === 'audio') {
    message.mediaId = msg.audio?.id;
    message.mimeType = msg.audio?.mime_type;
  } else {
    console.log('Unsupported message type received:', msg.type);
    return;
  }

  console.log(`📩 Inbound message from ${from} (${message.type}): ${message.text || message.caption || '[media]'}`);
  await dispatch(from, message);
}
