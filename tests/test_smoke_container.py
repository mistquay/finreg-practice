"""Readiness retries for the disposable CI container; no Docker required."""
import unittest
from http.client import RemoteDisconnected
from unittest.mock import patch
from urllib.error import URLError

from scripts import smoke_container


class ContainerReadinessTests(unittest.TestCase):
    def test_ready_container_returns_without_sleeping(self):
        with patch.object(smoke_container, "request", return_value={"status": "ok"}) as request, \
                patch.object(smoke_container.time, "sleep") as sleep:
            smoke_container.wait_ready()
        request.assert_called_once_with("/healthz")
        sleep.assert_not_called()

    def test_transient_startup_errors_are_retried(self):
        for error in (URLError("connection refused"), TimeoutError("timed out"),
                      ConnectionResetError("connection reset by peer"),
                      ConnectionAbortedError("connection aborted"),
                      RemoteDisconnected("remote end closed connection")):
            with self.subTest(error=type(error).__name__), \
                    patch.object(smoke_container, "request", side_effect=[error, {"status": "ok"}]) as request, \
                    patch.object(smoke_container.time, "monotonic", side_effect=[0, 1]), \
                    patch.object(smoke_container.time, "sleep") as sleep:
                smoke_container.wait_ready()
                self.assertEqual(request.call_count, 2)
                sleep.assert_called_once_with(0.5)

    def test_persistent_connection_reset_stops_at_deadline(self):
        error = ConnectionResetError("connection reset by peer")
        with patch.object(smoke_container, "request", side_effect=error) as request, \
                patch.object(smoke_container.time, "monotonic", side_effect=[0, 1, 30]), \
                patch.object(smoke_container.time, "sleep") as sleep:
            with self.assertRaises(ConnectionResetError) as raised:
                smoke_container.wait_ready()
        self.assertIs(raised.exception, error)
        self.assertEqual(request.call_count, 2)
        sleep.assert_called_once_with(0.5)

    def test_unexpected_health_response_fails_immediately(self):
        with patch.object(smoke_container, "request", return_value={"status": "error"}), \
                patch.object(smoke_container.time, "sleep") as sleep:
            with self.assertRaises(AssertionError):
                smoke_container.wait_ready()
        sleep.assert_not_called()


if __name__ == "__main__":
    unittest.main()
