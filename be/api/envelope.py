"""Response envelope and the mapping of every error into it."""

import logging
import math
from http import HTTPStatus
from typing import Generic, Literal, TypeVar

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, JsonValue
from starlette.exceptions import HTTPException as StarletteHTTPException

from domain import ErrorCode, StoreError

logger = logging.getLogger(__name__)

T = TypeVar("T")


class ApiOk(BaseModel, Generic[T]):
    """Successful response."""

    ok: Literal[True] = True
    data: T


class ErrorBody(BaseModel):
    """Error payload."""

    code: ErrorCode
    message: str
    details: JsonValue = None


class ApiErr(BaseModel):
    """Error response."""

    ok: Literal[False] = False
    error: ErrorBody


HTTP_STATUS: dict[ErrorCode, HTTPStatus] = {
    ErrorCode.VALIDATION_ERROR: HTTPStatus.UNPROCESSABLE_ENTITY,
    ErrorCode.ROUTE_NOT_FOUND: HTTPStatus.NOT_FOUND,
    ErrorCode.METHOD_NOT_ALLOWED: HTTPStatus.METHOD_NOT_ALLOWED,
    ErrorCode.WORKER_NOT_FOUND: HTTPStatus.NOT_FOUND,
    ErrorCode.WORKER_LEASE_EXPIRED: HTTPStatus.CONFLICT,
    ErrorCode.JOB_NOT_FOUND: HTTPStatus.NOT_FOUND,
    ErrorCode.LEASE_REJECTED: HTTPStatus.CONFLICT,
    ErrorCode.JOB_ALREADY_FINISHED: HTTPStatus.CONFLICT,
    ErrorCode.INTERNAL_ERROR: HTTPStatus.INTERNAL_SERVER_ERROR,
}


def _finite(value: JsonValue) -> JsonValue:
    # A rejected non-finite float (NaN/Infinity) echoed verbatim as an error's "input"
    # would crash JSONResponse's strict json.dumps(allow_nan=False); drop it to null.
    if isinstance(value, float) and not math.isfinite(value):
        return None
    if isinstance(value, list):
        return [_finite(v) for v in value]
    if isinstance(value, dict):
        return {k: _finite(v) for k, v in value.items()}
    return value


def error_response(code: ErrorCode, message: str, details: JsonValue = None) -> JSONResponse:
    """Build an error envelope with the HTTP status mapped to `code`.

    Args:
        code: Error code.
        message: Human-readable message.
        details: Optional JSON details.

    Returns:
        The JSON response.
    """
    body = ApiErr(error=ErrorBody(code=code, message=message, details=details))
    return JSONResponse(status_code=HTTP_STATUS[code], content=body.model_dump(mode="json"))


def install_error_handlers(app: FastAPI) -> None:
    """Route store, validation, HTTP and unexpected errors into the error envelope."""

    @app.exception_handler(StoreError)
    async def _store_error(_request: Request, exc: StoreError) -> JSONResponse:
        return error_response(exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        return error_response(
            ErrorCode.VALIDATION_ERROR,
            "request validation failed",
            _finite(jsonable_encoder(exc.errors())),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        if exc.status_code == HTTPStatus.NOT_FOUND:
            return error_response(ErrorCode.ROUTE_NOT_FOUND, "route not found")
        if exc.status_code == HTTPStatus.METHOD_NOT_ALLOWED:
            return error_response(ErrorCode.METHOD_NOT_ALLOWED, "method not allowed")
        return error_response(ErrorCode.INTERNAL_ERROR, str(exc.detail))

    @app.exception_handler(Exception)
    async def _unexpected_error(_request: Request, exc: Exception) -> JSONResponse:
        logger.error("unhandled error", exc_info=exc)
        return error_response(ErrorCode.INTERNAL_ERROR, "internal error")
