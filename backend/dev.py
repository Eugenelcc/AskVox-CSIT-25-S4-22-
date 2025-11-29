import platform
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent  # backend/
VENV_DIR = ROOT / "venv"
REQ = ROOT / "requirements.txt"


def banner(msg: str) -> None:
    line = "=" * 60
    print(f"\n{line}\n{msg}\n{line}")


def ok(msg: str) -> None:
    print(f"✅ {msg}")


def info(msg: str) -> None:
    print(f"ℹ️  {msg}")


def die(msg: str, code: int = 1) -> None:
    print(f"❌ {msg}")
    raise SystemExit(code)


def run(cmd: list[str]) -> None:
    print(">", " ".join(cmd))
    subprocess.check_call(cmd, cwd=str(ROOT))


def venv_python() -> Path:
    if platform.system() == "Windows":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def ensure_venv() -> None:
    if venv_python().exists():
        ok("venv already exists")
        return
    banner("Creating virtual environment (venv)")
    run([sys.executable, "-m", "venv", "venv"])
    ok("venv created")


def install_requirements() -> None:
    banner("Installing dependencies from requirements.txt")
    if not REQ.exists():
        die(f"requirements.txt not found at: {REQ}")

    py = str(venv_python())
    run([py, "-m", "pip", "install", "--upgrade", "pip"])
    run([py, "-m", "pip", "install", "-r", str(REQ)])
    ok("Dependencies installed")


def alembic_upgrade_head() -> None:
    banner("Running DB migrations (alembic upgrade head)")
    py = str(venv_python())
    run([py, "-m", "alembic", "upgrade", "head"])
    ok("Migrate is done")


def run_uvicorn() -> None:
    banner("Starting FastAPI server (uvicorn)")
    info("Server URL: http://127.0.0.1:8000")
    info("Swagger docs: http://127.0.0.1:8000/docs")

    py = str(venv_python())
    run([py, "-m", "uvicorn", "app.main:app", "--reload", "--port", "8000"])
    # Note: uvicorn blocks, so you won't see a "done" message after this.


def usage() -> None:
    print(
        "\nCommands:\n"
        "  python dev.py setup     # create venv + install requirements\n"
        "  python dev.py migrate   # alembic upgrade head\n"
        "  python dev.py run       # run uvicorn\n"
        "  python dev.py all       # setup + migrate + run\n"
    )


def main() -> None:
    if len(sys.argv) < 2:
        usage()
        raise SystemExit(1)

    cmd = sys.argv[1].lower().strip()
    if cmd not in {"setup", "migrate", "run", "all"}:
        usage()
        die(f"Unknown command: {cmd}")

    banner("AskVox Backend Dev Helper")

    ensure_venv()

    if cmd in {"setup", "all"}:
        install_requirements()
        ok("Setup is done")

    if cmd in {"migrate", "all"}:
        alembic_upgrade_head()

    if cmd in {"run", "all"}:
        run_uvicorn()


if __name__ == "__main__":
    main()
