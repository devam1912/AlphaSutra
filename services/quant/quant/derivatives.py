import math
from datetime import date


def greeks(
    spot: float,
    strike: float,
    years: float,
    iv: float,
    rate: float,
    option: str = "CALL",
    dividend: float = 0,
) -> dict:
    values = [spot, strike, years, iv, rate, dividend]
    if not all(math.isfinite(x) for x in values) or min(spot, strike, years, iv) <= 0:
        raise ValueError("Greeks require finite positive spot, strike, time and volatility")
    if option not in {"CALL", "PUT"}:
        raise ValueError("Invalid option type")

    def normal(x):
        return (1 + math.erf(x / math.sqrt(2))) / 2

    d1 = (math.log(spot / strike) + (rate - dividend + iv * iv / 2) * years) / (
        iv * math.sqrt(years)
    )
    d2 = d1 - iv * math.sqrt(years)
    density = math.exp(-d1 * d1 / 2) / math.sqrt(2 * math.pi)
    discount = math.exp(-rate * years)
    div = math.exp(-dividend * years)
    call = option == "CALL"
    sign = 1 if call else -1
    price = sign * (spot * div * normal(sign * d1) - strike * discount * normal(sign * d2))
    theta = (
        -spot * div * density * iv / (2 * math.sqrt(years))
        - sign * rate * strike * discount * normal(sign * d2)
        + sign * dividend * spot * div * normal(sign * d1)
    ) / 365
    return {
        "price": price,
        "delta": div * (normal(d1) if call else normal(d1) - 1),
        "gamma": div * density / (spot * iv * math.sqrt(years)),
        "vega": spot * div * density * math.sqrt(years) / 100,
        "theta": theta,
        "assumption": "European Black-Scholes, supplied IV and rates",
    }


def option_candidate(contract: dict, today: date, probability: float) -> dict:
    """Premium-funded long options only; a stop is not a guaranteed maximum loss."""
    dte = (date.fromisoformat(contract["expiry"]) - today).days
    premium, lot = contract["premium"], contract["lot_size"]
    spread = contract["ask"] - contract["bid"]
    reasons = []
    if not 3 <= dte <= 45:
        reasons.append("expiry outside policy")
    if premium <= 0 or lot <= 0 or int(lot) != lot:
        reasons.append("invalid contract")
    if contract["bid"] <= 0 or spread < 0 or spread / max(premium, 0.01) > 0.03:
        reasons.append("illiquid spread")
    if contract["open_interest"] < 1000 or contract["volume"] < 100:
        reasons.append("insufficient liquidity")
    if probability < 0.85:
        reasons.append("insufficient validated probability")
    if reasons:
        return {"status": "NO_TRADE", "reasons": reasons}
    atr = contract["premium_atr"]
    if not 0 < atr < premium / 2:
        return {"status": "NO_TRADE", "reasons": ["invalid premium volatility"]}
    return {
        "status": "CANDIDATE",
        "entry": premium,
        "stop": premium - 2 * atr,
        "target1": premium + 4 * atr,
        "target2": premium + 6 * atr,
        "capital": premium * lot,
        "maximum_loss": premium * lot,
        "planned_stop_loss": 2 * atr * lot,
        "days_to_expiry": dte,
        "warning": "Full premium can be lost; gaps can bypass stops",
    }
