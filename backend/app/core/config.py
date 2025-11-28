from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    database_url_sync: str
    cors_origins: str = "http://localhost:5173"

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
