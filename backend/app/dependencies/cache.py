"""
Response cache-control dependencies.

"""

from fastapi import Response


def no_store(response: Response) -> None:

    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
