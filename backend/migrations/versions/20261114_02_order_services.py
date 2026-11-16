"""Add customer-friendly order IDs, status history, notifications, and service requests."""
from alembic import op
import sqlalchemy as sa

revision = "20261114_02"
down_revision = "20261107_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE website_orders ALTER COLUMN order_id TYPE VARCHAR(80)"))
    op.execute(sa.text("ALTER TABLE website_orders ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2) NOT NULL DEFAULT 0"))
    op.execute(sa.text("ALTER TABLE website_orders ADD COLUMN IF NOT EXISTS tracking_number VARCHAR(160)"))
    op.execute(sa.text("ALTER TABLE website_orders ADD COLUMN IF NOT EXISTS carrier VARCHAR(120)"))
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS order_status_history (
          id SERIAL PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES website_orders(id) ON DELETE CASCADE,
          old_status VARCHAR(40), new_status VARCHAR(40) NOT NULL, note TEXT, changed_by VARCHAR(80),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_order_status_history_order_id ON order_status_history(order_id);
        CREATE INDEX IF NOT EXISTS ix_order_status_history_created_at ON order_status_history(created_at);
        INSERT INTO order_status_history (order_id, new_status, changed_by)
          SELECT id, status, 'migration' FROM website_orders
          WHERE NOT EXISTS (SELECT 1 FROM order_status_history h WHERE h.order_id = website_orders.id);
        CREATE TABLE IF NOT EXISTS service_requests (
          id SERIAL PRIMARY KEY, reference_id VARCHAR(80) UNIQUE NOT NULL, customer_name VARCHAR(120) NOT NULL,
          phone VARCHAR(20) NOT NULL, email VARCHAR(254), service_category VARCHAR(100) NOT NULL,
          device_type VARCHAR(40) NOT NULL, brand_model VARCHAR(160), problem_description TEXT NOT NULL,
          address TEXT NOT NULL, preferred_contact_time VARCHAR(80), image_urls JSON NOT NULL DEFAULT '[]',
          status VARCHAR(40) NOT NULL DEFAULT 'New Request', assigned_to VARCHAR(120), internal_notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_service_requests_reference_id ON service_requests(reference_id);
        CREATE INDEX IF NOT EXISTS ix_service_requests_phone ON service_requests(phone);
        CREATE INDEX IF NOT EXISTS ix_service_requests_status ON service_requests(status);
        CREATE TABLE IF NOT EXISTS service_request_history (
          id SERIAL PRIMARY KEY, request_id INTEGER NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
          old_status VARCHAR(40), new_status VARCHAR(40) NOT NULL, note TEXT, changed_by VARCHAR(80),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS ix_service_request_history_request_id ON service_request_history(request_id);
    """))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS service_request_history; DROP TABLE IF EXISTS service_requests; DROP TABLE IF EXISTS order_status_history;"))
    op.execute(sa.text("ALTER TABLE website_orders DROP COLUMN IF EXISTS carrier, DROP COLUMN IF EXISTS tracking_number, DROP COLUMN IF EXISTS tax_amount"))
    op.execute(sa.text("ALTER TABLE website_orders ALTER COLUMN order_id TYPE VARCHAR(36)"))
