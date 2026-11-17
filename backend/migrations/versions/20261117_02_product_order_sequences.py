"""Add persistent product-specific order reference sequences."""

from alembic import op
import sqlalchemy as sa

revision = "20261117_02"
down_revision = "20261117_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "product_order_sequences",
        sa.Column("sku", sa.String(120), primary_key=True),
        sa.Column("last_assigned_order_number", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.add_column("website_order_items", sa.Column("product_order_number", sa.Integer(), nullable=True))
    op.add_column("website_order_items", sa.Column("product_order_reference", sa.String(200), nullable=True))
    op.create_index(
        "ix_website_order_items_product_order_reference",
        "website_order_items",
        ["product_order_reference"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_website_order_items_product_order_reference", table_name="website_order_items")
    op.drop_column("website_order_items", "product_order_reference")
    op.drop_column("website_order_items", "product_order_number")
    op.drop_table("product_order_sequences")
