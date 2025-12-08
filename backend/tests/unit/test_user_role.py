from app.models.users import UserRole



def test_userrole_values():
    assert UserRole.admin.value == "admin"
    assert UserRole.user.value == "user"
    assert UserRole.developer.value == "developer"
