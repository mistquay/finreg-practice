"""CI-only HTTP smoke test against the disposable container on port 18765."""
import argparse
import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:18765"
NOTE = "container persistence smoke test"


def request(path, data=None, origin=BASE):
    headers = {"Origin": origin}
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode()
    with urlopen(Request(BASE + path, data=body, headers=headers), timeout=5) as response:
        return json.load(response)


def wait_ready():
    deadline = time.monotonic() + 30
    while True:
        try:
            assert request("/healthz") == {"status": "ok"}
            return
        except (URLError, TimeoutError):
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.5)


def write():
    assert request("/api/meta")["counts"]["total"] == 0
    payload = {"title": "Container smoke test", "questions": [{
        "id": "smoke-one", "stem": "请选择 A。", "options": {"A": "正确", "B": "错误"},
        "answer": "A", "module": "计算机专业",
    }]}
    assert request("/api/import", {"data": payload})["added"] == 1
    question = request("/api/questions")["items"][0]
    request("/api/mark/" + question["id"], {"favorite": True, "note": NOTE})
    session = request("/api/session", {"filters": {"paper_id": question["paper_id"]}, "count": 1})
    result = request("/api/session/" + session["id"] + "/answer", {
        "question_id": question["id"], "selected": ["A"], "elapsed_ms": 1000,
    })
    assert result["correct"] == 1
    request("/api/session/" + session["id"] + "/finish", {})
    try:
        request("/api/session", {}, origin="https://untrusted.example")
    except HTTPError as error:
        assert error.code == 403
        error.close()
    else:
        raise AssertionError("An unconfigured Origin was accepted")


def verify():
    meta = request("/api/meta")
    assert meta["counts"]["total"] == 1
    assert meta["counts"]["favorites"] == 1
    assert meta["counts"]["seen"] == 1
    assert meta["sessions"][0]["status"] == "completed"
    question = request("/api/questions")["items"][0]
    assert question["note"] == NOTE
    assert request("/api/stats?days=0")["summary"]["correct"] == 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=("write", "verify"), required=True)
    args = parser.parse_args()
    wait_ready()
    write() if args.phase == "write" else verify()
    print(f"Container smoke test {args.phase}: PASS")
