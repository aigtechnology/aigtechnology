from decimal import Decimal

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.business_models import Inventory, Product, ProductOrderSequence, WebsiteOrderItem
from app.checkout import _new_product_order_references
from app.database import Base
from app.schemas import CheckoutItem
from app import models  # noqa: F401 - registers admin tables for metadata creation


def test_product_order_references_are_sequential_per_sku_and_support_multiple_items():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as database:
            dell = Product(sku="DELL3400", catalog_id="dell", name="Dell", selling_price=Decimal("1"), is_active=True)
            hp = Product(sku="HP840", catalog_id="hp", name="HP", selling_price=Decimal("1"), is_active=True)
            database.add_all([dell, hp])
            database.flush()
            dell_inventory = Inventory(product_id=dell.id, available_quantity=10)
            hp_inventory = Inventory(product_id=hp.id, available_quantity=10)
            database.add_all([dell_inventory, hp_inventory])
            database.flush()

            dell_item = (dell, dell_inventory, CheckoutItem(sku="DELL3400", quantity=1))
            hp_item = (hp, hp_inventory, CheckoutItem(sku="HP840", quantity=1))
            first = _new_product_order_references(database, "Rahul", [dell_item])[0]
            second = _new_product_order_references(database, "Amit", [dell_item])[0]
            mixed = _new_product_order_references(database, "Priya", [dell_item, hp_item])

            assert first == "RAHUL-DELL3400-0001"
            assert second == "AMIT-DELL3400-0002"
            assert mixed == ["PRIYA-DELL3400-0003", "PRIYA-HP840-0001"]
            assert database.scalar(
                select(ProductOrderSequence.last_assigned_order_number)
                .where(ProductOrderSequence.sku == "DELL3400")
            ) == 3
            assert database.scalar(
                select(WebsiteOrderItem.id)
                .where(WebsiteOrderItem.product_order_reference == "RAHUL-DELL3400-0001")
            ) is None
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()
