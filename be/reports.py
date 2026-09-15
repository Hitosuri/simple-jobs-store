"""Delivery of finished jobs' outcomes to providers."""

import httpx2
from pydantic import JsonValue

from domain import ReportMethod


def send(client: httpx2.Client, method: ReportMethod, body: JsonValue) -> str | None:
    """Deliver one report. Redirects are not followed, so a 3xx counts as a failure.

    Args:
        client: HTTP client; its timeout bounds the send.
        method: Report method to use.
        body: JSON payload describing the finished job.

    Returns:
        None when the provider answered 2xx, else a short description of the failure.
    """
    try:
        with client.stream("POST", str(method.config.url), json=body) as response:
            return None if response.is_success else f"HTTP {response.status_code}"
    except httpx2.HTTPError as exc:
        return f"{type(exc).__name__}: {exc}"
