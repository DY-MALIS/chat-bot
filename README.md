# DGacademy Telegram Chatbot

A small TypeScript Telegram chatbot for DGacademy, deployed as a Vercel serverless webhook.

## Features

- Telegram webhook endpoint at `/api/telegram`
- `/start`, `/help`, `/about`, `/courses`, and `/reset` commands
- Gemini-powered replies using DGacademy context
- Same-language replies when possible
- Short best-effort per-instance memory

## Setup

1. Install dependencies:

   ```powershell
   bun install
   ```

2. Add these environment variables in Vercel:

   ```text
   TELEGRAM_BOT_TOKEN=your_token_here
   GEMINI_API_KEY=your_key_here
   GEMINI_MODEL=gemini-2.5-flash
   TELEGRAM_WEBHOOK_SECRET=use_a_long_random_secret
   ```

3. Deploy to Vercel.

4. Put your deployed URL in local `.env`:

   ```text
   VERCEL_PUBLIC_URL=https://your-project.vercel.app
   TELEGRAM_WEBHOOK_SECRET=the_same_secret_used_in_vercel
   ```

5. Register the Telegram webhook:

   ```powershell
   bun run set-webhook
   ```

Open `https://your-project.vercel.app/api/telegram` to check the health response.

## Configuration

| Variable | Description | Default |
| --- | --- | --- |
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | Required |
| `GEMINI_API_KEY` | Google Gemini API key | Required |
| `GEMINI_MODEL` | Gemini model name | `gemini-2.5-flash` |
| `VERCEL_PUBLIC_URL` | Public Vercel URL used by `bun run set-webhook` | Required locally for webhook setup |
| `TELEGRAM_WEBHOOK_SECRET` | Secret checked by the Vercel webhook | Optional but recommended |

Keep `.env` out of version control. If a token or API key was shared publicly, rotate it before production use.
