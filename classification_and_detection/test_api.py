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

BASE_URL = os.getenv("RESOLVEX_BASE_URL", "http://localhost:9000")
TEST_TIMEOUT_SECONDS = float(os.getenv("RESOLVEX_TEST_TIMEOUT", "180"))
# 1x1 JPEG to ensure multimodal pipeline is exercised by default.
DEFAULT_TEST_IMAGE_BASE64 = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEAAkGBxAQEBAQEBAVFRUVFRUVFRUVFRUVFRUV"
    "FRUWFhUVFRUYHSggGBolGxUVITEhJSkrLi4uFx8zODMsNygtLisBCgoKDg0OGhAQGi0f"
    "HyUtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLf/A"
    "ABEIAAEAAQMBIgACEQEDEQH/xAAbAAACAwEBAQAAAAAAAAAAAAAEBQIDBgEAB//EADQQ"
    "AAIBAwMCBAQEBQUBAAAAAAECAwAEEQUSITFBEyJRYQYUMnGBkaEHFCNSYrHB8BYjQ1OC"
    "/8QAGAEAAwEBAAAAAAAAAAAAAAAAAAECAwT/xAAhEQEBAAICAgIDAQAAAAAAAAABAhED"
    "IRIxQQQTIlEFcf/aAAwDAQACEQMRAD8A9xREQEREBERAREQEREBERAREQEREBERA//Z"
)
TEST_IMAGE_BASE64 = os.getenv("RESOLVEX_TEST_IMAGE_BASE64") or DEFAULT_TEST_IMAGE_BASE64
SKIP_IMAGE_TEST = os.getenv("RESOLVEX_SKIP_IMAGE_TEST", "false").lower() in {
    "1",
    "true",
    "yes",
}


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
        }
        r = await client.post("/api/v1/analyze", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        print(f"  Status: {r.status_code}")
        data = r.json()
        print(f"  Primary Category  : {data['primary_issue']['category']}")
        print(f"  Subcategory       : {data['primary_issue']['subcategory']}")
        print(f"  Priority Score    : {data['primary_issue']['priority_score']}/5")
        print(f"  Confidence        : {data['primary_issue']['confidence']:.2f}")
        print(f"  Secondary Issues  : {len(data['secondary_issues'])}")
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
        }
        r = await client.post("/api/v1/analyze", json=payload)
        assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
        print(f"  Status: {r.status_code}")
        data = r.json()
        print(f"  Primary Category  : {data['primary_issue']['category']}")
        print(f"  Priority Score    : {data['primary_issue']['priority_score']}/5")
        print(f"  Secondary Issues  : {len(data['secondary_issues'])}")
        for si in data["secondary_issues"]:
            print(f"    → {si['category']} (confidence={si['confidence']:.2f})")

        # ── Test 4: Validation Error (text too short) ──────────────────────────
        print("\n── Test 4: Validation error (text too short) ─────────────────")
        payload = {
            "complaint_id": str(uuid.uuid4()),
            "text_description": "bad",  # < 10 chars — should fail
        }
        r = await client.post("/api/v1/analyze", json=payload)
        print(f"  Expected 422, got {r.status_code}", "✓" if r.status_code == 422 else "✗")

        # ── Test 5: Multimodal request ────────────────────────────────────────
        if not SKIP_IMAGE_TEST:
            print("\n── Test 5: Multimodal complaint ───────────────────────────────")
            payload = {
                "complaint_id": str(uuid.uuid4()),
                "text_description": (
                    "Please classify this complaint using the attached image as context. "
                    "There may be road damage and drainage overflow."
                ),
                "image_base64": TEST_IMAGE_BASE64,
            }
            r = await client.post("/api/v1/analyze", json=payload)
            if r.status_code == 200:
                data = r.json()
                print(f"  Status: {r.status_code}")
                print(f"  Primary Category  : {data['primary_issue']['category']}")
                print(f"  Priority Score    : {data['primary_issue']['priority_score']}/5")
                print(f"  Secondary Issues  : {len(data['secondary_issues'])}")
            else:
                print(f"  Status: {r.status_code} (non-fatal)")
                print(f"  Body: {r.text}")
        else:
            print("\n── Test 5: Multimodal complaint ───────────────────────────────")
            print("  Skipped (set RESOLVEX_SKIP_IMAGE_TEST=true to control this)")

        print("\n── All tests complete ────────────────────────────────────────\n")


if __name__ == "__main__":
    asyncio.run(run_tests())
