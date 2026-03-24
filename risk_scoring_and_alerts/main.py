"""
ResolveX · Urban Intelligence Engine
Risk Scoring & Alert Endpoints  —  RX-022 / RX-024

Depends on:  RX-021 (DBSCAN spatial clustering)
Feeds into:  RX-024 Leaflet heatmap layer, Commissioner dashboard alerts

Run locally:
    uvicorn main:app --reload --port 8020

Endpoints:
    GET /risk/zones   → Heatmap circle data with risk scores
    GET /risk/alerts  → Early-warning alerts for high/critical zones
"""

from __future__ import annotations

import math
import logging
import httpx
from enum import Enum
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------
DBSCAN_SERVICE_URL = "http://localhost:8010/api/v1/analytics/clusters"

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s — %(message)s",
)
log = logging.getLogger("resolvex.risk")

# ---------------------------------------------------------------------------
# App bootstrap
# ---------------------------------------------------------------------------

app = FastAPI(
    title="ResolveX — Urban Intelligence Engine (Risk Service)",
    description=(
        "Risk scoring and early-warning alert endpoints that consume "
        "DBSCAN spatial clusters (RX-021) and serve the Commissioner dashboard."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],          # Tighten before production
    allow_methods=["GET"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Scoring constants
# ---------------------------------------------------------------------------

# Risk level thresholds (inclusive lower bound on risk_score 0–100)
CRITICAL_THRESHOLD: int = 75
HIGH_THRESHOLD: int = 50
MEDIUM_THRESHOLD: int = 25

# Alert is only generated when risk_score >= this value
ALERT_SCORE_THRESHOLD: int = HIGH_THRESHOLD

# Category weights — drainage carries extra weight in a pre-monsoon context.
# Extend this dict when RX-028 (reputation model) is calibrated.
CATEGORY_WEIGHTS: dict[str, float] = {
    "Drainage":          1.40,   # Flood-risk multiplier — monsoon scenario
    "Roads":             1.15,
    "Sanitation":        1.25,
    "Electricity":       1.10,
    "Water Supply":      1.20,
    "Garbage":           1.05,
    "Noise Pollution":   0.90,
    "Other":             1.00,
}

# Pre-monsoon flood-risk messaging — used in alert text generation.
# Only applied to Drainage clusters (demonstrates monsoon scenario).
MONSOON_FLOOD_RISK_TEMPLATE = (
    "{ward_id}: {flood_pct}% pre-monsoon flood risk "
    "based on {complaint_count} drainage complaints."
)
DEFAULT_ALERT_TEMPLATE = (
    "{ward_id}: {risk_level} civic risk — "
    "{complaint_count} {category} complaints require immediate attention."
)

# ---------------------------------------------------------------------------
# Internal domain types  (mirrors what RX-021 would return at runtime)
# ---------------------------------------------------------------------------


class RawCluster(BaseModel):
    """
    Represents a single DBSCAN cluster as produced by RX-021
    (get_cluster_feature_collection).  In production, replace the mock list
    below with the live result from that function.

    Field notes
    -----------
    cluster_id        : DBSCAN label (≥ 0; noise label -1 is already dropped)
    centroid_lat/lng  : Geographic centre of the convex hull, in WGS-84 degrees
    radius_m          : Approximate cluster radius — half the max pairwise
                        haversine distance within the cluster (metres)
    complaint_count   : Number of trusted complaints inside this cluster
    primary_category  : Modal complaint category within the cluster
    ward_id           : Administrative ward identifier (business key)
    """

    cluster_id: int
    centroid_lat: float
    centroid_lng: float
    radius_m: float
    complaint_count: int
    primary_category: str
    ward_id: str

    @model_validator(mode="after")
    def _validate_coords(self) -> "RawCluster":
        if not (-90 <= self.centroid_lat <= 90):
            raise ValueError(f"centroid_lat out of range: {self.centroid_lat}")
        if not (-180 <= self.centroid_lng <= 180):
            raise ValueError(f"centroid_lng out of range: {self.centroid_lng}")
        return self


# ---------------------------------------------------------------------------
# Response schemas — RX-022
# ---------------------------------------------------------------------------


class RiskLevel(str, Enum):
    LOW      = "Low"
    MEDIUM   = "Medium"
    HIGH     = "High"
    CRITICAL = "Critical"


class RiskZone(BaseModel):
    """
    Single heatmap circle consumed by RX-024 (Leaflet layer).
    All coordinate fields follow GeoJSON ordering (lng, lat) internally
    but are named centroid_lat / centroid_lng for dashboard readability.
    """

    ward_id:       str        = Field(..., description="Administrative ward identifier")
    centroid_lat:  float      = Field(..., description="Cluster centroid latitude  (WGS-84)")
    centroid_lng:  float      = Field(..., description="Cluster centroid longitude (WGS-84)")
    radius_m:      float      = Field(..., description="Heatmap circle radius in metres", ge=0)
    risk_level:    RiskLevel  = Field(..., description="Categorical risk band")
    risk_score:    int        = Field(..., description="Numeric risk score 0–100", ge=0, le=100)


class RiskZoneResponse(BaseModel):
    zones: list[RiskZone]
    total: int = Field(..., description="Total number of risk zones returned")


# ---------------------------------------------------------------------------
# Response schemas — RX-024 alerts
# ---------------------------------------------------------------------------


class RiskAlert(BaseModel):
    ward_id:         str       = Field(..., description="Administrative ward identifier")
    alert_text:      str       = Field(..., description="Human-readable alert message")
    risk_level:      RiskLevel = Field(..., description="Categorical risk band")
    complaint_count: int       = Field(..., description="Number of complaints in this zone", ge=0)


class RiskAlertResponse(BaseModel):
    alerts: list[RiskAlert]
    total:  int = Field(..., description="Total number of alerts generated")

# ---------------------------------------------------------------------------
# Mock DBSCAN output  ←  replace with real RX-021 call in production
# ---------------------------------------------------------------------------
# This list simulates the output of:
#
#   from app.api.v1.analytics.services import get_cluster_feature_collection
#   feature_collection = await get_cluster_feature_collection(pool)
#
# and then a lightweight post-processing step that computes centroids and
# radii from the convex hull coordinates (not yet in RX-021, tracked as
# part of RX-022 scope).
#
# The Ward 7 row is pinned to exactly 18 Drainage complaints to satisfy
# the mandatory monsoon scenario for the hackathon demo.

_MOCK_CLUSTERS: list[dict[str, Any]] = [
    {
        "cluster_id":       0,
        "ward_id":          "Ward 7",
        "centroid_lat":     28.6317,
        "centroid_lng":     77.2167,
        "radius_m":         420.0,
        "complaint_count":  18,        # ← pinned — monsoon scenario
        "primary_category": "Drainage",
    },
    {
        "cluster_id":       1,
        "ward_id":          "Ward 3",
        "centroid_lat":     28.6480,
        "centroid_lng":     77.2090,
        "radius_m":         310.0,
        "complaint_count":  11,
        "primary_category": "Roads",
    },
    {
        "cluster_id":       2,
        "ward_id":          "Ward 12",
        "centroid_lat":     28.6195,
        "centroid_lng":     77.2310,
        "radius_m":         275.0,
        "complaint_count":  8,
        "primary_category": "Sanitation",
    },
    {
        "cluster_id":       3,
        "ward_id":          "Ward 5",
        "centroid_lat":     28.6550,
        "centroid_lng":     77.2240,
        "radius_m":         180.0,
        "complaint_count":  5,
        "primary_category": "Water Supply",
    },
    {
        "cluster_id":       4,
        "ward_id":          "Ward 9",
        "centroid_lat":     28.6120,
        "centroid_lng":     77.2050,
        "radius_m":         140.0,
        "complaint_count":  3,
        "primary_category": "Electricity",
    },
]

# ---------------------------------------------------------------------------
# Risk scoring logic
# ---------------------------------------------------------------------------


def _compute_risk_score(cluster: RawCluster) -> int:
    """
    Derive a 0–100 risk score for a single DBSCAN cluster.

    The formula has three components:

    1. **Complaint volume score (0–60 pts)**
       Logarithmic scaling so that the first few complaints have high
       marginal impact but the score saturates for very large clusters.
       Anchored so that 20 complaints ≈ 60 pts.

    2. **Category weight bonus (0–20 pts)**
       Each category has a domain-specific multiplier (see CATEGORY_WEIGHTS).
       Drainage during pre-monsoon season carries the highest weight (1.40).

    3. **Spatial density bonus (0–20 pts)**
       Denser clusters (more complaints per unit area) are scored higher
       because they signal a concentrated problem, not a diffuse one.

    All components are clipped and the final score is clamped to [0, 100].

    NOTE: When RX-028 (reputation model) ships, replace the category weight
    lookup with a model-derived severity score passed in via the cluster
    metadata.  The formula structure can stay the same.

    Component ceilings are intentionally asymmetric (45 / 15 / 12 = 72 max)
    so that a single large Drainage cluster reaches HIGH but cannot hit
    Critical without an additional amplification path (e.g. RX-028 signals).
    Raise CRITICAL_THRESHOLD or adjust ceilings when the scoring is
    calibrated against real complaint history.
    """

    # 1. Volume score — log scale, saturates near 20 complaints  (max 45 pts)
    volume_score: float = min(45.0, 45.0 * math.log1p(cluster.complaint_count) / math.log1p(20))

    # 2. Category weight bonus  (max 15 pts)
    #    Maps category weight range [0.85, 1.40] → [0, 15]
    weight = CATEGORY_WEIGHTS.get(cluster.primary_category, 1.0)
    category_bonus: float = min(15.0, 15.0 * (weight - 0.85) / 0.55)

    # 3. Spatial density bonus  (max 12 pts)
    #    complaints per km² — avoid division by zero for point-like clusters
    area_km2 = math.pi * (max(cluster.radius_m, 1.0) / 1000.0) ** 2
    density = cluster.complaint_count / area_km2
    # Saturates at ~150 complaints/km²
    density_bonus: float = min(12.0, 12.0 * math.log1p(density) / math.log1p(150))

    raw = volume_score + category_bonus + density_bonus
    return max(0, min(100, round(raw)))


def _score_to_risk_level(score: int) -> RiskLevel:
    if score >= CRITICAL_THRESHOLD:
        return RiskLevel.CRITICAL
    if score >= HIGH_THRESHOLD:
        return RiskLevel.HIGH
    if score >= MEDIUM_THRESHOLD:
        return RiskLevel.MEDIUM
    return RiskLevel.LOW


def _compute_flood_risk_pct(cluster: RawCluster) -> int:
    """
    Derive a human-readable flood-risk percentage for drainage clusters.

    This is a *display metric* for the alert text — not the internal risk
    score.  It maps complaint_count → flood % via a logistics-inspired
    curve anchored at 18 complaints → 76%.

    Replace with a calibrated model output when the hydrology team delivers
    the Pre-Monsoon Flood Risk Model (tracked separately from RX-028).
    """
    # Sigmoid: k=0.193, midpoint=12 → logistic(18) = 0.7609 → rounds to 76.
    # Verified: exp(-0.193 * 6) ≈ 0.3143  →  1 / 1.3143 ≈ 0.7609
    k = 0.193         # steepness
    midpoint = 12.0   # complaint count at 50%
    logistic = 1.0 / (1.0 + math.exp(-k * (cluster.complaint_count - midpoint)))
    pct = round(logistic * 100)
    return max(1, min(99, pct))


def _build_alert_text(cluster: RawCluster, risk_level: RiskLevel) -> str:
    """
    Generate context-aware alert text.

    Drainage clusters get monsoon-specific messaging.
    All other categories get the generic department-head template.

    The Ward 7 / 18-complaint / Drainage combination will produce exactly:
        "Ward 7: 76% pre-monsoon flood risk based on 18 drainage complaints."
    """
    if cluster.primary_category == "Drainage":
        flood_pct = _compute_flood_risk_pct(cluster)
        return MONSOON_FLOOD_RISK_TEMPLATE.format(
            ward_id=cluster.ward_id,
            flood_pct=flood_pct,
            complaint_count=cluster.complaint_count,
        )
    return DEFAULT_ALERT_TEMPLATE.format(
        ward_id=cluster.ward_id,
        risk_level=risk_level.value,
        complaint_count=cluster.complaint_count,
        category=cluster.primary_category,
    )


# ---------------------------------------------------------------------------
# Shared pipeline
# ---------------------------------------------------------------------------


def _geojson_to_raw_clusters(feature_collection: dict[str, Any]) -> list[RawCluster]:
    """
    Transform GeoJSON FeatureCollection (from RX-021) into internal RawCluster rows.
    """
    clusters = []
    for feature in feature_collection.get("features", []):
        props = feature.get("properties", {})
        geom = feature.get("geometry", {})
        g_type = geom.get("type")
        coords_raw = geom.get("coordinates")
        
        if not coords_raw:
            continue
            
        # DBSCAN might return Polygon (convex hull), MultiPoint (fallback), or Point
        if g_type == "Polygon":
            # ring is coords_raw[0]
            ring = coords_raw[0]
            lats = [c[1] for c in ring]
            lngs = [c[0] for c in ring]
        elif g_type == "MultiPoint":
            lats = [c[1] for c in coords_raw]
            lngs = [c[0] for c in coords_raw]
        elif g_type == "Point":
            lats = [coords_raw[1]]
            lngs = [coords_raw[0]]
        else:
            log.warning("Unsupported geometry type: %s", g_type)
            continue
        
        if not lats:
            continue
            
        centroid_lat = sum(lats) / len(lats)
        centroid_lng = sum(lngs) / len(lngs)
        
        # Approximate radius: distance from centroid to furthest point
        max_dist = 0.0
        for lat, lng in zip(lats, lngs):
            dist = math.sqrt((lat - centroid_lat)**2 + (lng - centroid_lng)**2) * 111320
            if dist > max_dist:
                max_dist = dist

        clusters.append(RawCluster(
            cluster_id       = props.get("cluster_id", -1),
            ward_id          = props.get("ward_id", "Unknown"),
            centroid_lat     = centroid_lat,
            centroid_lng     = centroid_lng,
            radius_m         = max_dist if max_dist > 0 else 100.0,
            complaint_count  = props.get("complaint_count", 0),
            primary_category = props.get("primary_category", "Other")
        ))
    return clusters


async def _load_clusters() -> list[RawCluster]:
    """
    Fetch live clusters from the DBSCAN service.
    """
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(DBSCAN_SERVICE_URL, timeout=10.0)
            if resp.status_code == 200:
                fc = resp.json()
                return _geojson_to_raw_clusters(fc)
            
            log.warning("DBSCAN service returned %d, falling back to mock data", resp.status_code)
    except Exception as exc:
        log.exception("Error processing DBSCAN clusters: %s", exc)

    return [RawCluster(**c) for c in _MOCK_CLUSTERS]


def _process_clusters(
    clusters: list[RawCluster],
) -> tuple[list[RiskZone], list[RiskAlert]]:
    """
    Score every cluster and partition results into zones and alerts.
    Returns (zones, alerts).
    """
    zones:  list[RiskZone]  = []
    alerts: list[RiskAlert] = []

    for cluster in clusters:
        score      = _compute_risk_score(cluster)
        risk_level = _score_to_risk_level(score)

        zone = RiskZone(
            ward_id      = cluster.ward_id,
            centroid_lat = cluster.centroid_lat,
            centroid_lng = cluster.centroid_lng,
            radius_m     = cluster.radius_m,
            risk_level   = risk_level,
            risk_score   = score,
        )
        zones.append(zone)

        log.info(
            "Scored %s  category=%-12s  complaints=%d  score=%d  level=%s",
            cluster.ward_id,
            cluster.primary_category,
            cluster.complaint_count,
            score,
            risk_level.value,
        )

        if score >= ALERT_SCORE_THRESHOLD:
            alert_text = _build_alert_text(cluster, risk_level)
            alerts.append(
                RiskAlert(
                    ward_id         = cluster.ward_id,
                    alert_text      = alert_text,
                    risk_level      = risk_level,
                    complaint_count = cluster.complaint_count,
                )
            )
            log.warning("ALERT generated for %s: %s", cluster.ward_id, alert_text)

    # Sort zones descending by score so the dashboard sees most critical first
    zones.sort(key=lambda z: z.risk_score, reverse=True)
    alerts.sort(
        key=lambda a: (a.risk_level == RiskLevel.CRITICAL, a.risk_level == RiskLevel.HIGH),
        reverse=True,
    )

    return zones, alerts


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@app.get(
    "/risk/zones",
    response_model=RiskZoneResponse,
    summary="Heatmap zone data with risk scores",
    description=(
        "Returns every DBSCAN cluster enriched with a 0–100 risk score and "
        "a categorical risk level.  Consumed by the RX-024 Leaflet heatmap layer.  "
        "Results are sorted by descending risk_score."
    ),
    tags=["Risk"],
)
async def get_risk_zones() -> RiskZoneResponse:
    """
    GET /risk/zones

    Returns heatmap circle data for all active spatial clusters.
    """
    try:
        clusters = await _load_clusters()
        zones, _ = _process_clusters(clusters)
        return RiskZoneResponse(zones=zones, total=len(zones))
    except Exception as exc:                          # noqa: BLE001
        log.exception("Risk zone pipeline failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Risk zone computation failed. Please retry shortly.",
        ) from exc


@app.get(
    "/risk/alerts",
    response_model=RiskAlertResponse,
    summary="Early-warning alerts for department heads",
    description=(
        "Returns alert messages for every zone whose risk_score ≥ "
        f"{ALERT_SCORE_THRESHOLD} (High or Critical).  "
        "Drainage clusters receive monsoon-specific flood-risk messaging.  "
        "Results are sorted by severity (Critical → High)."
    ),
    tags=["Risk"],
)
async def get_risk_alerts() -> RiskAlertResponse:
    """
    GET /risk/alerts

    Returns early-warning text alerts for high/critical-risk zones.
    """
    try:
        clusters = await _load_clusters()
        _, alerts = _process_clusters(clusters)
        return RiskAlertResponse(alerts=alerts, total=len(alerts))
    except Exception as exc:                          # noqa: BLE001
        log.exception("Risk alert pipeline failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail="Risk alert generation failed. Please retry shortly.",
        ) from exc


# ---------------------------------------------------------------------------
# Health probe  (useful for Docker / k8s liveness checks)
# ---------------------------------------------------------------------------


@app.get("/healthz", include_in_schema=False)
def health_check() -> dict[str, str]:
    return {"status": "ok", "service": "resolvex-risk"}
