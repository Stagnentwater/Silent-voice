import os


def _get_env(name: str, default: str | None = None) -> str | None:
    value = os.getenv(name, default)
    if isinstance(value, str):
        return value.strip()
    return value


ENVIRONMENT = (_get_env("ENVIRONMENT", "local") or "local").lower()
IS_LOCAL = ENVIRONMENT in {"local", "dev", "development"}


def get_database_url() -> str | None:
    if IS_LOCAL:
        return _get_env("LOCAL_DATABASE_URL") or _get_env("DATABASE_URL")
    return _get_env("DATABASE_URL")


API_HOST = _get_env("HOST", "127.0.0.1" if IS_LOCAL else "0.0.0.0") or "127.0.0.1"
API_PORT = int(_get_env("PORT", "5000") or "5000")