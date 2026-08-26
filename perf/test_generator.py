from perf.generate import PROFILES, port_plan, stable_id


def test_profile_port_plans_are_exact_and_deterministic():
    for profile in PROFILES.values():
        assert sum(port_plan(profile)) == profile.ports
        assert port_plan(profile) == port_plan(profile)


def test_seeded_ids_are_stable():
    assert stable_id(7, "object", 2) == stable_id(7, "object", 2)
    assert stable_id(7, "object", 2) != stable_id(8, "object", 2)
