"""Log in to Instagram with instagrapi and hand the session to the Node CLI.

Instagram only accepts password logins through the Android app's current
Bloks/CAA flow, which instagrapi (subzeroid/instagrapi) implements and keeps up
to date. The Node CLI runs this script for the login only, then reuses the
session *and* the device identity below for its own API calls, so Instagram
sees a single device.

Protocol, one JSON object per line:
- stdin, first line: {"username", "password", "settings_path", "verbose"}
- stdout, progress: {"event": "step", "text"} for the CLI's spinner
- stdout, prompt: {"event": "prompt", "message"}; the CLI asks the user and
  answers with the code on the next stdin line
- stdout, last line: the session, or {"error", "type"} with exit status 1
"""

import json
import logging
import os
import sys
from pathlib import Path

from instagrapi import Client


def send(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def step(text):
    send({"event": "step", "text": text})


def ask(message):
    """Have the CLI prompt the user; it answers on stdin."""
    send({"event": "prompt", "message": message})
    return sys.stdin.readline().strip()


def emit(payload, status=0):
    # Leading newline: instagrapi may have printed a partial line to stdout.
    sys.stdout.write("\n" + json.dumps(payload) + "\n")
    sys.stdout.flush()
    sys.exit(status)


def error_type(exc):
    """Map an instagrapi exception onto the CLI's InstagramErrorType."""
    names = {cls.__name__ for cls in type(exc).__mro__}
    if names & {"BadPassword", "BadCredentials", "UserNotFound"}:
        return "INVALID_CREDENTIALS"
    if names & {"PleaseWaitFewMinutes", "RateLimitError"}:
        return "RATE_LIMITED"
    if names & {"ClientConnectionError", "ConnectionError", "Timeout"}:
        return "NETWORK_ERROR"
    # Anything else (challenge, 2FA, CAA refusal…) is not fixed by logging in
    # again: the CLI must not retry it.
    return "CHALLENGE_REQUIRED"


def save(client, settings_path):
    settings_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    client.dump_settings(settings_path)
    os.chmod(settings_path, 0o600)


def login(client, username, password):
    try:
        client.login(username, password)
    except Exception as exc:  # TwoFactorRequired's import path varies by version
        if type(exc).__name__ != "TwoFactorRequired":
            raise
        code = ask(
            "Two-factor authentication is enabled. Enter the code from your "
            "authenticator app or SMS."
        )
        if not code:
            raise
        step("Verifying the 2FA code")
        client.login(username, password, verification_code=code)


def ask_challenge_code(username, choice):
    channel = str(getattr(choice, "name", choice)).lower()
    code = ask(f"Instagram sent a verification code by {channel}.")
    step("Verifying the code")
    return code


def main():
    request = json.loads(sys.stdin.readline())
    logging.basicConfig(level=logging.INFO if request.get("verbose") else logging.ERROR)

    settings_path = Path(request["settings_path"])
    client = Client()
    client.challenge_code_handler = ask_challenge_code
    restored = False
    if settings_path.exists():
        try:
            # Reusing the saved device + session avoids a fresh login (and its
            # checkpoints) on every run; login() validates it first.
            client.load_settings(settings_path)
            restored = bool(client.user_id)
        except Exception:
            pass

    step("Checking the saved session" if restored else "Logging in to Instagram")
    try:
        login(client, request["username"], request["password"])
    except Exception as exc:
        # Keep the device even on failure: the next attempt (e.g. with the code
        # Instagram just sent) must come from the same phone, not a new one.
        save(client, settings_path)
        emit({"error": str(exc) or type(exc).__name__, "type": error_type(exc)}, 1)

    save(client, settings_path)

    settings = client.get_settings()
    emit(
        {
            "authorization": client.authorization,
            "user_id": str(client.user_id),
            "username": client.username or "",
            "mid": settings.get("mid") or "",
            "uuids": settings["uuids"],
            "device_settings": settings["device_settings"],
            "locale": settings.get("locale") or "",
            "timezone_offset": settings.get("timezone_offset"),
        }
    )


if __name__ == "__main__":
    main()
