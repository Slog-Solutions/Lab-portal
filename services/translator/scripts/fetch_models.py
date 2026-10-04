#!/usr/bin/env python
"""
Downloads every weight the translator needs into one directory, so the
air-gapped lab server never has to reach the internet.

Run this on a machine WITH internet and the translator's Python deps
installed (easiest: inside the built image), then copy the directory into
the `translator-models` volume. See README.md.

    python scripts/fetch_models.py --out ./models

What it fetches:
  * seamless_streaming_unity           — encoder + T2U
  * seamless_streaming_monotonic_decoder — the read/write policy
  * vocoder_v2                         — units to waveform
  * the SentencePiece tokenizers for both
  * Silero VAD, via torch.hub into TORCH_HOME

Total is roughly 12GB.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

CARDS = [
    "seamless_streaming_unity",
    "seamless_streaming_monotonic_decoder",
    "vocoder_v2",
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default="./models", help="target directory (becomes TORCH_HOME and TRANSLATOR_MODEL_DIR)")
    args = parser.parse_args()

    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)

    # Both fairseq2 and torch.hub key their caches off environment
    # variables, so these must be set BEFORE either is imported — hence
    # the imports below rather than at module scope.
    os.environ["TORCH_HOME"] = str(out)
    os.environ["FAIRSEQ2_CACHE_DIR"] = str(out / "fairseq2")
    os.environ["HF_HOME"] = str(out / "hf")

    print(f"Fetching into {out}")

    try:
        import torch
        from fairseq2.assets import asset_store, download_manager
    except ImportError as err:
        print(f"error: translator deps are not installed here ({err}).", file=sys.stderr)
        print("Run this inside the built image: docker run --rm -v $PWD/models:/models lab-portal/translator:latest \\", file=sys.stderr)
        print("    python /app/../services/translator/scripts/fetch_models.py --out /models", file=sys.stderr)
        return 1

    failed: list[str] = []
    for name in CARDS:
        try:
            card = asset_store.retrieve_card(name)
            for field in ("checkpoint", "tokenizer", "vocoder"):
                if card.field(field).exists():
                    uri = card.field(field).as_uri()
                    print(f"  {name}.{field} <- {uri}")
                    download_manager.download_checkpoint(uri, name)
        except Exception as err:  # noqa: BLE001
            print(f"  !! {name}: {type(err).__name__}: {err}", file=sys.stderr)
            failed.append(name)

    try:
        print("  silero-vad (torch.hub)")
        torch.hub.load(repo_or_dir="snakers4/silero-vad", model="silero_vad", onnx=False)
    except Exception as err:  # noqa: BLE001
        print(f"  !! silero-vad: {type(err).__name__}: {err}", file=sys.stderr)
        failed.append("silero-vad")

    if failed:
        print(f"\nFAILED: {', '.join(failed)}", file=sys.stderr)
        print("Seamless checkpoints are gated on Hugging Face — accept the model terms and", file=sys.stderr)
        print("set HF_TOKEN, then re-run. The service will not translate without them.", file=sys.stderr)
        return 1

    print(f"\nDone. Copy {out} into the translator-models volume (see README).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
