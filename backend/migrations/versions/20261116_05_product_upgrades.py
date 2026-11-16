"""Add structured product specifications and configurable hardware upgrades."""
from alembic import op
import sqlalchemy as sa

revision = "20261116_05"
down_revision = "20261116_04"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE business_products ADD COLUMN IF NOT EXISTS structured_specifications JSON NOT NULL DEFAULT '{}'"))
    op.execute(sa.text("ALTER TABLE business_products ADD COLUMN IF NOT EXISTS upgrade_options JSON NOT NULL DEFAULT '{}'"))
    op.execute(sa.text("ALTER TABLE website_order_items ADD COLUMN IF NOT EXISTS base_unit_price NUMERIC(12,2)"))
    op.execute(sa.text("ALTER TABLE website_order_items ADD COLUMN IF NOT EXISTS upgrade_amount NUMERIC(12,2) NOT NULL DEFAULT 0"))
    op.execute(sa.text("ALTER TABLE website_order_items ADD COLUMN IF NOT EXISTS configuration JSON NOT NULL DEFAULT '{}'"))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE website_order_items DROP COLUMN IF EXISTS configuration, DROP COLUMN IF EXISTS upgrade_amount, DROP COLUMN IF EXISTS base_unit_price"))
    op.execute(sa.text("ALTER TABLE business_products DROP COLUMN IF EXISTS upgrade_options, DROP COLUMN IF EXISTS structured_specifications"))
