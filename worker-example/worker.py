"""Minimal simple-jobs-store worker. Usage: README.md next to this file; protocol: WORKER.md."""

import json
import os
import socket
import threading
import time
import urllib.error
import urllib.request

BASE = os.environ.get("STORE_URL", "http://127.0.0.1:8000/api")
WORKER_ID = f"{socket.gethostname()}-{os.getpid()}"
JOB_TYPE = "resize"
HEARTBEAT_S = 10  # a third of the default 30 s leases


class ApiError(Exception):
    def __init__(self, code, message):
        super().__init__(f"{code}: {message}")
        self.code = code


def call(method, path, body=None):
    request = urllib.request.Request(
        BASE + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            envelope = json.load(response)
    except urllib.error.HTTPError as error:
        envelope = json.load(error)
    if not envelope["ok"]:
        raise ApiError(envelope["error"]["code"], envelope["error"]["message"])
    return envelope["data"]


def register():
    call("PUT", f"/workers/{WORKER_ID}", {"name": "resize-worker", "concurrentLimit": 1})


def keep_worker_alive():
    while True:
        time.sleep(HEARTBEAT_S)
        try:
            call("POST", f"/workers/{WORKER_ID}/heartbeat")
        except ApiError as error:
            if error.code == "WORKER_NOT_FOUND":
                register()
        except OSError:  # urllib's URLError (store unreachable) is an OSError
            pass


def handle(description, lost):
    """Your job logic. Must be idempotent; stop early if `lost` gets set."""
    time.sleep(1)
    if description.get("fail"):
        raise ValueError("asked to fail")
    return {"echo": description}


def run(claim):
    job_id = claim["job"]["id"]
    proof = {"workerId": WORKER_ID, "leaseToken": claim["leaseToken"]}
    done, lost = threading.Event(), threading.Event()

    def keep_job_alive():
        while not done.wait(HEARTBEAT_S):
            try:
                call("POST", f"/jobs/{job_id}/heartbeat", proof)
            except ApiError as error:
                if error.code in ("LEASE_REJECTED", "JOB_NOT_FOUND"):
                    lost.set()  # cancelled, past deadline, or taken by another worker
                    return
            except OSError:
                pass

    threading.Thread(target=keep_job_alive, daemon=True).start()
    try:
        result = handle(claim["job"]["description"], lost)
        body = {**proof, "status": "success", "result": result}
    except KeyboardInterrupt:
        call("POST", f"/jobs/{job_id}/release", proof)  # hand it back, no attempt used
        raise
    except Exception as error:
        body = {**proof, "status": "failed", "error": type(error).__name__, "errorDetail": str(error)}
    finally:
        done.set()
    if lost.is_set():
        return
    try:
        call("POST", f"/jobs/{job_id}/finish", body)
    except ApiError as error:
        if error.code not in ("LEASE_REJECTED", "JOB_NOT_FOUND"):
            raise


def main():
    register()
    threading.Thread(target=keep_worker_alive, daemon=True).start()
    while True:
        try:
            claim = call("POST", "/jobs/claim", {"workerId": WORKER_ID, "type": JOB_TYPE})
        except ApiError as error:
            if error.code not in ("WORKER_NOT_FOUND", "WORKER_LEASE_EXPIRED"):
                raise
            register()
            continue
        except OSError:
            time.sleep(5)
            continue
        if claim is None:
            time.sleep(2)
            continue
        run(claim)


if __name__ == "__main__":
    main()
