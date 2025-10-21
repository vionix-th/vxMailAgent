# TODO — Backend Remediation (2025-10-21 Audit)

## Remove Synthetic Settings Defaults (High)
- **Defect Hypothesis:** `RepoBundleRegistry.applyDefaults` fabricates `defaultSettings()` for bundles missing settings, so fetcher bootstrap interprets `fetcherAutoStart: true` and starts loops without real tenant configuration.
- **SOT:** `SettingsRepository` records inside the SQLite bundle for each tenant.
- **Repair Steps:** Stop persisting `defaultSettings()` during bundle hydration, make `SettingsRepository.loadSettings` throw a typed `RepositoryError` when no settings exist, and short-circuit fetcher bootstrap until explicit provisioning seeds settings.
- **Exit Criteria:** New tenants without seeded settings trigger a clear “settings not initialized” failure, fetcher startup is blocked until real settings are saved, and blank defaults never persist.
- **Regression Tests:**
  - Extend `src/backend/tests/integration/settings-and-api.test.cjs` with `integration: settings require explicit provisioning` that starts the backend against a temporary data dir with the settings document removed, asserts `/api/settings` fails with the new error, and verifies creating real settings clears the failure.
  - Add an integration check in `src/backend/tests/integration/fetcher-and-observability.test.cjs` to assert `/api/fetcher/start` responds with a validation error while settings are missing and succeeds after provisioning.
  - Add a focused `node:test` under `src/backend/repository/__tests__/repo-bundle-registry.test.ts` to confirm `applyDefaults` refuses to fabricate settings and emits the expected `RepositoryError`.
- **Operational Follow-up:** Update onboarding/runbooks to ensure provisioning flows insert canonical settings before bootstrap.
- **Status:** Completed on 2025-10-21 — guards now emit `SETTINGS_NOT_INITIALIZED`, fetcher bootstrap skips missing tenants, and the specified integration/unit tests are in place.

## Harden Fetcher Log Validation (High)
- **Defect Hypothesis:** `services/fetcher.ts` coerces malformed payloads to `[]` and injects IDs, letting clients wipe or corrupt logs.
- **SOT:** `FetcherLogRepository` per-tenant log collection.
- **Repair Steps:** Introduce a shared validator for fetcher log mutations that enforces array shape, id/timestamp presence, and rejects non-conforming payloads before touching the repository; propagate validation errors to callers without mutating stored logs.
- **Exit Criteria:** Non-array or malformed log payloads return a 400-class error and leave persisted logs untouched; valid entries store unchanged IDs/timestamps.
- **Regression Tests:**
  - Extend `src/backend/tests/integration/fetcher-and-observability.test.cjs` with `integration: fetcher logs reject malformed entries` that POSTs malformed payloads (non-array and missing-id entries) and asserts the response is 400 with no repository changes.
  - Add a service-level `node:test` (e.g. `src/backend/services/__tests__/fetcher-logs.test.ts`) that exercises the validator directly with malformed inputs.
- **Status:** Completed on 2025-10-21 — `fetcher-log-validation` now enforces shape, `POST /api/fetcher/logs` rejects bad payloads, and both the integration and service tests cover failures.

## Preserve API Configs on Partial Patch (High)
- **Defect Hypothesis:** `services/settings.ts` rebuilds `apiConfigs` from `patch.apiConfigs`, erasing configs that are not included in the payload.
- **SOT:** `SettingsRepository` `apiConfigs` array.
- **Repair Steps:** Merge incoming configs by `id`, updating only supplied entries, enforcing required fields, and preserving untouched configs.
- **Exit Criteria:** `PATCH /api/settings` with a subset of configs updates only targeted entries and retains others.
- **Regression Tests:**
  - Expand `src/backend/tests/integration/settings-and-api.test.cjs` with `integration: api config patch preserves siblings` that seeds multiple configs, updates one via PATCH, and confirms others remain.
  - Add a service-level `node:test` (e.g. `src/backend/services/__tests__/settings-merge.test.ts`) verifying the merge helper leaves untouched configs intact.
- **Status:** Completed on 2025-10-21 — partial `apiConfigs` patches now merge by id, the integration test confirms siblings persist, and the merge helper is covered by service tests.

## Preserve Signatures on Partial Updates (Medium)
- **Defect Hypothesis:** `services/settings.ts` replaces the entire `signatures` map whenever the field is present in a patch payload.
- **SOT:** `SettingsRepository` `signatures` object.
- **Repair Steps:** Merge patches into the existing map per key, rejecting payloads with missing ids instead of wholesale replacement.
- **Exit Criteria:** Updating one signature leaves others unchanged when `loadSettings` is called afterward.
- **Regression Tests:**
  - Extend `src/backend/tests/integration/settings-and-api.test.cjs` with `integration: signature patch merges entries` to update a single signature and verify others persist.
  - Cover merge logic via the same service-level test suite planned for API configs.
- **Status:** Completed on 2025-10-21 — signature patches now merge per key, the integration test confirms unchanged entries remain, and service tests assert the helper behaviour.

## Enforce Workspace Tag Strings (Medium)
- **Defect Hypothesis:** `workspace-service.ts` and the workspace tool handler accept non-string tags when the array check passes, persisting invalid metadata.
- **SOT:** `WorkspaceItemsRepository` records for workspace metadata.
- **Repair Steps:** Centralize tag normalization, require strings, trim/dedupe entries, and reject payloads containing non-strings before persistence.
- **Exit Criteria:** Workspace create/update/tool calls fail when tags contain non-strings or empty values; persisted items always expose `string[]` tags.
- **Regression Tests:**
  - Augment `src/backend/tests/integration/workspace-items.test.cjs` with `integration: workspace tags enforce string array` covering rejection of numeric/object tags and acceptance of normalized strings.
  - Add a targeted `node:test` under `src/backend/services/__tests__/workspace-tags.test.ts` for the normalization helper.
- **Follow-Up:** Schedule a cleanup script (tracked separately) to audit existing workspace records for non-string tags once validation deploys.

## Remove Mock Provider Token Defaults (Medium)
- **Defect Hypothesis:** `providers/mail/mock.ts` manufactures placeholder OAuth tokens when accounts lack credentials, hiding misconfiguration.
- **SOT:** `AccountsRepository` token fields on provider accounts.
- **Repair Steps:** Require explicit tokens even in mock mode; throw a descriptive validation error when any required token is missing.
- **Exit Criteria:** Enabling the mock provider without seeded tokens triggers a deterministic failure; providing explicit mock tokens restores success.
- **Regression Tests:**
  - Extend `src/backend/tests/integration/accounts.test.cjs` with `integration: mock provider enforces tokens` by starting the backend with `VX_TEST_MOCK_PROVIDER=true`, attempting to create/use an account without tokens (expect failure), then repeating with explicit mock tokens (expect success).
  - Add a provider-focused `node:test` (e.g. `src/backend/providers/mail/__tests__/mock-provider.test.ts`) to assert the constructor throws when tokens are missing.

## Test & Validation Workflow
- **Command Gate:** Run `npm --prefix src/backend run lint`, `npm --prefix src/backend run typecheck`, and `npm --prefix src/backend run build` before executing the integration suite.
- **Integration Suite:** Execute `cd src/backend && node --test --test-reporter=spec tests/integration/*.cjs` after the fixes and new coverage land; ensure new cases are stable under base and failure scenarios.
- **Data Integrity Follow-Up:** After deploying tag validation, queue a maintenance task to audit and scrub legacy workspace metadata that already contains non-string tags.
