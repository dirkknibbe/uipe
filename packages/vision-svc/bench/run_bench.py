"""Unit-0-lite: POST each golden screenshot to a running /v1/analyze, score the
result against the hand-labeled expectations, print a scorecard. Run against an
ephemeral Fly A10 deploy (Task 12) — dogfoods the real contract + serve path.

Usage: python bench/run_bench.py --base-url https://<app>.fly.dev
"""
import argparse
import base64
import json
import sys
import time
from pathlib import Path
import urllib.request

from bench.scoring import interactable_recall

GOLDEN = Path(__file__).resolve().parent / "golden"
IOU_THRESHOLD = 0.5
RECALL_BAR = 0.80
P95_LATENCY_MS_BAR = 8000


def _post(base_url: str, png_b64: str) -> dict:
    body = json.dumps({"api_version": "v1", "png_base64": png_b64, "regions": []}).encode()
    req = urllib.request.Request(f"{base_url}/v1/analyze", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base-url", required=True)
    args = ap.parse_args()

    recalls, latencies, rows = [], [], []
    for png in sorted(GOLDEN.glob("*.png")):
        expected = json.loads((GOLDEN / "expected" / f"{png.stem}.json").read_text())["elements"]
        png_b64 = base64.b64encode(png.read_bytes()).decode()
        # retry through warming
        for _ in range(10):
            resp = _post(args.base_url, png_b64)
            if resp["status"] != "warming":
                break
            time.sleep(resp.get("retry_after_ms", 5000) / 1000)
        recall = interactable_recall(resp.get("elements", []), expected, IOU_THRESHOLD)
        recalls.append(recall)
        latencies.append(resp.get("latency_ms", 0))
        rows.append((png.name, resp["status"], round(recall, 2), round(resp.get("latency_ms", 0))))

    latencies.sort()
    p95 = latencies[int(0.95 * (len(latencies) - 1))] if latencies else 0
    mean_recall = sum(recalls) / len(recalls) if recalls else 0.0

    print("screenshot\tstatus\trecall\tlatency_ms")
    for r in rows:
        print("\t".join(map(str, r)))
    print(f"\nmean interactable recall: {mean_recall:.2f} (bar {RECALL_BAR})")
    print(f"p95 latency_ms: {p95} (bar {P95_LATENCY_MS_BAR})")

    passed = mean_recall >= RECALL_BAR and p95 <= P95_LATENCY_MS_BAR
    print("RESULT:", "PASS" if passed else "FAIL")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
