import os
from pathlib import Path

import pytest
from alembic import command, config


def _alembic_config_for_backend():
    backend_root = Path(__file__).resolve().parents[2]
    alembic_ini = backend_root / "alembic.ini"
    cfg = config.Config(str(alembic_ini))
    # Ensure Alembic uses the repository's migrations folder by absolute path
    migrations_path = backend_root / "alembic_migrations"
    cfg.set_main_option("script_location", str(migrations_path))
    return cfg


def _run_alembic_upgrade(sync_url: str):
    cfg = _alembic_config_for_backend()
    cfg.set_main_option("sqlalchemy.url", sync_url)
    command.upgrade(cfg, "head")


@pytest.fixture(scope="session")
def database_urls():
    """
    Provide database URLs for integration tests.

    Prefer environment variables `DATABASE_URL` (async) and
    `DATABASE_URL_SYNC` (sync). If they are not set the fixture
    will skip the integration tests and instruct the developer how
    to run them locally (start docker compose and export env vars).
    """
    async_url = os.environ.get("DATABASE_URL")
    sync_url = os.environ.get("DATABASE_URL_SYNC")

    if not async_url or not sync_url:
        pytest.skip(
            "Integration tests require DATABASE_URL and DATABASE_URL_SYNC. "
            "Start the local docker-compose Postgres and set these env vars."
        )

    return async_url, sync_url


@pytest.fixture(scope="session")
def apply_migrations(database_urls):
    """Apply Alembic migrations against the provided sync DB URL.

    This runs once per test session.
    """
    _, sync_url = database_urls
    _run_alembic_upgrade(sync_url)
    return True
