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

  // ── 2. Fallback Manual Commands ──────────────────────────────────────────

  // list reminders / reminders
  if (trimmed.toLowerCase() === 'reminders' || trimmed.toLowerCase() === 'list reminders') {
    const reminders = listUpcomingReminders(from);
    if (!reminders || reminders.length === 0) {
      return sendMessage(from, 'Your schedule is clear right now, sir.');
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
    return sendMessage(
      from,
      `Here is your upcoming schedule, sir:\n\n${lines.join('\n')}`
    );
  }

  // cancel all reminders
  if (trimmed.toLowerCase() === 'cancel all reminders' || trimmed.toLowerCase() === 'delete all reminders') {
    const count = deleteAllReminders(from);
    if (count === 0) {
      return sendMessage(from, 'Your schedule was already clear, sir.');
    }
    return sendMessage(from, 'All upcoming reminders have been cleared, sir.');
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
        return sendMessage(from, 'I could not find that reminder, sir.');
      }
      deleteReminder(id);
      return sendMessage(from, `Cancelled your reminder for "${existing.content}", sir.`);
    }

    // Keyword/topic based cancel
    const pending = listUpcomingReminders(from);
    const cleanQuery = targetQuery.toLowerCase();
    const match = pending.find(r => r.content.toLowerCase().includes(cleanQuery));

    if (match) {
      deleteReminder(match.id);
      return sendMessage(from, `Cancelled your reminder for "${match.content}", sir.`);
    }

    return sendMessage(from, `I couldn't find a reminder matching "${targetQuery}", sir.`);
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

    saveReminder({
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
      `Noted, sir. I'll remind you about "${task}" at ${displayTime}. ⏰`
    );
  }

  // list (vault items)
  if (trimmed.toLowerCase() === 'list') {
    const items = listRecent(10);
    if (!items.length) return sendMessage(from, 'Your vault is currently empty, sir.');
    const lines = items.map(item => {
      const preview = item.is_secret ? '[Encrypted Secret]' : item.content.slice(0, 70);
      return `• ${preview}`;
    });
    return sendMessage(
      from,
      `Here are your recent vault notes, sir:\n\n${lines.join('\n')}`
    );
  }

  // delete <id>
  const deleteMatch = trimmed.match(/^delete\s+(\d+)$/i);
  if (deleteMatch) {
    const id = parseInt(deleteMatch[1], 10);
    const item = getById(id);
    if (!item) return sendMessage(from, 'I could not find that entry, sir.');
    deleteItem(id);
    return sendMessage(from, 'Removed from your vault, sir.');
  }

  // get <id> (reveal secret or send media file)
  const getMatch =
    trimmed.match(/^get\s+(\d+)$/i) ||
    trimmed.match(/^(?:show|send)\s+(?:me\s+)?(?:photo|image|item)?\s*#?(\d+)$/i);
  if (getMatch) {
    const id = parseInt(getMatch[1], 10);
    const item = getById(id);
    if (!item) return sendMessage(from, 'I could not find that entry, sir.');

    if (item.type === 'image' || item.type === 'document' || item.type === 'file' || item.media_id) {
      await sendMessage(from, `Sending your ${item.type} now, sir.`);
      await sendMediaMessage(from, {
        type: item.type === 'document' ? 'document' : 'image',
        filePath: item.file_path,
        mediaId: item.media_id,
        mimeType: item.mime_type || 'image/jpeg',
        caption: item.content || `Vault item`,
      });
      return;
    }

    const content = item.is_secret ? decrypt(item.content) : item.content;
    return sendMessage(from, `${content}`);
  }

  // media / file attachment
  if (msgType !== 'text' && mediaId) {
    const isImage = msgType === 'image';
    const defaultCaption = isImage ? 'Photograph' : `Document (${mimeType})`;
    save({
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
        ? `Your photograph has been saved to the vault, sir.${caption ? `\n_${caption}_` : ''}`
        : `Your document has been saved to the vault, sir.${caption ? `\n_${caption}_` : ''}`
    );
  }

  // text processing (classifier fallback)
  const { type, content, tags, isSearch } = await classify(trimmed);

  // Search intent
  if (isSearch) {
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
          ? '[Encrypted Secret]'
          : r.content;
        return `• ${preview}`;
      });
      return sendMessage(
        from,
        `Here is what I found for "${cleanQuery}", sir:\n\n${lines.join('\n')}`
      );
    }

    const kwResults = keywordSearch(cleanQuery);
    if (kwResults.length > 0) {
      const lines = kwResults.map(r => {
        const preview = r.is_secret ? '[Encrypted Secret]' : r.content;
        return `• ${preview}`;
      });
      return sendMessage(
        from,
        `Here is what I found for "${cleanQuery}", sir:\n\n${lines.join('\n')}`
      );
    }

    return sendMessage(from, `I couldn't find anything matching "${cleanQuery}" in your vault, sir.`);
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

  save({ type, content: storedContent, tags, embedding, isSecret });

  return sendMessage(from, isSecret ? 'Stored and encrypted securely in your vault, sir.' : 'Saved to your vault, sir.');
}
