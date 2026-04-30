import json
import os
import sys
import urllib.request


def load_dotenv(path=".env"):
    if not os.path.exists(path):
        return

    with open(path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def post_json(url, payload):
    data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def main():
    load_dotenv()
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    public_url = os.getenv("VERCEL_PUBLIC_URL", "").strip().rstrip("/")
    secret = os.getenv("TELEGRAM_WEBHOOK_SECRET", "").strip()

    if not token:
        raise RuntimeError("Missing TELEGRAM_BOT_TOKEN")
    if not public_url:
        raise RuntimeError("Missing VERCEL_PUBLIC_URL, for example https://your-project.vercel.app")

    payload = {
        "url": f"{public_url}/api/telegram",
        "allowed_updates": ["message", "callback_query"],
        "drop_pending_updates": True,
    }
    if secret:
        payload["secret_token"] = secret

    result = post_json(f"https://api.telegram.org/bot{token}/setWebhook", payload)
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(error, file=sys.stderr)
        sys.exit(1)
