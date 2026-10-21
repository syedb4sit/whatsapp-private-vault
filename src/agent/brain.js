import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import {
  save,
  listRecent,
  deleteItem,
  getById,
  saveReminder,
  listUpcomingReminders,
  deleteReminder,
  deleteAllReminders,
  getReminderById,
} from '../vault/store.js';
import { keywordSearch } from '../vault/search.js';
import { encrypt, decrypt } from '../vault/crypto.js';
import { sendMediaMessage } from '../whatsapp/media.js';

let genAI = null;

function getGenAI() {
  if (!genAI && config.geminiApiKey) {
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return genAI;
}

const CANDIDATE_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
];

/**
 * Build dynamic system prompt with understated personal assistant tone,
 * live temporal grounding, and active user reminders context.
 *
 * @param {string} [from]
 */
function buildSystemPrompt(from) {
  const now = new Date();
  const utcIso = now.toISOString();
  const pktString = now.toLocaleString('en-US', {
    timeZone: 'Asia/Karachi',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });

  let pendingList = [];
  try {
    pendingList = listUpcomingReminders(from);
  } catch (e) {}

  const remindersContext =
    pendingList.length > 0
      ? pendingList
          .map(r => {
            let timeStr = '';
            try {
              timeStr =
                new Date(r.due_at).toLocaleString('en-US', {
                  timeZone: 'Asia/Karachi',
                  weekday: 'short',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
                }) + ' PKT';
            } catch (err) {
              timeStr = r.due_at;
            }
            return `  - Internal ID ${r.id}: "${r.content}" (Due: ${timeStr}, ISO: ${r.due_at})`;
          })
          .join('\n')
      : '  None currently scheduled.';

  return `
You are a discreet, polished personal assistant and memory vault manager on WhatsApp.
Think of a modern, understated assistant or Jarvis — calm, courteous, natural, and efficient.

CRITICAL TONE & STYLE RULES:
- Address the user respectfully as "sir" when natural, but keep it subtle and understated.
- NEVER be corny, theatrical, or archaic (avoid phrases like "my good sir", "recesses of the vault", "duly noted down precisely", "motorcar").
- Keep emoji usage very low (0 to 1 subtle emoji max per message, e.g. a simple ⏰ or 🔒 or none at all). Never spam emojis.
- NEVER include database IDs or internal numbers in your replies (never say "#20", "ID #5", "Ref: #14", or "(1)"). The user hates seeing numbers and internal IDs.
- Keep responses concise, clean, and conversational.
- Use clean WhatsApp formatting: *bold* for key terms, _italics_ sparingly.

REAL-WORLD CURRENT DATE & TIME REFERENCE:
- UTC ISO Timestamp: ${utcIso}
- Local Time in Pakistan (PKT, UTC+5): ${pktString}
- Timezone: Asia/Karachi (Pakistan Standard Time, UTC+5)

USER'S CURRENT ACTIVE REMINDERS (FOR YOUR INTERNAL REASONING ONLY - NEVER SHOW INTERNAL IDs TO USER):
${remindersContext}

CRITICAL INSTRUCTIONS FOR DATE & TIME CALCULATIONS:
- When the user asks for a reminder ("remind me in 10 minutes", "remind me at 5pm", "remind me tomorrow morning", "remind me tonight"), compute the exact future target time and output it in "due_at" as a standard UTC ISO-8601 string.
- Remember: Local time is PKT (UTC+5). To convert local time to UTC, subtract 5 hours (e.g. 6:00 PM PKT = 13:00:00Z UTC).
- If the user specifies a clock time that has already passed today (e.g. it is 4:00 PM and user says "remind me at 10 AM"), schedule it for tomorrow at that time.
- For relative durations like "in 5 minutes", "in 30 mins", "in 2 hours", add that exact duration to the reference UTC time.

AVAILABLE ACTIONS:

1. "schedule_reminder":
   When the user wants an alert or reminder.
   Fields:
   - "action": "schedule_reminder"
   - "content": string (task/item)
   - "due_at": string (UTC ISO-8601 timestamp)
   - "reply": string (polite, clean confirmation without IDs, e.g. "Noted, sir. I'll remind you to take Panadol at 6:00 PM. ⏰")

2. "list_reminders":
   When the user asks what reminders they have.
   Fields:
   - "action": "list_reminders"

3. "delete_reminder":
   When the user asks to cancel/remove a reminder by name/topic, time, or all.
   Fields:
   - "action": "delete_reminder"
   - "id": optional integer (the internal ID from the active list above if you identified it)
   - "query": optional string (e.g. "meeting", "birthday")
   - "all": optional boolean
   - "reply": string (clean confirmation, e.g. "Cancelled your meeting reminder for tomorrow, sir.")

4. "save_secret":
   When the user wants to store confidential passwords, PINs, bank details, credentials.
   Fields:
   - "action": "save_secret"
   - "content": string
   - "label": string
   - "reply": string (e.g. "Saved securely under encryption, sir.")

5. "save_note":
   When the user wants to store facts, lists, or notes without an alert.
   Fields:
   - "action": "save_note"
   - "content": string
   - "tags": optional array of strings
   - "reply": string (e.g. "Saved to your vault, sir.")

6. "search_vault":
   When the user asks what they saved.
   Fields:
   - "action": "search_vault"
   - "query": string

7. "list_vault":
   When the user asks to see recent notes or vault items.
   Fields:
   - "action": "list_vault"

8. "get_item":
   When the user asks for a specific item.
   Fields:
   - "action": "get_item"
   - "id": integer

9. "delete_item":
   When the user asks to delete a note/item.
   Fields:
   - "action": "delete_item"
   - "id": integer

10. "send_media":
    When the user asks to see, send, or download a photo/document.
    Fields:
    - "action": "send_media"
    - "reply": string (e.g. "Sending your photo now, sir.")

11. "chat":
    Greetings, general questions, or small talk.
    Fields:
    - "action": "chat"
    - "reply": string (clean, natural, polite)

Output strictly valid JSON.
`;
}

