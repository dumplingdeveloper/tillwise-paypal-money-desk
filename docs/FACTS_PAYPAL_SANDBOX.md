# Facts: making the real PayPal sandbox demo-ready

Status on 2026-10-26: **no sandbox credentials exist on the build machine** (`~/.config/tillwise/paypal-sandbox.env` is missing). So nothing below has run against PayPal yet:
- `sandbox:smoke`, `sandbox:seed` and sandbox mode were only tested offline, against local HTTP stubs (`mcp-server/test/sandboxSeed.test.ts`, `sandboxSmoke.test.ts`, `paypal.test.ts`).
- The only remaining step is credentials: save them, then run the commands in README → "Use the real PayPal sandbox".

Sources were fetched on 2026-10-25/26:
- PayPal's REST OpenAPI specs: https://github.com/paypal/paypal-rest-api-specifications, `main` @ `90e8041ffe` (2026-04-07). Files `openapi/checkout_orders_v2.json` (Orders 2.32), `payments_payment_v2.json` (Payments 2.12), `invoicing_v2.json` (Invoicing 2.6), `reporting_transactions_v1.json` (Transaction Search 1.9).
- developer.paypal.com pages, cited by URL below.

## 1. Hackathon requirement
https://paypalaihackathon.devpost.com/rules:
- "Entrants must build or update an application that integrates the PayPal developer platform (using the free sandbox environment) along with an AI tool, model, or platform of their choice".
- "To access the PayPal sandbox environment, use your existing PayPal account or create a free account at https://developer.paypal.com/".

## 2. Can an order be created AND captured server-side in the sandbox, without a buyer logging in?
**Yes, per the docs, with card data in `payment_source.card` and a sandbox test card. It needs Advanced Credit and Debit Card Payments on the sandbox business account. UNVERIFIED until it really runs.**

1. Orders v2 `POST /v2/checkout/orders` takes `payment_source.card`, a `card_request` with `number`, `expiry`, `security_code`, `name`, `billing_address` (spec `components.schemas.card` / `card_request`).
2. The same operation's `PayPal-Request-Id` header: "It is mandatory for all single-step create order calls (E.g. Create Order Request with payment source information like Card, PayPal.vault_id, PayPal.billing_agreement_id, etc)." "The server stores keys for 6 hours."
3. `POST /v2/checkout/orders/{id}/capture`: "To successfully capture payment for an order, the buyer must first approve the order or a valid payment_source must be provided in the request."
4. The `card_request` description says: "Passing card number, cvv and expiry directly via the API requires PCI SAQ D compliance." We only send PayPal's public sandbox test card, never real card data. The code refuses every host except `api-m.sandbox.paypal.com` (`mcp-server/src/sandboxSeed.ts` `SandboxRest`).
5. Test cards: https://developer.paypal.com/tools/sandbox/card-testing/ (redirects to /credit-card-number-generator), "Test card numbers".
   - That page lists Visa `4012000033330026`, which we use (`SANDBOX_TEST_CARD`).
   - "Use a test card number with a future expiration date and a 3-digit CVV".
   - "Ensure the integration is in sandbox mode, with a sandbox client ID, and connected to `api-m.sandbox.paypal.com` endpoints."
6. Account setup: https://developer.paypal.com/docs/checkout/advanced/integrate/ (redirects to /platforms/checkout/advanced/integrate; "Last updated: October 14, 2026"), "1. Prerequisites":
   > "This integration requires a sandbox business account with Advanced Credit and Debit Card Payments, which should be enabled automatically in your sandbox account. To confirm that Advanced Credit and Debit Card Payments are enabled for you, check your sandbox business account: Log into the PayPal Developer Dashboard, go to Apps & Credentials > Sandbox > REST API apps, and select the name of your app. Go to Features > Accept payments. Select the Advanced Credit and Debit Card Payments checkbox and select Save Changes."
