# Resolve-X

Created branch 'Abdul'

## Local Secrets Setup

Copy `.env.example` to `.env` and fill in your local-only values before running the API or Docker stack.

JWT signing keys should be provided through `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY`, or placed locally under `apps/api/keys/` without committing them.
