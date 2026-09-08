from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from uuid import uuid4

import joblib


def checked_id(model_id: str) -> str:
    if not re.fullmatch(r"[0-9a-f-]{36}", model_id):
        raise ValueError("Invalid model identifier")
    return model_id


def save(root: Path, model, report: dict) -> dict:
    model_id = str(uuid4())
    directory = root / model_id
    directory.mkdir(parents=True, exist_ok=False)
    path = directory / "model.joblib"
    joblib.dump(model, path)
    metadata = {
        **report,
        "model_id": model_id,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }
    (directory / "report.json").write_text(json.dumps(metadata, indent=2, allow_nan=False))
    return metadata


def load(root: Path, model_id: str):
    directory = root / checked_id(model_id)
    report = json.loads((directory / "report.json").read_text())
    path = directory / "model.joblib"
    if hashlib.sha256(path.read_bytes()).hexdigest() != report["sha256"]:
        raise ValueError("Artifact integrity check failed")
    # Only operator-owned local artifacts are loadable. Never unpickle uploads.
    return joblib.load(path), report


def promotion_reasons(challenger: dict, champion: dict | None = None) -> list[str]:
    result = challenger["final"]
    reasons = []
    if result["samples"] < 126 or result["selected"] < 50:
        reasons.append("insufficient final-period evidence")
    if result["brier"] >= 0.25:
        reasons.append("calibration does not beat an uninformative baseline")
    if result["precision"] is None or result["precision"] < 0.6:
        reasons.append("precision below policy")
    backtest = challenger.get("paper_validation")
    if not backtest or backtest.get("sessions", 0) < 60:
        reasons.append("60 forward paper sessions are required")
    elif backtest.get("net_expectancy", -1) <= 0 or backtest.get("max_drawdown", 1) > 0.1:
        reasons.append("forward return or drawdown gate failed")
    if champion:
        if (challenger["final_start"], challenger["final_end"], challenger["label"]) != (
            champion["final_start"],
            champion["final_end"],
            champion["label"],
        ):
            reasons.append("champion and challenger need the same evaluation period and label")
        if result["brier"] > champion["final"]["brier"]:
            reasons.append("worse calibration than champion")
        if (result["precision"] or 0) < (champion["final"]["precision"] or 0):
            reasons.append("worse precision than champion")
    return reasons


def promote(root: Path, model_id: str, expected_champion: str | None):
    # Exclusive file creation serializes operator promotion and rollback operations.
    root.mkdir(parents=True, exist_ok=True)
    lock = root / ".promotion.lock"
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        pointer = root / "champion.json"
        current = json.loads(pointer.read_text()) if pointer.exists() else None
        current_id = current["model_id"] if current else None
        if current_id != expected_champion:
            raise ValueError("Champion changed; re-evaluate before promotion")
        _, report = load(root, model_id)
        champion = load(root, current_id)[1] if current_id else None
        reasons = promotion_reasons(report, champion)
        event = {"model_id": model_id, "previous": current_id, "reasons": reasons}
        with (root / "promotion-history.jsonl").open("a") as history:
            history.write(json.dumps(event) + "\n")
        if reasons:
            return {"status": "REJECTED", **event}
        temporary = root / f"champion-{uuid4()}.tmp"
        temporary.write_text(json.dumps({"model_id": model_id, "previous": current_id}))
        os.replace(temporary, pointer)
        return {"status": "CHAMPION", **event}
    finally:
        os.close(fd)
        lock.unlink()


def rollback(root: Path, expected_champion: str) -> dict:
    lock = root / ".promotion.lock"
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        pointer = root / "champion.json"
        current = json.loads(pointer.read_text())
        if current["model_id"] != checked_id(expected_champion) or not current.get("previous"):
            raise ValueError("Champion changed or no rollback candidate exists")
        previous = checked_id(current["previous"])
        load(root, previous)
        event = {"action": "ROLLBACK", "from": expected_champion, "model_id": previous}
        with (root / "promotion-history.jsonl").open("a") as history:
            history.write(json.dumps(event) + "\n")
        temporary = root / f"rollback-{uuid4()}.tmp"
        temporary.write_text(json.dumps({"model_id": previous, "previous": expected_champion}))
        os.replace(temporary, pointer)
        return event
    finally:
        os.close(fd)
        lock.unlink()
