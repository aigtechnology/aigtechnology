"""Add product categories, delivery rules, and upgrade stock reservations."""

from alembic import op
import sqlalchemy as sa

revision = "20261118_01"
down_revision = "20261117_03"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("business_products", sa.Column("category", sa.String(80), nullable=True))
    op.create_index("ix_business_products_category", "business_products", ["category"])
    op.add_column("inventory_reservations", sa.Column("upgrade_stock_reservation", sa.JSON(), nullable=False, server_default="{}"))
    op.add_column("inventory_reservations", sa.Column("upgrade_stock_released", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_table(
        "delivery_charge_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("category", sa.String(80), nullable=False),
        sa.Column("charge_amount", sa.Numeric(12, 2), nullable=False, server_default="0"),
        sa.Column("charge_type", sa.String(20), nullable=False, server_default="fixed"),
        sa.Column("free_delivery", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("free_delivery_minimum", sa.Numeric(12, 2), nullable=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("category", name="uq_delivery_charge_rule_category"),
    )
    op.create_index("ix_delivery_charge_rules_category", "delivery_charge_rules", ["category"])


def downgrade() -> None:
    op.drop_index("ix_delivery_charge_rules_category", table_name="delivery_charge_rules")
    op.drop_table("delivery_charge_rules")
    op.drop_column("inventory_reservations", "upgrade_stock_released")
    op.drop_column("inventory_reservations", "upgrade_stock_reservation")
    op.drop_index("ix_business_products_category", table_name="business_products")
    op.drop_column("business_products", "category")
