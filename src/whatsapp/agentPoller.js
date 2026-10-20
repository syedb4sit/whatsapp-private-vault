import axios from 'axios';
import { config } from '../config.js';
import { dispatch } from '../router.js';

const BASE_URL = 'https://api.whatsapp.com/agent/v1';

let currentOffset = null;
let isPolling = false;

/**
 * Send read status and typing indicator to the WhatsApp chat.
 * Reference: POST /agent/v1/statuses in Developer Manual.
 */
export async function sendTypingAndRead(messageId) {
  const token = config.whatsappToken;
  if (!token || token.includes('your_token') || !messageId) return;

  try {
    await axios.post(
      `${BASE_URL}/statuses`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
        typing_indicator: { type: 'text' },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        timeout: 5000,
      }
    );
  } catch (err) {
    // Non-critical, ignore 503 or transient status errors
  }
}

/**
 * Start the WhatsApp Agent Platform long-polling loop.
 * Connects directly using your API key from WhatsApp Settings > Agents.
 * No webhook, no domain verification, and no public callback URL required!
 */
export async function startAgentPoller() {
  const token = config.whatsappToken;
  if (!token || token.includes('your_token')) {
    console.log('ℹ️  No WHATSAPP_TOKEN set; WhatsApp Agent Platform poller is idle.');
    return;
  }

  if (isPolling) return;
  isPolling = true;

  console.log('🤖 WhatsApp Agent Platform Poller started!');
  console.log('📡 Connecting to https://api.whatsapp.com/agent/v1/updates ...');

  // Long-poll loop
  (async () => {
    while (isPolling) {
      try {
        const params = {
          limit: 50,
          timeout: 15,
        };
        if (currentOffset !== null) {
          params.offset = currentOffset;
        }

        const res = await axios.get(`${BASE_URL}/updates`, {
          params,
          headers: {
            Authorization: `Bearer ${token}`,
          },
          timeout: 25000, // 25s HTTP timeout for 15s server long-poll
        });

        // HTTP 204 No Content means long-poll timeout elapsed with no new updates
        if (res.status === 204 || !res.data) {
          continue;
        }

        const data = res.data;
        if (data.next_offset !== undefined) {
          currentOffset = data.next_offset;
        }

        const entry = data.entry?.[0];
        const changes = entry?.changes || [];

        for (const change of changes) {
          const messages = change.value?.messages || [];
          for (const msg of messages) {
            console.log(`📩 [WhatsApp Agent API] Inbound from ${msg.from}: ${msg.text?.body || msg.type}`);

            // Mark message read & send typing indicator
            if (msg.id) {
              sendTypingAndRead(msg.id).catch(() => {});
            }

            let messagePayload = { type: msg.type };
            if (msg.type === 'text') {
              messagePayload.text = msg.text?.body || '';
            } else if (msg.type === 'image') {
              messagePayload.mediaId = msg.image?.id;
              messagePayload.mimeType = msg.image?.mime_type;
              messagePayload.caption = msg.image?.caption;
            } else if (msg.type === 'document') {
              messagePayload.mediaId = msg.document?.id;
              messagePayload.mimeType = msg.document?.mime_type;
              messagePayload.caption = msg.document?.caption || msg.document?.filename;
            } else if (msg.type === 'audio') {
              messagePayload.mediaId = msg.audio?.id;
              messagePayload.mimeType = msg.audio?.mime_type;
            } else {
              continue; // Reactions or unhandled types
            }

            try {
              await dispatch(msg.from, messagePayload);
            } catch (dispatchErr) {
              console.error('Error dispatching agent message:', dispatchErr);
            }
          }
        }
      } catch (err) {
        if (err.response) {
          const status = err.response.status;
          const errData = err.response.data;
          if (status === 401 || status === 400) {
            console.error(`❌ WhatsApp Agent API Auth Error (${status}):`, errData);
            // Wait 20 seconds before retry on authentication failure
            await new Promise((r) => setTimeout(r, 20000));
          } else if (status === 429) {
            console.warn('⚠️ WhatsApp Agent API rate limited (429), pausing 10s...');
            await new Promise((r) => setTimeout(r, 10000));
          } else {
            console.warn(`WhatsApp Agent API /updates status ${status}:`, errData);
            await new Promise((r) => setTimeout(r, 5000));
          }
        } else {
          // Socket hang up or network pause, normal during long-polling
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }
  })();
}
