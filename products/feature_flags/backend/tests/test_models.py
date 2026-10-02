import pytest
from django.contrib.auth.models import User
from django.db import IntegrityError, transaction

from products.feature_flags.backend.models import (
    PUBLIC_TOKEN_PREFIX,
    SECRET_TOKEN_PREFIX,
    FeatureFlag,
    Team,
)

pytestmark = pytest.mark.django_db


def test_team_tokens_keep_the_definitions_secret_hashed() -> None:
    team = Team.objects.create(name="Growth")

    secret_token = team.issue_secret_api_token()
    team.save(update_fields={"secret_api_token"})

    assert team.api_token.startswith(PUBLIC_TOKEN_PREFIX)
    assert secret_token.startswith(SECRET_TOKEN_PREFIX)
    assert team.secret_api_token != secret_token
    assert team.check_secret_api_token(secret_token)
    assert not team.check_secret_api_token(f"{SECRET_TOKEN_PREFIX}wrong")


def test_default_filters_are_not_shared_between_flags() -> None:
    user = User.objects.create_user(username="andre")
    team = Team.objects.create(name="Growth")
    first = FeatureFlag.objects.create(team=team, key="first", created_by=user)
    second = FeatureFlag.objects.create(team=team, key="second", created_by=user)

    first.filters["groups"].append({"properties": [], "rollout_percentage": 100, "variant": None})

    assert second.filters["groups"] == []


def test_every_model_update_advances_version() -> None:
    user = User.objects.create_user(username="andre")
    flag = FeatureFlag.objects.create(team=Team.objects.create(name="Growth"), key="checkout", created_by=user)

    assert flag.version == 1

    flag.name = "Checkout"
    flag.save(update_fields={"name"})

    assert flag.version == 2
    flag.refresh_from_db()
    assert flag.name == "Checkout"
    assert flag.version == 2


def test_live_keys_are_unique_per_team_but_reusable_after_soft_delete() -> None:
    user = User.objects.create_user(username="andre")
    team = Team.objects.create(name="Growth")
    flag = FeatureFlag.objects.create(team=team, key="checkout", created_by=user)

    with pytest.raises(IntegrityError), transaction.atomic():
        FeatureFlag.objects.create(team=team, key="checkout", created_by=user)

    flag.deleted = True
    flag.save(update_fields={"deleted"})
    replacement = FeatureFlag.objects.create(team=team, key="checkout", created_by=user)

    assert replacement.pk != flag.pk
