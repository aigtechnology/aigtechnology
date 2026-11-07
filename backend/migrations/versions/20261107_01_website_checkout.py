"""Add website checkout, payments, reservations, and catalog sync fields.

Revision ID: 20261107_01
Revises:
Create Date: 2026-11-07
"""
from alembic import op
import sqlalchemy as sa

revision = "20261107_01"
down_revision = None
branch_labels = None
depends_on = None


def _execute_script(script: str) -> None:
    for statement in script.split(";"):
        if statement.strip():
            op.execute(sa.text(statement))


def upgrade() -> None:
    op.execute(sa.text(
        "ALTER TABLE business_products "
        "ADD COLUMN IF NOT EXISTS catalog_id VARCHAR(160), "
        "ADD COLUMN IF NOT EXISTS image_url VARCHAR(2048), "
        "ADD COLUMN IF NOT EXISTS catalog_stock_quantity INTEGER"
    ))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_business_products_catalog_id "
        "ON business_products (catalog_id)"
    ))
    _execute_script("""
        CREATE TABLE IF NOT EXISTS website_customers (
          id SERIAL PRIMARY KEY, full_name VARCHAR(120) NOT NULL,
          phone VARCHAR(20) NOT NULL, email VARCHAR(254) NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_website_customers_phone ON website_customers (phone);
        CREATE INDEX IF NOT EXISTS ix_website_customers_email ON website_customers (email);
        CREATE TABLE IF NOT EXISTS website_addresses (
          id SERIAL PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES website_customers(id) ON DELETE CASCADE,
          line1 VARCHAR(250) NOT NULL, line2 VARCHAR(250) NOT NULL DEFAULT '',
          city VARCHAR(100) NOT NULL, state VARCHAR(100) NOT NULL,
          postal_code VARCHAR(10) NOT NULL, country VARCHAR(2) NOT NULL DEFAULT 'IN',
          is_billing BOOLEAN NOT NULL DEFAULT false
        );
        CREATE INDEX IF NOT EXISTS ix_website_addresses_customer_id ON website_addresses (customer_id);
        CREATE TABLE IF NOT EXISTS website_orders (
          id SERIAL PRIMARY KEY, order_id VARCHAR(36) NOT NULL UNIQUE,
          idempotency_key VARCHAR(80) NOT NULL UNIQUE, request_fingerprint VARCHAR(64) NOT NULL,
          customer_id INTEGER NOT NULL REFERENCES website_customers(id),
          lookup_token_hash VARCHAR(64) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'Pending Payment',
          payment_status VARCHAR(30) NOT NULL DEFAULT 'Created',
          subtotal NUMERIC(12,2) NOT NULL, delivery_charge NUMERIC(12,2) NOT NULL DEFAULT 0,
          discount NUMERIC(12,2) NOT NULL DEFAULT 0, total_amount NUMERIC(12,2) NOT NULL,
          shipping_address JSON NOT NULL, billing_address JSON NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_website_orders_order_id ON website_orders (order_id);
        CREATE INDEX IF NOT EXISTS ix_website_orders_customer_id ON website_orders (customer_id);
        CREATE INDEX IF NOT EXISTS ix_website_orders_status ON website_orders (status);
        CREATE INDEX IF NOT EXISTS ix_website_orders_payment_status ON website_orders (payment_status);
        CREATE INDEX IF NOT EXISTS ix_website_orders_created_at ON website_orders (created_at);
        CREATE TABLE IF NOT EXISTS website_order_items (
          id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES website_orders(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES business_products(id), name VARCHAR(255) NOT NULL,
          sku VARCHAR(120) NOT NULL, quantity INTEGER NOT NULL,
          unit_price NUMERIC(12,2) NOT NULL, subtotal NUMERIC(12,2) NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_website_order_items_order_id ON website_order_items (order_id);
        CREATE TABLE IF NOT EXISTS website_payments (
          id SERIAL PRIMARY KEY, payment_id VARCHAR(36) NOT NULL UNIQUE,
          order_id INTEGER NOT NULL REFERENCES website_orders(id) ON DELETE CASCADE,
          provider VARCHAR(30) NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'Created',
          provider_order_id VARCHAR(120) UNIQUE, provider_payment_id VARCHAR(120) UNIQUE,
          amount NUMERIC(12,2) NOT NULL, currency VARCHAR(3) NOT NULL DEFAULT 'INR',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_website_payments_payment_id ON website_payments (payment_id);
        CREATE INDEX IF NOT EXISTS ix_website_payments_order_id ON website_payments (order_id);
        CREATE INDEX IF NOT EXISTS ix_website_payments_status ON website_payments (status);
        CREATE INDEX IF NOT EXISTS ix_website_payments_provider_order_id ON website_payments (provider_order_id);
        CREATE INDEX IF NOT EXISTS ix_website_payments_provider_payment_id ON website_payments (provider_payment_id);
        CREATE TABLE IF NOT EXISTS payment_attempts (
          id SERIAL PRIMARY KEY, payment_id INTEGER NOT NULL REFERENCES website_payments(id) ON DELETE CASCADE,
          attempt_number INTEGER NOT NULL, status VARCHAR(30) NOT NULL DEFAULT 'Created',
          provider_reference VARCHAR(120) UNIQUE, error_code VARCHAR(80),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_payment_attempts_payment_id ON payment_attempts (payment_id);
        CREATE INDEX IF NOT EXISTS ix_payment_attempts_status ON payment_attempts (status);
        CREATE TABLE IF NOT EXISTS payment_webhook_events (
          id SERIAL PRIMARY KEY, provider_event_id VARCHAR(160) NOT NULL UNIQUE,
          event_type VARCHAR(100) NOT NULL, payload JSON NOT NULL,
          processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS inventory_reservations (
          id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES website_orders(id) ON DELETE CASCADE,
          product_id INTEGER NOT NULL REFERENCES business_products(id), quantity INTEGER NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'reserved', expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT uq_reservation_order_product UNIQUE (order_id, product_id)
        );
        CREATE INDEX IF NOT EXISTS ix_inventory_reservations_order_id ON inventory_reservations (order_id);
        CREATE INDEX IF NOT EXISTS ix_inventory_reservations_product_id ON inventory_reservations (product_id);
        CREATE INDEX IF NOT EXISTS ix_inventory_reservations_status ON inventory_reservations (status);
        CREATE INDEX IF NOT EXISTS ix_inventory_reservations_expires_at ON inventory_reservations (expires_at);
        CREATE TABLE IF NOT EXISTS website_refunds (
          id SERIAL PRIMARY KEY, refund_id VARCHAR(36) NOT NULL UNIQUE,
          idempotency_key VARCHAR(80) NOT NULL UNIQUE,
          payment_id INTEGER NOT NULL REFERENCES website_payments(id) ON DELETE CASCADE,
          provider_refund_id VARCHAR(120) UNIQUE, amount NUMERIC(12,2) NOT NULL,
          status VARCHAR(30) NOT NULL DEFAULT 'Created', created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_website_refunds_refund_id ON website_refunds (refund_id);
        CREATE INDEX IF NOT EXISTS ix_website_refunds_payment_id ON website_refunds (payment_id);
        CREATE INDEX IF NOT EXISTS ix_website_refunds_status ON website_refunds (status);
    """)


def downgrade() -> None:
    _execute_script("""
        DROP TABLE IF EXISTS website_refunds;
        DROP TABLE IF EXISTS inventory_reservations;
        DROP TABLE IF EXISTS payment_webhook_events;
        DROP TABLE IF EXISTS payment_attempts;
        DROP TABLE IF EXISTS website_payments;
        DROP TABLE IF EXISTS website_order_items;
        DROP TABLE IF EXISTS website_orders;
        DROP TABLE IF EXISTS website_addresses;
        DROP TABLE IF EXISTS website_customers;
        DROP INDEX IF EXISTS ix_business_products_catalog_id;
        ALTER TABLE business_products
          DROP COLUMN IF EXISTS catalog_stock_quantity,
          DROP COLUMN IF EXISTS image_url,
          DROP COLUMN IF EXISTS catalog_id;
    """)
