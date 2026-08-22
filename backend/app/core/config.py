from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "sqlite:///./idda_analysis.db"
    football_data_api_key: str | None = None
    football_data_uk_base_url: str = "https://www.football-data.co.uk"
    football_data_org_base_url: str = "https://api.football-data.org/v4"
    artifact_dir: str = "artifacts"
    sportmonks_api_key: str | None = None
    sportmonks_base_url: str = "https://api.sportmonks.com/v3/football"
    sportmonks_timeout_seconds: float = 30.0
    sportmonks_max_retries: int = 3
    history_seasons: int = 8
    scheduler_enabled: bool = False
    scheduler_sync_hour_utc: int = 3
    prematch_refresh_minutes: int = 90
    elo_initial_rating: float = 1500.0
    elo_k_factor: float = 24.0
    feature_half_life_days: float = 180.0
    ensemble_ml_weight: float = 0.40
    ensemble_dixon_coles_weight: float = 0.30
    ensemble_elo_weight: float = 0.20
    ensemble_market_weight: float = 0.10

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
