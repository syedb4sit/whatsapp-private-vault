import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { save, listRecent, deleteItem, getById } from '../vault/store.js';
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

const SYSTEM_PROMPT = `
You are the intelligent brain of a secure personal memory vault assistant on WhatsApp.
Your job is to read the user's message, determine their intent, and return a single valid JSON object.

Available actions:
1. "save_secret": When the user wants to save passwords, PINs, bank details, API keys, private tokens, or confidential data.
   Required fields: "content" (the secret value), "label" (short title), "reply" (friendly confirmation)
2. "save_note": When the user wants to remember or save regular notes, ideas, reminders, tasks, links, or facts.
   Required fields: "content" (the text), "tags" (optional array of category strings), "reply" (friendly confirmation)
3. "search_vault": When the user asks a question about what they saved, asks where something is, or wants to recall notes.
   Required fields: "query" (the keyword or topic to search)
4. "list_vault": When the user asks to see recent notes, list everything, or check their memory.
   Required fields: "reply"
5. "get_item": When the user asks for a specific note/secret by its numeric ID (e.g. "show me 3", "get item 1", "reveal password 2").
   Required fields: "id" (integer)
6. "delete_item": When the user asks to delete or forget a specific item by ID (e.g. "delete 2", "remove note 1").
   Required fields: "id" (integer)
7. "send_media": When the user asks to see, send, return, download, or show an image, photo, picture, or document (e.g. "send me the photo", "show me my picture", "give me the image I sent", "download image 2", "send me the file").
   Required fields: "id" (optional integer ID if mentioned), "query" (optional keyword like "photo"), "reply" (e.g. "Sending your photo now! 📸")
8. "chat": General greetings, small talk, or questions about what you can do.
   Required fields: "reply"

Rules:
- NEVER leave passwords unencrypted; always classify them as "save_secret".
- If the user asks for an image, photo, or file to be sent/downloaded, ALWAYS use "send_media".
- Keep replies concise, helpful, and natural for WhatsApp with emojis.
`;

/**
 * Process a natural language message with Gemini.
 * Returns a conversational WhatsApp reply string.
 *
 * @param {string} userText
 * @param {string} [from] WhatsApp user identifier (e.g. user:50972923564215)
 */
export async function processWithGemini(userText, from) {
  const client = getGenAI();
  if (!client) return null;

  try {
    const model = client.getGenerativeModel({
      model: 'gemini-3.8-flash',
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    });

    const res = await model.generateContent(userText);
    const text = res.response.text();
    const parsed = JSON.parse(text);

    console.log(`🧠 [Gemini Intent] Action: ${parsed.action}`, parsed);

    // ── Execute Action ────────────────────────────────────────────────────────
    if (parsed.action === 'save_secret' && parsed.content) {
      const encrypted = encrypt(parsed.content);
      const tags = parsed.label ? [parsed.label.toLowerCase().replace(/\s+/g, '_')] : ['secret'];
      const id = save({
        type: 'secret',
        content: encrypted,
        tags,
        isSecret: true,
      });
      return `${parsed.reply || '🔐 Encrypted and saved to your private vault!'} (ID: #${id})`;
    }

    if (parsed.action === 'save_note' && parsed.content) {
      const tags = Array.isArray(parsed.tags) ? parsed.tags : [];
      const id = save({
        type: 'note',
        content: parsed.content,
        tags,
      });
      const tagStr = tags.length ? `\nTags: ${tags.map(t => '#' + t).join(' ')}` : '';
      return `${parsed.reply || '📝 Saved to your vault!'} (ID: #${id})${tagStr}`;
    }

    // ── Send / Download Media ─────────────────────────────────────────────────
    if (parsed.action === 'send_media') {
      let targetItem = null;
      if (parsed.id) {
        targetItem = getById(parsed.id);
      } else {
        // Find the most recent image or file
        const recent = listRecent(20);
        targetItem = recent.find(
          i => i.type === 'image' || i.type === 'file' || i.type === 'document' || i.media_id
        );
      }

      if (!targetItem || (!targetItem.media_id && !targetItem.file_path)) {
        return `📸 I couldn't find any image or file stored in your vault.`;
      }

      if (from) {
        console.log(`🚀 [Gemini] Dispatching media ID #${targetItem.id} to ${from}...`);
        await sendMediaMessage(from, {
          type: targetItem.type === 'document' ? 'document' : 'image',
          filePath: targetItem.file_path,
          mediaId: targetItem.media_id,
          mimeType: targetItem.mime_type || 'image/jpeg',
          caption: targetItem.content || 'Here is your photo from your vault! 📸',
        });
        return parsed.reply || `📸 Here is your photo (ID #${targetItem.id})!`;
      }

      return `📸 Found image ID #${targetItem.id} ("${targetItem.content}") ready for download.`;
    }

    if (parsed.action === 'search_vault' && parsed.query) {
      const results = keywordSearch(parsed.query);
      if (!results || results.length === 0) {
        return `🔍 I searched your vault for "${parsed.query}", but didn't find anything matching yet.`;
      }
      const lines = results.map(r => {
        const preview = r.is_secret
          ? '[🔐 Encrypted Secret — ask "reveal ' + r.id + '" to view]'
          : r.content.slice(0, 80);
        const icon = r.type === 'image' ? '📸' : r.type === 'secret' ? '🔐' : '📝';
        return `[#${r.id}] ${icon} ${r.type.toUpperCase()}: ${preview}`;
      });
      return `🧠 Found ${results.length} item(s) for "${parsed.query}":\n\n${lines.join('\n\n')}`;
    }

    if (parsed.action === 'list_vault') {
      const items = listRecent(8);
      if (!items || items.length === 0) {
        return '🔒 Your vault is currently empty.';
      }
      const lines = items.map(item => {
        const preview = item.is_secret ? '[🔐 Secret]' : item.content.slice(0, 60);
        const icon = item.type === 'image' ? '📸' : item.type === 'secret' ? '🔐' : '📝';
        return `[#${item.id}] ${icon} ${item.type.toUpperCase()} — ${preview}`;
      });
      return `📦 Recent items in your vault:\n\n${lines.join('\n')}`;
    }

    if (parsed.action === 'get_item' && parsed.id) {
      const item = getById(parsed.id);
      if (!item) return `❌ No item found with ID #${parsed.id}.`;

      // If it's media, send the file directly!
      if (item.type === 'image' || item.type === 'document' || item.type === 'file' || item.media_id) {
        if (from) {
          await sendMediaMessage(from, {
            type: item.type === 'document' ? 'document' : 'image',
            filePath: item.file_path,
            mediaId: item.media_id,
            mimeType: item.mime_type || 'image/jpeg',
            caption: item.content || `Vault item #${item.id}`,
          });
          return `📸 Sent your ${item.type} (ID #${item.id}) to WhatsApp!`;
        }
        return `📸 Item #${item.id} is an ${item.type}: "${item.content}".`;
      }

      const content = item.is_secret ? decrypt(item.content) : item.content;
      return `🔑 Item #${item.id} (${item.type}):\n${content}`;
    }

    if (parsed.action === 'delete_item' && parsed.id) {
      deleteItem(parsed.id);
      return `🗑️ Permanently removed item #${parsed.id} from your vault.`;
    }

    if (parsed.reply) {
      return parsed.reply;
    }

    return null;
  } catch (err) {
    console.warn('⚠️ Gemini reasoning error (falling back to direct parser):', err.message);
    return null;
  }
}
