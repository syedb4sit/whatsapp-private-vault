import { sendMessage } from './whatsapp/client.js';
import { classify } from './vault/classifier.js';
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
} from './vault/store.js';
import { semanticSearch, getEmbedding, keywordSearch } from './vault/search.js';
import { encrypt, decrypt } from './vault/crypto.js';
import { config } from './config.js';
import { processWithGemini } from './agent/brain.js';
import { sendMediaMessage } from './whatsapp/media.js';

const ICONS = { note: '📝', link: '🔗', secret: '🔐', file: '📎' };

/**
 * Main dispatcher — routes an inbound WhatsApp message to the correct vault action.
 *
 * @param {string} from     Sender phone number or user identifier
 * @param {{ type: string, text?: string, mediaId?: string, mimeType?: string, caption?: string }} message
 */
export async function dispatch(from, message) {
  const { type: msgType, text, mediaId, mimeType, caption } = message;
  const trimmed = (text || '').trim();

  // ── 1. Gemini AI Natural Language Processing (Primary) ───────────────────
  if (config.geminiApiKey && trimmed && msgType === 'text') {
    const aiResponse = await processWithGemini(trimmed, from);
    if (aiResponse) {
      return sendMessage(from, aiResponse);
    }
  }

  // ── 2. Fallback Manual Commands (Butler Persona) ─────────────────────────

  // list reminders / reminders
  if (trimmed.toLowerCase() === 'reminders' || trimmed.toLowerCase() === 'list reminders') {
    const reminders = listUpcomingReminders(from);
    if (!reminders || reminders.length === 0) {
      return sendMessage(from, 'Your schedule is entirely clear at present, sir. No pending reminders on your agenda. 🎩🛎️');
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
    return sendMessage(
      from,
      `🛎️ *Your Itinerary & Upcoming Reminders, sir:* (${reminders.length})\n\n${lines.join('\n\n')}\n\n_Should you wish to cancel an entry, simply instruct me: "cancel meeting reminder", etc._ 🎩`
    );
  }

  // cancel all reminders
  if (trimmed.toLowerCase() === 'cancel all reminders' || trimmed.toLowerCase() === 'delete all reminders') {
    const count = deleteAllReminders(from);
    if (count === 0) {
      return sendMessage(from, 'Your schedule was already entirely clear, sir. No reminders were found to cancel. 🎩');
    }
    return sendMessage(
      from,
      `As you wish, sir. I have cleared all ${count} upcoming reminder(s) from your agenda. Your calendar is now completely free. 🛎️🎩`
    );
  }

  // cancel reminder <id> / delete reminder <id> OR cancel <topic> reminder
  const cancelRemMatch =
    trimmed.match(/^(?:cancel|delete|remove)\s+(?:the\s+)?(.+?)\s+reminder(?:\s+for\s+(.+))?$/i) ||
    trimmed.match(/^(?:cancel|delete|remove)\s+reminder\s+(.+)$/i);
  if (cancelRemMatch) {
    const targetQuery = (cancelRemMatch[1] || '').trim();
    const id = parseInt(targetQuery, 10);

    if (!isNaN(id)) {
      const existing = getReminderById(id);
      if (!existing) {
        return sendMessage(from, `My apologies, sir, but no reminder exists under ID #${id}. 🎩`);
      }
      deleteReminder(id);
      return sendMessage(
        from,
        `As you wish, sir. I have removed reminder #${id} ("${existing.content}") from your agenda. 🛎️🎩`
      );
    }

    // Keyword/topic based cancel
    const pending = listUpcomingReminders(from);
    const cleanQuery = targetQuery.toLowerCase();
    const match = pending.find(r => r.content.toLowerCase().includes(cleanQuery));

    if (match) {
      deleteReminder(match.id);
      return sendMessage(
        from,
        `As you wish, sir. I have removed reminder #${match.id} ("${match.content}") from your agenda. 🛎️🎩`
      );
    }

    return sendMessage(from, `I examined your agenda, sir, but could find no reminder matching "${targetQuery}". 🔍🎩`);
  }

  // remind me in <X> (min|mins|minutes|hours) to <task> (Fallback parser)
  const remindMatch = trimmed.match(/^remind\s+me\s+in\s+(\d+)\s*(m|min|mins|minutes|h|hr|hours?)\s+(?:to\s+)?(.+)$/i);
  if (remindMatch) {
    const amount = parseInt(remindMatch[1], 10);
    const unit = remindMatch[2].toLowerCase();
    const task = remindMatch[3].trim();
    const isHours = unit.startsWith('h');
    const delayMs = isHours ? amount * 60 * 60 * 1000 : amount * 60 * 1000;
    const dueAt = new Date(Date.now() + delayMs).toISOString();

    const id = saveReminder({
      userId: from || 'default_user',
      content: task,
      dueAt,
    });

    const displayTime =
      new Date(dueAt).toLocaleTimeString('en-US', {
        timeZone: 'Asia/Karachi',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }) + ' PKT';

    return sendMessage(
      from,
      `Right away, sir. 🕰️ I have noted your reminder and shall alert you punctually when the moment arrives.\n\n` +
      `📌 *Task:* "${task}"\n` +
      `🕰️ *Scheduled:* ${displayTime} _(Ref: #${id})_ 🎩`
    );
  }

  // list (vault items)
  if (trimmed.toLowerCase() === 'list') {
    const items = listRecent(10);
    if (!items.length) return sendMessage(from, 'Your vault is currently pristine and unoccupied, sir. Awaiting your first deposit. 🔒🎩');
    const lines = items.map(item => {
      const preview = item.is_secret ? '🔐 _[Encrypted Secret]_' : `"${item.content.slice(0, 60)}"`;
      const icon = item.type === 'image' ? '📸' : item.type === 'secret' ? '🔐' : '📝';
      return `• *[#${item.id}]* ${icon} *${item.type.toUpperCase()}* — ${preview}`;
    });
    return sendMessage(
      from,
      `🎩 *A ledger of your recent vault archives, sir:*\n\n${lines.join('\n')}\n\n_Simply request any entry by its ID or keyword to examine details._ 🛎️`
    );
  }

  // delete <id>
  const deleteMatch = trimmed.match(/^delete\s+(\d+)$/i);
  if (deleteMatch) {
    const id = parseInt(deleteMatch[1], 10);
    const item = getById(id);
    if (!item) return sendMessage(from, `My apologies, sir, but no archive entry exists under ID #${id}. 🎩`);
    deleteItem(id);
    return sendMessage(from, `🗑️ It has been done, sir. Entry #${id} has been permanently expunged from the vault. 🎩`);
  }

  // get <id> (reveal secret or send media file)
  const getMatch =
    trimmed.match(/^get\s+(\d+)$/i) ||
    trimmed.match(/^(?:show|send)\s+(?:me\s+)?(?:photo|image|item)?\s*#?(\d+)$/i);
  if (getMatch) {
    const id = parseInt(getMatch[1], 10);
    const item = getById(id);
    if (!item) return sendMessage(from, `My apologies, sir, but no archive entry exists under ID #${id}. 🎩`);

    if (item.type === 'image' || item.type === 'document' || item.type === 'file' || item.media_id) {
      await sendMessage(from, `Right away, sir. Delivering your requested ${item.type} (ID #${id}) to your chat immediately! 📸🎩`);
      await sendMediaMessage(from, {
        type: item.type === 'document' ? 'document' : 'image',
        filePath: item.file_path,
        mediaId: item.media_id,
        mimeType: item.mime_type || 'image/jpeg',
        caption: item.content || `Vault item #${id}`,
      });
      return;
    }

    const content = item.is_secret ? decrypt(item.content) : item.content;
    return sendMessage(from, `🔑 *Unsealed Archive Entry #${id} (${item.type}), sir:*\n\n${content}\n\n_Discretion advised._ 🎩`);
  }

  // media / file attachment
  if (msgType !== 'text' && mediaId) {
    const isImage = msgType === 'image';
    const defaultCaption = isImage ? 'Uploaded photograph' : `Document (${mimeType})`;
    const id = save({
      type: msgType,
      content: caption || defaultCaption,
      tags: isImage ? ['image', 'photo', 'picture'] : [msgType, 'file'],
      mediaId,
      mimeType,
      filePath: message.filePath || null,
    });
    return sendMessage(
      from,
      isImage
        ? `📸 Your photograph has been deposited into the vault for safekeeping, sir! _(Ref: #${id})_${caption ? `\n_Caption:_ "${caption}"` : ''}\n\nInstruct me anytime: "send photo #${id}" to have it returned!`
        : `📎 Document deposited into your vault, sir! _(Ref: #${id})_\n_Type:_ ${mimeType}${caption ? `\n_Caption:_ ${caption}` : ''}`
    );
  }

  // text processing (classifier fallback)
  const { type, content, tags, isSearch } = await classify(trimmed);

  // Search intent
  if (isSearch) {
    await sendMessage(from, 'Checking our vault archives for you, sir... 🔍🎩');

    let cleanQuery = trimmed;
    const prefixes = [
      'find ',
      'search for ',
      'search ',
      'what did i save about ',
      'what did i save on ',
      'what did i save ',
      'where is ',
      'recall ',
      'show me ',
    ];
    for (const prefix of prefixes) {
      if (cleanQuery.toLowerCase().startsWith(prefix)) {
        cleanQuery = cleanQuery.slice(prefix.length).trim();
        break;
      }
    }
    cleanQuery = cleanQuery.replace(/\?+$/, '').trim() || trimmed;

    let semanticResults = [];
    try {
      semanticResults = await semanticSearch(cleanQuery);
    } catch (err) {
      console.warn('Semantic search unavailable, using keyword fallback:', err.message);
    }

    if (semanticResults && semanticResults.length > 0) {
      const lines = semanticResults.map(r => {
        const preview = r.is_secret
          ? '[🔐 Encrypted Secret — instruct me to "reveal ' + r.id + '" to unseal]'
          : `"${r.content.slice(0, 80)}"`;
        return `• *[#${r.id}]* *${r.type.toUpperCase()}:* ${preview}`;
      });
      return sendMessage(
        from,
        `🛎️ *Allow me to refresh your memory, sir.* Found ${semanticResults.length} record(s):\n\n${lines.join('\n\n')}\n\n_At your service._ 🎩`
      );
    }

    const kwResults = keywordSearch(cleanQuery);
    if (kwResults.length > 0) {
      const lines = kwResults.map(r => {
        const preview = r.is_secret ? '🔐 _[Encrypted Secret]_' : `"${r.content.slice(0, 80)}"`;
        return `• *[#${r.id}]* *${r.type.toUpperCase()}:* ${preview}`;
      });
      return sendMessage(
        from,
        `🛎️ *Allow me to refresh your memory, sir.* Found ${kwResults.length} record(s) matching _"${cleanQuery}"_:\n\n${lines.join('\n\n')}\n\n_At your service._ 🎩`
      );
    }

    return sendMessage(from, `I searched our records for _"${cleanQuery}"_, sir, but found no matching entries. 🔍🎩`);
  }

  // store item
  let storedContent = content;
  let isSecret = false;

  if (type === 'secret') {
    storedContent = encrypt(content);
    isSecret = true;
  }

  let embedding = null;
  if (!isSecret) {
    try {
      embedding = await getEmbedding(content);
    } catch (err) {
      console.warn('Embedding failed (will use keyword search only):', err.message);
    }
  }

  const id = save({ type, content: storedContent, tags, embedding, isSecret });

  const tagStr = tags.length ? `\n_Tags:_ ${tags.map(t => '#' + t).join(' ')}` : '';
  const icon = ICONS[type] || '📦';
  return sendMessage(
    from,
    `${icon} Safely committed to your vault archives, sir. _(Ref: #${id})_${tagStr} 🎩`
  );
}
