# 🔒 WhatsApp Private Vault MVP!

A personal private vault you control entirely through WhatsApp (or via the built-in web simulator). Send text, links, secrets, or files — they are stored securely. Ask questions in plain language or keywords, and the vault retrieves the exact item.

---

## ✨ What's Built & Included

- **Notes & Ideas**: Any text sent is indexed and stored.
- **Encrypted Secrets**: Send `secret: <password/token>` — encrypted locally using **AES-256-GCM**.
- **Search**: Fast keyword & tag search (`find <word>`, `what did I save about X?`) + OpenAI semantic embeddings fallback.
- **Web Dashboard & Simulator**: Built-in interactive simulator and live status page at `/`.
- **Zero-Friction WhatsApp Integration**: Auto-detects phone metadata so you don't have to manually configure IDs.
- **Render Ready**: Comes with `render.yaml` and `.node-version` for instant 1-click cloud deployment.

---

## 🚀 Live Deployment on Render (Step-by-Step)

### Option 1: Fast Blueprint Deploy
1. Push this project to your GitHub account (or fork it).
2. Go to [Render Dashboard](https://dashboard.render.com).
3. Click **New +** → **Blueprint**.
4. Select your GitHub repository. Render will automatically detect `render.yaml` and configure everything!
5. In the Environment Variables screen:
   - Paste your `WHATSAPP_TOKEN` (or Agent API key).
   - If using OpenAI semantic search, paste `OPENAI_API_KEY`.
6. Click **Apply**. Your service will build and be live at `https://your-app-name.onrender.com`!

### Option 2: Standard Web Service Deploy
1. In Render, click **New +** → **Web Service**.
2. Select your repository.
3. Configure settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. In **Environment Variables**, add:
   - `NODE_VERSION` = `22.12.0`
   - `WEBHOOK_VERIFY_TOKEN` = `fb708706ee0bd33ff93426d7`
   - `VAULT_ENCRYPTION_KEY` = `55f601100915348404be44743c82a2fa`
   - `OWNER_PHONE` = `*`
   - `WHATSAPP_TOKEN` = `your_token_or_agent_api_key_here`
5. Click **Create Web Service**.

---

## 📱 Connecting WhatsApp / Agent Webhook

Once your Render app is live (e.g. `https://my-vault.onrender.com`):

1. **Webhook URL**: `https://my-vault.onrender.com/webhook`
2. **Verify Token**: `fb708706ee0bd33ff93426d7` (pre-configured in `.env`)
3. When asked for subscribed fields, check **`messages`**.

---

## 💬 WhatsApp Command Cheatsheet

| What you send | What the vault does |
|---|---|
| `Buy milk tomorrow` | 📝 Saved as a note (ID #1) |
| `https://github.com/my-repo` | 🔗 Saved as a link |
| `secret: myMasterPassword123` | 🔐 AES-256 encrypted & stored (never saved in plaintext) |
| `list` | 📦 Displays the last 10 items |
| `find milk` | 🔍 Searches notes and links for "milk" |
| `get 2` | 🔑 Reveals/decrypts secret #2 |
| `delete 2` | 🗑️ Permanently deletes item #2 |
| `#work Project milestone update` | 📝 Saved and tagged with `#work` |

---

## 🧪 Local Testing & Simulator

You can test without even opening WhatsApp:

1. Run `npm start`
2. Open `http://localhost:3000` in your browser.
3. Use the built-in simulator form to send notes, secrets, list, and search!
