from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event

import pytest

from benchly import cli
from benchly.runtime import exclusive_worker_lock


def test_profile_command_waits_for_a_short_lived_writer(tmp_path, monkeypatch):
    database = tmp_path / "benchly.sqlite"
    started = Event()
    calls = []
    monkeypatch.setattr(cli, "enrich_profile_batch_job", lambda args: calls.append(args.database))

    def run_profile():
        started.set()
        return cli.main([
            "enrich-profile-batch", "--database", str(database), "--lock-wait-seconds", "2",
        ])

    with ThreadPoolExecutor(max_workers=1) as pool:
        with exclusive_worker_lock(database) as acquired:
            assert acquired
            pending = pool.submit(run_profile)
            assert started.wait(2)
            with pytest.raises(TimeoutError):
                pending.result(timeout=0.05)
            assert calls == []
        assert pending.result(timeout=3) == 0
    assert calls == [str(database)]


def test_wait_timeout_keeps_the_existing_writer_and_releases_its_own_handle(tmp_path):
    database = tmp_path / "benchly.sqlite"
    with exclusive_worker_lock(database) as acquired:
        assert acquired
        owner = (tmp_path / ".benchly-worker.lock").read_text()
        with exclusive_worker_lock(database, timeout_seconds=0.05) as waiting:
            assert waiting is False
        assert (tmp_path / ".benchly-worker.lock").read_text() == owner
        with exclusive_worker_lock(database) as competing:
            assert competing is False
    with exclusive_worker_lock(database) as next_writer:
        assert next_writer


@pytest.mark.parametrize("timeout", [-1, float("inf"), float("nan")])
def test_invalid_wait_duration_is_rejected(tmp_path, timeout):
    with pytest.raises(ValueError, match="finite and non-negative"):
        with exclusive_worker_lock(tmp_path / "benchly.sqlite", timeout_seconds=timeout):
            pytest.fail("Invalid timeout acquired a worker lock")
