from argparse import ArgumentParser
from typing import Any

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import transaction

from products.feature_flags.backend.models import AUTOMATION_TOKEN_SCOPES, AutomationToken, Team


class Command(BaseCommand):
    help = "Issue a project-scoped automation token and print its raw value once."

    def add_arguments(self, parser: ArgumentParser | CommandParser) -> None:
        parser.add_argument("--team-id", type=int, required=True)
        parser.add_argument("--user-id", type=int, required=True)
        parser.add_argument("--name", required=True)
        parser.add_argument("--scope", action="append", dest="scopes", required=True)

    def handle(self, *args: Any, **options: Any) -> None:
        scopes = list(options["scopes"])
        if len(scopes) != len(set(scopes)):
            raise CommandError("Duplicate scopes are not allowed.")
        unknown = sorted(set(scopes) - set(AUTOMATION_TOKEN_SCOPES))
        if unknown:
            raise CommandError(f"Unknown scope(s): {', '.join(unknown)}")
        name = str(options["name"]).strip()
        if not name:
            raise CommandError("Token name must not be blank.")

        with transaction.atomic():
            try:
                team = Team.objects.get(pk=options["team_id"])
            except Team.DoesNotExist as error:
                raise CommandError("Team does not exist.") from error
            try:
                user = get_user_model().objects.get(pk=options["user_id"])
            except get_user_model().DoesNotExist as error:
                raise CommandError("User does not exist.") from error
            if not user.is_active:
                raise CommandError("Cannot issue a token for an inactive user.")
            _token, raw_token = AutomationToken.issue(team=team, user=user, name=name, scopes=scopes)

        self.stdout.write(raw_token)
        self.stderr.write("Store this token now; its secret cannot be recovered.")
