#!/usr/bin/env python3
# Usage:
#   python scripts/test_transcribe_whisperx.py --audio /path/to/test.m4a [--model large-v3-turbo] [--hf-token TOKEN]
#
# Manual developer smoke test (NOT part of the Jest suite). Runs the full
# transcribe_whisperx.py pipeline end-to-end against a real audio file, prints
# each NDJSON progress line as it arrives, then pretty-prints the result JSON and
# total wall-clock time. Use this to validate the Python runner before wiring it
# into the Electron app. Run inside the same venv that has whisperx installed.

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audio", required=True)
    parser.add_argument("--model", default="large-v3-turbo")
    parser.add_argument("--hf-token", default="")
    parser.add_argument("--language", default="")
    args = parser.parse_args()

    here = os.path.dirname(os.path.abspath(__file__))
    runner = os.path.join(here, "transcribe_whisperx.py")
    out_fd, out_path = tempfile.mkstemp(suffix=".json")
    os.close(out_fd)
    cache_dir = os.path.join(tempfile.gettempdir(), "whisperx-models")

    cmd = [
        sys.executable, runner,
        "--audio", args.audio,
        "--model", args.model,
        "--hf-token", args.hf_token,
        "--output", out_path,
        "--model-cache-dir", cache_dir,
    ]
    if args.language:
        cmd += ["--language", args.language]

    print(f"$ {' '.join(cmd)}\n")
    start = time.time()
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )
    for line in proc.stdout:
        line = line.rstrip()
        if line:
            print(f"  {line}")
    code = proc.wait()
    elapsed = time.time() - start

    print(f"\nExited with code {code} in {elapsed:.1f}s")
    if code == 0 and os.path.isfile(out_path):
        with open(out_path, encoding="utf-8") as f:
            result = json.load(f)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        print(f"\nUtterances: {len(result.get('utterances', []))}")
        speakers = sorted({u['speaker'] for u in result.get('utterances', [])})
        print(f"Speakers: {speakers}")
    os.unlink(out_path)
    sys.exit(code)


if __name__ == "__main__":
    main()
