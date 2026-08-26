def pytest_addoption(parser):
    group = parser.getgroup("perf")
    group.addoption("--perf-mode", choices=("quick", "full"), default="quick")
    group.addoption("--perf-profile", choices=("small", "medium", "port_heavy", "large"), default="small")
    group.addoption("--perf-seed", type=int, default=20260826)
    group.addoption("--perf-results", default="perf/results/latest.json")
    group.addoption("--perf-case", choices=("projection_l1", "projection_l2", "saved_map", "catalog_inventory", "physical_object", "trace_specific_port", "trace_any_port"), default=None)
