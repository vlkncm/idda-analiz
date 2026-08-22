import json
import logging
from datetime import datetime, timezone


REDACT_KEYS = {"api_token", "sportmonks_api_key", "authorization"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {"timestamp": datetime.now(timezone.utc).isoformat(), "level": record.levelname, "logger": record.name, "message": record.getMessage()}
        fields = getattr(record, "fields", {})
        payload.update({key: "[REDACTED]" if key.lower() in REDACT_KEYS else value for key, value in fields.items()})
        return json.dumps(payload, ensure_ascii=False, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)

