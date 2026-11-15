"""CI-only HTTP smoke test against the disposable container on port 18765."""
import argparse
import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:18765"
NOTE = "container persistence smoke test"
# The workflow starts the container with FINREG_SETUP_CODE set to this value.
SETUP_CODE = "SMOKE-TEST-CODE"
ACCOUNT = {"username": "smoke", "password": "smoke-test-password"}
session = {"cookie": ""}


def request(path, data=None):
    headers = {"Host": "study.example", "Origin": "https://study.example"}
    if session["cookie"]:
        headers["Cookie"] = session["cookie"]
    body = None
    if data is not None:
        headers["Content-Type"] = "application/json"
        body = json.dumps(data).encode()
    with urlopen(Request(BASE + path, data=body, headers=headers), timeout=5) as response:
        if response.headers.get("Set-Cookie"):
            session["cookie"] = response.headers["Set-Cookie"].split(";")[0]
        return json.load(response)


def sign_in():
    try:
        request("/api/meta")
        raise AssertionError("API answered without a login")
    except HTTPError as error:
        assert error.code == 401
    if request("/api/auth/me")["setup"]:
        request("/api/auth/register", dict(ACCOUNT, code=SETUP_CODE))
    else:
        request("/api/auth/login", ACCOUNT)
    assert request("/api/auth/me")["user"]["role"] == "admin"


def wait_ready():
    deadline = time.monotonic() + 30
    while True:
        try:
            assert request("/healthz") == {"status": "ok"}
            return
        # Docker can reset an accepted connection before the app is listening.
        except (URLError, TimeoutError, ConnectionError):
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
    sign_in()
    write() if args.phase == "write" else verify()
    print(f"Container smoke test {args.phase}: PASS")
