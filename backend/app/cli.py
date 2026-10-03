"""Maintenance commands. Usage: python -m app.cli reset-password"""

import getpass
import sys

from . import auth
from .db import db, init


def reset_password() -> int:
    init()
    with db() as con:
        row = con.execute("SELECT name FROM user").fetchone()
    if not row:
        print("Es gibt noch kein Konto. Lege es beim ersten Aufruf der Web-App an.")
        return 1
    password = getpass.getpass(f"Neues Passwort für {row['name']}: ")
    if len(password) < 8:
        print("Das Passwort braucht mindestens 8 Zeichen.")
        return 1
    if password != getpass.getpass("Wiederholen: "):
        print("Die Eingaben stimmen nicht überein.")
        return 1
    with db() as con:
        con.execute("UPDATE user SET pw_hash = ?", (auth.hash_password(password),))
    auth.end_all_sessions()
    print("Passwort geändert, alle Sitzungen abgemeldet.")
    return 0


if __name__ == "__main__":
    if sys.argv[1:] == ["reset-password"]:
        sys.exit(reset_password())
    print(__doc__)
    sys.exit(2)
