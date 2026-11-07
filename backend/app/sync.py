from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from .business_models import FlipkartOrder, FlipkartOrderItem, Shipment, SyncLog
from .flipkart import FlipkartClient, FlipkartAPIError


async def check_flipkart_connection(database: Session) -> dict[str, object]:
    client = FlipkartClient()
    if not client.configured:
        return {"configured": False, "status": "not_configured", "message": "Add FLIPKART_APP_ID and FLIPKART_APP_SECRET to backend/.env."}

    sync_log = SyncLog(sync_type="connection_check", status="running")
    database.add(sync_log)
    database.commit()
    try:
        # The filter shape is documented by Flipkart's shipment search API.
        filters = [
            {"type": "preDispatch", "states": ["APPROVED", "PACKING_IN_PROGRESS", "PACKED", "FORM_FAILED", "READY_TO_DISPATCH"], "serviceProfiles": "NON_FBF"},
            {"type": "postDispatch", "states": ["SHIPPED", "DELIVERED", "PICKUP_COMPLETE"], "serviceProfiles": "NON_FBF"},
        ]
        responses = [await client.search_shipments(payload) for payload in filters]
        sync_log.status = "success"
        shipments = [shipment for response in responses if isinstance(response, dict) for shipment in response.get("shipments", [])]
        processed = upsert_shipments(database, shipments)
        sync_log.records_processed = processed
        sync_log.completed_at = datetime.now(UTC)
        database.commit()
        return {"configured": True, "status": "success", "records_seen": sync_log.records_processed, "orders_saved": processed}
    except FlipkartAPIError as error:
        sync_log.status = "failed"
        sync_log.error_message = str(error)
        sync_log.completed_at = datetime.now(UTC)
        database.commit()
        return {"configured": True, "status": "failed", "message": str(error)}


def _parse_date(value: object) -> datetime:
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(UTC)


def _money(value: object) -> Decimal:
    try:
        return Decimal(str(value or 0))
    except Exception:
        return Decimal("0")


def upsert_shipments(database: Session, shipments: object) -> int:
    if not isinstance(shipments, list):
        return 0
    saved = 0
    for shipment in shipments:
        if not isinstance(shipment, dict):
            continue
        shipment_id = str(shipment.get("shipmentId") or "").strip()
        items = shipment.get("orderItems")
        if not shipment_id or not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            order_id = str(item.get("orderId") or "").strip()
            if not order_id:
                continue
            price_components = item.get("priceComponents") if isinstance(item.get("priceComponents"), dict) else {}
            order = database.scalar(select(FlipkartOrder).where(FlipkartOrder.order_id == order_id))
            if order is None:
                order = FlipkartOrder(
                    order_id=order_id,
                    shipment_id=shipment_id,
                    order_date=_parse_date(item.get("orderDate")),
                    status=str(item.get("status") or "unknown").lower(),
                    total_amount=_money(price_components.get("totalPrice")),
                    source_payload=shipment,
                )
                database.add(order)
                database.flush()
                order.items.append(FlipkartOrderItem(
                    product_name=str(item.get("title") or item.get("fsn") or item.get("sku") or "Flipkart item"),
                    sku=str(item.get("sku") or item.get("fsn") or "UNKNOWN"),
                    quantity=int(item.get("quantity") or 1),
                    unit_price=_money(price_components.get("sellingPrice")),
                ))
                saved += 1
            else:
                order.shipment_id = shipment_id
                order.status = str(item.get("status") or order.status).lower()
                order.total_amount = _money(price_components.get("totalPrice"))
                order.source_payload = shipment
            existing_shipment = database.scalar(select(Shipment).where(Shipment.shipment_id == shipment_id))
            if existing_shipment is None:
                database.add(Shipment(
                    shipment_id=shipment_id,
                    order_id=order.id,
                    status=str(item.get("status") or "unknown").lower(),
                    source_payload=shipment,
                ))
    return saved
