import { sendMessage } from './whatsapp/client.js';
import { classify } from './vault/classifier.js';
import { save, listRecent, deleteItem, getById } from './vault/store.js';
import { semanticSearch, getEmbedding, keywordSearch } from './vault/search.js';
import { encrypt, decrypt } from './vault/crypto.js';
import { config } from './config.js';
import { processWithGemini } from './agent/brain.js';
import { sendMediaMessage } from './whatsapp/media.js';

const ICONS = { note: '📝', link: '🔗', secret: '🔐', file: '📎' };

/**
 * Main dispatcher — routes an inbound WhatsApp message to the correct vault action.
 *
 * @param {string} from     Sender phone number
 * @param {{ type: string, text?: string, mediaId?: string, mimeType?: string, caption?: string }} message
 */
export async function dispatch(from, message) {
  const { type: msgType, text, mediaId, mimeType, caption } = message;
  const trimmed = (text || '').trim();

  // ── Gemini AI Natural Language Processing ────────────────────────────────
  if (config.geminiApiKey && trimmed && msgType === 'text') {
    const aiResponse = await processWithGemini(trimmed, from);
    if (aiResponse) {
      return sendMessage(from, aiResponse);
    }
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (trimmed.toLowerCase() === 'list') {
    const items = listRecent(10);
    if (!items.length) return sendMessage(from, '🔒 Your vault is empty.');
    const lines = items.map(item => {
      const preview = item.is_secret ? '[🔐 Secret]' : item.content.slice(0, 60);
      return `[${item.id}] ${item.type.toUpperCase()} — ${preview}`;
    });
    return sendMessage(from, `📦 Last ${items.length} items:\n\n${lines.join('\n')}`);
  }

  // ── delete <id> ───────────────────────────────────────────────────────────
  const deleteMatch = trimmed.match(/^delete\s+(\d+)$/i);
  if (deleteMatch) {
    const id = parseInt(deleteMatch[1], 10);
    const item = getById(id);
    if (!item) return sendMessage(from, `❌ No item with ID ${id}`);
    deleteItem(id);
    return sendMessage(from, `🗑️ Deleted item #${id}`);
  }

  // ── get <id> (reveal secret or send media file) ───────────────────────────
  const getMatch =
    trimmed.match(/^get\s+(\d+)$/i) ||
    trimmed.match(/^(?:show|send)\s+(?:me\s+)?(?:photo|image|item)?\s*#?(\d+)$/i);
  if (getMatch) {
    const id = parseInt(getMatch[1], 10);
    const item = getById(id);
    if (!item) return sendMessage(from, `❌ No item with ID #${id}`);

    // If it is an image, document, or has a media_id, send the actual file!
    if (item.type === 'image' || item.type === 'document' || item.type === 'file' || item.media_id) {
      await sendMessage(from, `📸 Sending your ${item.type} (ID #${id}) ...`);
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
    return sendMessage(from, `🔑 #${id} (${item.type}):\n${content}`);
  }

  // ── media / file attachment ───────────────────────────────────────────────
  if (msgType !== 'text' && mediaId) {
    const isImage = msgType === 'image';
    const defaultCaption = isImage ? 'Uploaded photo' : `File (${mimeType})`;
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
        ? `📸 Photo securely saved to your vault! ID: #${id}${caption ? `\nCaption: "${caption}"` : ''}\n\nAsk me anytime: "send photo #${id}" to get it back!`
        : `📎 File saved to your vault! ID: #${id}\nType: ${mimeType}${caption ? `\nCaption: ${caption}` : ''}`
    );
  }

  // ── text processing ───────────────────────────────────────────────────────
  const { type, content, tags, isSearch } = await classify(trimmed);

  // Search intent
  if (isSearch) {
    await sendMessage(from, '🔍 Searching your vault...');

    // Extract core query by removing natural language trigger prefixes
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
      // If OpenAI embedding is not available, gracefully use keyword search
      console.warn('Semantic search unavailable, using keyword fallback:', err.message);
    }

    if (semanticResults && semanticResults.length > 0) {
      const lines = semanticResults.map(r => {
        const preview = r.is_secret
          ? '[🔐 Secret — use `get <id>` to reveal]'
          : r.content.slice(0, 80);
        return `[${r.id}] ${r.type.toUpperCase()} — ${preview}`;
      });
      return sendMessage(from, `🧠 Found ${semanticResults.length} result(s):\n\n${lines.join('\n\n')}`);
    }

    // Fallback to keyword search
    const kwResults = keywordSearch(cleanQuery);
    if (kwResults.length > 0) {
      const lines = kwResults.map(r => {
        const preview = r.is_secret ? '[🔐 Secret]' : r.content.slice(0, 80);
        return `[${r.id}] ${r.type.toUpperCase()} — ${preview}`;
      });
      return sendMessage(from, `🔤 Keyword results for "${cleanQuery}":\n\n${lines.join('\n\n')}`);
    }

    return sendMessage(from, `🤷 Nothing found for: "${cleanQuery}"`);
  }

  // ── store item ────────────────────────────────────────────────────────────
  let storedContent = content;
  let isSecret = false;

  if (type === 'secret') {
    storedContent = encrypt(content);
    isSecret = true;
  }

  // Embed non-secret items for semantic search
  let embedding = null;
  if (!isSecret) {
    try {
      embedding = await getEmbedding(content);
    } catch (err) {
      console.warn('Embedding failed (will use keyword search only):', err.message);
    }
  }

  const id = save({ type, content: storedContent, tags, embedding, isSecret });

  const tagStr = tags.length ? `\nTags: ${tags.map(t => '#' + t).join(' ')}` : '';
  const icon = ICONS[type] || '📦';
  return sendMessage(from, `${icon} Saved! ID: #${id}${tagStr}`);
}
