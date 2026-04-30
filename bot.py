import json
import logging
import os
import signal
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque


TELEGRAM_API = "https://api.telegram.org/bot{token}/{method}"
GEMINI_API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MAX_TELEGRAM_MESSAGE = 3900


DGACADEMY_CONTEXT = """
DGacademy is a place to educate and inspire people to stay up to date with
technology and solve business problems through face-to-face and online classes.
It offers many AI lessons taught by teachers with clear knowledge and practical
skills.
""".strip()


SYSTEM_PROMPT = f"""
You are the official DGacademy Telegram assistant.

Brand context:
{DGACADEMY_CONTEXT}

Your job:
- Welcome people warmly and help them understand DGacademy's AI and technology learning options.
- Explain AI and business technology concepts in clear, practical language.
- Encourage users to explore face-to-face and online classes.
- Ask a short follow-up question when a user needs course guidance.
- Do not invent exact prices, schedules, certificates, policies, or teacher names.
- If details are unavailable, direct users to the DGacademy website or Mini App.
- Reply in the same language as the user when possible.
- Keep answers concise for Telegram unless the user asks for detail.
""".strip()


def load_dotenv(path=".env"):
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


class Config:
    def __init__(self):
        load_dotenv()
        self.telegram_token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
        self.gemini_api_key = os.getenv("GEMINI_API_KEY", "").strip()
        self.gemini_model = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
        self.gemini_timeout = int(os.getenv("GEMINI_TIMEOUT", "20"))
        self.website_url = os.getenv("DGACADEMY_WEBSITE_URL", "https://dgacademy21bot.angkorgate.ai").strip()
        self.mini_app_url = os.getenv("DGACADEMY_MINI_APP_URL", "https://t.me/dgacademy21bot/dg21").strip()
        self.admin_contact = os.getenv("DGACADEMY_ADMIN_CONTACT", "").strip()
        self.poll_timeout = int(os.getenv("TELEGRAM_POLL_TIMEOUT", "30"))

    def validate(self):
        missing = []
        if not self.telegram_token:
            missing.append("TELEGRAM_BOT_TOKEN")
        if not self.gemini_api_key:
            missing.append("GEMINI_API_KEY")
        if missing:
            joined = ", ".join(missing)
            raise RuntimeError(f"Missing required environment variable(s): {joined}")


def post_json(url, payload, headers=None, timeout=35):
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def get_json(url, params=None, timeout=35):
    if params:
        url = f"{url}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


class TelegramClient:
    def __init__(self, token):
        self.token = token

    def api_url(self, method):
        return TELEGRAM_API.format(token=self.token, method=method)

    def get_updates(self, offset=None, timeout=30):
        params = {
            "timeout": timeout,
            "allowed_updates": json.dumps(["message", "callback_query"]),
        }
        if offset is not None:
            params["offset"] = offset
        return get_json(self.api_url("getUpdates"), params=params, timeout=timeout + 10)

    def send_message(self, chat_id, text, reply_markup=None):
        for part in split_message(text):
            payload = {
                "chat_id": chat_id,
                "text": part,
                "parse_mode": "HTML",
                "disable_web_page_preview": False,
            }
            if reply_markup:
                payload["reply_markup"] = reply_markup
            post_json(self.api_url("sendMessage"), payload)

    def send_chat_action(self, chat_id, action="typing"):
        post_json(self.api_url("sendChatAction"), {"chat_id": chat_id, "action": action}, timeout=10)

    def answer_callback_query(self, callback_query_id, text=None):
        payload = {"callback_query_id": callback_query_id}
        if text:
            payload["text"] = text
        post_json(self.api_url("answerCallbackQuery"), payload, timeout=10)


class GeminiClient:
    def __init__(self, api_key, model, timeout=20):
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    def generate(self, history):
        url = GEMINI_API.format(model=urllib.parse.quote(self.model, safe=""))
        payload = {
            "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": list(history),
            "generationConfig": {
                "temperature": 0.45,
                "topP": 0.9,
                "maxOutputTokens": 900,
            },
        }
        response = post_json(
            url,
            payload,
            headers={"x-goog-api-key": self.api_key},
            timeout=self.timeout,
        )
        return extract_gemini_text(response)


