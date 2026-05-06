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

type TelegramUpdate = {
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
  adminContact: string;
  pollTimeout: number;
};

function readConfig(): Config {
  const config = {
    telegramToken: readRequiredEnv("TELEGRAM_BOT_TOKEN"),
    geminiApiKey: readRequiredEnv("GEMINI_API_KEY"),
    geminiModel: process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash",
    adminContact: process.env.DGACADEMY_ADMIN_CONTACT?.trim() || "",
    pollTimeout: Number(process.env.TELEGRAM_POLL_TIMEOUT || 30),
  };

  if (!Number.isFinite(config.pollTimeout) || config.pollTimeout < 1) {
    throw new Error("TELEGRAM_POLL_TIMEOUT must be a positive number.");
  }

  return config;
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

class TelegramClient {
  constructor(private readonly token: string) {}

  async getUpdates(offset: number | undefined, timeout: number): Promise<TelegramUpdate[]> {
    const params = new URLSearchParams({
      timeout: String(timeout),
      allowed_updates: JSON.stringify(["message"]),
    });
    if (offset !== undefined) {
      params.set("offset", String(offset));
    }

    const response = await this.request<{ result: TelegramUpdate[] }>("getUpdates", {
      method: "GET",
      query: params,
      timeoutMs: (timeout + 10) * 1000,
    });
    return response.result;
  }

  async sendMessage(chatId: number, text: string): Promise<void> {
    for (const part of splitMessage(text)) {
      await this.request("sendMessage", {
        body: {
          chat_id: chatId,
          text: part,
          parse_mode: "HTML",
          disable_web_page_preview: false,
        },
      });
    }
  }

  async sendChatAction(chatId: number): Promise<void> {
    await this.request("sendChatAction", {
      body: { chat_id: chatId, action: "typing" },
      timeoutMs: 10_000,
    });
  }

  private async request<T = unknown>(
    method: string,
    options: { method?: "GET" | "POST"; query?: URLSearchParams; body?: unknown; timeoutMs?: number } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 35_000);
    const query = options.query ? `?${options.query}` : "";

    try {
      const response = await fetch(`${TELEGRAM_API}${this.token}/${method}${query}`, {
        method: options.method ?? "POST",
        headers: options.body ? { "Content-Type": "application/json" } : undefined,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });

      const data = (await response.json()) as T & { ok?: boolean; description?: string };
      if (!response.ok || data.ok === false) {
        throw new Error(data.description || `Telegram request failed: ${response.status}`);
      }
      return data;
    } finally {
      clearTimeout(timeout);
    }
  }
}

class ChatBot {
  private readonly telegram: TelegramClient;
  private readonly histories = new Map<number, Content[]>();
  private readonly model;
  private running = true;

  constructor(private readonly config: Config) {
    this.telegram = new TelegramClient(config.telegramToken);
    this.model = new GoogleGenerativeAI(config.geminiApiKey).getGenerativeModel({
      model: config.geminiModel,
      systemInstruction: systemPrompt,
      generationConfig: {
        temperature: 0.45,
        topP: 0.9,
        maxOutputTokens: 900,
      },
    });
  }

  stop(): void {
    this.running = false;
  }

  async run(): Promise<void> {
    console.log(`DGacademy bot is running with Gemini model ${this.config.geminiModel}`);
    let offset: number | undefined;

    while (this.running) {
      try {
        const updates = await this.telegram.getUpdates(offset, this.config.pollTimeout);
        for (const update of updates) {
          offset = update.update_id + 1;
          await this.handleUpdate(update);
        }
      } catch (error) {
        console.error("Polling loop error:", error);
        await sleep(3000);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const chatId = update.message?.chat?.id;
    const text = update.message?.text?.trim();
    if (!chatId || !text) {
      return;
    }

    if (text.startsWith("/")) {
      await this.handleCommand(chatId, text);
      return;
    }

    await this.handleChat(chatId, text);
  }

  private async handleCommand(chatId: number, text: string): Promise<void> {
    const command = text.split(/\s+/, 1)[0].split("@", 1)[0].toLowerCase();

    if (command === "/start") {
      await this.sendWelcome(chatId);
    } else if (command === "/help") {
      await this.telegram.sendMessage(chatId, this.helpText());
    } else if (command === "/about") {
      await this.sendAbout(chatId);
    } else if (command === "/courses") {
      await this.sendCourses(chatId);
    } else if (command === "/reset") {
      this.histories.delete(chatId);
      await this.telegram.sendMessage(chatId, "Conversation reset. What would you like to learn next?");
    } else {
      await this.telegram.sendMessage(chatId, "I do not know that command yet. Try /help.");
    }
  }

  private async handleChat(chatId: number, text: string): Promise<void> {
    await this.telegram.sendChatAction(chatId);

    const history = this.histories.get(chatId) ?? [];
    const chat = this.model.startChat({ history });

    try {
      const result = await chat.sendMessage(text);
      const answer = result.response.text() || "I could not create an answer for that. Could you rephrase your question?";
      this.histories.set(chatId, trimHistory(await chat.getHistory()));
      await this.telegram.sendMessage(chatId, htmlEscape(answer));
    } catch (error) {
      console.error("Gemini generation failed:", error);
      await this.telegram.sendMessage(
        chatId,
        "Sorry, I could not generate a reply right now. Please try again in a moment.",
      );
    }
  }

  private async sendWelcome(chatId: number): Promise<void> {
    await this.telegram.sendMessage(
      chatId,
      [
        "Welcome to DGacademy.",
        "",
        "I can help you explore AI lessons, online and face-to-face classes, and practical ways to use technology to solve business problems.",
        "",
        "Tell me what you want to learn or what business problem you want to solve.",
      ].join("\n"),
    );
  }

  private async sendAbout(chatId: number): Promise<void> {
    await this.telegram.sendMessage(
      chatId,
      "DGacademy helps people stay up to date with technology and apply it to real business problems. There are AI lessons, online and face-to-face learning options, and teachers with practical knowledge.",
    );
  }

  private async sendCourses(chatId: number): Promise<void> {
    await this.telegram.sendMessage(
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
  }

  private helpText(): string {
    const lines = [
      "You can ask me about AI lessons, class formats, or how technology can help your business.",
      "",
      "Commands:",
      "/about - About DGacademy",
      "/courses - Course directions",
      "/reset - Clear this chat memory",
    ];
    if (this.config.adminContact) {
      lines.push("", `Admin: ${this.config.adminContact}`);
    }
    return lines.join("\n");
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const bot = new ChatBot(readConfig());
  process.once("SIGINT", () => bot.stop());
  process.once("SIGTERM", () => bot.stop());
  await bot.run();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
