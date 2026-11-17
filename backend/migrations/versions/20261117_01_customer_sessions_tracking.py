"""Add unified customer sessions and website shipment metadata."""
from alembic import op
import sqlalchemy as sa

revision = "20261117_01"
down_revision = "20261116_05"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("website_customers", sa.Column("normalized_phone", sa.String(10), nullable=True))
    op.execute("UPDATE website_customers SET normalized_phone = RIGHT(REGEXP_REPLACE(phone, '[^0-9]', '', 'g'), 10) WHERE normalized_phone IS NULL")
    op.alter_column("website_customers", "normalized_phone", nullable=False)
    op.create_index("ix_website_customers_normalized_phone", "website_customers", ["normalized_phone"])
    op.add_column("website_orders", sa.Column("tracking_url", sa.String(2048), nullable=True))
    op.add_column("website_orders", sa.Column("actual_dispatch_date", sa.DateTime(timezone=True), nullable=True))
    op.add_column("website_orders", sa.Column("estimated_delivery_date", sa.DateTime(timezone=False), nullable=True))
    op.create_table(
        "customer_sessions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("customer_id", sa.Integer(), sa.ForeignKey("website_customers.id", ondelete="SET NULL"), nullable=True),
        sa.Column("normalized_phone", sa.String(10), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("token_hash", name="uq_customer_sessions_token_hash"),
    )
    op.create_index("ix_customer_sessions_customer_id", "customer_sessions", ["customer_id"])
    op.create_index("ix_customer_sessions_normalized_phone", "customer_sessions", ["normalized_phone"])
    op.create_index("ix_customer_sessions_expires_at", "customer_sessions", ["expires_at"])


def downgrade() -> None:
    op.drop_table("customer_sessions")
    op.drop_column("website_orders", "estimated_delivery_date")
    op.drop_column("website_orders", "actual_dispatch_date")
    op.drop_column("website_orders", "tracking_url")
    op.drop_index("ix_website_customers_normalized_phone", table_name="website_customers")
    op.drop_column("website_customers", "normalized_phone")
