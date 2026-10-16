"""Build and qualify a complete locked source archive outside the checkout."""
from hashlib import sha256
import gzip
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
NAME = f"shopping-assistant-app-{VERSION}"
NPM = shutil.which("npm")
NODE = shutil.which("node")
if not NPM or not NODE:
    raise RuntimeError("Node.js 24 and npm are required")
ENV = {**os.environ, "NEXT_TELEMETRY_DISABLED": "1", "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
for key in list(ENV):
    if key.startswith("OPENAI_") or key.startswith("SHOP_") or key in {"NODE_PATH", "NODE_OPTIONS", "TSX_TSCONFIG_PATH"}:
        ENV.pop(key)


def run(command, cwd):
    result = subprocess.run([str(part) for part in command], cwd=cwd, env=ENV, capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise RuntimeError(f"Failed {command[:3]}\n{result.stdout[-2500:]}\n{result.stderr[-3500:]}")
    return result.stdout


def source_archive():
    entries = [".env.example", ".gitattributes", ".gitignore", ".github", "AGENTS.md", "README.md", "PLAN.md", "COMPATIBILITY.md", "package.json", "package-lock.json", "next.config.ts", "next-env.d.ts", "tsconfig.json", "playwright.config.ts", "app", "lib", "fixtures/base.json", "data/manifest.json", "data/cases", "scripts", "test", "e2e", "e2e-busy", "scenarios"]
    excluded = {"__pycache__", ".DS_Store"}
    files = {}
    for entry in entries:
        target = ROOT / entry
        if not target.exists():
            raise RuntimeError(f"Missing required source {entry}")
        for path in sorted(target.rglob("*") if target.is_dir() else [target]):
            relative = path.relative_to(ROOT)
            if any(part in excluded for part in relative.parts) or path.suffix == ".pyc":
                continue
            if path.is_symlink():
                raise RuntimeError(f"Source symlink is not qualified: {relative}")
            if path.is_file():
                files[relative.as_posix()] = sha256(path.read_bytes()).hexdigest()
    artifact = ROOT / "dist" / f"{NAME}-source.tar.gz"
    artifact.parent.mkdir(exist_ok=True)
    with artifact.open("wb") as output, gzip.GzipFile(filename="", fileobj=output, mode="wb", mtime=0) as compressed, tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for relative in sorted(files):
            path = ROOT / relative
            info = archive.gettarinfo(str(path), f"{NAME}/{relative}")
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ""
            info.mode = 0o644
            with path.open("rb") as source:
                archive.addfile(info, source)
    return artifact, files


artifact, files = source_archive()
with TemporaryDirectory(prefix="firedrill-shopping-distribution-") as temporary:
    base = Path(temporary).resolve()
    workspace = base / NAME
    with tarfile.open(artifact) as archive:
        for member in archive.getmembers():
            prefix = f"{NAME}/"
            if not member.isfile() or not member.name.startswith(prefix) or member.name[len(prefix):] not in files:
                raise RuntimeError("Unexpected source archive entry")
            path = workspace / member.name[len(prefix):]
            path.parent.mkdir(parents=True, exist_ok=True)
            with archive.extractfile(member) as source:
                path.write_bytes(source.read())
    installed_files = {path.relative_to(workspace).as_posix(): sha256(path.read_bytes()).hexdigest() for path in workspace.rglob("*") if path.is_file()}
    assert installed_files == files, "Extracted complete source differs from checkout"
    run([NPM, "ci"], workspace)
    resolved = Path(run([NODE, "-p", "require.resolve('ai')"], workspace).strip()).resolve()
    assert resolved.is_relative_to(workspace.resolve()), f"SDK resolved outside fresh source: {resolved} versus {workspace.resolve()}"
    loader = run([NODE, "-p", "require.resolve('tsx')"], workspace).strip()
    cli = [NODE, "--import", loader, workspace / "scripts/shop.ts"]
    cases = json.loads(run([*cli, "cases", "--data-root", workspace / "data"], base))
    assert len(cases["cases"]) == 12
    destinations = base / "private-cases"
    for case in cases["cases"]:
        path = destinations / f"{case['id']}.db"
        initialized = json.loads(run([*cli, "init", "--case", case["id"], "--db", path, "--data-root", workspace / "data"], base))
        assert initialized["source_sha256"] == case["sha256"] and path.stat().st_mode & 0o777 == 0o600
    busy = json.loads(run([*cli, "show", "--db", destinations / "busy.db"], base))
    assert len(busy["state"]["products"]) == 48 and len(busy["orders"]) == 20 and len(busy["state"]["cart"]) == 5
    before = (destinations / "busy.db").read_bytes()
    refused = subprocess.run([str(item) for item in [*cli, "init", "--case", "starter", "--db", destinations / "busy.db", "--data-root", workspace / "data"]], cwd=base, env=ENV, capture_output=True, timeout=60)
    assert refused.returncode == 1 and (destinations / "busy.db").read_bytes() == before
    run([NPM, "test"], workspace)
    run([NPM, "run", "typecheck"], workspace)
    run([NPM, "run", "build"], workspace)
    run([NPM, "run", "test:e2e"], workspace)
print(json.dumps({"artifact": str(artifact), "source_files": len(files), "source_sha256": sha256(artifact.read_bytes()).hexdigest(), "cases": len(cases["cases"]), "fresh_locked_install": True, "all_case_cli": True, "native_domain_source_checks": True, "production_browser_flows": True, "live_model": False}))
