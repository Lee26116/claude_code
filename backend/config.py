import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ADMIN_USERNAME: str = "li"
    ADMIN_PASSWORD: str = "changeme_secure_password"
    JWT_SECRET: str = "changeme_jwt_secret_key"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_DAYS: int = 7

    CLAUDE_BRAIN_PATH: str = os.path.expanduser("~/claude-brain")
    UPLOAD_PATH: str = os.path.expanduser("~/uploads")
    DATABASE_PATH: str = "./dashboard.db"

    ALLOWED_ORIGINS: str = "*"

    # Telegram Bot
    TELEGRAM_BOT_TOKEN: str = ""
    TELEGRAM_ALLOWED_USERS: str = ""  # comma-separated Telegram user IDs
    TELEGRAM_DEFAULT_WORK_DIR: str = os.path.expanduser("~/projects")

    class Config:
        env_file = ".env"


settings = Settings()
