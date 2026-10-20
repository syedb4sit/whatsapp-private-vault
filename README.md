# 🔒 WhatsApp Private Vault MVP

A personal private vault you control entirely through WhatsApp. Send text, links, secrets, or files — they are stored securely. Ask a question and semantic search (OpenAI embeddings) retrieves the most relevant item. Everything lives on your own server in a local SQLite database.

---

## ✨ Features

| Feature | Details |
|---|---|
| 📝 Notes | Any plain text is saved as a note |
| 🔗 Links | URLs are auto-detected and tagged as links |
| 🔐 Secrets | Prefix with `secret:` — stored with AES-256-GCM encryption |
| 📎 Files | Images, documents, audio — stores the WhatsApp `media_id` |
| 🧠 Semantic search | OpenAI `text-embedding-3-small` + cosine similarity |
| 🔤 Keyword fallback | SQLite LIKE search when no embeddings match |
| #️⃣ Tags | Any `#word` in a message is extracted and stored |
| 🛡️ Owner-only | Messages from any other number are silently ignored |

---

## 🛠️ Prerequisites

- **Node.js 20+** (`node --version`)
- **npm 9+**
- **OpenAI API key** — <https://platform.openai.com/api-keys>
- **Meta Developer account** with a WhatsApp Business app — <https://developers.facebook.com>
- **ngrok** (for local development) — <https://ngrok.com>

---

## 🚀 Setup

### 1. Clone & install

```bash
git clone <your-repo-url>
cd amazing-curie
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in every value (see table below).

| Variable | Description |
|---|---|
| `WHATSAPP_TOKEN` | Permanent access token from Meta Developer Portal |
| `WHATSAPP_PHONE_NUMBER_ID` | Phone Number ID from your WhatsApp Business app |
| `WEBHOOK_VERIFY_TOKEN` | Any random string you choose (used to verify the webhook URL) |
| `OPENAI_API_KEY` | OpenAI secret key |
| `VAULT_ENCRYPTION_KEY` | Exactly 32 characters (pad or truncate longer values) |
| `OWNER_PHONE` | Your WhatsApp number in E.164 format **without** `+` (e.g. `923001234567`) |
| `PORT` | HTTP port, default `3000` |

### 3. Start the server

```bash
npm start        # production
npm run dev      # development (auto-reload with nodemon)
```

---

## 📱 Getting WhatsApp Cloud API Credentials

1. Go to <https://developers.facebook.com> → **My Apps** → **Create App** → select **Business**.
2. Add the **WhatsApp** product to your app.
3. Under **WhatsApp → API Setup** copy the **Phone Number ID** and **Temporary/Permanent Access Token**.
4. To get a **permanent token**: create a System User in Business Manager with the `whatsapp_business_messaging` permission and generate a token.

---

## 🌐 Running Locally with ngrok

```bash
# Terminal 1 — start the vault server
npm run dev

# Terminal 2 — expose it to the internet
ngrok http 3000
```

Copy the `https://xxxx.ngrok.io` URL.

In the Meta Developer Portal → **WhatsApp → Configuration**:
- **Callback URL**: `https://xxxx.ngrok.io/webhook`
- **Verify Token**: the value you put in `WEBHOOK_VERIFY_TOKEN`
- Subscribe to the **messages** webhook field.

Click **Verify and Save**. You should see `Webhook verified ✅` in your terminal.

---

## ☁️ Deploy to Railway

1. Push the repo to GitHub.
2. Go to <https://railway.app> → **New Project** → **Deploy from GitHub repo**.
3. Add all the environment variables from `.env` in the Railway **Variables** tab.
4. Railway auto-detects Node.js and runs `npm start`.
5. Copy the Railway-generated domain, set it as the WhatsApp webhook URL.

> [!NOTE]
> `vault.db` lives on the ephemeral filesystem on Railway. For production persistence, mount a Railway Volume at the project root and update `DB_PATH` in `src/vault/db.js` to point to the mounted path.

---

## 💬 Usage Examples

Send these messages to your WhatsApp Business number:

```
Buy milk tomorrow                    → saved as note
https://openai.com                   → saved as link
secret: my-api-key-abc123            → saved encrypted
find recipes                         → semantic search
what did I save about OpenAI?        → semantic search
list                                 → last 10 items
get 3                                → reveal item #3 (decrypts secrets)
delete 7                             → delete item #7
[send an image/doc/audio]            → saved as file
#work Meeting notes for Q4           → saved as note, tagged "work"
```

---

## 📋 Vault Commands Reference

| Command | What it does |
|---|---|
| Any text | Saved as **note** |
| A bare URL | Saved as **link** |
| `secret: <value>` | Saved as **secret** (AES-256-GCM encrypted) |
| `#tag` in any message | Adds tags to the stored item |
| `find <query>` | Semantic search (then keyword fallback) |
| `what did I save about X?` | Same as `find` |
| `list` | Shows the last 10 items (ID + preview) |
| `get <id>` | Retrieves full content of item by ID (decrypts secrets) |
| `delete <id>` | Permanently deletes an item by ID |
| Send image / doc / audio | Saved as **file** (stores WhatsApp `media_id`) |

---

## 🏗️ Project Structure

```
amazing-curie/
├── package.json
├── .env.example
├── .gitignore
├── README.md
└── src/
    ├── index.js              # Express entry, webhook verify + dispatch
    ├── config.js             # Load & validate env vars
    ├── router.js             # Main dispatcher
    ├── whatsapp/
    │   ├── client.js         # sendMessage(), downloadMedia()
    │   └── handler.js        # Parse inbound webhook payload
    └── vault/
        ├── db.js             # SQLite setup (better-sqlite3)
        ├── store.js          # CRUD: save, list, delete, getById
        ├── search.js         # Semantic search + keyword fallback
        ├── crypto.js         # AES-256-GCM encrypt/decrypt
        └── classifier.js     # Classify text → {type, tags, isSearch}
```

---

## 🔐 Security Notes

- Only your `OWNER_PHONE` number can interact with the vault. All other senders are silently dropped.
- Secrets are encrypted before writing to SQLite; the raw value never touches the database.
- The `VAULT_ENCRYPTION_KEY` and `.env` file are git-ignored — never commit them.
- Embeddings are **not** generated for secrets, so their content is never sent to OpenAI.
