from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
BUILD_DIR = ROOT / "build" / "backend"
WORK_DIR = BUILD_DIR / "work"
SPEC_DIR = BUILD_DIR / "spec"
EXE_NAME = "audita-backend"


def main() -> None:
    BUILD_DIR.mkdir(parents=True, exist_ok=True)
    WORK_DIR.mkdir(parents=True, exist_ok=True)
    SPEC_DIR.mkdir(parents=True, exist_ok=True)

    data_sep = ";" if os.name == "nt" else ":"
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        "--clean",
        "--onefile",
        "--name",
        EXE_NAME,
        "--distpath",
        str(BUILD_DIR),
        "--workpath",
        str(WORK_DIR),
        "--specpath",
        str(SPEC_DIR),
        "--add-data",
        f"{ROOT / 'static'}{data_sep}static",
        "--add-data",
        f"{ROOT / 'data'}{data_sep}data",
        str(ROOT / "app.py"),
    ]

    subprocess.run(command, cwd=ROOT, check=True)

    suffix = ".exe" if os.name == "nt" else ""
    built_executable = BUILD_DIR / f"{EXE_NAME}{suffix}"
    if not built_executable.exists():
        raise FileNotFoundError(f"Expected backend executable was not created: {built_executable}")
    print(f"Built {built_executable}")


if __name__ == "__main__":
    main()
