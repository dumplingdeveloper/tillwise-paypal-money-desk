# Facts: the real PayPal sandbox (verified on 2026-10-26)

Status on 2026-10-26: **these facts come from real runs against `api-m.sandbox.paypal.com`.**
- Credentials: **PayPal's public default sandbox credential set**. It is published as the collection variables `client_id` / `client_secret` in PayPal's official Postman collections: https://github.com/paypal/postman-collections, files `Collections/PayPal_Public_APIs.json` and `PayPal_Checkout_Flows.json`, repo HEAD `7f7240ab2d94`.
  - The collection note says, verbatim: "PayPal Public Collection comes with following default public set of credentials stored at the Collection level. You may choose to override these values via environment level variables. You may bring your own credentials from PayPal Developer Dashboard there."
  - The token's `app_id` is `APP-80W284485P519543T`.
  - This is a **shared** app: everything we create is visible to every other user of these credentials, and theirs to us. The values are stored only in `~/.config/tillwise/paypal-sandbox.env` (mode 600). They are never in this repo or in any log.
- Runs (UTC):
  - `npm run sandbox:smoke`: 13:31 (5/6) and 13:35 (6/6).
  - `npm run sandbox:seed`: 13:36 (6/6, run tag `FWFMVM`).
  - The opt-in voice test `LIVE_PAYPAL=1` (`alexa-sim/test/sandboxLive.test.ts`) passed at 14:16. An earlier run at 14:07 also made a real refund, but hung in teardown; that is fixed now.
  - Probes for this document, all ≤ 5 calls each, are listed in §8.
- Evidence written by the scripts and the test:
  - `docs/evidence/paypal-sandbox-smoke.json`;
  - `paypal-sandbox-seed.json`;
  - `paypal-sandbox-voice-refund.json`;
  - screenshots in `alexa-sim/screenshots/sandbox/`.

Sources were fetched on 2026-10-25/26:
- PayPal's REST OpenAPI specs: https://github.com/paypal/paypal-rest-api-specifications, `main` @ `90e8041ffe` (2026-04-07). Files `openapi/checkout_orders_v2.json` (Orders 2.32), `payments_payment_v2.json` (Payments 2.12), `invoicing_v2.json` (Invoicing 2.6), `reporting_transactions_v1.json` (Transaction Search 1.9).
- developer.paypal.com pages, cited by URL below.
- PayPal's Postman collections (above). They are the source for the request payload shapes:
  - `PayPal_Checkout_Flows.json` → "Expanded Checkout - Save Payment Methods / Save During Purchase / Vault at checkout, Payment Source: Card Non-3DS / Create order with Card" (`POST {{base_url}}/v2/checkout/orders` with `payment_source.card` number/expiry/name/billing_address and a `PayPal-Request-Id` header). The seed sends the same shape without the vault attributes.
  - "… Payment Source: Card - 3DS / Create order with Card 3DS" adds `attributes.verification.method: "SCA_ALWAYS"`.
  - "PayPal + Expanded Checkout / Confirm Payment Source - 3DS" is `POST /v2/checkout/orders/:order_id/confirm-payment-source`.

## 1. Hackathon requirement
https://paypalaihackathon.devpost.com/rules:
- "Entrants must build or update an application that integrates the PayPal developer platform (using the free sandbox environment) along with an AI tool, model, or platform of their choice".
- "To access the PayPal sandbox environment, use your existing PayPal account or create a free account at https://developer.paypal.com/".

