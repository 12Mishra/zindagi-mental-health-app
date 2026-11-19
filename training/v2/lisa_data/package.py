"""Bundle the GPU kit (gpu/*) with the built data (data/final/*) into lisa_v2_gpu.zip."""

from __future__ import annotations

import json
import zipfile

from .common import DATA, V2, log

GPU = V2 / "gpu"
FILES = ["train.py", "run.sh", "requirements-train.txt", "requirements-serve.txt", "qwen_nothink.jinja", "README.md"]


def build() -> None:
    final = DATA / "final"
    missing = [n for n in ("train.jsonl", "validation.jsonl", "eval.jsonl", "manifest.json") if not (final / n).exists()]
    if missing:
        raise SystemExit(f"Run `pipeline.py build` first; missing {missing}")
    out = V2 / "lisa_v2_gpu.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for name in FILES:
            info = zipfile.ZipInfo(f"lisa_v2_gpu/{name}")
            info.external_attr = (0o755 if name.endswith(".sh") else 0o644) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            # Normalise line endings so bash on the pod never sees CRLF.
            z.writestr(info, (GPU / name).read_text(encoding="utf-8").replace("\r\n", "\n"))
        for name in ("train.jsonl", "validation.jsonl", "eval.jsonl", "manifest.json"):
            z.write(final / name, f"lisa_v2_gpu/data/{name}")
    manifest = json.loads((final / "manifest.json").read_text(encoding="utf-8"))
    log(f"wrote {out} ({out.stat().st_size / 1e6:.1f} MB): {manifest['examples']}")
