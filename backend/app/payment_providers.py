import hashlib
import hmac
import json
from decimal import Decimal

import httpx
from fastapi import HTTPException, status

from .config import settings

RAZORPAY_API = "https://api.razorpay.com/v1"


async def create_razorpay_order(payment_id: str, amount: str, currency: str, receipt: str) -> dict[str, object]:
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise HTTPException(status_code=503, detail="Razorpay credentials are not configured")
    payload = {
        "amount": int(Decimal(amount) * 100),
        "currency": currency,
        "receipt": receipt,
        "notes": {"aig_payment_id": payment_id},
    }
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{RAZORPAY_API}/orders",
                json=payload,
                auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
            )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Razorpay order creation failed") from error
    if not isinstance(result, dict) or not isinstance(result.get("id"), str):
        raise HTTPException(status_code=502, detail="Razorpay returned an invalid order response")
    return result


def verify_razorpay_payment_signature(order_id: str, payment_id: str, signature: str) -> bool:
    if not settings.razorpay_key_secret:
        return False
    expected = hmac.new(
        settings.razorpay_key_secret.encode(),
        f"{order_id}|{payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def verify_razorpay_webhook_signature(raw_body: bytes, signature: str) -> bool:
    if not settings.razorpay_webhook_secret:
        return False
    expected = hmac.new(
        settings.razorpay_webhook_secret.encode(),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


async def fetch_razorpay_payment(provider_payment_id: str) -> dict[str, object]:
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise HTTPException(status_code=503, detail="Razorpay credentials are not configured")
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{RAZORPAY_API}/payments/{provider_payment_id}",
                auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
            )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Razorpay payment status check failed") from error
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Razorpay returned an invalid payment response")
    return result


async def create_razorpay_refund(provider_payment_id: str, amount: str) -> dict[str, object]:
    if not settings.razorpay_key_id or not settings.razorpay_key_secret:
        raise HTTPException(status_code=503, detail="Razorpay credentials are not configured")
    payload = {"amount": int(Decimal(amount) * 100)}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                f"{RAZORPAY_API}/payments/{provider_payment_id}/refund",
                json=payload,
                auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
            )
        response.raise_for_status()
        result = response.json()
    except (httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=502, detail="Razorpay refund request failed") from error
    if not isinstance(result, dict) or not isinstance(result.get("id"), str):
        raise HTTPException(status_code=502, detail="Razorpay returned an invalid refund response")
    return result


def parse_webhook_body(raw_body: bytes) -> dict[str, object]:
    try:
        result = json.loads(raw_body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook JSON body") from error
    if not isinstance(result, dict):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook payload")
    return result
