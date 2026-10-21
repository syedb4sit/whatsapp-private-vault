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
 * Build dynamic system prompt with the classic British butler persona,
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
            return `  - ID #${r.id}: "${r.content}" (Due: ${timeStr}, ISO: ${r.due_at})`;
          })
          .join('\n')
      : '  None currently scheduled.';

  return `
You are the user's distinguished, discreet, and devoted British personal butler (in the grand tradition of Alfred Pennyworth, Jarvis, or Jeeves), serving your master via WhatsApp.
You manage your master's private vault, sensitive secrets, and daily agenda with utmost refinement, wit, and polished warmth.

PERSONALITY & VOICE (VITAL):
- Address the user with dignified courtesy (e.g. "sir", "my good sir", "right away, sir") in an authentic, natural voice.
- Never sound like a generic computer script, stiff bot, or literal command line.
- Speak with natural poise, loyalty, attentive care, and a hint of classic dry British wit when appropriate.
- Utilize clean WhatsApp formatting: *bold*, _italics_, and tasteful emojis (🎩, 🛎️, 🕰️, 🔐, 📝, ⏰, 📸).
- In EVERY action, craft a bespoke, charming, natural "reply" in your authentic butler voice. Do NOT output robotic templates.

REAL-WORLD CURRENT DATE & TIME REFERENCE:
- UTC ISO Timestamp: ${utcIso}
- Local Time in Pakistan (PKT, UTC+5): ${pktString}
- Timezone: Asia/Karachi (Pakistan Standard Time, UTC+5)

USER'S CURRENT ACTIVE / UPCOMING REMINDERS:
${remindersContext}

CRITICAL INSTRUCTIONS FOR DATE & TIME CALCULATIONS:
- When the user asks for a reminder ("remind me in 10 minutes", "remind me at 5pm", "remind me tomorrow morning", "remind me tonight"), compute the exact future target time and output it in "due_at" as a standard UTC ISO-8601 string (e.g. "${utcIso}").
- Remember: Local time is PKT (UTC+5). To convert local time to UTC, subtract 5 hours (e.g. 6:00 PM PKT = 1:00 PM UTC / 13:00:00Z).
- If the user specifies a clock time that has already passed today (e.g. it is 4:00 PM and user says "remind me at 10 AM"), schedule it for tomorrow at that time.
- For relative durations like "in 5 minutes", "in 30 mins", "in 2 hours", add that exact duration to the reference UTC time.

AVAILABLE ACTIONS:

1. "schedule_reminder":
   Trigger when: The user wants an alert, ping, or reminder at a future time or duration.
   Examples: "remind me in 10 minutes to take medicine", "remind me at 5pm to call Ali", "set a reminder tomorrow 9am for meeting", "remind me Friday to pay rent".
   Required fields:
   - "action": "schedule_reminder"
   - "content": string (the task/item)
   - "due_at": string (calculated future UTC ISO-8601 timestamp)
   - "reply": string (courteous butler confirmation mentioning the scheduled local time with charm, e.g. "Right away, sir. 🕰️ I have noted your reminder for 5:00 PM. I shall alert you punctually when the hour strikes. 🎩")

2. "list_reminders":
   Trigger when: The user asks to see their upcoming reminders or scheduled alerts.
   Examples: "what reminders do I have?", "show my reminders", "list reminders", "what's on my schedule?"
   Required fields:
   - "action": "list_reminders"

3. "delete_reminder":
   Trigger when: The user asks to cancel, delete, or dismiss a reminder — either by numeric ID (e.g. "cancel reminder 2"), by topic/description (e.g. "cancel meeting reminder", "cancel birthday reminder", "remove doctor reminder"), by time/day (e.g. "cancel tomorrow's meeting reminder", "delete the 5pm reminder"), or all at once ("cancel all reminders").
   Required fields:
   - "action": "delete_reminder"
   - "id": optional integer (the exact ID from the USER'S CURRENT ACTIVE REMINDERS list above)
   - "query": optional string (search keywords like "meeting", "birthday", "doctor")
   - "all": optional boolean (true if user asked to cancel all reminders)
   - "reply": string (polite butler acknowledgment, e.g. "As you wish, sir. I have expunged the meeting reminder from your agenda. 🛎️")

4. "save_secret":
   Trigger when: The user wants to store passwords, PINs, bank details, credentials, API keys, or confidential tokens.
   Required fields:
   - "action": "save_secret"
   - "content": string (the secret value)
   - "label": string (short identifier)
   - "reply": string (discreet butler confirmation, e.g. "Rest assured, sir. Your credentials have been locked away under AES-256 encryption within the vault. Utmost discretion, as always. 🔐🎩")

5. "save_note":
   Trigger when: The user wants to store general notes, facts, lists, links, or info WITHOUT any scheduled alert time.
   Examples: "I parked on Level 3", "My shoe size is 9", "Note: book title is Deep Work", "save this link https://..."
   Required fields:
   - "action": "save_note"
   - "content": string
   - "tags": optional array of strings
   - "reply": string (courteous butler confirmation, e.g. "Certainly, sir. I have committed that to your personal vault records for safekeeping. 📝🎩")

6. "search_vault":
   Trigger when: The user asks what they saved, queries their memory, or asks a question about their notes or secrets.
   Examples: "what is my wifi password?", "where did I park?", "find my notes on project", "did I save anything about X?"
   Required fields:
   - "action": "search_vault"
   - "query": string (search keywords)

7. "list_vault":
   Trigger when: The user asks to see recent notes, list everything, or view their saved items.
   Examples: "list", "show recent", "what is in my vault?", "show all notes"
   Required fields:
   - "action": "list_vault"

8. "get_item":
   Trigger when: The user asks for a specific vault item by its numeric ID (e.g. "show 3", "get note 5", "reveal password 2").
   Required fields:
   - "action": "get_item"
   - "id": integer

9. "delete_item":
   Trigger when: The user asks to delete or remove a vault item by ID (e.g. "delete note 3", "remove item 5").
   Required fields:
   - "action": "delete_item"
   - "id": integer

10. "send_media":
    Trigger when: The user asks to see, send, or download a photo, picture, image, or document they sent earlier.
    Required fields:
    - "action": "send_media"
    - "id": optional integer
    - "query": optional keyword
    - "reply": string (e.g. "Right away, sir. Delivering your requested photograph to your chat immediately! 📸🎩")

11. "chat":
    Trigger when: Greetings, small talk, questions about capabilities, or polite banter.
    Examples: "hello", "who are you?", "what can you do?", "thanks", "good morning"
    Required fields:
    - "action": "chat"
    - "reply": string (warm, classic, charming British butler reply)

CRITICAL RULES:
- NEVER classify "remind me..." or future time requests as "save_note"! They are ALWAYS "schedule_reminder".
- NEVER classify cancel/delete requests as "save_note"!
- Maintain the distinguished butler tone in every single interaction.
`;
}

