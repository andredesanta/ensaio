"""Opt-in synthetic REST + stdio MCP integration; never writes credentials."""

import json
import os
import subprocess
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BASE_URL = "http://127.0.0.1:8765"


def _wait_for_django(process: subprocess.Popen[bytes]) -> None:
    deadline = time.monotonic() + 15
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("Synthetic Django server exited before becoming healthy.")
        try:
            with urllib.request.urlopen(f"{BASE_URL}/healthz", timeout=1) as response:  # noqa: S310
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("Timed out waiting for the synthetic Django server.")


def _manage_shell(source: str) -> str:
    completed = subprocess.run(
        [str(ROOT / ".venv/bin/python"), "manage.py", "shell", "-c", source],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return completed.stdout.strip().splitlines()[-1]


def main() -> None:
    fixture = json.loads(
        _manage_shell(
            "import json, uuid; "
            "from django.contrib.auth.models import User; "
            "from products.feature_flags.backend.models import AutomationToken, Team; "
            "suffix=uuid.uuid4().hex; "
            "user=User.objects.create_user(username=f'mcp-live-{suffix}', password=None); "
            "team=Team.objects.create(name=f'MCP live {suffix}'); "
            "token, raw=AutomationToken.issue(team=team, user=user, name='mcp-live-integration', "
            "scopes=['feature_flag:read','feature_flag:write']); "
            "print(json.dumps({'user_id': user.pk, 'team_id': team.pk, 'token': raw}))"
        )
    )
    user_id = int(fixture["user_id"])
    team_id = int(fixture["team_id"])
    raw_token = str(fixture["token"])
    server = subprocess.Popen(
        [
            str(ROOT / ".venv/bin/python"),
            "manage.py",
            "runserver",
            "127.0.0.1:8765",
            "--noreload",
        ],
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        _wait_for_django(server)
        environment = {
            **os.environ,
            "ENSAIO_BASE_URL": BASE_URL,
            "ENSAIO_PROJECT_ID": str(team_id),
            "ENSAIO_API_TOKEN": raw_token,
        }
        subprocess.run(
            ["corepack", "pnpm", "--dir", "services/mcp", "run", "build"],
            cwd=ROOT,
            check=True,
            env=environment,
        )
        subprocess.run(
            ["corepack", "pnpm", "--dir", "services/mcp", "run", "eval:probe"],
            cwd=ROOT,
            check=True,
            env=environment,
        )
        subprocess.run(
            ["corepack", "pnpm", "--dir", "services/mcp", "run", "integration:live"],
            cwd=ROOT,
            check=True,
            env=environment,
        )
    finally:
        server.terminate()
        try:
            server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait()
        _manage_shell(
            "from django.contrib.auth.models import User; "
            "from products.feature_flags.backend.models import Team; "
            f"Team.objects.filter(pk={team_id}).delete(); "
            f"User.objects.filter(pk={user_id}).delete()"
        )


if __name__ == "__main__":
    main()
