from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    database_url_sync: str
    cors_origins: str = "http://localhost:5173"
    
    
    secret_key: str
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 7

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
