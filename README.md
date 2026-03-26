# Resolve-X

Created branch 'Abdul'

## Local Secrets Setup

Copy `.env.example` to `.env` and fill in your local-only values before running the API or Docker stack.

JWT signing keys should be provided through `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`, or placed locally under `apps/api/keys/` without committing them.

For OTP behavior, set `OTP_PROVIDER=twilio` in `.env` for real SMS verification and provide all required Twilio keys (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SID`).
If you intentionally want mock OTP in development, set `OTP_PROVIDER=mock`.

## Docker Compose On A Public VM

This stack is configured to run behind a public VM IP using the `PUBLIC_HOST` variable.

1. In `.env`, set `PUBLIC_HOST=35.188.144.29` (or your VM public IP).
2. Open VM firewall ports: `3000`, `4000`, `8010`, `8020`, `9000`, `9001`, `15672`.
3. Start services:

```bash
docker compose up -d --build
```

4. Access services:

- Frontend: `http://35.188.144.29:3000`
- API: `http://35.188.144.29:4000/health`
- DBSCAN: `http://35.188.144.29:8010/healthz`
- Risk: `http://35.188.144.29:8020/healthz`
- MinIO API: `http://35.188.144.29:9000`
- MinIO Console: `http://35.188.144.29:9001`

5. Optional integration test from the VM:

```bash
python test_integration.py
```
