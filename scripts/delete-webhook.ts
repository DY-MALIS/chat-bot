import "dotenv/config";

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();

if (!token) {
  throw new Error("Missing TELEGRAM_BOT_TOKEN");
}

const response = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook?drop_pending_updates=true`);
const result = await response.json();
console.log(JSON.stringify(result, null, 2));

if (!response.ok) {
  process.exitCode = 1;
}
