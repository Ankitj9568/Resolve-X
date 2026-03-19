# 1. Install deps
pip install -r requirements.txt

# 2. Set your NIM key
cp .env.example .env
# edit .env → set NIM_API_KEY=nvapi-...

# 3. Run
uvicorn main:app --reload --host 0.0.0.0 --port 8080

# 4. Smoke-test
python test_api.py

# 5. OpenAPI docs
open http://localhost:8080/docs