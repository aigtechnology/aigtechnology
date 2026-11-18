"""Add region-specific delivery charge rules."""

from alembic import op
import sqlalchemy as sa

revision = "20261118_02"
down_revision = "20261118_01"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("delivery_charge_rules", sa.Column("region", sa.String(24), nullable=False, server_default="all"))
    op.drop_constraint("uq_delivery_charge_rule_category", "delivery_charge_rules", type_="unique")
    op.create_unique_constraint(
        "uq_delivery_charge_rule_category_region",
        "delivery_charge_rules",
        ["category", "region"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_delivery_charge_rule_category_region", "delivery_charge_rules", type_="unique")
    op.create_unique_constraint("uq_delivery_charge_rule_category", "delivery_charge_rules", ["category"])
    op.drop_column("delivery_charge_rules", "region")
