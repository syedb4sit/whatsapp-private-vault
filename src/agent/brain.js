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
  saveMemory,
  listMemories,
  deleteMemory,
  deleteAllMemories,
  getRecentConversation,
} from '../vault/store.js';
import { keywordSearch } from '../vault/search.js';
import { encrypt, decrypt } from '../vault/crypto.js';
import { sendMediaMessage } from '../whatsapp/media.js';
import { textToSpeech } from '../whatsapp/tts.js';

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
 * Build dynamic system prompt with full personal context, accumulated long-term memories,
 * multi-turn conversation history, live temporal grounding, and active reminders.
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

  // 1. Active reminders
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

  // 2. Accumulated Long-Term Memories
  let memoriesList = [];
  try {
    memoriesList = listMemories(from);
  } catch (e) {}

  const memoriesContext =
    memoriesList.length > 0
      ? memoriesList
          .map(m => `  • [${(m.category || 'general').toUpperCase()}]: ${m.key} = "${m.value}"`)
          .join('\n')
      : '  No personal memories recorded yet.';

  // 3. Multi-turn recent conversation turns
  let convHistory = [];
  try {
    convHistory = getRecentConversation(from, 8);
  } catch (e) {}

  const historyContext =
    convHistory.length > 0
      ? convHistory
          .map(c => `  [${c.role === 'user' ? 'Mr. Basit' : 'Butler'}]: ${c.content}`)
          .join('\n')
      : '  (Starting fresh dialogue)';

  return `
You are the elite, ultra-intelligent personal butler and memory vault manager on WhatsApp for your master, Mr. Basit.
Think of a classic, understated British personal assistant (like Jarvis or a modern, poised Alfred) — exceptionally sharp, proactive, discreet, and natural.

MASTER'S CORE PROFILE & FIXED ROUTINE:
- Master's Name: Basit (address him naturally as "Mr. Basit" or "sir").
- Office Routine: Goes to office every day from 5:00 PM – 5:15 PM until ~1:00 AM – 1:30 AM PKT.
- University Routine: Attends university 3 days a week: Monday, Tuesday, and Wednesday (morning ~8:30/9:00 AM to ~3:00/4:00 PM), but he always departs university for home around 1:00 PM PKT.
- Upcoming Exams: University exams are imminent. His FIRST EXAM is this upcoming Monday! Prioritize academic reminders and revision.

ACCUMULATED MEMORY & KNOWLEDGE BASE ABOUT MR. BASIT:
${memoriesContext}

RECENT CONVERSATION HISTORY (CHRONOLOGICAL):
${historyContext}

ACTIVE UPCOMING REMINDERS:
${remindersContext}

CURRENT DATE & TIME:
- UTC ISO: ${utcIso}
- Local Time in Pakistan (PKT, UTC+5): ${pktString}
- Timezone: Asia/Karachi (UTC+5)

CORE BUTLER BEHAVIOR & RULES:
1. PERSISTENT LONG-TERM MEMORY (CRITICAL):
   - Whenever Mr. Basit shares or mentions any fact, preference, relationship, habit, rule, credential hint, or detail about his life in casual chat (e.g. "my brother is Hamza", "I like black coffee", "my car plate is LEA-123", "Mohib is my FYP teammate", "I study at FAST", "my blood group is B+", "I prefer tea over coffee"):
     AUTONOMOUSLY extract it and include in your JSON response under "learned_memories": [ { "category": "people"|"preference"|"habit"|"fact"|"academics"|"vehicle", "key": "...", "value": "..." } ].
     You do not need him to say "save note". You are intelligent and quietly remember important details about your master!
   - When asked what you remember about him ("what do you know about me?", "do you know my brother?", "what is my profile?", "who am I?"):
     Answer warmly, comprehensively, and accurately using your accumulated memories and core profile.
   - If he asks to forget or remove a memory ("forget my car number", "remove brother"), populate "forget_memories": ["key"].

2. MULTI-TURN CONVERSATION CONTINUITY:
   - Use the RECENT CONVERSATION HISTORY to resolve pronouns ("it", "that", "him", "her"), follow-up questions, and modifications!
   - If he said "Remind me at 5 to call Ali" and next says "actually make that 5:30", recognize that "that" refers to the 5:00 PM reminder to call Ali! Use "schedule_reminder" with "cancel_query": "call ali" and set the new time.
   - If he asks "who did I say I needed to call?", look at the conversation history and reply "You mentioned calling Ali, sir."

3. PROACTIVE CONFLICT WARNINGS:
   - If Mr. Basit asks to schedule an appointment or reminder during his daily office hours (5:00 PM – 1:00 AM PKT) or university hours (Mon-Wed morning to 1:00 PM), schedule the reminder as requested, but politely append a short, discreet note about the conflict (e.g. "Do note that you are typically at the office during that hour, sir.").

4. TONE & POLISH:
   - Address him respectfully as "Mr. Basit" or "sir", keeping it subtle and natural.
   - Keep emojis very low (0 to 1 subtle emoji max per message, e.g. ⏰, 🔒).
   - NEVER expose database IDs or numbers like "#20", "ID #5", or "(1)".
   - Clean WhatsApp formatting: *bold* for emphasis, _italics_ sparingly.

CRITICAL INSTRUCTIONS FOR DATE & TIME CALCULATIONS:
- Compute future target time and output it in "due_at" as a standard UTC ISO-8601 string.
- Local time is PKT (UTC+5). To convert local time to UTC, subtract 5 hours (e.g. 6:00 PM PKT = 13:00:00Z UTC).
- If the clock time has already passed today, schedule for tomorrow at that time.

AVAILABLE ACTIONS (Strictly output valid JSON):

1. "schedule_reminder":
   Fields:
   - "action": "schedule_reminder"
   - "content": string
   - "due_at": string (UTC ISO-8601 timestamp)
   - "cancel_query": optional string (if replacing/updating an earlier reminder)
   - "cancel_id": optional integer
   - "reply": string
   - "wants_voice": optional boolean

2. "list_reminders":
   Fields:
   - "action": "list_reminders"
   - "reply": optional string
   - "wants_voice": optional boolean

3. "delete_reminder":
   Fields:
   - "action": "delete_reminder"
   - "id": optional integer
   - "query": optional string
   - "all": optional boolean
   - "reply": string

4. "remember":
   When explicitly asked to remember or note a fact/preference.
   Fields:
   - "action": "remember"
   - "category": string ("people"|"preference"|"habit"|"fact"|"academics"|"vehicle"|"general")
   - "key": string
   - "value": string
   - "reply": string (e.g. "I have committed that to memory, Mr. Basit.")

5. "recall_memory":
   When asked what you remember about him, a specific topic, or his profile.
   Fields:
   - "action": "recall_memory"
   - "query": optional string
   - "reply": string (summarizing remembered facts clearly)

6. "forget_memory":
   When asked to forget a fact.
   Fields:
   - "action": "forget_memory"
   - "key": string
   - "reply": string

7. "save_secret":
   Fields:
   - "action": "save_secret"
   - "content": string
   - "label": string
   - "reply": string

8. "save_note":
   Fields:
   - "action": "save_note"
   - "content": string
   - "tags": optional array of strings
   - "reply": string

9. "search_vault":
   Fields:
   - "action": "search_vault"
   - "query": string

10. "list_vault":
    Fields:
    - "action": "list_vault"

11. "get_item":
    Fields:
    - "action": "get_item"
    - "id": integer

12. "delete_item":
    Fields:
    - "action": "delete_item"
    - "id": integer

13. "send_media":
    Fields:
    - "action": "send_media"
    - "id": optional integer
    - "reply": string

14. "chat":
    Routine checks, contextual discussions, schedule queries, answering from conversation history.
    Fields:
    - "action": "chat"
    - "reply": string
    - "wants_voice": optional boolean

Plus optional root fields on ANY response:
- "learned_memories": [ { "category": string, "key": string, "value": string } ]
- "forget_memories": [ string ]

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

  const targetUser = from || 'default_user';
  const systemInstruction = buildSystemPrompt(targetUser);
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
    let textResponse = null;

    // ── 0. Autonomous Memory Extraction (Background) ──────────────────────────
    if (Array.isArray(parsed.learned_memories) && parsed.learned_memories.length > 0) {
      for (const m of parsed.learned_memories) {
        if (m.key && m.value) {
          saveMemory({
            userId: targetUser,
            category: m.category || 'general',
            key: m.key,
            value: m.value,
          });
          console.log(`🧠 [Memory Engine] Autonomously learned: [${m.category || 'general'}] ${m.key} = "${m.value}"`);
        }
      }
    }

    if (Array.isArray(parsed.forget_memories) && parsed.forget_memories.length > 0) {
      for (const k of parsed.forget_memories) {
        deleteMemory(targetUser, k);
        console.log(`🧠 [Memory Engine] Forgot memory key: ${k}`);
      }
    }

    // ── 1. Schedule Reminder ──────────────────────────────────────────────────
    if (parsed.action === 'schedule_reminder' && parsed.content) {
      // If modifying/updating an earlier reminder
      if (parsed.cancel_id) {
        deleteReminder(parsed.cancel_id);
      } else if (parsed.cancel_query) {
        const pending = listUpcomingReminders(targetUser);
        const match = pending.find(r => r.content.toLowerCase().includes(parsed.cancel_query.toLowerCase()));
        if (match) deleteReminder(match.id);
      }

      let dueAt = parsed.due_at;
      if (!dueAt || isNaN(new Date(dueAt).getTime())) {
        dueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      }

      saveReminder({
        userId: targetUser,
        content: parsed.content,
        dueAt,
      });

      if (parsed.reply) {
        textResponse = parsed.reply;
      } else {
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
        textResponse = `Noted, Mr. Basit. I'll remind you about "${parsed.content}" at ${displayTime}. ⏰`;
      }
    }

    // ── 2. List Reminders ─────────────────────────────────────────────────────
    else if (parsed.action === 'list_reminders') {
      const reminders = listUpcomingReminders(targetUser);
      if (!reminders || reminders.length === 0) {
        textResponse = 'Your schedule is clear right now, Mr. Basit.';
      } else {
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
        textResponse = `Here is your upcoming schedule, Mr. Basit:\n\n${lines.join('\n')}`;
      }
    }

    // ── 3. Delete / Cancel Reminder ───────────────────────────────────────────
    else if (parsed.action === 'delete_reminder') {
      if (parsed.all) {
        deleteAllReminders(targetUser);
        textResponse = 'All upcoming reminders have been cleared, Mr. Basit.';
      } else {
        let targetReminder = null;
        if (parsed.id) {
          targetReminder = getReminderById(parsed.id);
        }

        if (!targetReminder) {
          const pending = listUpcomingReminders(targetUser);
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
          const pending = listUpcomingReminders(targetUser);
          if (!pending || pending.length === 0) {
            textResponse = 'Your schedule is already clear, Mr. Basit.';
          } else {
            const available = pending.map(r => `• ${r.content}`).join('\n');
            textResponse = `I couldn't find a reminder matching that, Mr. Basit. Here is what is on your schedule:\n\n${available}`;
          }
        } else {
          deleteReminder(targetReminder.id);
          textResponse =
            parsed.reply ||
            `Cancelled your reminder for "${targetReminder.content}", Mr. Basit.`;
        }
      }
    }

    // ── 4. Remember (Explicit Fact / Preference Storage) ──────────────────────
    else if (parsed.action === 'remember') {
      if (parsed.key && parsed.value) {
        saveMemory({
          userId: targetUser,
          category: parsed.category || 'general',
          key: parsed.key,
          value: parsed.value,
        });
      }
      textResponse = parsed.reply || 'I have committed that to memory, Mr. Basit.';
    }

    // ── 5. Recall Memory / Profile Summary ────────────────────────────────────
    else if (parsed.action === 'recall_memory') {
      if (parsed.reply) {
        textResponse = parsed.reply;
      } else {
        const mems = listMemories(targetUser);
        if (mems.length === 0) {
          textResponse = 'I have your daily office and university routines in mind, Mr. Basit, but no personal preferences recorded yet.';
        } else {
          const lines = mems.map(m => `• *${m.key}*: ${m.value}`);
          textResponse = `Here is what I have recorded in memory for you, Mr. Basit:\n\n${lines.join('\n')}`;
        }
      }
    }

    // ── 6. Forget Memory ──────────────────────────────────────────────────────
    else if (parsed.action === 'forget_memory') {
      if (parsed.key) {
        deleteMemory(targetUser, parsed.key);
      }
      textResponse = parsed.reply || 'Removed from my memory, Mr. Basit.';
    }

    // ── 7. Save Secret ────────────────────────────────────────────────────────
    else if (parsed.action === 'save_secret' && parsed.content) {
      const encrypted = encrypt(parsed.content);
      const tags = parsed.label ? [parsed.label.toLowerCase().replace(/\s+/g, '_')] : ['secret'];
      save({
        type: 'secret',
        content: encrypted,
        tags,
        isSecret: true,
      });
      textResponse = parsed.reply || 'Stored and encrypted securely in your vault, Mr. Basit. 🔒';
    }

    // ── 8. Save Note ──────────────────────────────────────────────────────────
    else if (parsed.action === 'save_note' && parsed.content) {
      const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
      save({
        type: 'note',
        content: parsed.content,
        tags,
      });
      textResponse = parsed.reply || 'Saved to your vault, Mr. Basit.';
    }

    // ── 9. Send / Download Media ──────────────────────────────────────────────
    else if (parsed.action === 'send_media') {
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
        return 'I could not find that image or document in your vault, Mr. Basit.';
      }

      if (from) {
        console.log(`🚀 [Gemini] Dispatching media ID #${targetItem.id} to ${from}...`);
        await sendMediaMessage(from, {
          type: targetItem.type === 'document' ? 'document' : 'image',
          filePath: targetItem.file_path,
          mediaId: targetItem.media_id,
          mimeType: targetItem.mime_type || 'image/jpeg',
          caption: targetItem.content || 'Here is your photo, Mr. Basit.',
        });
        return parsed.reply || 'Sending your photo now, Mr. Basit.';
      }

      return `Your photo ("${targetItem.content}") is ready in the vault, Mr. Basit.`;
    }

    // ── 10. Search Vault ──────────────────────────────────────────────────────
    else if (parsed.action === 'search_vault' && parsed.query) {
      const results = keywordSearch(parsed.query);
      if (!results || results.length === 0) {
        textResponse = `I couldn't find anything matching "${parsed.query}" in your vault, Mr. Basit.`;
      } else {
        const lines = results.map(r => {
          const preview = r.is_secret
            ? '[Encrypted Secret]'
            : r.content;
          return `• ${preview}`;
        });
        textResponse = `Here is what I found for "${parsed.query}", Mr. Basit:\n\n${lines.join('\n')}`;
      }
    }

    // ── 11. List Vault ────────────────────────────────────────────────────────
    else if (parsed.action === 'list_vault') {
      const items = listRecent(8);
      if (!items || items.length === 0) {
        textResponse = 'Your vault is currently empty, Mr. Basit.';
      } else {
        const lines = items.map(item => {
          const preview = item.is_secret ? '[Encrypted Secret]' : item.content.slice(0, 70);
          return `• ${preview}`;
        });
        textResponse = `Here are your recent vault notes, Mr. Basit:\n\n${lines.join('\n')}`;
      }
    }

    // ── 12. Get Item ──────────────────────────────────────────────────────────
    else if (parsed.action === 'get_item' && parsed.id) {
      const item = getById(parsed.id);
      if (!item) return 'I could not find that entry in your vault, Mr. Basit.';

      if (item.type === 'image' || item.type === 'document' || item.type === 'file' || item.media_id) {
        if (from) {
          await sendMediaMessage(from, {
            type: item.type === 'document' ? 'document' : 'image',
            filePath: item.file_path,
            mediaId: item.media_id,
            mimeType: item.mime_type || 'image/jpeg',
            caption: item.content || `Vault item`,
          });
          return `Sending your ${item.type} now, Mr. Basit.`;
        }
        return `Item: "${item.content}".`;
      }

      const content = item.is_secret ? decrypt(item.content) : item.content;
      return `${content}`;
    }

    // ── 13. Delete Item ───────────────────────────────────────────────────────
    else if (parsed.action === 'delete_item' && parsed.id) {
      deleteItem(parsed.id);
      textResponse = 'Removed from your vault, Mr. Basit.';
    }

    // ── 14. Chat / Direct Reply ───────────────────────────────────────────────
    else if (parsed.reply) {
      textResponse = parsed.reply;
    }

    // ── Outbound Audio / Voice Note Dispatch ──────────────────────────────────
    if (textResponse && parsed.wants_voice && from) {
      try {
        const audioPath = await textToSpeech(textResponse);
        if (audioPath) {
          console.log(`🎙️ [Voice Dispatch] Sending British butler audio reply to ${from}...`);
          await sendMediaMessage(from, {
            type: 'audio',
            filePath: audioPath,
            mimeType: 'audio/mpeg',
          });
        }
      } catch (voiceErr) {
        console.warn('⚠️ Outbound voice note failed, sending text reply:', voiceErr.message);
      }
    }

    return textResponse;
  } catch (err) {
    console.warn('⚠️ Action execution error:', err.message);
    return null;
  }
}