## 2. Can an order be created AND captured server-side in the sandbox, without a buyer logging in?
**Yes, verified.** A single `POST /v2/checkout/orders` with `intent: "CAPTURE"`, `payment_source.card` (PayPal's sandbox test card) and a `PayPal-Request-Id` returns the order already **`COMPLETED`**, with the capture inside it. No buyer login, no approval link and no separate `/capture` call are needed. PayPal's default public sandbox app has card processing enabled.

Real response fields: one seed capture read back with `GET /v2/checkout/orders/0Y395785TC754713M`.
- order `status: "COMPLETED"`, `intent: "CAPTURE"`.
- `payment_source.card`:
  - `name: "Tillwise Demo Buyer"`, `last_digits: "0026"`, `brand: "VISA"`, `type: "CREDIT"`;
  - `bin_details.bin: "401200"`, `bin_country_code: "US"`.
- No `authentication_result`: with no `attributes.verification`, no 3-D Secure was triggered.
- capture:
  - `status: "COMPLETED"` (after the seeded partial refund: `"PARTIALLY_REFUNDED"`), `final_capture: true`;
  - `seller_protection.status: "NOT_ELIGIBLE"`;
  - `processor_response.response_code: "0000"`, `cvv_code: "M"`;
  - a `network_transaction_reference` is present.
- Fees: `seller_receivable_breakdown` is gross `24.00` / `paypal_fee` `1.37` / net `22.63` EUR. The other captures showed €64.50 → fee €3.03, €18.00 → €1.13, €14.90 → €1.00, €31.00 → €1.66.
- The order `GET` also embeds `purchase_units[].payments.refunds`. That is how Tillwise reads its own activity without Transaction Search (§5).
- `payee.email_address` is on `example.com`.

**3-D Secure, probed.** The same card with `attributes.verification.method: "SCA_ALWAYS"` (the Postman "Create order with Card 3DS" shape; tag `TW-DEMO-FWFMVM-3DS-01`, €5.00) returned:
- HTTP `201`, `status: "PAYER_ACTION_REQUIRED"`;
- links `self` and `payer-action`, the latter on `www.sandbox.paypal.com`;
- no capture and no `authentication_result`.

So 3DS needs a browser step. Tillwise never requests SCA, so the demo stays server-side. The probe order was left uncaptured; unapproved orders are not money movements.

Docs that still apply:
1. The `PayPal-Request-Id` header: "It is mandatory for all single-step create order calls (E.g. Create Order Request with payment source information like Card, PayPal.vault_id, PayPal.billing_agreement_id, etc)." "The server stores keys for 6 hours."
2. The `card_request` description: "Passing card number, cvv and expiry directly via the API requires PCI SAQ D compliance."
   - We only send PayPal's sandbox test card `4012000033330026`, never real card data.
   - The test card comes from https://developer.paypal.com/tools/sandbox/card-testing/ "Test card numbers": "Use a test card number with a future expiration date and a 3-digit CVV".
   - `SandboxRest` refuses every host except `api-m.sandbox.paypal.com`.
3. On a judge's **own** app, the prerequisites at https://developer.paypal.com/docs/checkout/advanced/integrate/ ("1. Prerequisites") apply: "This integration requires a sandbox business account with Advanced Credit and Debit Card Payments, which should be enabled automatically in your sandbox account." If it is not enabled, the fallback is as follows (stub-tested; not needed on the public app):
   - on `PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING`, `CARD_TYPE_NOT_SUPPORTED` or `CURRENCY_NOT_SUPPORTED_FOR_CARD_TYPE`, the seed creates buyer-approval orders and prints each `payer-action` link;
   - after approval, a rerun captures.
4. Error names (https://developer.paypal.com/api/orders/v2/error-messages): "DUPLICATE_INVOICE_ID : Duplicate Invoice ID detected." and "ORDER_ALREADY_CAPTURED : Order already captured." The seed treats both as "already exists".

## 3. Idempotency and tags (no duplicates on rerun, and visible on a shared app)
- Every object carries the tag `TW-DEMO-<RUN>-<KEY>`.
  - `<RUN>` is a per-install run tag: 6 characters from an alphabet without look-alikes, created once and kept in the manifest. This build machine has `FWFMVM`.
  - The key gives the purpose: `CAP-01..03`, `REF-01`, `INV-01`, `WOO-<order>-<cents>`.
  - On a shared app, the run tag keeps two installs from colliding on `invoice_id`.
- Orders: `purchase_units[].invoice_id` holds the tag. Spec: "invoice_id values are required to be unique within each merchant account by default". `custom_id` holds `tillwise-demo;seg=…;cust=…;prod=…`.
- Refunds: if a refund call sends no `custom_id`/`invoice_id`, PayPal copies the capture's.
  - The voice refund `329244097E559043K` came back with `custom_id: "tillwise-demo;seg=Retail;cust=Woo order 472;prod=Thank You Gift Box"` and `invoice_id: "TW-DEMO-FWFMVM-WOO-472-3100"`.
  - The seeded partial refund sends its own `custom_id` (`TW-DEMO-FWFMVM-REF-01`).
- `PayPal-Request-Id` = `tillwise-seed-<sha256(client id)[:10]>-<tag>-<step>`.
- Manifest: `~/.config/tillwise/paypal-sandbox-seed.json` (mode 600, ids only).
  - A rerun reads each known order back (`GET /v2/checkout/orders/{id}`) and creates nothing new.
  - The 14:16 seed rerun reported "already captured" / "already refunded" / "already exists" for all 5 base objects.
- Invoice: `POST /v2/invoicing/search-invoices` with `invoice_number` finds `TW-DEMO-FWFMVM-INV-01` before anything is created.

## 4. Invoice
- Created as a draft, then sent with `{send_to_recipient:false, send_to_invoicer:false}`, so PayPal emails nobody. Real status afterwards: **`UNPAID`**. Example: `INV2-R8BR-T37A-MD59-WJ3U`, €180.00, recipient `galway-gift-house@example.com`.
- Invoicing accepted the `example.com` recipient. Our earlier `example.test` placeholder was never tried on the real API.
- `sandbox:smoke` creates a **draft** (`status: "DRAFT"`), reads it back and deletes it, so it leaves nothing behind:
  - drafts `INV2-CVTS-AZG9-JX69-E5RE` (from the 5/6 run) and `INV2-MCC3-SJR9-8C85-WP94` were deleted;
  - `DELETE` is only allowed for drafts.
- `/remind` is never called.

## 5. Reading it back: Transaction Search is impractical on the shared app
Real Transaction Search (`GET /v1/reporting/transactions`) results:
- **Volume.** A 30-day window failed with `RESULTSET_TOO_LARGE` — "Result set size is greater than the maximum limit. Change the filter criteria and try again." [HTTP 400]. Per-window counts:
  - 24 h: `total_items: 377`;
  - 72 h: `total_items: 1219`.

  These are other users' transactions on the same public app. The first event codes seen were `T0002` and `T1503`.
- **Lag.** `last_refreshed_datetime` trailed real time by about 2 hours:
  - `2026-10-26T11:29:59Z` at 13:35Z;
  - `2026-10-26T12:29:59Z` at 14:19Z.

  Our 13:36Z capture `8TY43715XV359243H` was not yet searchable at 14:19Z: `transaction_id` filter, `total_items: 0`. The spec says "It takes a maximum of three hours for executed transactions to appear in the list transactions call." See §8 for the follow-up probe.
- **Start date after the refresh point.** A `start_date` after `last_refreshed_datetime` fails with `INVALID_REQUEST`, "Data for the given start date is not available." [HTTP 404].
- **No tag filter.** The spec's query parameters are `transaction_id`, `transaction_type`, `transaction_status`, `transaction_amount`, `transaction_currency`, `start_date`, `end_date`, `payment_instrument_type`, `store_id`, `terminal_id`, `fields`, `balance_affecting_records_only`, `page_size` and `page`. There is no `invoice_id`/`custom_id` filter, so "our" rows can't be selected on a shared app.

Therefore, in sandbox mode, Tillwise reads **its own objects by id**, from the ids in the seed manifest:
- `GET /v2/checkout/orders/{id}` returns captures and their refunds, including refunds made by the voice flow;
- `GET /v2/invoicing/invoices/{id}`.

The results are cached for 20 s. Implementation: `mcp-server/src/paypal/sandboxActivity.ts`; `paypal_ledger_export` → `sandbox_activity`.

`PAYPAL_LEDGER=sandbox` still selects the Transaction-Search ledger, but it only makes sense on a judge's **own** app (it lists every invoice and dispute on the app).

**Disputes on the shared app.** `GET /v1/customer/disputes` returned 3 disputes (`RESOLVED`, `WAITING_FOR_SELLER_RESPONSE`, `RESOLVED`). All are other users'.
- Tillwise lists or opens a dispute only if one of its `disputed_transactions[].seller_transaction_id` is one of our capture ids.
- `paypal_dispute_get` and the accept preview refuse other disputes (`disputeIsOwned`).
- A merchant API cannot open a dispute, so the Money Desk dispute widget stays on the mock ledger.

**Refunds.** `POST /v2/payments/captures/{id}/refund` returned **`COMPLETED`** at once, with no PENDING phase observed:
- seed partial €6.00, `6CX228346V6118107`: capture → `PARTIALLY_REFUNDED`;
- voice full refunds €14.90 `2LC20649W90418214` and €31.00 `329244097E559043K`: capture → `REFUNDED`.

`seller_payable_breakdown.paypal_fee` is `0.00` on refunds; the capture fee is not returned.
- Each refund has links `self` and `up` (→ the capture).
- `create_time` carries an offset (`"2026-10-26T07:16:03-07:00"`); Tillwise normalises it to UTC.

## 6. What runs live against the sandbox, and what stays on the mock ledger
Mode switch (`mcp-server/src/paypal/service.ts` `fromEnv`):
- `PAYPAL_MODE=sandbox`, or automatic when the credentials file exists;
- `PAYPAL_MODE=mock` forces mock.

In sandbox mode the analytics ledger stays on mock data unless `PAYPAL_LEDGER=sandbox` (own app only).

| Feature | Sandbox mode (`PAYPAL_MODE=sandbox`) | Source label on screen |
| --- | --- | --- |
| Voice "Refund order N" → preview → owner confirms → apply | **Live** `POST /v2/payments/captures/{id}/refund`, audited in WordPress with the PayPal refund id. It needs a real capture linked to that Woo order (`npm run sandbox:seed -- --link-woo N`); otherwise the preview refuses, and never falls back to a mock capture | Voice badge: "PayPal: REAL sandbox · api-m.sandbox.paypal.com · PayPal's public default sandbox app (shared)" |
| Voice invoice create/send, tracking, dispute accept | **Live** calls (same preview → confirm → apply). Dispute accept only works on our own disputes. Not exercised by the opt-in test | same badge |
| Money Desk grid "LIVE PayPal sandbox · objects Tillwise created" | **Live**: seed captures, refunds, invoice and voice refunds, read by id (§5) | the title itself |
| Money Desk KPIs, revenue chart, refund-rate tile, "Who still owes us", dispute countdown, refunds grid | **Mock ledger** (`mockLedger.ts`, ~45 days, 3 segments, the "damaged in transit" mug spike) | every title ends in "· mock data"; header "analytics: mock ledger (demo data, not PayPal)" |
| `paypal_refund_anomaly`, "Why are refunds spiking?" | **Mock ledger** (Transaction Search has no refund reasons and lags ~2 h; the shared app has ~377 foreign transactions per day) | the agent is told to end new titles with "· mock data" or "· live sandbox" |

The opt-in test asserts this via `studioApi.getState()`:
- the live grid is at the top, sorted `created_at desc`;
- every other title ends with " · mock data";
- `ledger.paypal_mode === 'sandbox'`, `ledger.mode === 'mock'`;
- the refund's row is in `sandbox_activity`.

## 7. Being gentle with the shared app
- Fake names only (Aoife Byrne, Cork Office Co, Mugs & Candles Club, Galway Gift House), `@example.com` emails, and the tag `TW-DEMO-FWFMVM-*` on everything.
- Every PayPal request is counted (`mcp-server/src/paypal/callLog.ts`, `TILLWISE_PAYPAL_CALL_LOG`, host `api-m.sandbox.paypal.com` only, no headers or bodies logged). §8 has the count.
- Cleanup:
  - smoke drafts are deleted;
  - the 3DS probe order was never approved;
  - captures and refunds can't be deleted in PayPal;
  - the seed invoice `INV2-R8BR-T37A-MD59-WJ3U` stays `UNPAID` on purpose, as the demo's live invoice.

## 8. Call count and what is still unverified
**PayPal API calls for M4 (2026-10-26), all on the shared public app:**
- 90 calls were logged by `callLog.ts` in the smoke, seed, MCP server and probe processes.
- 4 more calls were made inside the `LIVE_PAYPAL` test process before it logged its own calls (2 runs × OAuth + `GET /v2/payments/refunds/{id}`). That is fixed now.
- Total so far: **94**, against a budget of 250.

By endpoint (logged calls):

| Calls | Endpoint |
| --- | --- |
| 33 | `GET /v2/checkout/orders/{id}` (seed rerun checks + Money Desk activity reads) |
| 17 | `POST /v1/oauth2/token` (one per process) |
| 7 | `GET /v1/reporting/transactions` |
| 7 | `GET /v2/invoicing/invoices/{id}` |
| 6 | `POST /v2/checkout/orders` |
| 5 | `POST /v2/invoicing/search-invoices` |
| 4 | `GET /v1/customer/disputes` |
| 3 | `POST /v2/invoicing/invoices` |
| 3 | `POST /v2/payments/captures/{id}/refund` |
| 2 | `DELETE /v2/invoicing/invoices/{id}` |
| 2 | `GET /v2/payments/refunds/{id}` |
| 1 | `POST /v2/invoicing/invoices/{id}/send` |

**Still unverified:**
1. When our own captures become searchable in Transaction Search, and their T-codes. We only saw them as not yet present ~45 min after capture.
2. Voice-flow invoice create/send, tracking and dispute accept against the real sandbox. They use the same client as the verified refund but were not run live.
3. A sandbox dispute on our own capture. The merchant API can't open one, so it needs a sandbox buyer account; with the public credentials no buyer login exists.
4. Behaviour on a judge's **own** app (option B): ACDC enablement, the card fallback, and `PAYPAL_LEDGER=sandbox` with real Transaction Search data.
