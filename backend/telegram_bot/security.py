from config import settings


def get_allowed_users() -> set[int]:
    """Parse TELEGRAM_ALLOWED_USERS env var into a set of user IDs."""
    raw = settings.TELEGRAM_ALLOWED_USERS.strip()
    if not raw:
        return set()
    result = set()
    for part in raw.split(","):
        part = part.strip()
        if part.isdigit():
            result.add(int(part))
    return result


def is_authorized(user_id: int) -> bool:
    """Check if a Telegram user ID is in the whitelist."""
    allowed = get_allowed_users()
    if not allowed:
        return False
    return user_id in allowed
