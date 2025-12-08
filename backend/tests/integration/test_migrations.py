from sqlalchemy import create_engine, inspect


def test_migrations_created_tables(apply_migrations, database_urls):
    """Verify Alembic-created tables exist in the database.

    This test relies on `apply_migrations` fixture which runs
    `alembic upgrade head` against the `DATABASE_URL_SYNC`.
    """
    _, sync_url = database_urls

    engine = create_engine(sync_url)
    inspector = inspect(engine)
    table_names = inspector.get_table_names()

    expected = {"users", "user_sessions", "chat_sessions", "chat_messages"}
    assert expected.issubset(set(table_names)), f"Missing tables: {expected - set(table_names)}"
