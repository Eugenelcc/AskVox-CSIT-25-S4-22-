import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent  # backend/

def run(args: list[str]) -> None:
    cmd = ["docker", "compose"] + args
    print(">", " ".join(cmd))
    subprocess.check_call(cmd, cwd=str(ROOT))

def main():
    if len(sys.argv) < 2:
        print("Usage: python docker.py up|mig|logs|down|ps")
        raise SystemExit(1)

    a = sys.argv[1].lower().strip()

    if a == "up":
        run(["up", "-d", "--build"])
        print("✅ up done")
        print("Swagger: http://127.0.0.1:8000/docs")

    elif a in ("mig", "migrate"):
        run(["exec", "api", "python", "-m", "alembic", "upgrade", "head"])
        print("✅ migrate done")

    elif a == "logs":
        run(["logs", "-f", "api"])

    elif a == "ps":
        run(["ps"])

    elif a == "down":
        run(["down"])
        print("✅ down done")
        
    elif a in ("resetdb", "reset"):
        run(["down", "-v"])
        print("✅ wiped DB volume")
        run(["up", "-d", "--build"])
        print("✅ up done")
        run(["exec", "api", "python", "-m", "alembic", "upgrade", "head"])
        print("✅ migrate done (fresh DB)")


    else:
        raise SystemExit(f"Unknown command: {a}")

if __name__ == "__main__":
    main()
