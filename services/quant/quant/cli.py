import argparse
import json
from pathlib import Path

import pandas as pd

from quant.registry import promote, save
from quant.training import train


def main():
    parser = argparse.ArgumentParser(description="Reproducible AlphaSutra research jobs")
    commands = parser.add_subparsers(dest="command", required=True)
    training = commands.add_parser("train")
    training.add_argument("csv", type=Path)
    training.add_argument("--kind", choices=["logistic", "boosting"], default="logistic")
    training.add_argument("--horizon", type=int, default=5)
    training.add_argument("--threshold", type=float, default=0.8)
    training.add_argument("--costs-bps", type=int, default=30)
    training.add_argument("--artifact-root", type=Path, default=Path("artifacts"))
    promotion = commands.add_parser("promote")
    promotion.add_argument("model_id")
    promotion.add_argument("--expected-champion")
    promotion.add_argument("--artifact-root", type=Path, default=Path("artifacts"))
    args = parser.parse_args()
    if args.command == "train":
        frame = pd.read_csv(args.csv)
        model, report = train(frame, args.horizon, args.threshold, args.kind, args.costs_bps)
        metadata = save(args.artifact_root, model, report)
        print(json.dumps(metadata, indent=2, allow_nan=False))
    else:
        print(json.dumps(promote(args.artifact_root, args.model_id, args.expected_champion)))


if __name__ == "__main__":
    main()
