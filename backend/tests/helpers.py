from typing import Optional


class FakeUser:
    def __init__(self, id: int = 1, email: str = "test@example.com", password_hash: str = "hashed", role: str = "user", is_active: bool = True):
        self.id = id
        self.email = email
        self.password_hash = password_hash
        self.role = role
        self.is_active = is_active


class FakeResult:
    def __init__(self, value: Optional[object]):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeSession:
    def __init__(self, existing: Optional[object] = None):
        self.existing = existing

    async def execute(self, *args, **kwargs):
        return FakeResult(self.existing)

    async def commit(self):
        return None

    async def refresh(self, obj, *args, **kwargs):
        if not getattr(obj, "id", None):
            obj.id = 123

    def add(self, obj):
        # no-op: tests can inspect the object directly
        return None


def async_override_get_db_factory(existing: Optional[object] = None):
    async def _override_get_db():
        sess = FakeSession(existing=existing)
        yield sess

    return _override_get_db
