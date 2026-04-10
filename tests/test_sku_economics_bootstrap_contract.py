from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.models.sku_economics import AdAnalysisBootstrapJob
from app.routers.sku_economics import _serialize_bootstrap_job


def test_bootstrap_status_serialization_supports_completed_partial_and_rich_sources():
    job = AdAnalysisBootstrapJob(
        id=99,
        store_id=12,
        status="completed_partial",
        current_stage="completed_partial",
        stage_progress=100,
        step="Partial ready",
        source_statuses=[
            {
                "id": "advert",
                "label": "Реклама WB",
                "mode": "partial",
                "records": 120,
                "automatic": True,
                "synced_at": datetime(2026, 4, 10, 10, 0, 0).isoformat(),
                "coverage_ratio": 0.66,
                "coverage_start": date(2026, 4, 1).isoformat(),
                "coverage_end": date(2026, 4, 6).isoformat(),
                "expected_start": date(2026, 4, 1).isoformat(),
                "expected_end": date(2026, 4, 9).isoformat(),
            },
            {
                "id": "finance",
                "label": "Финансы WB",
                "mode": "automatic",
                "records": 500,
                "automatic": True,
                "coverage_ratio": 1.0,
            },
        ],
        is_partial=True,
        started_at=datetime(2026, 4, 10, 9, 30, 0),
        completed_at=datetime(2026, 4, 10, 9, 40, 0),
        period_start=date(2026, 4, 1),
        period_end=date(2026, 4, 9),
    )

    payload = _serialize_bootstrap_job(job, store_id=12)

    assert payload.status == "completed_partial"
    assert payload.ready is True
    assert payload.is_partial is True
    assert payload.current_stage == "completed_partial"
    assert isinstance(payload.source_statuses, list)
    assert payload.source_statuses[0].id == "advert"
    assert payload.source_statuses[0].coverage_ratio == 0.66
    assert payload.source_statuses[1].mode == "automatic"
