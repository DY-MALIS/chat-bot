import json
import logging
import os
import sys
from http.server import BaseHTTPRequestHandler
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from bot import Config, DGacademyBot, configure_logging


configure_logging()
_bot = None


def get_bot():
    global _bot
    if _bot is None:
        config = Config()
        config.validate()
        _bot = DGacademyBot(config)
    return _bot


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.respond(200, {"ok": True, "service": "DGacademy Telegram webhook"})

    def do_POST(self):
        expected_secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()
        received_secret = self.headers.get("X-Telegram-Bot-Api-Secret-Token", "")
        if expected_secret and received_secret != expected_secret:
            self.respond(401, {"ok": False, "error": "Unauthorized"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = self.rfile.read(length).decode("utf-8")
            update = json.loads(payload or "{}")
        except Exception:
            logging.exception("Could not parse Telegram update")
            self.respond(400, {"ok": False, "error": "Invalid JSON"})
            return

        try:
            get_bot().handle_update(update)
        except Exception:
            logging.exception("Webhook handler failed")
            self.respond(200, {"ok": True, "warning": "Update accepted but processing failed"})
            return

        self.respond(200, {"ok": True})

    def respond(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)
