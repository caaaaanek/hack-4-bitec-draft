from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# Абсолютний мінімум розміру групи для показу агрегатів. Менше задати не можна навіть адміну.
MIN_GROUP_SIZE_FLOOR = 5
# Мінімальна довжина секрету JWT (байтів) для HS256.
JWT_SECRET_MIN_LENGTH = 32


class Settings(BaseSettings):
    """Налаштування читаються зі змінних оточення або з файлу .env."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "postgresql+psycopg://imd:imd@localhost:5432/imd"

    # Секрет для підпису JWT. У .env.example порожній, задається локально (не коротше 32 символів).
    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    # Обмеження спроб входу: стільки невдалих спроб за вікно (секунд) на пару логін + IP.
    login_max_failures: int = 5
    login_window_seconds: int = 300

    # Вартість хешування паролів. 12 для роботи, у тестах менше заради швидкості.
    bcrypt_rounds: int = 12

    # Мінімальний розмір групи для показу агрегатів (k-анонімність). Не менше MIN_GROUP_SIZE_FLOOR.
    default_min_group_size: int = 5

    # Часовий пояс для дат хвиль, подань і фактів.
    timezone: str = "Europe/Kyiv"

    # Через кому: адреси фронтенду, яким дозволено звертатися до API.
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # Спільний ключ, з яким інші системи передають факти (заголовок X-Integration-Key).
    # Застарілий спосіб: з ним можна передати будь-яке джерело. Краще integration_keys.
    integration_api_key: str = ""
    # Окремий ключ на кожне джерело: "artemida=ключ1;atestat=ключ2". Джерело в запиті має збігатися з ключем.
    integration_keys: str = ""

    # Інтеграція з темою 2 (трекер заходів колег). Порожня адреса: інтеграцію вимкнено.
    theme2_url: str = ""
    theme2_api_key: str = ""
    theme2_timeout_seconds: float = 5.0

    # Опційний асистент (чат-бот). Вимкнено за замовчуванням, система повністю працює без нього.
    assistant_enabled: bool = False
    assistant_url: str = "http://localhost:11434/api/generate"  # Ollama
    assistant_model: str = "llama3.1:8b"
    assistant_timeout_seconds: float = 30.0

    # Пароль для синтетичних демо-користувачів, яких створює seed.
    demo_password: str = ""

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def integration_key_map(self) -> dict[str, str]:
        """джерело -> ключ."""
        result = {}
        for pair in self.integration_keys.split(";"):
            if "=" in pair:
                source, key = pair.split("=", 1)
                if source.strip() and key.strip():
                    result[source.strip()] = key.strip()
        return result

    @property
    def min_group_size(self) -> int:
        return max(self.default_min_group_size, MIN_GROUP_SIZE_FLOOR)


def check_settings(settings: "Settings") -> None:
    """Зупиняє застосунок на старті, якщо налаштування небезпечні."""
    if len(settings.jwt_secret) < JWT_SECRET_MIN_LENGTH:
        raise RuntimeError(
            f"JWT_SECRET не задано або коротший за {JWT_SECRET_MIN_LENGTH} символи. "
            "Згенеруйте: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
