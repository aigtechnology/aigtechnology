"""Add purchase-linked service request fields and preserve structured order IDs."""
from alembic import op
import sqlalchemy as sa

revision = "20261116_04"
down_revision = "20261114_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE website_orders ALTER COLUMN order_id TYPE VARCHAR(80)"))
    op.execute(sa.text("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS purchase_type VARCHAR(20)"))
    op.execute(sa.text("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS purchase_reference VARCHAR(120)"))
    op.execute(sa.text("ALTER TABLE service_requests ADD COLUMN IF NOT EXISTS purchase_mobile VARCHAR(20)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_service_requests_purchase_reference ON service_requests(purchase_reference)"))


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_service_requests_purchase_reference"))
    op.execute(sa.text("ALTER TABLE service_requests DROP COLUMN IF EXISTS purchase_mobile, DROP COLUMN IF EXISTS purchase_reference, DROP COLUMN IF EXISTS purchase_type"))
