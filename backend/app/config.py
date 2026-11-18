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

    # Асистент фронтенду (frontend-proto, /api/assistant): будь-який OpenAI-сумісний /chat/completions.
    # Порожній LLM_BASE_URL і LLM_API_KEY — асистент вимкнено, фронтенд відповідає шаблонами правил.
    # Шлюз кафедри: LLM_BASE_URL=https://api.csit-mitit.com/v1, LLM_MODEL=gemma4-26b (ключ — LLM_API_KEY).
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "gemma4-26b"
    llm_timeout_seconds: float = 60.0

    # Пароль для синтетичних демо-користувачів, яких створює seed.
    demo_password: str = ""

    # Підшлях, під яким застосунок стоїть за зворотним проксі (наприклад "/imd"). Порожньо: корінь.
    root_path: str = ""
    # Публічна адреса фронтенду для посилань на анонімне проходження (наприклад "https://imd.example").
    # Порожньо: посилання відносні ("/s#<токен>").
    public_url: str = ""

    # Одноразові посилання (анонімне проходження без облікового запису).
    token_batch_max: int = 1000

    # Файли-докази до пунктів чек-листа.
    evidence_dir: str = "/data/evidence"
    evidence_max_bytes: int = 10 * 1024 * 1024
    evidence_max_files_per_item: int = 10

    # Вхід паролем. Можна вимкнути, коли всі входять через проксі організації.
    password_login_enabled: bool = True
    # Вхід через довірений зворотний проксі (SSO організації): проксі автентифікує людину
    # і передає логін у заголовку. Приймається лише з адрес TRUSTED_PROXIES.
    proxy_auth_enabled: bool = False
    proxy_auth_header: str = "X-Remote-User"
    # Через кому: IP або мережі CIDR проксі, наприклад "10.0.0.5,172.16.0.0/12".
    trusted_proxies: str = ""
    # Необов'язковий спільний секрет, який проксі додає в заголовок X-Proxy-Secret.
    proxy_auth_secret: str = ""
    # Через кому: IP або CIDR зворотного проксі перед API (nginx фронтенду), від якого беремо реальну
    # адресу клієнта з X-Forwarded-For. Лише для лімітів спроб і журналу; вхід через SSO цим не вмикається
    # (для нього окремо TRUSTED_PROXIES). Порожньо: адреса клієнта — безпосередній співрозмовник TCP.
    forwarded_proxies: str = ""

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
    def trusted_proxy_list(self) -> list[str]:
        return [p.strip() for p in self.trusted_proxies.split(",") if p.strip()]

    @property
    def forwarded_proxy_list(self) -> list[str]:
        return [p.strip() for p in self.forwarded_proxies.split(",") if p.strip()]

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
    if "*" in settings.cors_origin_list:
        raise RuntimeError("CORS_ORIGINS не може містити «*»: перелічіть адреси фронтенду явно.")
    if settings.root_path and (not settings.root_path.startswith("/") or settings.root_path.endswith("/")):
        raise RuntimeError("ROOT_PATH має починатися з «/» і не закінчуватися нею, наприклад /imd.")
    if settings.proxy_auth_enabled and not settings.trusted_proxy_list:
        raise RuntimeError("PROXY_AUTH_ENABLED=true потребує TRUSTED_PROXIES: інакше заголовок підробить будь-хто.")


@lru_cache
def get_settings() -> Settings:
    return Settings()
