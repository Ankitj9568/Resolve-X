import requests
import time
import sys

# ---------------------------------------------------------
# Configuration
# ---------------------------------------------------------
VM_IP = "35.188.144.29"
DBSCAN_URL = "http://localhost:8010"
RISK_URL = "http://localhost:8020"

def test_service_health(name, url):
    print(f"[*] Checking health of {name} at {url}...")
    try:
        # Most FastAPI apps use /healthz or /docs as a quick check
        resp = requests.get(f"{url}/healthz", timeout=5)
        if resp.status_code == 200:
            print(f"[+] {name} is alive: {resp.json()}")
            return True
        else:
            print(f"[-] {name} returned status {resp.status_code}")
    except Exception as e:
        print(f"[-] Could not connect to {name}: {e}")
    return False

def test_risk_endpoints():
    print(f"\n[*] Testing Risk Service Endpoints...")
    endpoints = ["/risk/zones", "/risk/alerts"]
    for ep in endpoints:
        try:
            full_url = f"{RISK_URL}{ep}"
            print(f"    - GET {full_url}")
            resp = requests.get(full_url, timeout=5)
            if resp.status_code == 200:
                data = resp.json()
                print(f"      [OK] Received {data.get('total', 0)} items.")
                if data.get('total', 0) > 0:
                    # Show a snippet of the first item
                    key = 'zones' if 'zones' in data else 'alerts'
                    print(f"      [DATA] Sample: {data[key][0].get('ward_id')} - {data[key][0].get('risk_level')}")
            else:
                print(f"      [FAIL] Status {resp.status_code}: {resp.text}")
        except Exception as e:
            print(f"      [ERROR] {e}")

def main():
    print("=== ResolveX Local integration Test ===")
    print(f"Target VM: {VM_IP}")
    
    # Check if local modules are running
    dbscan_ok = test_service_health("DBSCAN Service", DBSCAN_URL)
    risk_ok = test_service_health("Risk Service", RISK_URL)

    if not (dbscan_ok and risk_ok):
        print("\n[!] WARNING: One or more local services are not responding.")
        print("    Please ensure they are running in separate terminals:")
        print(f"    DBSCAN: uvicorn main:app --port 8010 (in DBScan_clustering_pipeline)")
        print(f"    Risk:   uvicorn main:app --port 8020 (in risk_scoring_and_alerts)")
    
    # Test endpoints
    test_risk_endpoints()

    print("\n=== Integration Notes ===")
    print(f"1. Ensure your local .env or config points to the VM DB if needed.")
    print(f"2. Your frontend (on VM or Local) should point to:")
    print(f"   - Analytics -> {RISK_URL}")
    print(f"   - Database  -> {VM_IP}")

if __name__ == "__main__":
    main()
