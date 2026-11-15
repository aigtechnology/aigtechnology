import html
import json
import logging
from datetime import date, datetime, timedelta
from pathlib import Path
import httpx

from .business_models import WebsiteOrder, WebsitePayment
from .config import settings

logger = logging.getLogger("aig.mailjet")
DISPATCH_SETTINGS_FILE = Path(__file__).resolve().parents[2] / "config" / "dispatch-settings.json"


def get_dispatch_working_days() -> int:
    try:
        value = json.loads(DISPATCH_SETTINGS_FILE.read_text(encoding="utf-8")).get("working_days", 2)
        return max(0, min(30, int(value)))
    except (FileNotFoundError, OSError, ValueError, TypeError, AttributeError):
        return 2


def set_dispatch_working_days(working_days: int) -> int:
    DISPATCH_SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    temporary = DISPATCH_SETTINGS_FILE.with_suffix(".tmp")
    temporary.write_text(json.dumps({"working_days": working_days}, indent=2) + "\n", encoding="utf-8")
    temporary.replace(DISPATCH_SETTINGS_FILE)
    return working_days


def _dispatch_date(order_date: datetime | date | None, working_days: int | None = None) -> str:
    """Return the configured number of weekdays after the order date."""
    current = order_date.date() if isinstance(order_date, datetime) else order_date or date.today()
    remaining = get_dispatch_working_days() if working_days is None else working_days
    while remaining:
        current += timedelta(days=1)
        if current.weekday() < 5:
            remaining -= 1
    return current.strftime("%d %b %Y")


def _configured() -> bool:
    return bool(
        settings.mailjet_api_key
        and settings.mailjet_secret_key
        and settings.mailjet_api_url
        and settings.notification_from_email
    )


def _order_text(order: WebsiteOrder, payment: WebsitePayment) -> tuple[str, str]:
    customer = order.customer
    items = "\n".join(
        f"- {item.name} ({item.sku}) x {item.quantity}: INR {item.subtotal}"
        for item in order.items
    )
    address = order.shipping_address or {}
    address_text = ", ".join(
        str(address.get(key, ""))
        for key in ("line1", "line2", "city", "state", "postal_code")
        if address.get(key)
    )
    dispatch_days = get_dispatch_working_days()
    dispatch_date = _dispatch_date(order.created_at, dispatch_days)
    text = (
        f"Order ID: {order.order_id}\n"
        f"Customer: {customer.full_name}\n"
        f"Mobile: {customer.phone}\n"
        f"Email: {customer.email}\n"
        f"Products:\n{items}\n"
        f"Total: INR {order.total_amount}\n"
        f"Delivery address: {address_text}\n"
        f"Expected dispatch date: {dispatch_date} ({dispatch_days} working days after order date)\n"
        f"Payment status: {payment.status}\n"
    )
    safe_items = "".join(
        f"<li>{html.escape(item.name)} ({html.escape(item.sku)}) × {item.quantity}: INR {html.escape(str(item.subtotal))}</li>"
        for item in order.items
    )
    safe_address = html.escape(address_text)
    safe_order_id = html.escape(order.order_id)
    safe_name = html.escape(customer.full_name)
    safe_phone = html.escape(customer.phone)
    safe_email = html.escape(customer.email)
    safe_status = html.escape(payment.status)
    safe_dispatch_date = html.escape(dispatch_date)
    html_body = f"""<!doctype html>
<html><body style="font-family:Arial,sans-serif;color:#102a43">
<h2 style="color:#1769aa">AIG TECHNOLOGY</h2>
<h3>Order confirmation: {safe_order_id}</h3>
<p><strong>Customer:</strong> {safe_name}<br><strong>Mobile:</strong> {safe_phone}<br><strong>Email:</strong> {safe_email}</p>
<h4>Products</h4><ul>{safe_items}</ul>
<p><strong>Total:</strong> INR {html.escape(str(order.total_amount))}<br><strong>Payment status:</strong> {safe_status}</p>
<p><strong>Expected dispatch date:</strong> {safe_dispatch_date} ({dispatch_days} working days after the order date)</p>
<p><strong>Delivery address:</strong><br>{safe_address}</p>
<p>Thank you for choosing AIG TECHNOLOGY.</p>
</body></html>"""
    return text, html_body


async def send_mailjet_messages(messages: list[dict[str, object]]) -> bool:
    if not _configured():
        logger.warning("Mailjet notification skipped: required configuration is missing")
        return False
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                settings.mailjet_api_url,
                auth=(settings.mailjet_api_key, settings.mailjet_secret_key),
                json={"Messages": messages},
            )
        if response.is_error:
            logger.error("Mailjet rejected email request: status=%s body=%s", response.status_code, response.text[:500])
            return False
        payload = response.json()
        results = payload.get("Messages", []) if isinstance(payload, dict) else []
        statuses = [item.get("Status") for item in results if isinstance(item, dict)]
        message_ids = [
            recipient.get("MessageID")
            for item in results
            if isinstance(item, dict)
            for recipient in item.get("To", [])
            if isinstance(recipient, dict) and recipient.get("MessageID")
        ]
        logger.info("Mailjet accepted email request: statuses=%s message_ids=%s", statuses, message_ids)
        return bool(results) and all(status in {"success", "queued"} for status in statuses)
    except (httpx.HTTPError, ValueError) as error:
        logger.error("Mailjet request failed: %s", error)
        return False


async def send_order_emails(order: WebsiteOrder, payment: WebsitePayment) -> bool:
    customer = order.customer
    recipients: list[str] = []
    for address in (customer.email, settings.admin_notification_email):
        if address and address.lower() not in {item.lower() for item in recipients}:
            recipients.append(address)
    if not recipients:
        logger.warning("Order email skipped: no recipients configured for order_id=%s", order.order_id)
        return False
    text_body, html_body = _order_text(order, payment)
    messages = [
        {
            "From": {"Email": settings.notification_from_email, "Name": settings.notification_from_name},
            "To": [{"Email": recipient}],
            "Subject": f"AIG TECHNOLOGY order confirmation - {order.order_id}",
            "TextPart": text_body,
            "HTMLPart": html_body,
        }
        for recipient in recipients
    ]
    return await send_mailjet_messages(messages)
