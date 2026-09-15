import json
from collections.abc import Iterator

import httpx2
import pytest
from typing_extensions import override

import reports
from domain import CallbackMethod


def method(path: str) -> CallbackMethod:
    return CallbackMethod.model_validate(
        {"type": "callback", "config": {"url": f"https://p.example{path}"}}
    )


def respond(request: httpx2.Request) -> httpx2.Response:
    if request.url.path == "/timeout":
        msg = "slow"
        raise httpx2.ConnectTimeout(msg, request=request)
    return httpx2.Response(int(request.url.path.strip("/")))


@pytest.fixture
def http() -> Iterator[httpx2.Client]:
    with httpx2.Client(transport=httpx2.MockTransport(respond)) as client:
        yield client


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("/200", None),
        ("/204", None),
        ("/500", "HTTP 500"),
        ("/302", "HTTP 302"),
        ("/timeout", "ConnectTimeout: slow"),
    ],
)
def test_send_maps_outcome(http: httpx2.Client, path: str, expected: str | None) -> None:
    assert reports.send(http, method(path), {"id": 1}) == expected


class _ExplodingBody(httpx2.SyncByteStream):
    """A body that fails the test if `send` ever reads it."""

    @override
    def __iter__(self) -> Iterator[bytes]:
        msg = "response body was consumed"
        raise AssertionError(msg)

    @override
    def close(self) -> None:
        pass


def test_send_does_not_read_the_response_body() -> None:
    def handler(_request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, stream=_ExplodingBody())

    with httpx2.Client(transport=httpx2.MockTransport(handler)) as client:
        assert reports.send(client, method("/hook"), {"id": 1}) is None


def test_send_posts_body_as_json() -> None:
    seen: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200)

    with httpx2.Client(transport=httpx2.MockTransport(handler)) as client:
        reports.send(client, method("/hook"), {"id": 7, "status": "success"})
    assert len(seen) == 1
    assert seen[0].method == "POST"
    assert str(seen[0].url) == "https://p.example/hook"
    assert seen[0].headers["content-type"] == "application/json"
    assert json.loads(seen[0].content) == {"id": 7, "status": "success"}
