import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const publicUrl = process.env.VERCEL_PUBLIC_URL?.trim().replace(/\/$/, "");
const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();

if (!token) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}

if (!publicUrl) {
  throw new Error("Missing VERCEL_PUBLIC_URL, for example https://your-project.vercel.app");
}

const payload: Record<string, unknown> = {
  url: `${publicUrl}/api/telegram`,
  allowed_updates: ["message"],
  drop_pending_updates: true,
};

if (secret) {
  payload.secret_token = secret;
}

const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});
const result = await response.json();

console.log(JSON.stringify(result, null, 2));

if (!response.ok) {
  process.exitCode = 1;
}
