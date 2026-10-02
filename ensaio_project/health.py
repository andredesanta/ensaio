from django.http import HttpRequest, HttpResponse


def healthz(_request: HttpRequest) -> HttpResponse:
    """Process is up. Does not query Postgres: a down database is not "this process is dead"."""
    return HttpResponse("ok")