7. Countries and currencies: https://developer.paypal.com/docs/checkout/advanced/eligibility/ (→ /expanded/eligibility, "Last updated: August 17, 2026"). "Expanded Checkout payments are available for 37 countries and 22 currencies". Ireland (IE) and the US list EUR among their currencies.
   - If the judge's sandbox business account is in a country or currency that is not supported, use `npm run sandbox:seed -- --currency USD`.
8. Error names (https://developer.paypal.com/api/rest/reference/orders/v2/errors/ → /api/orders/v2/error-messages):
   - "PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING : Payee account is not setup to be able to process card payments."
   - "DUPLICATE_INVOICE_ID : Duplicate Invoice ID detected."
   - "ORDER_ALREADY_CAPTURED : Order already captured."
   - "CARD_TYPE_NOT_SUPPORTED", "CURRENCY_NOT_SUPPORTED_FOR_CARD_TYPE".

**Fallback (implemented and stub-tested; not real-run).** If card processing is not available, `sandbox:seed` handles it as follows:
- On `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`, `CARD_TYPE_NOT_SUPPORTED` or `CURRENCY_NOT_SUPPORTED_FOR_CARD_TYPE`, it creates buyer-approval orders (`payment_source.paypal.experience_context`, `user_action: PAY_NOW`).
- It prints each `payer-action` link.
- The judge opens each link and logs in with the sandbox **personal** account. Developer Dashboard → Testing Tools → Sandbox Accounts creates one by default; this location is UNVERIFIED.
- Re-running `npm run sandbox:seed` then sees `APPROVED` and captures (`POST …/capture` with a fixed `PayPal-Request-Id`).

## 3. Idempotency and tags (no duplicates on rerun)
- Orders: `purchase_units[].invoice_id` is set to the tag (`TW-DEMO-CAP-01..03`, `TW-DEMO-WOO-<order>-<cents>`). Spec: "invoice_id values are required to be unique within each merchant account by default."
  - A rerun without the local manifest therefore gets `DUPLICATE_INVOICE_ID`.
  - We report that as "already exists", not as a failure.
- `custom_id` = `tillwise-demo;seg=…;cust=…;prod=…`. Spec: "Appears in transaction and settlement reports but is not visible to the payer". Transaction Search returns it as `custom_field`, so the sandbox ledger can show segment, customer and product (`mcp-server/src/paypal/seedTags.ts`).
- `PayPal-Request-Id` = `tillwise-seed-<sha256(client id)[:10]>-<tag>-<step>`. The app id itself is never sent in the header or printed.
- Manifest `~/.config/tillwise/paypal-sandbox-seed.json` (mode 600, ids only, no secrets).
  - On rerun, each known order is checked with `GET /v2/checkout/orders/{id}`.
  - COMPLETED → "already captured"; APPROVED → capture; otherwise the approve link is printed again.
- Invoice: `POST /v2/invoicing/search-invoices` with `invoice_number` ("Filters the search by the invoice number") finds `TW-DEMO-INV-01` before anything is created. `invoice_number` max length is 25 (spec).

## 4. Invoice
- `POST /v2/invoicing/invoices`: "Creates a draft invoice. To move the invoice from a draft to payable state, you must send the invoice."
- `POST /v2/invoicing/invoices/{id}/send`: "To send the invoice through a share link and not through PayPal, set the send_to_recipient parameter to false". The seed sends `{send_to_recipient:false, send_to_invoicer:false}`, so PayPal emails nobody. This is a single payable invoice for the "who still owes" view. It is **not** a reminder or dunning feature: `/remind` is never called.

## 5. Reading it back (sandbox mode of the MCP server)
1. Transaction Search `GET /v1/reporting/transactions`:
   - "It takes a maximum of three hours for executed transactions to appear in the list transactions call."
   - end_date: "The maximum supported range is 31 days." So `PayPalService.sandboxLedger` now queries in ≤31-day chunks.
   - `page_size` maximum is 500.
2. T-codes (https://developer.paypal.com/docs/transaction-search/transaction-event-codes/ → /reports/reference/t-codes):
   - "T0005 Credit card payment" and "T0006 Express Checkout payment" are read as captures;
   - "T1107 Payment refund" is read as a refund, joined to its capture through `paypal_reference_id`.
   - UNVERIFIED: which of T0005/T0006 a card capture made through Orders v2 gets in the sandbox.
3. Bug fixed while preparing this: `@paypal/paypal-server-sdk` returns camelCase models (`transactionInfo.transactionId`). The old code read snake_case and would have seen no data. `normalizeTransaction` in `liveClient.ts` maps them, and `paypal.test.ts` covers it.
4. Invoices: `GET /v2/invoicing/invoices` ("Lists invoices") → `LivePayPalClient.listInvoices`.
5. Disputes: `GET /v1/customer/disputes` (existing). The seed does **not** create disputes. A merchant API cannot open a dispute; a buyer opens it, so sandbox disputes would have to be opened from a sandbox buyer account (procedure UNVERIFIED).
6. Refunds (voice flow, existing): `POST /v2/payments/captures/{capture_id}/refund`. "For a full refund, include an empty payload in the JSON request body. For a partial refund, include an amount object".

## 6. What runs live against the sandbox, and what stays on the mock ledger
Mode switch (`mcp-server/src/paypal/service.ts` `fromEnv`):
- `PAYPAL_MODE=sandbox`, or automatic when the credentials file exists;
- `PAYPAL_MODE=mock` forces mock.

| Feature | Mock mode (default) | Sandbox mode |
| --- | --- | --- |
| Voice flow: refund / invoice / tracking / dispute accept (preview → confirm → apply) | Mock client, audited | **Live** PayPal sandbox calls, audited. "Refund order N" needs a real capture linked to that Woo order: `npm run sandbox:seed -- --link-woo N` |
| Money Desk captures, revenue by segment, refund grid | `mockLedger.ts` (~45 days, 3 segments) | **Live** Transaction Search. Segment/customer/product come only for seed-tagged rows; others show "Unknown"; up to 3 h delay |
| "Who still owes" scoreboard | mock invoices | **Live** Invoicing v2 list (e.g. `TW-DEMO-INV-01`) |
| Dispute countdown | mock disputes | **Live** Disputes v1; empty unless a sandbox buyer opened one |
| Refund-rate tile, `paypal_refund_anomaly`, "Why are refunds spiking?" | The causal spike story ("damaged in transit" mugs) exists **only** in the mock ledger | Computed from the live sandbox ledger. It has no refund reasons (Transaction Search has none), so by-reason splits are empty, and there is no spike unless one is created |
| Tracking rows | mock | not listed (empty) |

The Money Desk header labels this as `mock ledger (demo data, not PayPal)` or `live PayPal sandbox` (`alexa-sim/public/money-desk.js`). The ledger's `notes` appear as the tooltip.

## 7. UNVERIFIED (needs one real run with credentials)
1. Whether a single-step card order in the sandbox returns `COMPLETED` directly or needs `/capture`. Both paths are handled.
2. Whether `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING` is the exact issue name a non-ACDC sandbox account returns, so that the fallback triggers.
3. Whether Invoicing accepts the `example.test` recipient email when `send_to_recipient:false`.
4. The T-code of sandbox card captures, and how long Transaction Search really lags in the sandbox.
5. That `npm run sandbox:smoke` passes 6/6. It has never run against PayPal.
6. 3D Secure: the eligibility page says "If you are based in Europe, you may be subject to the Second Payment Services Directive (PSD2): Include 3D Secure as part of your integration."
   - An EU-based sandbox business account might return `PAYER_ACTION_REQUIRED` for card orders.
   - The seed then prints the `payer-action` link and treats the order as pending, as in the fallback.
   - A US sandbox business account avoids this.
