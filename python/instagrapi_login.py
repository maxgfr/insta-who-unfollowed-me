"""Log in to Instagram with instagrapi and hand the session to the Node CLI.

Instagram only accepts password logins through the Android app's current
Bloks/CAA flow, which instagrapi (subzeroid/instagrapi) implements and keeps up
to date. The Node CLI runs this script for the login only, then reuses the
session *and* the device identity below for its own API calls, so Instagram
sees a single device.

Input (stdin, JSON): {"username", "password", "settings_path", "verbose"}
Output (last stdout line, JSON): the session, or {"error", "type"} with exit 1.
Two-factor and challenge codes are asked for on the controlling terminal.
"""

import json
import logging
import os
import sys
from pathlib import Path

from instagrapi import Client


def ask(message):
    """Prompt on the terminal: stdin carries the JSON request, not the user."""
    try:
        path = "CONIN$" if os.name == "nt" else "/dev/tty"
        with open(path, "r", encoding="utf-8") as tty:
            sys.stderr.write(message)
            sys.stderr.flush()
            return tty.readline().strip()
    except OSError:
        return ""


def emit(payload, status=0):
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
        code = ask("\n🔐 Two-factor authentication is enabled. Enter the 2FA code: ")
        if not code:
            raise
        client.login(username, password, verification_code=code)


def main():
    request = json.load(sys.stdin)
    logging.basicConfig(level=logging.INFO if request.get("verbose") else logging.ERROR)

    settings_path = Path(request["settings_path"])
    client = Client()
    client.challenge_code_handler = lambda username, choice: ask(
        "\n🔐 Instagram sent a verification code "
        f"({str(getattr(choice, 'name', choice)).lower()}). Enter it: "
    )
    if settings_path.exists():
        try:
            # Reusing the saved device + session avoids a fresh login (and its
            # checkpoints) on every run; login() validates it first.
            client.load_settings(settings_path)
        except Exception:
            pass

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
            "mid": settings.get("mid") or "",
            "uuids": settings["uuids"],
            "device_settings": settings["device_settings"],
            "locale": settings.get("locale") or "",
            "timezone_offset": settings.get("timezone_offset"),
        }
    )


if __name__ == "__main__":
    main()
