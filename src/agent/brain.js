import { GoogleGenerativeAI } from '@google/generative-ai';
import { config } from '../config.js';
import { save, listRecent, deleteItem, getById } from '../vault/store.js';
import { keywordSearch } from '../vault/search.js';
import { encrypt, decrypt } from '../vault/crypto.js';

let genAI = null;

function getGenAI() {
  if (!genAI && config.geminiApiKey) {
    genAI = new GoogleGenerativeAI(config.geminiApiKey);
  }
  return genAI;
}

const toolDeclarations = [
  {
    name: 'save_note',
    description: 'Save a note, thought, idea, link, or general information to the encrypted vault.',
    parameters: {
      type: 'OBJECT',
      properties: {
        content: { type: 'STRING', description: 'The text or note content to save' },
        tags: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Optional tags or categories (e.g. ["fyp", "meeting", "groceries"])',
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'save_secret',
    description: 'Save confidential or sensitive information (passwords, PINs, tokens, credentials, secret notes). It is encrypted with AES-256.',
    parameters: {
      type: 'OBJECT',
      properties: {
        content: { type: 'STRING', description: 'The exact password, PIN, or secret value' },
        label: { type: 'STRING', description: 'Short label or description of what this secret is for (e.g. "WiFi Password", "Bank PIN")' },
      },
      required: ['content'],
    },
  },
  {
    name: 'search_vault',
    description: 'Search the vault for stored notes, memories, or keywords matching a query.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search term or keyword to look up in the vault' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_vault',
    description: 'List the most recent items stored in the vault.',
    parameters: {
      type: 'OBJECT',
      properties: {
        limit: { type: 'INTEGER', description: 'Number of recent items to list (default: 5)' },
      },
    },
  },
  {
    name: 'get_item',
    description: 'Retrieve an item by its numeric ID. If it is an encrypted secret, it will be decrypted.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'INTEGER', description: 'The ID of the item to retrieve' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_item',
    description: 'Delete an item from the vault by its numeric ID.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'INTEGER', description: 'The ID of the item to delete' },
      },
      required: ['id'],
    },
  },
];

/**
 * Execute a tool requested by Gemini.
 */
function executeTool(name, args) {
  if (name === 'save_note') {
    const id = save({
      type: 'note',
      content: args.content,
      tags: args.tags || [],
    });
    return { success: true, id, message: `Note saved with ID #${id}` };
  }

  if (name === 'save_secret') {
    const encrypted = encrypt(args.content);
    const tags = args.label ? [args.label.toLowerCase().replace(/\s+/g, '_')] : [];
    const id = save({
      type: 'secret',
      content: encrypted,
      tags,
      isSecret: true,
    });
    return { success: true, id, message: `Secret encrypted with AES-256 and saved with ID #${id}` };
  }

  if (name === 'search_vault') {
    const results = keywordSearch(args.query);
    const formatted = results.map(r => ({
      id: r.id,
      type: r.type,
      is_secret: r.is_secret,
      content: r.is_secret ? '[Encrypted Secret - use get_item with ID to reveal]' : r.content,
      tags: r.tags,
      created_at: r.created_at,
    }));
    return { query: args.query, count: formatted.length, matches: formatted };
  }

  if (name === 'list_vault') {
    const limit = args.limit || 5;
    const items = listRecent(limit).map(r => ({
      id: r.id,
      type: r.type,
      is_secret: r.is_secret,
      content: r.is_secret ? '[Encrypted Secret]' : r.content,
    }));
    return { count: items.length, items };
  }

  if (name === 'get_item') {
    const item = getById(args.id);
    if (!item) return { error: `Item with ID #${args.id} not found.` };
    const content = item.is_secret ? decrypt(item.content) : item.content;
    return { id: item.id, type: item.type, is_secret: item.is_secret, content };
  }

  if (name === 'delete_item') {
    deleteItem(args.id);
    return { success: true, message: `Item #${args.id} deleted successfully.` };
  }

  return { error: `Unknown tool: ${name}` };
}

/**
 * Process a natural language message with Gemini Function Calling.
 * Returns natural text response or null if Gemini is not configured.
 */
export async function processWithGemini(userText) {
  const client = getGenAI();
  if (!client) return null;

  try {
    const model = client.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction:
        'You are an intelligent, proactive personal memory vault assistant on WhatsApp.\n' +
        'You can store notes, remember secrets, search memories, list items, and manage commitments.\n' +
        'CRITICAL RULES:\n' +
        '1. If the user tells you a password, PIN, key, or sensitive credential, ALWAYS use `save_secret` to store it with AES-256 encryption.\n' +
        '2. If the user asks a question about what they saved or asks you to recall something, call `search_vault`.\n' +
        '3. If they ask to see everything, call `list_vault`.\n' +
        '4. If they ask to reveal or get a specific item or password, call `get_item`.\n' +
        '5. If they want to delete or forget something, call `delete_item`.\n' +
        '6. Keep your final WhatsApp response natural, concise, and helpful with appropriate emojis.',
      tools: [{ functionDeclarations: toolDeclarations }],
    });

    const chat = model.startChat();
    const result = await chat.sendMessage(userText);
    const response = result.response;

    const functionCalls = response.functionCalls();
    if (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      console.log(`🧠 [Gemini Agent] Decided to call tool: ${call.name} with:`, call.args);
      const toolOutput = executeTool(call.name, call.args);

      // Send tool result back to Gemini so it generates the natural language reply
      const followUp = await chat.sendMessage([
        {
          functionResponse: {
            name: call.name,
            response: toolOutput,
          },
        },
      ]);

      return followUp.response.text();
    }

    return response.text();
  } catch (err) {
    console.warn('⚠️ Gemini natural language processing error (falling back to direct commands):', err.message);
    return null;
  }
}
