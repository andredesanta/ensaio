from argparse import ArgumentParser
from typing import Any

from django.core.management.base import BaseCommand, CommandError, CommandParser
from django.db import transaction

from products.feature_flags.backend.agent_authentication import revoke_automation_token
from products.feature_flags.backend.models import AutomationToken


class Command(BaseCommand):
    help = "Idempotently revoke an automation token by its non-secret selector."

    def add_arguments(self, parser: ArgumentParser | CommandParser) -> None:
        parser.add_argument("--selector", required=True)

    def handle(self, *args: Any, **options: Any) -> None:
        with transaction.atomic():
            try:
                token = AutomationToken.objects.select_for_update().get(selector=options["selector"])
            except AutomationToken.DoesNotExist as error:
                raise CommandError("Automation token does not exist.") from error
            already_revoked = token.is_revoked
            revoke_automation_token(token)

        state = "already revoked" if already_revoked else "revoked"
        self.stdout.write(f"{token.selector}: {state}")
