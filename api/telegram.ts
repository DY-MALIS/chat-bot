import { handleTelegramUpdate, type TelegramUpdate } from "../src/bot.js";

type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
};

type VercelResponse = {
  status(code: number): VercelResponse;
  json(payload: unknown): void;
};

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method === "GET") {
    res.status(200).json({ ok: true, service: "DGacademy Telegram webhook" });
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed" });
    return;
  }

  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const receivedSecret = readHeader(req.headers, "x-telegram-bot-api-secret-token");

  if (expectedSecret && receivedSecret !== expectedSecret) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  try {
    await handleTelegramUpdate(req.body as TelegramUpdate);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Webhook handler failed:", error);
    res.status(200).json({ ok: true, warning: "Update accepted but processing failed" });
  }
}

function readHeader(headers: VercelRequest["headers"], name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
