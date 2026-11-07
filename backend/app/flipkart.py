import asyncio
from collections.abc import Mapping
from typing import Any

import httpx

from .config import settings


class FlipkartAPIError(RuntimeError):
    pass


class FlipkartClient:
    """Minimal client for documented read APIs; credentials stay server-side."""

    def __init__(self) -> None:
        self.base_url = settings.flipkart_api_base_url.rstrip("/")
        self.access_token = settings.flipkart_access_token.strip()
        self.app_id = settings.flipkart_app_id.strip()
        self.app_secret = settings.flipkart_app_secret.strip()

    @property
    def configured(self) -> bool:
        return bool(self.access_token or (self.app_id and self.app_secret))

    async def _get_access_token(self, client: httpx.AsyncClient) -> str:
        if self.access_token:
            return self.access_token
        response = await client.get(
            "/oauth-service/oauth/token",
            params={"grant_type": "client_credentials", "scope": "Seller_Api"},
            auth=(self.app_id, self.app_secret),
        )
        if response.is_error:
            raise FlipkartAPIError(f"Flipkart token request returned HTTP {response.status_code}: {response.text[:500]}")
        payload = response.json()
        token = str(payload.get("access_token") or "").strip()
        if not token:
            raise FlipkartAPIError("Flipkart token response did not contain access_token.")
        self.access_token = token
        return token

    async def request(
        self,
        method: str,
        path: str,
        *,
        params: Mapping[str, Any] | None = None,
        json: Mapping[str, Any] | None = None,
    ) -> dict[str, Any]:
        if not self.configured:
            raise FlipkartAPIError("Flipkart access token is not configured on the backend.")
        async with httpx.AsyncClient(base_url=self.base_url, timeout=30) as client:
            access_token = await self._get_access_token(client)
            headers = {"Authorization": f"Bearer {access_token}", "Accept": "application/json"}
            for attempt in range(3):
                response = await client.request(method, path, headers=headers, params=params, json=json)
                if response.status_code not in {429, 500, 502, 503, 504} or attempt == 2:
                    if response.is_error:
                        raise FlipkartAPIError(f"Flipkart API returned HTTP {response.status_code}: {response.text[:500]}")
                    return response.json()
                retry_after = min(float(response.headers.get("Retry-After", "1")), 30)
                await asyncio.sleep(retry_after * (attempt + 1))
        raise FlipkartAPIError("Flipkart API request failed after retries.")

    async def search_shipments(self, filter_payload: Mapping[str, Any]) -> dict[str, Any]:
        return await self.request("POST", "/sellers/v3/shipments/filter/", json={"filter": filter_payload})

    async def get_shipments(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return await self.request("GET", "/sellers/v3/shipments", params=params)

    async def get_returns(self, params: Mapping[str, Any]) -> dict[str, Any]:
        return await self.request("GET", "/sellers/v2/returns", params=params)
