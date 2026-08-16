import inspect
from pathlib import Path

from app import models
from app.adjacency_resolver import StructuralAdjacencyResolver
from app.l3_reachability_resolver import ConfiguredL3ReachabilityResolver
from app.nat_resolver import ConfiguredNATPolicyResolver
from app.repository import CanonicalRepository
from app.security_resolver import ConfiguredSecurityPolicyResolver
from app.security_evaluation_resolver import ConfiguredSecurityEvaluationResolver
from app.structural_adjacency_resolver import StructuralAdjacencyProofResolver


def test_canonical_domain_tables_do_not_add_workspace_id():
    assert all(
        "workspace_id" not in table.columns
        for table in models.Base.metadata.tables.values()
    )


def test_adjacency_lookup_uses_only_injected_repository_session():
    repository_source = inspect.getsource(
        CanonicalRepository.get_adjacency_identity_candidates
    )
    assert "self.session" in repository_source
    for resolver in (
        StructuralAdjacencyResolver,
        StructuralAdjacencyProofResolver,
        ConfiguredL3ReachabilityResolver,
        ConfiguredNATPolicyResolver,
        ConfiguredSecurityPolicyResolver,
        ConfiguredSecurityEvaluationResolver,
    ):
        source = inspect.getsource(resolver)
        assert "SessionLocal" not in source
        assert "create_engine" not in source
        assert "workspace" not in source.lower()
        assert "cache" not in source.lower()


def test_canonical_code_and_migrations_do_not_qualify_public_schema():
    root = Path(__file__).resolve().parents[1]
    paths = [root / "app" / "models.py", root / "app" / "repository.py"]
    paths.extend((root / "alembic" / "versions").glob("*.py"))
    assert all("public." not in path.read_text(encoding="utf-8") for path in paths)
