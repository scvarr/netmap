"""PostgreSQL snapshot and writer-concurrency guarantees for draft review."""
import copy
import uuid

from sqlalchemy import event, select, text

from app import models as m
from app.base_template_review import BaseTemplateReview
from app.database import SessionLocal
from app.hardware_catalog import HardwareCatalog
from app.main import open_base_template_draft
from tests.test_base_template_review import check, open_draft, save
from tests.test_hardware_configuration import create_base, create_object


def test_existing_review_read_has_only_access_share_locks_and_does_not_block_writer():
    template_id, _ = create_base()
    obj = create_object(template_id)
    checked = check(template_id, open_draft(template_id))
    point_id = uuid.UUID(obj['slots'][0]['connection_point_ref']['entity_id'])
    observed = []

    # Pause at the real GET transaction's commit boundary, while all of its
    # locks are still held. A separate PostgreSQL writer must commit immediately.
    with SessionLocal() as reader:
        def before_commit(session):
            assert session.scalar(text('SHOW transaction_isolation')) == 'repeatable read'
            locks = session.execute(text("""
                SELECT c.relname, l.mode FROM pg_locks l
                JOIN pg_class c ON c.oid = l.relation
                WHERE l.pid = pg_backend_pid() AND l.granted
                  AND c.relnamespace = current_schema()::regnamespace
                  AND c.relkind = 'r'
            """)).all()
            observed.extend(locks)
            assert locks and all(mode == 'AccessShareLock' for _, mode in locks)
            with SessionLocal.begin() as writer:
                writer.execute(text("SET LOCAL lock_timeout = '750ms'"))
                # No exclusive ownership of BaseTemplate by an ordinary GET.
                writer.execute(select(m.BaseTemplate).where(m.BaseTemplate.id == uuid.UUID(template_id)).with_for_update(nowait=True))
                writer.get(m.ConnectionPoint, point_id).cardinality = 2

        event.listen(reader, 'before_commit', before_commit)
        document = open_base_template_draft(uuid.UUID(template_id), reader)

    assert observed
    assert document['review']['candidate_id'] == checked['review']['candidate_id']
    assert document['review']['current']  # Valid for this GET's pre-write snapshot.
    assert not open_draft(template_id)['review']['current']


def test_check_persists_one_snapshot_despite_committed_concurrent_changes(monkeypatch):
    template_id, _ = create_base()
    obj = create_object(template_id)
    first = check(template_id, open_draft(template_id))
    with SessionLocal() as session:
        expected_fingerprint = session.get(m.BaseTemplateCandidate, uuid.UUID(first['review']['candidate_id'])).input_fingerprint
    definition = copy.deepcopy(first['definition'])
    definition['slots'] = []
    saved = save(template_id, first, definition)
    assert not saved['review']['current']
    interface_id = uuid.UUID(obj['slots'][0]['network_interface_ref']['entity_id'])
    original_inputs = BaseTemplateReview._inputs
    concurrent_objects = []

    def inputs_with_concurrent_commit(review):
        fingerprint = original_inputs(review)
        if not concurrent_objects:
            with SessionLocal.begin() as writer:
                writer.execute(text("SET LOCAL lock_timeout = '750ms'"))
                alias = writer.scalar(select(m.EntityMetadata).where(m.EntityMetadata.network_interface_id == interface_id))
                alias.value = 'User data committed during check'
                created = HardwareCatalog(writer).create_object(uuid.UUID(template_id), 'Concurrent object')
                concurrent_objects.append(str(created.physical_object_id))
        return fingerprint

    monkeypatch.setattr(BaseTemplateReview, '_inputs', inputs_with_concurrent_commit)
    checked = check(template_id, saved)
    review = checked['review']
    assert review['current']  # The saved candidate describes its own exact snapshot.
    assert review['definition'] == definition
    assert len(review['result']['objects']) == 1  # Concurrent configuration is invisible.
    assert review['result']['objects'][0]['classification'] == 'potentially_safe'
    with SessionLocal() as session:
        candidate = session.get(m.BaseTemplateCandidate, uuid.UUID(review['candidate_id']))
        assert candidate.input_fingerprint == expected_fingerprint
        assert candidate.result == review['result']
        assert session.scalar(select(m.EntityMetadata.value).where(m.EntityMetadata.network_interface_id == interface_id)) == 'User data committed during check'

    assert not open_draft(template_id)['review']['current']
    rechecked = check(template_id, checked)['review']
    by_object = {item['physical_object_id']: item for item in rechecked['result']['objects']}
    assert by_object[obj['physical_object_ref']['entity_id']]['classification'] == 'requires_intervention'
    assert by_object[concurrent_objects[0]]['classification'] == 'potentially_safe'
    with SessionLocal() as session:
        assert session.get(m.BaseTemplateCandidate, uuid.UUID(rechecked['candidate_id'])).input_fingerprint != expected_fingerprint


def test_document_without_verified_inputs_cannot_claim_current_review():
    template_id, _ = create_base()
    checked = check(template_id, open_draft(template_id))
    with SessionLocal.begin() as session:
        draft = session.scalar(select(m.BaseTemplateDraft).where(m.BaseTemplateDraft.template_id == uuid.UUID(template_id)))
        candidate = session.get(m.BaseTemplateCandidate, uuid.UUID(checked['review']['candidate_id']))
        assert not BaseTemplateReview(session).document(draft, candidate)['review']['current']

    edited = save(template_id, checked, {**checked['definition'], 'name': 'Changed draft'})
    assert not edited['review']['current']
    assert not open_draft(template_id)['review']['current']


def test_concurrent_initialization_retries_snapshot_and_retains_one_draft():
    template_id, _ = create_base()
    initialized = []
    with SessionLocal() as reader:
        def before_execute(connection, cursor, statement, parameters, context, executemany):
            # Initialize between the reader's absent-draft lookup and its root
            # lock. RR must retry rather than reuse a now-obsolete empty snapshot.
            if not initialized and 'FROM base_templates' in statement and 'FOR UPDATE' in statement:
                with SessionLocal() as writer:
                    initialized.append(open_base_template_draft(uuid.UUID(template_id), writer))

        def after_begin(session, transaction, connection):
            event.listen(connection, 'before_cursor_execute', before_execute)

        event.listen(reader, 'after_begin', after_begin)
        document = open_base_template_draft(uuid.UUID(template_id), reader)
    assert initialized and document == initialized[0]
    with SessionLocal() as session:
        assert len(session.scalars(select(m.BaseTemplateDraft).where(m.BaseTemplateDraft.template_id == uuid.UUID(template_id))).all()) == 1
