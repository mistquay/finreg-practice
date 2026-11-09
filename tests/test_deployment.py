"""Portable deployment checks; no private question-bank fixtures required."""
import json
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import app
import database


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.root_patch = patch.object(database, "ROOT", self.root)
        self.db_patch = patch.object(database, "DB_PATH", self.root / "data/practice.sqlite3")
        self.app_patch = patch.object(app, "ROOT", self.root)
        for item in (self.root_patch, self.db_patch, self.app_patch):
            item.start()
        database.initialize()
        self.server = app.ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        for item in (self.app_patch, self.db_patch, self.root_patch):
            item.stop()
        self.tmp.cleanup()

    def request(self, path, data=None, host=None, origin=None):
        headers = {}
        if host:
            headers["Host"] = host
        if origin:
            headers["Origin"] = origin
        body = None
        if data is not None:
            headers["Content-Type"] = "application/json"
            body = json.dumps(data).encode()
        return urlopen(Request(self.base + path, data=body, headers=headers), timeout=5)

    def test_origin_configuration(self):
        self.assertEqual(app.configured_origins(" HTTPS://Study.Example:443/ ,http://192.0.2.1:8765 "),
                         {"https://study.example", "http://192.0.2.1:8765"})
        self.assertEqual(app.configured_origins(""), set())
        for value in ("*", "https://*.example.com", "https://@study.example", "study.example", "ftp://study.example", "https://study.example/path",
                      "https://user:password@study.example", "https://study.example?token=abc"):
            with self.assertRaises(ValueError):
                app.configured_origins(value)

    def test_local_default_and_rejection_of_unknown_hosts(self):
        with self.request("/healthz") as response:
            self.assertEqual(json.load(response), {"status": "ok"})
        for headers in ({"host": "study.example"}, {"origin": "https://untrusted.example"}):
            with self.assertRaises(HTTPError) as error:
                self.request("/api/meta", **headers)
            self.assertEqual(error.exception.code, 403)
            error.exception.close()

    def test_reverse_proxy_and_published_port_origins(self):
        self.server.allowed_origins = app.configured_origins(
            "https://study.example,http://192.0.2.1:18765")
        for host, origin in (("study.example", "https://study.example"),
                             ("study.example:443", "https://study.example"),
                             ("192.0.2.1:18765", "http://192.0.2.1:18765")):
            with self.request("/healthz", host=host, origin=origin) as response:
                self.assertEqual(response.status, 200)
        with self.assertRaises(HTTPError) as error:
            self.request("/api/import", data={}, host="study.example", origin="https://untrusted.example")
        self.assertEqual(error.exception.code, 403)
        error.exception.close()

    def test_assets_and_originals_share_the_persistent_directory(self):
        for folder, name, body in (("assets", "chart.svg", b"<svg/>"), ("sources", "paper.pdf", b"%PDF-test")):
            target = self.root / "data" / folder / name
            target.parent.mkdir(parents=True)
            target.write_bytes(body)
            with self.request(f"/{folder}/{name}") as response:
                self.assertEqual(response.read(), body)
        with self.assertRaises(HTTPError) as error:
            self.request("/data/practice.sqlite3")
        self.assertEqual(error.exception.code, 404)
        error.exception.close()

    def test_empty_bank_import_and_persistence(self):
        with self.request("/api/meta") as response:
            self.assertEqual(json.load(response)["counts"]["total"], 0)
        payload = {"title": "Deployment test", "questions": [{"stem": "选择 A", "options": ["甲", "乙"], "answer": "A"}]}
        with self.request("/api/import", {"data": payload}) as response:
            self.assertEqual(json.load(response)["added"], 1)
        database.initialize()
        with self.request("/api/questions") as response:
            self.assertEqual(json.load(response)["total"], 1)
        with closing(sqlite3.connect(self.root / "data/practice.sqlite3")) as connection:
            self.assertEqual(connection.execute("PRAGMA integrity_check").fetchone()[0], "ok")


if __name__ == "__main__":
    unittest.main()
