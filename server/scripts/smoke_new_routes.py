import json
import urllib.request
import urllib.error

BASE_URL = "http://127.0.0.1:5000"


def post_json(path, payload):
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            parsed = json.loads(body) if body else {}
        except json.JSONDecodeError:
            parsed = {"raw": body}
        return e.code, parsed


def get_json(path):
    req = urllib.request.Request(f"{BASE_URL}{path}", method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body)
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8")
        try:
            parsed = json.loads(body) if body else {}
        except json.JSONDecodeError:
            parsed = {"raw": body}
        return e.code, parsed


def main():
    status, body = post_json("/pose/sentence", {"sentence": "hello world"})
    print("/pose/sentence status:", status)
    print(body)
    assert status == 200, "Expected 200 from /pose/sentence"
    assert isinstance(body.get("signs"), list), "Expected signs list"

    status_400, body_400 = post_json("/pose/sentence", {"sentence": "   "})
    print("/pose/sentence empty status:", status_400)
    print(body_400)
    assert status_400 == 400, "Expected 400 for empty sentence"
    assert body_400.get("error") == "invalid_request"

    signs = body.get("signs") or []
    first_sign_id = next((s.get("sign_id") for s in signs if s.get("sign_id")), None)
    if first_sign_id:
        status_word, body_word = get_json(f"/pose/word/{first_sign_id}")
        print("/pose/word/<id> status:", status_word)
        print(body_word)
        assert status_word == 200, "Expected 200 from /pose/word/<id>"
        assert str(body_word.get("sign_id")) == str(first_sign_id)
        assert "frame_count" in body_word

    status_bad, body_bad = get_json("/pose/word/not-a-number")
    print("/pose/word/non-numeric status:", status_bad)
    print(body_bad)
    assert status_bad == 400, "Expected 400 for non-numeric sign_id"
    assert body_bad.get("error") == "invalid_sign_id"

    print("Smoke checks passed.")


if __name__ == "__main__":
    main()
