import os
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str
    session_secret: str
    admin_origin: str = "http://localhost:5500"
    storefront_origin: str = "https://aigtechnology.in"
    cors_allowed_origins: str = ""
    rate_limit_storage_uri: str = ""
    firebase_project_id: str = "aig-technology"
    razorpay_key_id: str = ""
    razorpay_key_secret: str = ""
    razorpay_webhook_secret: str = ""
    payment_provider: Literal["mock", "razorpay"] = "mock"
    flipkart_api_base_url: str = "https://api.flipkart.net"
    flipkart_app_id: str = ""
    flipkart_app_secret: str = ""
    flipkart_access_token: str = ""
    flipkart_location_id: str = ""

    model_config = SettingsConfigDict(env_file=os.environ.get("AIG_ENV_FILE", ".env"), extra="ignore")

    @property
    def allowed_origins(self) -> list[str]:
        configured = [origin.strip().rstrip("/") for origin in self.cors_allowed_origins.split(",") if origin.strip()]
        return list(dict.fromkeys([self.admin_origin.rstrip("/"), self.storefront_origin.rstrip("/"), *configured]))


settings = Settings()
