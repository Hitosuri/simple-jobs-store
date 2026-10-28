"""Read-only insight routes: attempts window and overview."""

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.exceptions import RequestValidationError

import stats
from api.deps import ConnDep, NowDep
from api.envelope import ApiOk
from api.schemas import AttemptWindowOut, OverviewOut
from domain import EpochMs, WorkerId

router = APIRouter(tags=["insights"])

MAX_WINDOW_MS = 86_400_000


def _epoch_ms(moment: datetime) -> EpochMs:
    aware = moment if moment.tzinfo else moment.replace(tzinfo=UTC)
    return EpochMs((aware - datetime(1970, 1, 1, tzinfo=UTC)) // timedelta(milliseconds=1))


@router.get("/attempts")
def list_attempts(
    conn: ConnDep,
    start: Annotated[datetime, Query(alias="from")],
    end: Annotated[datetime, Query(alias="to")],
    worker: str | None = None,
) -> ApiOk[list[AttemptWindowOut]]:
    """List attempts overlapping the window `from`..`to`, at most 24 hours wide."""
    start_ms, end_ms = _epoch_ms(start), _epoch_ms(end)
    if not 0 < end_ms - start_ms <= MAX_WINDOW_MS:
        raise RequestValidationError(
            [
                {
                    "type": "value_error",
                    "loc": ("query", "to"),
                    "msg": "`to` must be after `from` by at most 24 hours",
                    "input": end.isoformat(),
                }
            ]
        )
    rows = stats.attempts_between(
        conn,
        start=start_ms,
        end=end_ms,
        worker_id=None if worker is None else WorkerId(worker),
    )
    return ApiOk[list[AttemptWindowOut]](data=[AttemptWindowOut.build(r) for r in rows])


@router.get("/overview")
def get_overview(conn: ConnDep, now: NowDep) -> ApiOk[OverviewOut]:
    """Return everything the Overview screen shows."""
    return ApiOk[OverviewOut](data=OverviewOut.build(stats.overview(conn, now=now), now))
