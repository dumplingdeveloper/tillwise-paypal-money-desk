# Phase B M1 build log

## Model and scope

- Coding agent model name available to this session: UNVERIFIED by local CLI output; the session does not expose a stable model identifier to commands.
- Work scope: PayPal core M1 only; no M2 AG Studio implementation started.

## APIMatic Context Plugin probe

- Install command attempted as requested: `npx context-plugins install https://github.com/paypaldev/server-sdk-context-plugin-preview`.
- Result observed in terminal: the installer warned that plugins can run commands through hooks/MCP servers and printed a telemetry notice, then failed during `git clone` because this Mac has old Apple Git 2.21 with unsupported clone flags.
- Fallback used: manually cloned the public repo into the session artifact folder, not this repository: `/Users/shiyx/.copilot/session-state/a5f98933-0ac2-4012-8b8b-91ed009d4889/files/server-sdk-context-plugin-preview`.
- License evidence: `plugin.json:10` says `"license": "MIT"`; `plugin.json:11-18` lists bundled skills under `./skills/typescript` among other languages. The plugin was not vendored into this repo.
- Plugin identity evidence: `plugin.json:5` says it helps “Integrate and consume the APIMatic-generated PayPal Server SDK SDK — bundled skills for csharp, java, php, Python, ruby, TypeScript.”

## Skills read and resulting implementation choices

- `typescript-getting-started/SKILL.md:28-30` identifies npm package `@paypal/paypal-server-sdk` version `2.5.0`, install command `npm install @paypal/paypal-server-sdk`, and `Client` construction with `new Client(config?: Partial<Configuration>)`. Result: `mcp-server/package.json` now depends on `@paypal/paypal-server-sdk` and `LivePayPalClient` constructs `new Client(...)`.
- `typescript-authentication/SKILL.md:77-79` shows credentials named `oAuthClientId`; lines around `93` say `oAuthClockSkew` refreshes early. Result: `LivePayPalClient` config uses `clientCredentialsAuthCredentials` with client id/secret and a token provider.
- `typescript-client-initialization/SKILL.md:21-27` shows `import { Client, Environment }`, `environment`, `timeout: 30000`, and `httpClientOptions`. Lines `67-89` describe custom timeout/proxy/agents/retries and a fake-client seam. Result: live SDK client sets sandbox environment, 30s timeout, retries, and an injectable adapter for contract tests.
- `typescript-calling-endpoints/SKILL.md:122-135` says every operation returns `ApiResponse<T>` and the deserialized value is on `.result`. Result: `LivePayPalClient` reads SDK responses from `response.result`.
- `typescript-configuration-resilience/SKILL.md:84-88` warns the generated default timeout can be `0`, meaning no timeout. Result: live client explicitly sets `timeout: 30_000`.
- `typescript-error-handling/SKILL.md:37-43` says `ApiError` exposes `statusCode`, `headers`, `request`, `result`, and `body`, and bare `ApiError` may only have `body`. Result: `LivePayPalClient.paypalFetch()` normalizes plain-fetch failures into the PayPal error envelope, and `LivePayPalClient.sdkCall()` parses SDK `.result` or `.body` when available before throwing `PayPalApiError`.
- `typescript-testing/SKILL.md:9-11` says `unstable_httpClientOptions` is the injection point and a stub axios adapter provides an in-process seam with no network. Lines `38-43` say the adapter receives request config and must return raw serialized body. Result: `test/paypal.test.ts` contract test injects an SDK adapter and returns JSON strings.
- `typescript-models/SKILL.md:75-98` says to open generated model/container files for real declaration shapes and date strings. Result: refund amount was converted from REST `currency_code` to SDK `currencyCode` after SDK runtime validation rejected the REST shape.

## What changed in M1

- Added PayPal client abstraction, deterministic mock client, live sandbox client, orchestration service, and MCP tool registrations under `mcp-server/src/paypal/`.
- Added WooCommerce PayPal order context, audit record/list, and deterministic mock seed abilities in `wp-plugin/tillwise-store-agent/includes/class-store-agent.php`.
- Added existing permission-gate coverage for PayPal read/preview/refusal vs mutation tools in `alexa-sim/src/permissionGate.ts`.
- Added `scripts/paypal-seed.mjs`; mock mode seeds deterministic Woo order links. Live browserless card seeding remains UNVERIFIED until PayPal sandbox credentials exist and card capability docs are rechecked.

## Secrets and live sandbox

- No `~/.config/tillwise/paypal-sandbox.env` file existed when M1 implementation began, so no live PayPal calls were attempted.
- The live client reads `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from that file when present and does not print them.
