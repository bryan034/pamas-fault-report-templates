"""Initial, frozen template schema with checked adoption of existing installations.

Existing tables/data are never replaced. Missing tables/indexes are added only
when existing columns and integrity constraints agree with this baseline.
"""
from alembic import op
from alembic.migration import MigrationContext
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0001_template_schema"
down_revision = None
branch_labels = None
depends_on = None


def schema_snapshot():
    metadata = sa.MetaData()

    sa.Table('application_login_attempts', metadata,
    sa.Column('state_hash', sa.String(length=64), nullable=False),
    sa.Column('browser_hash', sa.String(length=64), nullable=False),
    sa.Column('nonce', sa.String(length=128), nullable=False),
    sa.Column('verifier', sa.String(length=128), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('state_hash')
    )
    sa.Index('ix_application_login_attempts_expires_at', metadata.tables['application_login_attempts'].c['expires_at'])
    sa.Table('application_sessions', metadata,
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('subject', sa.String(length=255), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('token_hash')
    )
    sa.Index('ix_application_sessions_email', metadata.tables['application_sessions'].c['email'])
    sa.Index('ix_application_sessions_expires_at', metadata.tables['application_sessions'].c['expires_at'])
    sa.Table('application_users', metadata,
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('role', sa.String(length=12), nullable=False),
    sa.Column('updated_by', sa.String(length=254), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('email')
    )
    sa.Table('templates', metadata,
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=100), nullable=False),
    sa.Column('definition', sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'), nullable=False),
    sa.Column('source_pdf', sa.LargeBinary(), nullable=False),
    sa.Column('blank_pdf', sa.LargeBinary(), nullable=False),
    sa.Column('thumbnail', sa.LargeBinary(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    sa.Table('word_conversion_sources', metadata,
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('payload', sa.LargeBinary(), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    sa.Index('ix_word_conversion_sources_expires_at', metadata.tables['word_conversion_sources'].c['expires_at'])
    sa.Table('template_archives', metadata,
    sa.Column('template_id', sa.String(length=36), nullable=False),
    sa.Column('archived_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['template_id'], ['templates.id'], ),
    sa.PrimaryKeyConstraint('template_id')
    )
    sa.Table('template_drafts', metadata,
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('template_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=100), nullable=False),
    sa.Column('form', sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['template_id'], ['templates.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    sa.Index('ix_template_drafts_template_id', metadata.tables['template_drafts'].c['template_id'])
    sa.Table('template_revisions', metadata,
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('template_id', sa.String(length=36), nullable=False),
    sa.Column('number', sa.Integer(), nullable=False),
    sa.Column('definition', sa.JSON().with_variant(postgresql.JSONB(), 'postgresql'), nullable=False),
    sa.Column('source_pdf', sa.LargeBinary(), nullable=False),
    sa.Column('blank_pdf', sa.LargeBinary(), nullable=False),
    sa.Column('thumbnail', sa.LargeBinary(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['template_id'], ['templates.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('template_id', 'number', name='unique_template_revision_number')
    )
    sa.Index('ix_template_revisions_template_id', metadata.tables['template_revisions'].c['template_id'])
    sa.Table('template_draft_deletions', metadata,
    sa.Column('draft_id', sa.String(length=36), nullable=False),
    sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['draft_id'], ['template_drafts.id'], ),
    sa.PrimaryKeyConstraint('draft_id')
    )
    sa.Index('ix_template_draft_deletions_deleted_at', metadata.tables['template_draft_deletions'].c['deleted_at'])
    sa.Table('template_draft_images', metadata,
    sa.Column('draft_id', sa.String(length=36), nullable=False),
    sa.Column('field_id', sa.String(length=80), nullable=False),
    sa.Column('payload', sa.LargeBinary(), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('media_type', sa.String(length=40), nullable=False),
    sa.ForeignKeyConstraint(['draft_id'], ['template_drafts.id'], ),
    sa.PrimaryKeyConstraint('draft_id', 'field_id')
    )
    sa.Table('template_draft_revisions', metadata,
    sa.Column('draft_id', sa.String(length=36), nullable=False),
    sa.Column('revision_id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['draft_id'], ['template_drafts.id'], ),
    sa.ForeignKeyConstraint(['revision_id'], ['template_revisions.id'], ),
    sa.PrimaryKeyConstraint('draft_id')
    )
    sa.Table('template_sources', metadata,
    sa.Column('revision_id', sa.String(length=36), nullable=False),
    sa.Column('filename', sa.String(length=255), nullable=False),
    sa.Column('format', sa.String(length=8), nullable=False),
    sa.Column('payload', sa.LargeBinary(), nullable=False),
    sa.ForeignKeyConstraint(['revision_id'], ['template_revisions.id'], ),
    sa.PrimaryKeyConstraint('revision_id')
    )
    sa.Table('word_documents', metadata,
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('template_id', sa.String(length=36), nullable=False),
    sa.Column('draft_id', sa.String(length=36), nullable=True),
    sa.Column('payload', sa.LargeBinary(), nullable=False),
    sa.Column('version', sa.Integer(), nullable=False),
    sa.Column('editor_key', sa.String(length=64), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['draft_id'], ['template_drafts.id'], ),
    sa.ForeignKeyConstraint(['template_id'], ['templates.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('draft_id')
    )
    sa.Index('ix_word_documents_template_id', metadata.tables['word_documents'].c['template_id'])
    return metadata

def validate_table(bind, inspector, table, schema):
    columns = {item["name"]: item for item in inspector.get_columns(table.name, schema=schema)}
    context = MigrationContext.configure(bind)
    for expected in table.columns:
        actual = columns.get(expected.name)
        if actual is None or actual["nullable"] != expected.nullable or context.impl.compare_type(
            sa.Column(expected.name, actual["type"]), expected
        ):
            raise RuntimeError(f"Schema mismatch at {table.name}.{expected.name}; inspect the database before migrating")
    if inspector.get_pk_constraint(table.name, schema=schema)["constrained_columns"] != [c.name for c in table.primary_key]:
        raise RuntimeError(f"Primary key mismatch on {table.name}")
    unique = {tuple(item["column_names"]) for item in inspector.get_unique_constraints(table.name, schema=schema)}
    for constraint in table.constraints:
        if isinstance(constraint, sa.UniqueConstraint) and tuple(c.name for c in constraint.columns) not in unique:
            raise RuntimeError(f"Unique constraint mismatch on {table.name}")
    foreign = {(tuple(f["constrained_columns"]), f["referred_table"], tuple(f["referred_columns"]))
               for f in inspector.get_foreign_keys(table.name, schema=schema)}
    for constraint in table.foreign_key_constraints:
        expected = (tuple(c.name for c in constraint.columns), constraint.referred_table.name,
                    tuple(element.column.name for element in constraint.elements))
        if expected not in foreign:
            raise RuntimeError(f"Foreign key mismatch on {table.name}")


def upgrade():
    bind = op.get_bind()
    schema = bind.get_execution_options().get("schema_translate_map", {}).get(None)
    inspector = sa.inspect(bind)
    existing = set(inspector.get_table_names(schema=schema))
    snapshot = schema_snapshot()
    # Validate the whole existing schema before issuing any DDL.
    for table in snapshot.sorted_tables:
        if table.name in existing:
            validate_table(bind, inspector, table, schema)
    for table in snapshot.sorted_tables:
        if table.name not in existing:
            table.create(bind)
        else:
            indexes = {item["name"]: item for item in inspector.get_indexes(table.name, schema=schema)}
            for index in table.indexes:
                if index.name not in indexes:
                    index.create(bind)
                elif indexes[index.name]["column_names"] != [c.name for c in index.columns]:
                    raise RuntimeError(f"Index mismatch on {table.name}.{index.name}")


def downgrade():
    raise RuntimeError("The initial schema cannot be dropped by downgrade. Restore a verified backup into a separate database instead.")
