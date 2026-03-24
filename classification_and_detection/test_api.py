"""
test_api.py — ResolveX Classification Service
==============================================
Quick integration smoke-test.  Run AFTER starting the service locally:

    uvicorn main:app --reload --port 8080

Then in a separate terminal:

    python test_api.py

Requires: httpx  (already in requirements.txt)
"""

import asyncio
import json
import os
import uuid

import httpx

BASE_URL = os.getenv("RESOLVEX_BASE_URL", "http://localhost:8000")
TEST_TIMEOUT_SECONDS = float(os.getenv("RESOLVEX_TEST_TIMEOUT", "180"))


async def run_tests():
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=TEST_TIMEOUT_SECONDS) as client:

        print(f"\nUsing test timeout: {TEST_TIMEOUT_SECONDS:.1f}s")

        # ── Test 1: Health Check ───────────────────────────────────────────────
        print("\n── Test 1: Health Check ──────────────────────────────────────")
        r = await client.get("/healthz")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"
        print(f"  ✓ Status: {r.status_code}")
        print(f"  Response: {r.json()}")

        # ── Test 2: Roads complaint (text only) ────────────────────────────────
        print("\n── Test 2: Roads & Footpaths (text only) ─────────────────────")
        payload = {
            "complaint_id": str(uuid.uuid4()),
            "text_description": (
                "There is a massive pothole on Nehru Marg near the junction "
                "with Park Street. It is about 2 feet wide and very deep. "
                "Three motorcycles have already damaged their wheels this week. "
                "Please repair it urgently before someone gets killed."
            ),
            "latitude": 12.9716,
            "longitude": 77.5946,
            "user_selected_category": "Roads and Footpaths"
        }
        r = await client.post("/api/v1/analyze", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        print(f"  Status: {r.status_code}")
        data = r.json()
        analysis = data.get("analysis")
        if analysis:
            print(f"  Primary Category  : {analysis['primary_issue']['category']}")
            print(f"  Subcategory       : {analysis['primary_issue']['subcategory']}")
            print(f"  Priority Score    : {analysis['primary_issue']['priority_score']}/5")
            print(f"  Confidence        : {analysis['primary_issue']['confidence']:.2f}")
            print(f"  Secondary Issues  : {len(analysis['secondary_issues'])}")
        else:
            print("  No analysis background — possibly a duplicate.")
        print(f"  Full JSON:\n{json.dumps(data, indent=2)}")

        # ── Test 3: Multi-issue complaint ──────────────────────────────────────
        print("\n── Test 3: Multi-issue complaint ─────────────────────────────")
        payload = {
            "complaint_id": str(uuid.uuid4()),
            "text_description": (
                "The open drain on Gandhi Nagar Road is overflowing with sewage "
                "and the stench is unbearable. Three stray dogs have been "
                "seen drinking from it and the streetlight at the corner has "
                "been broken for two months making the whole area very dark "
                "and unsafe at night."
            ),
            "latitude": 12.9716,
            "longitude": 77.5946,
            "user_selected_category": "Drainage and Sewage"
        }
        r = await client.post("/api/v1/analyze", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        print(f"  Status: {r.status_code}")
        data = r.json()
        analysis = data.get("analysis")
        if analysis:
            print(f"  Primary Category  : {analysis['primary_issue']['category']}")
            print(f"  Priority Score    : {analysis['primary_issue']['priority_score']}/5")
            print(f"  Secondary Issues  : {len(analysis['secondary_issues'])}")
            for si in analysis["secondary_issues"]:
                print(f"    → {si['category']} (confidence={si['confidence']:.2f})")
        else:
            print("  No analysis background — possibly a duplicate.")

        # ── Test 4: Validation Error (text too short) ──────────────────────────
        print("\n── Test 4: Validation error (text too short) ─────────────────")
        payload = {
            "complaint_id": str(uuid.uuid4()),
            "text_description": "bad",  # < 10 chars — should fail
            "latitude": 12.9716,
            "longitude": 77.5946,
            "user_selected_category": "Roads and Footpaths"
        }
        r = await client.post("/api/v1/analyze", json=payload)
        print(f"  Expected 422, got {r.status_code}", "✓" if r.status_code == 422 else "✗")

        print("\n── All tests complete ────────────────────────────────────────\n")


if __name__ == "__main__":
    asyncio.run(run_tests())
