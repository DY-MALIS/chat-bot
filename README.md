# DGacademy Telegram Chatbot

A small dependency-free Python Telegram chatbot for DGacademy. It supports local Telegram long polling and a Vercel serverless webhook, and uses the Gemini REST `generateContent` API.

## Features

- `/start`, `/help`, `/about`, `/courses`, `/contact`, and `/reset` commands
- Gemini-powered replies using DGacademy context
- Same-language replies when possible
- Inline buttons for the DGacademy website and Telegram Mini App
- Short per-chat memory for more natural conversations
- No required Python packages beyond the standard library
- Vercel webhook endpoint at `/api/telegram`

## Setup

1. Copy the environment template:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Edit `.env` and add:

   ```text
   TELEGRAM_BOT_TOKEN=your_token_here
   GEMINI_API_KEY=your_key_here
   ```

3. Run the bot:

   ```powershell
   .\run.ps1
   ```

The process must stay running for the bot to respond.

## Host on Vercel

1. Push this folder to a Git repository and import it in Vercel.

2. In Vercel, add these Environment Variables for Production:

   ```text
   TELEGRAM_BOT_TOKEN=your_token_here
   GEMINI_API_KEY=your_key_here
   GEMINI_MODEL=gemini-2.5-flash
   GEMINI_TIMEOUT=20
   DGACADEMY_WEBSITE_URL=https://dgacademy21bot.angkorgate.ai
   DGACADEMY_MINI_APP_URL=https://t.me/dgacademy21bot/dg21
   TELEGRAM_WEBHOOK_SECRET=use_a_long_random_secret
   ```

3. Deploy the project.

4. Add your deployed URL to `.env` locally:

   ```text
   VERCEL_PUBLIC_URL=https://your-project.vercel.app
   TELEGRAM_WEBHOOK_SECRET=the_same_secret_used_in_vercel
   ```

5. Register the Telegram webhook:

   ```powershell
   .\run.ps1 scripts/set_webhook.py
   ```

   If your local `python` command is available, this also works:

   ```powershell
   python scripts/set_webhook.py
   ```

6. Open this health URL in a browser:

   ```text
   https://your-project.vercel.app/api/telegram
   ```

   It should return JSON with `"ok": true`.

After `setWebhook` is enabled, Telegram sends updates to Vercel. Local long polling with `bot.py` will not receive updates unless you delete the webhook first.

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | Required |
| `GEMINI_API_KEY` | Google Gemini API key | Required |
| `GEMINI_MODEL` | Gemini model name | `gemini-2.5-flash` |
| `GEMINI_TIMEOUT` | Gemini request timeout in seconds | `20` |
| `DGACADEMY_WEBSITE_URL` | Website button URL | `https://dgacademy21bot.angkorgate.ai` |
| `DGACADEMY_MINI_APP_URL` | Mini App button URL | `https://t.me/dgacademy21bot/dg21` |
| `DGACADEMY_ADMIN_CONTACT` | Optional admin contact text | Empty |
| `VERCEL_PUBLIC_URL` | Public Vercel deployment URL for `scripts/set_webhook.py` | Required for webhook setup |
| `TELEGRAM_WEBHOOK_SECRET` | Optional secret checked by the Vercel webhook | Empty |
| `TELEGRAM_POLL_TIMEOUT` | Long-poll timeout in seconds | `30` |
| `LOG_LEVEL` | Python logging level | `INFO` |

## Security Note

The Telegram bot token and Gemini API key should be treated as secrets. If either key was shared in a chat, document, screenshot, or public repo, rotate it before production use.

## Production Notes

- Keep `.env` out of version control.
- Use `/reset` in Telegram to clear the current chat memory.
- On Vercel, conversation memory is best-effort only because serverless instances can restart. For durable memory, add Redis, Vercel KV, or a database.
