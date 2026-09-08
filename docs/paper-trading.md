# Paper execution and risk

All prices and cash are integer paise. Each account receives ₹10 lakh. Equity
exposure is capped at ₹7 lakh; premium-funded long options at ₹3 lakh. These are
absolute ceilings, not deployment targets. Risk sizing commonly permits less.
Futures and naked short options have no execution adapter and fail closed.

Every buy needs maximum entry, stop and two targets with planned reward/risk ≥2.
Market orders are price-protected day orders: they remain open if ask plus
slippage exceeds maximum price. Limits use the same cap. Stop entries arm at
the trigger; stop-limit entries also retain their price cap. No execution occurs
on a quote predating order creation. Day orders expire at session close.

The worker consumes displayed quote quantity across accounts in a transaction
and fills whole lots. Partial fills retain reservations. Each quote is consumed
at most once per order. Fee rounding can prevent a small partial fill; the worker
reports failure instead of spending beyond the reservation.

Risk checks run at submission and fill. Pending orders count against exposure
and cash limits. Position valuation needs fresh quotes. Kill and pause controls
prevent new exposure and cancel pending entries; protective exits remain active.
A kill switch does not promise immediate liquidation.

Fee rates are illustrative simulation assumptions. Operators may install an
immutable fee schedule and select FEE_VERSION. Orders retain that version.
Both entry and exit fees affect realized P&L. Long options use full premium as
the loss budget because gaps can bypass stops.

Exits close the full position only with sufficient verified depth. Insufficient
liquidity is an operational failure for review. Target 1 is the automatic exit;
target 2 remains thesis context. Partial exits and short positions are unsupported.
Verified exchange sessions must be loaded; missing dates fail closed.
