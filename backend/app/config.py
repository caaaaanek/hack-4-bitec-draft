from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# Абсолютний мінімум розміру групи для показу агрегатів. Менше задати не можна навіть адміну.
MIN_GROUP_SIZE_FLOOR = 5
# Як у текстах називати кореневу одиницю (ORG_KIND): не лише ВВНЗ, а й військова частина чи підприємство.
ORG_TERMS: dict[str, dict[str, str]] = {
    "institution": {"nominative": "заклад", "genitive": "закладу", "plural": "заклади", "full": "заклад вищої освіти"},
    "organization": {"nominative": "організація", "genitive": "організації", "plural": "організації",
                     "full": "організація"},
    "unit": {"nominative": "частина", "genitive": "частини", "plural": "частини", "full": "військова частина"},
}
# Мінімальна довжина секрету JWT (байтів) для HS256.
JWT_SECRET_MIN_LENGTH = 32

# Профіль безпеки (SECURITY_PROFILE). demo — як для показу журі: адмін задає паролі, усе в одних руках, особовий
# склад може входити логіном. production — запобіжники з аналізу 20.11 увімкнено разом. Змінна, задана явно
# (у .env чи оточенні), має пріоритет над профілем, і тоді /config показує це в policies.overridden.
SECURITY_PROFILES = ("demo", "production")
PRODUCTION_PROFILE: dict[str, object] = {
    "admin_sets_passwords": False,   # пароль людина ставить сама за запрошенням; імпорт CSV повертає посилання
    "four_eyes_enabled": True,       # привілейовані ролі, нові облікові записи, відкриття хвилі — друга людина
    "separate_tech_admin": True,     # люди й підрозділи — технічний адміністратор без доступу до результатів
    "staff_token_only": True,        # особовий склад — лише QR і одноразові посилання
    "leader_child_details": False,   # керівник бачить деталі лише свого підрозділу
}