class DGacademyBot:
    def __init__(self, config):
        self.config = config
        self.telegram = TelegramClient(config.telegram_token)
        self.gemini = GeminiClient(config.gemini_api_key, config.gemini_model, config.gemini_timeout)
        self.histories = defaultdict(lambda: deque(maxlen=12))
        self.running = True

    def stop(self, *_args):
        self.running = False

    def run(self):
        logging.info("DGacademy bot is running with Gemini model %s", self.config.gemini_model)
        offset = None
        while self.running:
            try:
                updates = self.telegram.get_updates(offset=offset, timeout=self.config.poll_timeout)
                for update in updates.get("result", []):
                    offset = update["update_id"] + 1
                    self.handle_update(update)
            except urllib.error.HTTPError as error:
                body = error.read().decode("utf-8", errors="replace")
                logging.error("HTTP error: %s %s", error.code, body)
                time.sleep(3)
            except Exception:
                logging.exception("Polling loop error")
                time.sleep(3)

    def handle_update(self, update):
        if "callback_query" in update:
            self.handle_callback(update["callback_query"])
            return

        message = update.get("message") or {}
        chat = message.get("chat") or {}
        chat_id = chat.get("id")
        text = (message.get("text") or "").strip()
        if not chat_id or not text:
            return

        if text.startswith("/"):
            self.handle_command(chat_id, text)
            return

        self.handle_chat(chat_id, text)

    def handle_callback(self, callback):
        callback_id = callback.get("id")
        message = callback.get("message") or {}
        chat_id = (message.get("chat") or {}).get("id")
        data = callback.get("data")
        if callback_id:
            self.telegram.answer_callback_query(callback_id)
        if chat_id and data == "courses":
            self.send_courses(chat_id)
        elif chat_id and data == "about":
            self.send_about(chat_id)

    def handle_command(self, chat_id, text):
        command = text.split(maxsplit=1)[0].split("@", 1)[0].lower()
        if command == "/start":
            self.send_welcome(chat_id)
        elif command == "/help":
            self.telegram.send_message(chat_id, self.help_text(), reply_markup=self.main_keyboard())
        elif command == "/about":
            self.send_about(chat_id)
        elif command == "/courses":
            self.send_courses(chat_id)
        elif command == "/contact":
            self.send_contact(chat_id)
        elif command == "/reset":
            self.histories.pop(chat_id, None)
            self.telegram.send_message(chat_id, "Conversation reset. What would you like to learn next?")
        else:
            self.telegram.send_message(chat_id, "I do not know that command yet. Try /help.", reply_markup=self.main_keyboard())

    def handle_chat(self, chat_id, text):
        self.telegram.send_chat_action(chat_id)
        history = self.histories[chat_id]
        history.append({"role": "user", "parts": [{"text": text}]})
        try:
            answer = self.gemini.generate(history)
        except Exception:
            logging.exception("Gemini generation failed")
            self.telegram.send_message(
                chat_id,
                "Sorry, I could not generate a reply right now. Please try again in a moment.",
                reply_markup=self.main_keyboard(),
            )
            return
        history.append({"role": "model", "parts": [{"text": answer}]})
        self.telegram.send_message(chat_id, html_escape(answer), reply_markup=self.main_keyboard())

    def send_welcome(self, chat_id):
        text = (
            "Welcome to DGacademy.\n\n"
            "I can help you explore AI lessons, online and face-to-face classes, "
            "and practical ways to use technology to solve business problems.\n\n"
            "Tell me what you want to learn or what business problem you want to solve."
        )
        self.telegram.send_message(chat_id, text, reply_markup=self.main_keyboard())

    def send_about(self, chat_id):
        text = (
            "DGacademy helps people stay up to date with technology and apply it to real business problems. "
            "There are AI lessons, online and face-to-face learning options, and teachers with practical knowledge."
        )
        self.telegram.send_message(chat_id, text, reply_markup=self.main_keyboard())

    def send_courses(self, chat_id):
        text = (
            "Popular learning directions include:\n"
            "- AI foundations for work and business\n"
            "- Prompting and productivity with AI tools\n"
            "- Applying AI to marketing, operations, and customer support\n"
            "- Technology skills for modern teams\n\n"
            "What is your goal: personal learning, team training, or solving a business problem?"
        )
        self.telegram.send_message(chat_id, text, reply_markup=self.main_keyboard())

    def send_contact(self, chat_id):
        lines = [
            "You can continue through the DGacademy links below.",
            f"Website: {self.config.website_url}",
            f"Mini App: {self.config.mini_app_url}",
        ]
        if self.config.admin_contact:
            lines.append(f"Admin: {self.config.admin_contact}")
        self.telegram.send_message(chat_id, "\n".join(lines), reply_markup=self.main_keyboard())

    def help_text(self):
        return (
            "You can ask me about AI lessons, class formats, or how technology can help your business.\n\n"
            "Commands:\n"
            "/about - About DGacademy\n"
            "/courses - Course directions\n"
            "/contact - Website and Mini App links\n"
            "/reset - Clear this chat memory"
        )

    def main_keyboard(self):
        return {
            "inline_keyboard": [
                [
                    {"text": "Open Website", "url": self.config.website_url},
                    {"text": "Open Mini App", "url": self.config.mini_app_url},
                ],
                [
                    {"text": "Courses", "callback_data": "courses"},
                    {"text": "About", "callback_data": "about"},
                ],
            ]
        }


def extract_gemini_text(response):
    candidates = response.get("candidates") or []
    if not candidates:
        return "I could not create an answer for that. Could you rephrase your question?"

    parts = ((candidates[0].get("content") or {}).get("parts")) or []
    text_parts = [part.get("text", "") for part in parts if part.get("text")]
    text = "\n".join(text_parts).strip()
    return text or "I could not create an answer for that. Could you rephrase your question?"


def split_message(text):
    if len(text) <= MAX_TELEGRAM_MESSAGE:
        return [text]

    chunks = []
    current = text
    while len(current) > MAX_TELEGRAM_MESSAGE:
        split_at = current.rfind("\n", 0, MAX_TELEGRAM_MESSAGE)
        if split_at < 1000:
            split_at = MAX_TELEGRAM_MESSAGE
        chunks.append(current[:split_at].strip())
        current = current[split_at:].strip()
    if current:
        chunks.append(current)
    return chunks


def html_escape(text):
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def configure_logging():
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(message)s",
    )


def main():
    configure_logging()
    config = Config()
    config.validate()
    bot = DGacademyBot(config)
    signal.signal(signal.SIGINT, bot.stop)
    signal.signal(signal.SIGTERM, bot.stop)
    bot.run()


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as error:
        print(error, file=sys.stderr)
        sys.exit(1)
