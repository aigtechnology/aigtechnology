"""Add optional Firebase identity to website customers."""

from alembic import op
import sqlalchemy as sa

revision = "20261117_03"
down_revision = "20261117_02"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("website_customers", sa.Column("firebase_uid", sa.String(128), nullable=True))
    op.add_column(
        "website_customers",
        sa.Column("auth_provider", sa.String(30), nullable=False, server_default="guest"),
    )
    op.create_index("ix_website_customers_firebase_uid", "website_customers", ["firebase_uid"], unique=True)
    op.alter_column("customer_sessions", "normalized_phone", existing_type=sa.String(10), nullable=True)


def downgrade() -> None:
    op.alter_column("customer_sessions", "normalized_phone", existing_type=sa.String(10), nullable=False)
    op.drop_index("ix_website_customers_firebase_uid", table_name="website_customers")
    op.drop_column("website_customers", "auth_provider")
    op.drop_column("website_customers", "firebase_uid")
