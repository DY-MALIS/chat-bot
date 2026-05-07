import "dotenv/config";
import { GoogleGenerativeAI, type Content } from "@google/generative-ai";

const TELEGRAM_API = "https://api.telegram.org/bot";
const MAX_TELEGRAM_MESSAGE = 3900;

const dgacademyContext = `
DGacademy is a place to educate and inspire people to stay up to date with
technology and solve business problems through face-to-face and online classes.
It offers many AI lessons taught by teachers with clear knowledge and practical
skills.
`.trim();

const systemPrompt = `
You are the official DGacademy Telegram assistant.

Brand context:
${dgacademyContext}

Your job:
- Welcome people warmly and help them understand DGacademy's AI and technology learning options.
- Explain AI and business technology concepts in clear, practical language.
- Encourage users to explore face-to-face and online classes.
- Ask a short follow-up question when a user needs course guidance.
- Do not invent exact prices, schedules, certificates, policies, or teacher names.
- If details are unavailable, say that an admin can confirm the latest details.
- Reply in the same language as the user when possible.
- Keep answers concise for Telegram unless the user asks for detail.
`.trim();

export type TelegramUpdate = {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id?: number };
  };
};

type Config = {
  telegramToken: string;
  geminiApiKey: string;
  geminiModel: string;
};

const histories = new Map<number, Content[]>();

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const config = readConfig();
  const telegram = new TelegramClient(config.telegramToken);
  const chatId = update.message?.chat?.id;
  const text = update.message?.text?.trim();

  if (!chatId || !text) {
    return;
  }

  if (text.startsWith("/")) {
    await handleCommand(telegram, chatId, text);
    return;
  }

  await telegram.sendChatAction(chatId);

  try {
    const answer = await generateReply(config, chatId, text);
    await telegram.sendMessage(chatId, htmlEscape(answer));
  } catch (error) {
    console.error("Gemini generation failed:", error);
    await telegram.sendMessage(chatId, "Sorry, I could not generate a reply right now. Please try again in a moment.");
  }
}

function readConfig(): Config {
  return {
    telegramToken: readRequiredEnv("TELEGRAM_BOT_TOKEN"),
    geminiApiKey: readRequiredEnv("GEMINI_API_KEY"),
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
  };
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function handleCommand(telegram: TelegramClient, chatId: number, text: string): Promise<void> {
  const command = text.split(/\s+/, 1)[0].split("@", 1)[0].toLowerCase();

  if (command === "/start") {
    await telegram.sendMessage(
      chatId,
      [
        "Welcome to DGacademy.",
        "",
        "I can help you explore AI lessons, online and face-to-face classes, and practical ways to use technology to solve business problems.",
        "",
        "Tell me what you want to learn or what business problem you want to solve.",
      ].join("\n"),
    );
  } else if (command === "/help") {
    await telegram.sendMessage(
      chatId,
      [
        "You can ask me about AI lessons, class formats, or how technology can help your business.",
        "",
        "Commands:",
        "/about - About DGacademy",
        "/courses - Course directions",
        "/reset - Clear this chat memory",
      ].join("\n"),
    );
  } else if (command === "/about") {
    await telegram.sendMessage(
      chatId,
      "DGacademy helps people stay up to date with technology and apply it to real business problems. There are AI lessons, online and face-to-face learning options, and teachers with practical knowledge.",
    );
  } else if (command === "/courses") {
    await telegram.sendMessage(
      chatId,
      [
        "Popular learning directions include:",
        "- AI foundations for work and business",
        "- Prompting and productivity with AI tools",
        "- Applying AI to marketing, operations, and customer support",
        "- Technology skills for modern teams",
        "",
        "What is your goal: personal learning, team training, or solving a business problem?",
      ].join("\n"),
    );
  } else if (command === "/reset") {
    histories.delete(chatId);
    await telegram.sendMessage(chatId, "Conversation reset. What would you like to learn next?");
  } else {
    await telegram.sendMessage(chatId, "I do not know that command yet. Try /help.");
  }
}

async function generateReply(config: Config, chatId: number, text: string): Promise<string> {
  const model = new GoogleGenerativeAI(config.geminiApiKey).getGenerativeModel({
    model: config.geminiModel,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature: 0.45,
      topP: 0.9,
      maxOutputTokens: 900,
    },
  });
  const chat = model.startChat({ history: histories.get(chatId) ?? [] });
  const result = await chat.sendMessage(text);
  const answer = result.response.text() || "I could not create an answer for that. Could you rephrase your question?";

  histories.set(chatId, trimHistory(await chat.getHistory()));
  return answer;
}

class TelegramClient {
  constructor(private readonly token: string) {}

  async sendMessage(chatId: number, text: string): Promise<void> {
    for (const part of splitMessage(text)) {
      await this.request("sendMessage", {
        chat_id: chatId,
        text: part,
        parse_mode: "HTML",
        disable_web_page_preview: false,
      });
    }
  }

  async sendChatAction(chatId: number): Promise<void> {
    await this.request("sendChatAction", { chat_id: chatId, action: "typing" });
  }

  private async request<T = unknown>(method: string, body: unknown): Promise<T> {
    const response = await fetch(`${TELEGRAM_API}${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as T & { ok?: boolean; description?: string };

    if (!response.ok || data.ok === false) {
      throw new Error(data.description || `Telegram request failed: ${response.status}`);
    }

    return data;
  }
}

function trimHistory(history: Content[]): Content[] {
  return history.slice(-12);
}

function splitMessage(text: string): string[] {
  if (text.length <= MAX_TELEGRAM_MESSAGE) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > MAX_TELEGRAM_MESSAGE) {
    let splitAt = remaining.lastIndexOf("\n", MAX_TELEGRAM_MESSAGE);
    if (splitAt < 1000) {
      splitAt = MAX_TELEGRAM_MESSAGE;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

function htmlEscape(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
