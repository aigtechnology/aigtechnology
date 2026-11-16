"""Add offline purchase records for invoice/mobile service verification."""
from alembic import op
import sqlalchemy as sa

revision = "20261114_03"
down_revision = "20261114_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "offline_purchases",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("invoice_type", sa.String(20), nullable=False),
        sa.Column("invoice_number", sa.String(120), nullable=False),
        sa.Column("customer_name", sa.String(120), nullable=False),
        sa.Column("mobile", sa.String(20), nullable=False),
        sa.Column("email", sa.String(254)),
        sa.Column("product_name", sa.String(255), nullable=False),
        sa.Column("product_model", sa.String(160), nullable=False, server_default=""),
        sa.Column("serial_number", sa.String(160), nullable=False, server_default=""),
        sa.Column("purchase_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column("warranty_months", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("invoice_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("invoice_type", "invoice_number", "mobile", "product_model", "serial_number", name="uq_offline_purchase_identity"),
    )
    op.create_index("ix_offline_purchases_invoice_type", "offline_purchases", ["invoice_type"])
    op.create_index("ix_offline_purchases_invoice_number", "offline_purchases", ["invoice_number"])
    op.create_index("ix_offline_purchases_mobile", "offline_purchases", ["mobile"])


def downgrade() -> None:
    op.drop_table("offline_purchases")
