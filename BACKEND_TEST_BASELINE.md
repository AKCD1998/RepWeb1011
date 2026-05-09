# Backend Test Baseline

Last updated: 2026-05-09

## Test Setup

The active backend tests live under `REACTjs-Project/tests/backend`.

The repo now uses Jest plus Supertest for lightweight backend smoke tests:

```bash
cd REACTjs-Project
npm test
```

Equivalent explicit command:

```bash
npm run test:backend
```

The test runner uses `node --experimental-vm-modules` because this project is ESM (`"type": "module"`).

## What The Tests Cover

`tests/backend/backend-smoke.test.mjs` covers:

- The PostgreSQL connection layer can be imported safely with `DATABASE_URL` unset.
- Important controller, route, middleware, and helper modules can be imported safely.
- The current server entry point, `server/index.js`, can start in a child process.
- `GET /api/health` responds with the current no-database baseline: HTTP `503` and `DATABASE_URL is not set`.
- `GET /api/patients` uses the existing CSV fallback and responds without a database.
- Unknown API routes return the current JSON `404` shape.
- Representative route families respond without crashing:
  - Auth routes
  - Admin routes
  - Inventory routes
  - Dispense routes
  - Reporting/stock routes
  - Product/reference routes

For auth-protected routes, the tests assert the current expected unauthenticated status code (`401`). They do not fake a successful login.

For public DB-backed routes, the tests intentionally run without `DATABASE_URL` and assert the current expected error status (`500`). This confirms the route and error middleware respond over HTTP without requiring a real database.

## What Is Not Covered Yet

- Successful login/logout flows.
- Authenticated role behavior for `ADMIN`, `PHARMACIST`, and `OPERATOR`.
- Branch-scoped authorization behavior.
- Product, inventory, transfer, dispense, incident, and report happy paths.
- PostgreSQL query correctness.
- Migration execution.
- Destructive write behavior.
- Frontend behavior.
- The legacy `Vanilla/backend` service.

## Routes Skipped Or Limited

- Authenticated success paths are skipped because they require seeded users and a known test database.
- DB-backed public routes are limited to no-database smoke assertions to avoid accidentally reading or writing a live database.
- Inventory, dispense, incident, and product write routes are not exercised with valid payloads because those would require a safe isolated database fixture.
- The legacy `Vanilla/backend` routes are not included because the active deployment path is `REACTjs-Project/server`, and the legacy backend has a separate package and schema.

## Safety Notes

The backend HTTP tests force `DATABASE_URL` to an empty string when spawning the server. This prevents the baseline suite from connecting to Render/live PostgreSQL or any local database by accident.

The suite does not run migrations, seed data, or perform successful write operations.