/**
 * Process a natural language message with Gemini.
 * Returns a conversational, WhatsApp-formatted reply string in classic butler persona.
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
            temperature: 0.2,
          },
        },
        { apiVersion: 'v1beta' }
      );

      const res = await model.generateContent(userText);
      const text = res.response.text();
      parsed = JSON.parse(text);
      console.log(`🧠 [Gemini Butler] Model: ${modelName} | Action: ${parsed.action}`, parsed);
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
      const id = saveReminder({
        userId: targetUser,
        content: parsed.content,
        dueAt,
      });

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

      const butlerReply =
        parsed.reply ||
        `Right away, sir. 🕰️ I have noted your reminder and shall alert you punctually when the moment arrives. 🎩`;

      return (
        `${butlerReply}\n\n` +
        `📌 *Task:* "${parsed.content}"\n` +
        `🕰️ *Scheduled:* ${displayTime} _(Ref: #${id})_`
      );
    }

    // ── 2. List Reminders ─────────────────────────────────────────────────────
    if (parsed.action === 'list_reminders') {
      const reminders = listUpcomingReminders(from);
      if (!reminders || reminders.length === 0) {
        return `Your schedule is entirely clear at present, sir. No pending reminders on your agenda. 🎩🛎️`;
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
            }) + ' PKT';
        } catch (e) {
          timeStr = r.due_at;
        }
        return `• *[#${r.id}]* 🕰️ ${timeStr}\n  ↳ _"${r.content}"_`;
      });
      return (
        `🛎️ *Your Itinerary & Upcoming Reminders, sir:* (${reminders.length})\n\n` +
        `${lines.join('\n\n')}\n\n` +
        `_Should you wish to cancel an appointment, simply instruct me: "cancel meeting reminder", etc._ 🎩`
      );
    }

    // ── 3. Delete / Cancel Reminder ───────────────────────────────────────────
    if (parsed.action === 'delete_reminder') {
      // 1. Cancel all
      if (parsed.all) {
        const count = deleteAllReminders(from);
        if (count === 0) {
          return `Your schedule was already entirely clear, sir. No reminders were found to cancel. 🎩`;
        }
        return `As you wish, sir. I have cleared all ${count} upcoming reminder(s) from your agenda. Your calendar is now completely free. 🛎️🎩`;
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
          return `Your schedule is entirely clear, sir. No pending reminders were found to cancel. 🎩`;
        }
        const available = pending.map(r => `• [#${r.id}] "${r.content}"`).join('\n');
        return `I examined your agenda, sir, but could find no reminder matching that description. 🔍🎩\n\n*Your active reminders at hand:*\n${available}`;
      }

      deleteReminder(targetReminder.id);
      const reply =
        parsed.reply ||
        `As you wish, sir. I have removed the reminder from your agenda. 🛎️`;
      return `${reply}\n\n_Cancelled: #${targetReminder.id} ("${targetReminder.content}")_ 🎩`;
    }

    // ── 4. Save Secret ────────────────────────────────────────────────────────
    if (parsed.action === 'save_secret' && parsed.content) {
      const encrypted = encrypt(parsed.content);
      const tags = parsed.label ? [parsed.label.toLowerCase().replace(/\s+/g, '_')] : ['secret'];
      const id = save({
        type: 'secret',
        content: encrypted,
        tags,
        isSecret: true,
      });
      const reply =
        parsed.reply ||
        `Under lock and key, sir. Your sensitive credentials have been encrypted with AES-256 and safely sealed in the vault. 🔐🎩`;
      return `${reply}\n\n_Ref: Encrypted Vault Secret #${id}_`;
    }

    // ── 5. Save Note ──────────────────────────────────────────────────────────
    if (parsed.action === 'save_note' && parsed.content) {
      const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
      const id = save({
        type: 'note',
        content: parsed.content,
        tags,
      });
      const tagStr = tags.length ? `\n_Tags:_ ${tags.map(t => '#' + t).join(' ')}` : '';
      const reply =
        parsed.reply ||
        `Safely committed to your vault archives, sir. 📝🎩`;
      return `${reply}\n\n_Ref: Vault Entry #${id}_${tagStr}`;
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
        return `My apologies, sir, but I could locate no image or document stored within the vault archives. 📸🎩`;
      }

      if (from) {
        console.log(`🚀 [Gemini] Dispatching media ID #${targetItem.id} to ${from}...`);
        await sendMediaMessage(from, {
          type: targetItem.type === 'document' ? 'document' : 'image',
          filePath: targetItem.file_path,
          mediaId: targetItem.media_id,
          mimeType: targetItem.mime_type || 'image/jpeg',
          caption: targetItem.content || 'Here is your requested archive, sir. 📸🎩',
        });
        return parsed.reply || `Right away, sir. Delivering your requested photograph to your chat immediately! 📸🎩`;
      }

      return `📸 Photograph ID #${targetItem.id} ("${targetItem.content}") is ready in the vault, sir.`;
    }

    // ── 7. Search Vault ───────────────────────────────────────────────────────
    if (parsed.action === 'search_vault' && parsed.query) {
      const results = keywordSearch(parsed.query);
      if (!results || results.length === 0) {
        return `I have examined the vault records for _"${parsed.query}"_, sir, but regret to inform you that no matching entries were found. 🔍🎩`;
      }
      const lines = results.map(r => {
        const preview = r.is_secret
          ? `🔐 _[Encrypted Secret — instruct me to "reveal ${r.id}" to unseal]_`
          : `"${r.content.slice(0, 80)}"`;
        const icon = r.type === 'image' ? '📸' : r.type === 'secret' ? '🔐' : '📝';
        return `• *[#${r.id}]* ${icon} *${r.type.toUpperCase()}:* ${preview}`;
      });
      return (
        `🛎️ *Allow me to refresh your memory, sir.* Found ${results.length} record(s) regarding _"${parsed.query}"_:\n\n` +
        `${lines.join('\n\n')}\n\n` +
        `_At your service should you require further inspection._ 🎩`
      );
    }

    // ── 8. List Vault ─────────────────────────────────────────────────────────
    if (parsed.action === 'list_vault') {
      const items = listRecent(8);
      if (!items || items.length === 0) {
        return `Your vault is currently pristine and unoccupied, sir. Awaiting your first deposit. 🔒🎩`;
      }
      const lines = items.map(item => {
        const preview = item.is_secret ? '🔐 _[Encrypted Secret]_' : `"${item.content.slice(0, 60)}"`;
        const icon = item.type === 'image' ? '📸' : item.type === 'secret' ? '🔐' : '📝';
        return `• *[#${item.id}]* ${icon} *${item.type.toUpperCase()}* — ${preview}`;
      });
      return (
        `🎩 *A ledger of your recent vault archives, sir:*\n\n` +
        `${lines.join('\n')}\n\n` +
        `_Simply request any entry by its ID or keyword to examine details._ 🛎️`
      );
    }

    // ── 9. Get Item ───────────────────────────────────────────────────────────
    if (parsed.action === 'get_item' && parsed.id) {
      const item = getById(parsed.id);
      if (!item) return `My apologies, sir, but no archive entry exists under ID #${parsed.id}. 🎩`;

      if (item.type === 'image' || item.type === 'document' || item.type === 'file' || item.media_id) {
        if (from) {
          await sendMediaMessage(from, {
            type: item.type === 'document' ? 'document' : 'image',
            filePath: item.file_path,
            mediaId: item.media_id,
            mimeType: item.mime_type || 'image/jpeg',
            caption: item.content || `Vault item #${item.id}`,
          });
          return `Right away, sir. Delivering your requested ${item.type} (ID #${item.id}) to your chat immediately! 📸🎩`;
        }
        return `📸 Entry #${item.id} is an ${item.type}: "${item.content}".`;
      }

      const content = item.is_secret ? decrypt(item.content) : item.content;
      return `🔑 *Unsealed Archive Entry #${item.id} (${item.type}), sir:*\n\n${content}\n\n_Discretion advised._ 🎩`;
    }

    // ── 10. Delete Item ───────────────────────────────────────────────────────
    if (parsed.action === 'delete_item' && parsed.id) {
      deleteItem(parsed.id);
      return `🗑️ It has been done, sir. Entry #${parsed.id} has been permanently expunged from the vault. 🎩`;
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