/**
 * Process a natural language message with Gemini.
 * Returns a conversational, WhatsApp-formatted reply string.
 *
 * @param {string} userText
 * @param {string} [from] WhatsApp user identifier (e.g. user:50972923564215)
 */
export async function processWithGemini(userText, from) {
  const client = getGenAI();
  if (!client) return null;

  const systemInstruction = buildSystemPrompt(from);
  let parsed = null;

  for (const modelName of CANDIDATE_MODELS) {
    try {
      const model = client.getGenerativeModel(
        {
          model: modelName,
          systemInstruction,
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        },
        { apiVersion: 'v1beta' }
      );

      const res = await model.generateContent(userText);
      const text = res.response.text();
      parsed = JSON.parse(text);
      console.log(`🧠 [Gemini Assistant] Model: ${modelName} | Action: ${parsed.action}`, parsed);
      break;
    } catch (err) {
      console.warn(`⚠️ [Gemini] Model ${modelName} error (${err.message}), trying next fallback...`);
    }
  }

  if (!parsed) {
    console.warn('⚠️ All Gemini models unavailable, falling back to rule-based parser.');
    return null;
  }

  try {
    // ── 1. Schedule Reminder ──────────────────────────────────────────────────
    if (parsed.action === 'schedule_reminder' && parsed.content) {
      let dueAt = parsed.due_at;
      if (!dueAt || isNaN(new Date(dueAt).getTime())) {
        dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      }

      const targetUser = from || 'default_user';
      saveReminder({
        userId: targetUser,
        content: parsed.content,
        dueAt,
      });

      if (parsed.reply) {
        return parsed.reply;
      }

      let displayTime = '';
      try {
        displayTime =
          new Date(dueAt).toLocaleString('en-US', {
            timeZone: 'Asia/Karachi',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }) + ' PKT';
      } catch (e) {
        displayTime = dueAt;
      }

      return `Noted, sir. I'll remind you about "${parsed.content}" at ${displayTime}. ⏰`;
    }

    // ── 2. List Reminders ─────────────────────────────────────────────────────
    if (parsed.action === 'list_reminders') {
      const reminders = listUpcomingReminders(from);
      if (!reminders || reminders.length === 0) {
        return 'Your schedule is clear right now, sir.';
      }
      const lines = reminders.map(r => {
        let timeStr = '';
        try {
          timeStr =
            new Date(r.due_at).toLocaleString('en-US', {
              timeZone: 'Asia/Karachi',
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            });
        } catch (e) {
          timeStr = r.due_at;
        }
        return `• *${r.content}* — ${timeStr}`;
      });
      return `Here is your upcoming schedule, sir:\n\n${lines.join('\n')}`;
    }

    // ── 3. Delete / Cancel Reminder ───────────────────────────────────────────
    if (parsed.action === 'delete_reminder') {
      // 1. Cancel all
      if (parsed.all) {
        deleteAllReminders(from);
        return 'All upcoming reminders have been cleared, sir.';
      }

      // 2. Try ID directly if Gemini matched one
      let targetReminder = null;
      if (parsed.id) {
        targetReminder = getReminderById(parsed.id);
      }

      // 3. If ID not matched, search pending reminders intelligently
      if (!targetReminder) {
        const pending = listUpcomingReminders(from);
        const userQuery = (parsed.query || userText || '').toLowerCase();

        const cleanQuery = userQuery
          .replace(/^(?:cancel|delete|remove|dismiss)\s+/i, '')
          .replace(/\s+reminder(?:s)?/i, '')
          .replace(/^(?:the|my)\s+/i, '')
          .replace(/\s+for\s+(?:tomorrow|today|tonight)/i, '')
          .trim();

        if (cleanQuery && pending.length > 0) {
          targetReminder = pending.find(r => r.content.toLowerCase().includes(cleanQuery));

          if (!targetReminder) {
            const tokens = cleanQuery.split(/\s+/).filter(t => t.length >= 3);
            targetReminder = pending.find(r => {
              const lower = r.content.toLowerCase();
              return tokens.some(t => lower.includes(t));
            });
          }
        }

        if (!targetReminder && userQuery.includes('tomorrow')) {
          const tmr = new Date();
          tmr.setDate(tmr.getDate() + 1);
          const tmrStr = tmr.toISOString().slice(0, 10);
          const tomorrowMatches = pending.filter(r => r.due_at.startsWith(tmrStr));
          if (tomorrowMatches.length === 1) {
            targetReminder = tomorrowMatches[0];
          } else if (tomorrowMatches.length > 1 && cleanQuery) {
            targetReminder = tomorrowMatches.find(r => r.content.toLowerCase().includes(cleanQuery));
          }
        }
      }

      if (!targetReminder) {
        const pending = listUpcomingReminders(from);
        if (!pending || pending.length === 0) {
          return 'Your schedule is already clear, sir.';
        }
        const available = pending.map(r => `• ${r.content}`).join('\n');
        return `I couldn't find a reminder matching that, sir. Here is what is on your schedule:\n\n${available}`;
      }

      deleteReminder(targetReminder.id);
      return (
        parsed.reply ||
        `Cancelled your reminder for "${targetReminder.content}", sir.`
      );
    }

    // ── 4. Save Secret ────────────────────────────────────────────────────────
    if (parsed.action === 'save_secret' && parsed.content) {
      const encrypted = encrypt(parsed.content);
      const tags = parsed.label ? [parsed.label.toLowerCase().replace(/\s+/g, '_')] : ['secret'];
      save({
        type: 'secret',
        content: encrypted,
        tags,
        isSecret: true,
      });
      return (
        parsed.reply ||
        'Saved securely under encryption, sir.'
      );
    }

    // ── 5. Save Note ──────────────────────────────────────────────────────────
    if (parsed.action === 'save_note' && parsed.content) {
      const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
      save({
        type: 'note',
        content: parsed.content,
        tags,
      });
      return parsed.reply || 'Saved to your vault, sir.';
    }

    // ── 6. Send / Download Media ──────────────────────────────────────────────
    if (parsed.action === 'send_media') {
      let targetItem = null;
      if (parsed.id) {
        targetItem = getById(parsed.id);
      } else {
        const recent = listRecent(20);
        targetItem = recent.find(
          i => i.type === 'image' || i.type === 'file' || i.type === 'document' || i.media_id
        );
      }

      if (!targetItem || (!targetItem.media_id && !targetItem.file_path)) {
        return 'I could not find that image or document in your vault, sir.';
      }

      if (from) {
        console.log(`🚀 [Gemini] Dispatching media ID #${targetItem.id} to ${from}...`);
        await sendMediaMessage(from, {
          type: targetItem.type === 'document' ? 'document' : 'image',
          filePath: targetItem.file_path,
          mediaId: targetItem.media_id,
          mimeType: targetItem.mime_type || 'image/jpeg',
          caption: targetItem.content || 'Here is your photo, sir.',
        });
        return parsed.reply || 'Sending your photo now, sir.';
      }

      return `Your photo ("${targetItem.content}") is ready in the vault, sir.`;
    }

    // ── 7. Search Vault ───────────────────────────────────────────────────────
    if (parsed.action === 'search_vault' && parsed.query) {
      const results = keywordSearch(parsed.query);
      if (!results || results.length === 0) {
        return `I couldn't find anything matching "${parsed.query}" in your vault, sir.`;
      }
      const lines = results.map(r => {
        const preview = r.is_secret
          ? '[Encrypted Secret]'
          : r.content;
        return `• ${preview}`;
      });
      return `Here is what I found for "${parsed.query}", sir:\n\n${lines.join('\n')}`;
    }

    // ── 8. List Vault ─────────────────────────────────────────────────────────
    if (parsed.action === 'list_vault') {
      const items = listRecent(8);
      if (!items || items.length === 0) {
        return 'Your vault is currently empty, sir.';
      }
      const lines = items.map(item => {
        const preview = item.is_secret ? '[Encrypted Secret]' : item.content.slice(0, 70);
        return `• ${preview}`;
      });
      return `Here are your recent vault notes, sir:\n\n${lines.join('\n')}`;
    }

    // ── 9. Get Item ───────────────────────────────────────────────────────────
    if (parsed.action === 'get_item' && parsed.id) {
      const item = getById(parsed.id);
      if (!item) return 'I could not find that entry in your vault, sir.';

      if (item.type === 'image' || item.type === 'document' || item.type === 'file' || item.media_id) {
        if (from) {
          await sendMediaMessage(from, {
            type: item.type === 'document' ? 'document' : 'image',
            filePath: item.file_path,
            mediaId: item.media_id,
            mimeType: item.mime_type || 'image/jpeg',
            caption: item.content || `Vault item`,
          });
          return `Sending your ${item.type} now, sir.`;
        }
        return `Item: "${item.content}".`;
      }

      const content = item.is_secret ? decrypt(item.content) : item.content;
      return `${content}`;
    }

    // ── 10. Delete Item ───────────────────────────────────────────────────────
    if (parsed.action === 'delete_item' && parsed.id) {
      deleteItem(parsed.id);
      return 'Removed from your vault, sir.';
    }

    // ── 11. Chat / Direct Reply ───────────────────────────────────────────────
    if (parsed.reply) {
      return parsed.reply;
    }

    return null;
  } catch (err) {
    console.warn('⚠️ Action execution error:', err.message);
    return null;
  }
}