class Settings(BaseSettings):
    """Налаштування читаються зі змінних оточення або з файлу .env."""

    # env_ignore_empty: рядок «AUTOPILOT_INTERVAL_SECONDS=» у .env (як у .env.example) означає «значення за
    # замовчуванням», а не порожній рядок, який не перетворюється на число й зупиняє застосунок на старті.
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore", env_ignore_empty=True)

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
    # Власники фактів: "факт=джерело1,джерело2;факт2=джерело". Замінює типових власників (fact_registry.BUILTIN_OWNERS)
    # для перелічених фактів. Наприклад, заклад рахує КІ в ARTEMIDA, а не в модулі «Перевірки»: "coi_reviewed=artemida".
    fact_owners: str = ""

    # Інтеграція з темою 2 (трекер заходів колег). Порожня адреса: інтеграцію вимкнено.
    # Mitra: THEME2_URL=http://mitra/api/integrations/integra (ми шлемо POST {THEME2_URL}/measures).
    theme2_url: str = ""
    theme2_api_key: str = ""
    theme2_timeout_seconds: float = 5.0
    # Адреса веб-інтерфейсу Mitra. Посилання на доказ (/verify) і на захід приймаються лише з цієї адреси.
    # Порожньо: береться схема й хост із THEME2_URL.
    theme2_public_url: str = ""
    # Як часто надсилати чергу заходів у Mitra, секунд. 0 — лише вручну (POST /integrations/theme2/sync).
    theme2_sync_seconds: float = 10

    # Опційний асистент (чат-бот). Вимкнено за замовчуванням, система повністю працює без нього.
    assistant_enabled: bool = False
    assistant_url: str = "http://localhost:11434/api/generate"  # Ollama
    assistant_model: str = "llama3.1:8b"
    assistant_timeout_seconds: float = 30.0

    # Асистент фронтенду (frontend-proto, /api/assistant): будь-який OpenAI-сумісний /chat/completions.
    # Порожній LLM_BASE_URL — асистент вимкнено, фронтенд відповідає шаблонами правил (ключ без адреси нічого не вмикає).
    # Шлюз кафедри: LLM_BASE_URL=https://api.csit-mitit.com/v1, LLM_MODEL=gemma4-26b, LLM_API_KEY, і, бо адреса
    # зовнішня, LLM_ALLOW_EXTERNAL=true.
    llm_base_url: str = ""
    # Закритий контур: модель лише за внутрішньою адресою (localhost, приватна мережа, сервіс compose).
    # true — дозволити зовнішню адресу (наприклад, шлюз кафедри); дані агреговані, але вийдуть за контур.
    llm_allow_external: bool = False
    llm_api_key: str = ""
    llm_model: str = "gemma4-26b"
    llm_timeout_seconds: float = 60.0
    # Скільки запитів до моделі одночасно. Кожен запит займає потік сервера до LLM_TIMEOUT_SECONDS × кроки
    # інструментів; без обмеження черга до моделі забирає потоки в решти API. Понад ліміт — 429.
    llm_max_concurrent: int = 4

    # Живі запити модуля «Перевірки» до відкритих API (Prozorro, НАЗК). Закритий контур означає «без обов'язкової
    # залежності від зовнішніх сервісів», а не «без інтернету»: true вмикає необов'язкові живі джерела.
    external_fetch_enabled: bool = False
    # Перевірка контрагентів (пункт 4.5.1 чек-листа) через комерційний API на кшталт Youcontrol.
    # Без адреси й ключа (або з EXTERNAL_FETCH_ENABLED=false) — синтетичний мок.
    counterparty_api_url: str = ""
    counterparty_api_key: str = ""
    # Ключ шифрування буфера відповідей (до закриття хвилі). Порожньо: похідний від JWT_SECRET.
    # Окремий ключ дозволяє міняти JWT_SECRET, не втрачаючи відповідей відкритих хвиль.
    pool_encryption_key: str = ""
    # Файл із ключем буфера (Docker secret, сховище секретів під іншою людиною). Має пріоритет над
    # POOL_ENCRYPTION_KEY: ключа немає ні в .env, ні в змінних оточення контейнера.
    pool_encryption_key_file: str = ""

    # ---------- Профіль безпеки ----------
    # demo | production. Див. PRODUCTION_PROFILE вище: production вмикає всі запобіжники разом.
    security_profile: str = "demo"

    # ---------- Ролі й розподіл обов'язків ----------
    # Хто підтверджує пункти чек-листа (через кому): уповноважений і/або внутрішній аудит.
    checklist_confirmers: str = "commissioner,auditor"
    # true: адміністратор (уповноважений, хвилі) не керує людьми й підрозділами — лише технічний
    # адміністратор (coordinator), який, своєю чергою, не бачить результатів.
    separate_tech_admin: bool = False
    # Як називати кореневу одиницю в текстах: institution (заклад), organization (організація), unit (частина).
    org_kind: str = "institution"

    # ---------- Захист від колективного покарання ----------
    # false (рекомендовано): керівник бачить деталі лише свого підрозділу, а про дочірні — розподіл
    # «скільки підрозділів на якому рівні» без назв. true: як раніше, усе піддерево.
    leader_child_details: bool = False

    # ---------- Облікові записи ----------
    # false (рекомендовано): адміністратор не задає паролів — людина ставить пароль сама за запрошенням.
    admin_sets_passwords: bool = True
    invite_ttl_hours: int = 72
    # Принцип двох осіб: привілейовані ролі, зміна категорії, нові облікові записи й відкриття хвилі
    # підтверджує друга людина (POST /admin/approvals/{id}/approve).
    four_eyes_enabled: bool = False

    # ---------- Анонімність ----------
    # true: особовий склад проходить анкети лише за QR чи одноразовими посиланнями (логін — для робочої
    # групи й керівників). Хвиля за логінами з анкетою особового складу не створюється.
    staff_token_only: bool = False
    # Детектор відвертості: мінімум відповідей на кожен варіант непрямого питання (і не менше k).
    candor_min_per_variant: int = 30

    # Якір журналу назовні (services/audit_anchor.py): раз на день голова ланцюжка хешів іде у файл на окремому
    # томі (WORM, під іншою людиною) і/або в сервіс міток часу RFC 3161. Порожньо — лише ручний якір аудитора.
    audit_anchor_dir: str = ""
    audit_anchor_tsa_url: str = ""

    # Автопілот хвиль (services/autopilot.py): як часто робити крок, у секундах. 0 — лише вручну (POST /autopilot/tick).
    autopilot_interval_seconds: float = 0

    # Пароль для синтетичних демо-користувачів, яких створює seed.
    demo_password: str = ""

    # Підшлях, під яким застосунок стоїть за зворотним проксі (наприклад "/imd"). Порожньо: корінь.
    root_path: str = ""
    # Публічна адреса фронтенду для посилань на анонімне проходження (наприклад "https://imd.example").
    # Порожньо: посилання відносні ("/s/<токен>").
    public_url: str = ""
    # Каталог зібраного фронтенду (frontend-proto/dist). Якщо задано, API сам віддає сторінки на тому ж порту:
    # один процес без nginx і Docker. Порожньо: фронтенд віддає nginx (docker compose) або Vite.
    frontend_dist: str = ""

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

    @model_validator(mode="after")
    def apply_security_profile(self) -> "Settings":
        """production: запобіжники, яких не задано явно, беруть значення профілю."""
        if self.security_profile == "production":
            for key, value in PRODUCTION_PROFILE.items():
                if key not in self.model_fields_set:
                    object.__setattr__(self, key, value)
        return self

    @property
    def profile_overrides(self) -> list[str]:
        """Запобіжники профілю production, які явно вимкнено змінними оточення."""
        if self.security_profile != "production":
            return []
        return sorted(k for k, v in PRODUCTION_PROFILE.items() if getattr(self, k) != v)

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
    def fact_owner_map(self) -> dict[str, tuple[str, ...]]:
        """факт -> джерела, яким дозволено його передавати."""
        result = {}
        for pair in self.fact_owners.split(";"):
            if "=" in pair:
                code, sources = pair.split("=", 1)
                owners = tuple(s.strip() for s in sources.split(",") if s.strip())
                if code.strip() and owners:
                    result[code.strip()] = owners
        return result

    @property
    def trusted_proxy_list(self) -> list[str]:
        return [p.strip() for p in self.trusted_proxies.split(",") if p.strip()]

    @property
    def forwarded_proxy_list(self) -> list[str]:
        return [p.strip() for p in self.forwarded_proxies.split(",") if p.strip()]

    @property
    def pool_key_material(self) -> str:
        """Матеріал ключа буфера: файл (секрет) → POOL_ENCRYPTION_KEY → похідний від JWT_SECRET."""
        if self.pool_encryption_key_file:
            try:
                with open(self.pool_encryption_key_file, encoding="utf-8") as f:
                    value = f.read().strip()
                if value:
                    return value
            except OSError:
                pass
            raise RuntimeError(f"POOL_ENCRYPTION_KEY_FILE={self.pool_encryption_key_file}: файл не прочитано або порожній")
        return self.pool_encryption_key or ("pool:" + self.jwt_secret)

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
    if settings.security_profile not in SECURITY_PROFILES:
        raise RuntimeError(f"SECURITY_PROFILE: один із {', '.join(SECURITY_PROFILES)}")
    if settings.org_kind not in ORG_TERMS:
        raise RuntimeError(f"ORG_KIND: один із {', '.join(ORG_TERMS)}")
    if settings.pool_encryption_key_file:
        settings.pool_key_material  # noqa: B018 — перевірка, що файл ключа читається, уже на старті
    if settings.proxy_auth_enabled and not settings.trusted_proxy_list:
        raise RuntimeError("PROXY_AUTH_ENABLED=true потребує TRUSTED_PROXIES: інакше заголовок підробить будь-хто.")


@lru_cache
def get_settings() -> Settings:
    return Settings()
