import os
import secrets
from pathlib import Path

import pandas as pd
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from quant.features import regime
from quant.registry import checked_id, load, save
from quant.training import infer, train

app = FastAPI(title="AlphaSutra Quant", version="0.1.0")
ARTIFACT_ROOT = Path(os.environ.get("ARTIFACT_ROOT", "artifacts"))


def authorize(x_service_token: str = Header(default="")):
    expected = os.environ.get("ML_SERVICE_TOKEN", "")
    if len(expected) < 32 or not secrets.compare_digest(expected, x_service_token):
        raise HTTPException(401, "Invalid service credential")


class Candle(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    timestamp: str
    open: float = Field(gt=0)
    high: float = Field(gt=0)
    low: float = Field(gt=0)
    close: float = Field(gt=0)
    volume: float = Field(ge=0)


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candles: list[Candle] = Field(min_length=60, max_length=5000)
    model_id: str


@app.get("/health")
def health():
    return {"status": "ok", "mode": "research"}


@app.post("/score", dependencies=[Depends(authorize)])
def score(request: ScoreRequest):
    try:
        model, report = load(ARTIFACT_ROOT, checked_id(request.model_id))
        frame = pd.DataFrame([c.model_dump() for c in request.candles])
        available = pd.to_datetime(frame.timestamp, utc=True).max()
        if available <= pd.Timestamp(report["calibration_end"]):
            raise ValueError("Inference data predates model calibration")
        return {
            **infer(model, frame),
            "model_id": request.model_id,
            "horizon": report["horizon"],
            "label": report["label"],
            "regime": regime(frame),
            "validation": report["final"],
        }
    except (ValueError, FileNotFoundError) as error:
        raise HTTPException(422, "Model unavailable or candle data invalid") from error


class TrainRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    candles: list[Candle] = Field(min_length=550, max_length=5000)
    kind: str = Field(pattern="^(logistic|boosting)$", default="logistic")


@app.post("/train", dependencies=[Depends(authorize)])
def train_job(request: TrainRequest):
    # Called only by the private background worker, never a browser request.
    try:
        model, report = train(
            pd.DataFrame([c.model_dump() for c in request.candles]), kind=request.kind
        )
        stored = save(ARTIFACT_ROOT, model, report)
        return {"model_id": stored["model_id"], "report": stored}
    except ValueError as error:
        raise HTTPException(422, "Training data does not meet validation requirements") from error
