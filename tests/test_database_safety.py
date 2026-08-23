import pytest

from conftest import require_confirmed_test_database


def test_destructive_cleanup_requires_explicit_test_database_marker():
    with pytest.raises(pytest.UsageError, match="NETMAP_TEST_DATABASE=1"):
        require_confirmed_test_database(
            "postgresql+psycopg://netmap:netmap@db:5432/netmap_test",
            "0",
        )


def test_destructive_cleanup_rejects_normal_runtime_database_even_with_marker():
    with pytest.raises(pytest.UsageError, match="must target 'netmap_test'"):
        require_confirmed_test_database(
            "postgresql+psycopg://netmap:netmap@db:5432/netmap",
            "1",
        )


def test_destructive_cleanup_accepts_only_confirmed_test_database():
    require_confirmed_test_database(
        "postgresql+psycopg://netmap:netmap@test-db:5432/netmap_test",
        "1",
    )
