# Tillwise × PayPal — Phase A feasibility and design

## Evidence baseline

- Hackathon requirements are treated as already verified in `/Users/shiyx/.copilot/session-state/a5f98933-0ac2-4012-8b8b-91ed009d4889/files/paypal-phaseA.md`: PayPal sandbox + AI are required, PayPal integration must be central, an existing project must be significantly updated after Oct 1, the repo must be public GitHub with detectable OSS license, the video must be public YouTube and under 3 minutes, judges must be able to run the project, and criteria are equally weighted.
- The isolated clone is configured for side-by-side execution: `docker-compose.yml:1` is `name: tillwise-paypal`, `docker-compose.yml:25` maps WordPress to `127.0.0.1:8098:80`, `mcp-server/src/server.ts:66-67` defaults to MCP port `3338` and WordPress `8098`, and `alexa-sim/src/server.ts:50` defaults to simulator port `4179`.

## PayPal AI tooling facts

### Authentication and environments

- `@paypal/mcp` authenticates with an access token, not client credentials: its README command is `npx -y @paypal/mcp --tools=all PAYPAL_ACCESS_TOKEN="YOUR_ACCESS_TOKEN" PAYPAL_ENVIRONMENT="SANDBOX"` and says “Replace `YOUR_ACCESS_TOKEN` with your PayPal access token” (`node_modules/@paypal/mcp/README.md:6-12`). Its CLI parser accepts only `access-token`, `tools`, and `paypal-environment` (`node_modules/@paypal/mcp/dist/index.js:9`) and reads `options.accessToken || process.env.PAYPAL_ACCESS_TOKEN` (`node_modules/@paypal/mcp/dist/index.js:48-52,118-120`).
- `@paypal/agent-toolkit` can use client credentials or a supplied access token. Its README says “configured with your account's client id and secret” and shows `clientId: process.env.PAYPAL_CLIENT_ID` / `clientSecret: process.env.PAYPAL_CLIENT_SECRET` (`node_modules/@paypal/agent-toolkit/README.md:90-100`). Its client stores `clientId`, `clientSecret`, and `accessToken` (`node_modules/@paypal/agent-toolkit/openai/index.js:2081-2088`), creates the official SDK client with `oAuthClientId` and `oAuthClientSecret` (`node_modules/@paypal/agent-toolkit/openai/index.js:2095-2102`), and obtains a token by POSTing `grant_type=client_credentials` to `/v1/oauth2/token` with Basic auth (`node_modules/@paypal/agent-toolkit/openai/index.js:2118-2133`).
- PayPal REST docs confirm the OAuth flow: “exchange your client ID and client secret for an access token”; cURL posts to `https://api-m.sandbox.paypal.com/v1/oauth2/token` with `grant_type=client_credentials`; expired tokens require calling `/v1/oauth2/token` again (https://developer.paypal.com/api/rest/authentication/).
- The toolkit chooses fixed PayPal hosts. Agent Toolkit sets `_baseUrl` to `https://api.sandbox.paypal.com` or `https://api.paypal.com` (`node_modules/@paypal/agent-toolkit/openai/index.js:2091-2093`). The bundled API client uses `https://api-m.sandbox.paypal.com` or `https://api-m.paypal.com` (`node_modules/@paypal/agent-toolkit/openai/index.js:2182`). PayPal Server SDK maps Sandbox/Production to `https://api-m.sandbox.paypal.com` / `https://api-m.paypal.com` and throws on other environments (`node_modules/@paypal/paypal-server-sdk/src/client.ts:142-153`). Therefore neither package exposes a documented base URL override for a local mock.
- Node 26 compatibility is feasible because `@paypal/mcp` declares `"node": ">=18"` (`node_modules/@paypal/mcp/package.json:22-24`) and `npx @paypal/mcp --help` executed under Node 26, returning a parser error rather than a runtime incompatibility: `Invalid argument: help. Accepted arguments are: access-token, tools, paypal-environment`.

### Tool allow-list and schemas

- `@paypal/mcp` supports a tool allow-list. The accepted `--tools` values are `invoices.create`, `invoices.list`, `invoices.get`, `invoices.send`, `invoices.sendReminder`, `invoices.cancel`, `invoices.generateQRC`, `orders.create`, `orders.get`, `orders.capture`, `disputes.list`, `disputes.get`, `disputes.create`, `shipment.create`, `shipment.get`, `products.create`, `products.list`, `products.update`, `products.show`, `subscriptionPlans.create`, `subscriptionPlans.list`, `subscriptionPlans.show`, `subscriptions.create`, `subscriptions.show`, `subscriptions.cancel`, `transactions.list`, `payments.createRefund`, and `payments.getRefunds` (`node_modules/@paypal/mcp/dist/index.js:10-39`). A live parser probe confirmed the error text: `Invalid tool: create_refund. Accepted tools are: ... payments.createRefund ...`.
- Agent Toolkit exposes the required candidate tools except `get_merchant_insights` is toolkit-only, not listed by `@paypal/mcp` README. Evidence: MCP README lists `create_order`, `pay_order`, `create_refund`, `list_disputes`, `get_dispute`, `accept_dispute_claim`, `create_shipment_tracking`, and `list_transactions` (`node_modules/@paypal/mcp/README.md:78-119`). Agent Toolkit README additionally lists `get_merchant_insights` (`node_modules/@paypal/agent-toolkit/README.md:72-73`). Source maps these methods to implementations (`node_modules/@paypal/agent-toolkit/openai/index.js:2282-2298`) and registers actions (`node_modules/@paypal/agent-toolkit/openai/index.js:3014-3021,3047-3119,3134-3160`).
- Generated JSON schema facts from the installed `@paypal/agent-toolkit@1.11.0` package are stored at `/Users/shiyx/.copilot/session-state/a5f98933-0ac2-4012-8b8b-91ed009d4889/files/paypal-probe/paypal-tool-schemas.txt`: `create_refund` requires `capture_id` and optionally `amount` and `note_to_payer` (lines 1-35); `list_disputes` accepts `disputed_transaction_id`, `dispute_state`, `page_size`, `page` (lines 65-98); `get_dispute` requires `dispute_id` (lines 129-140); `accept_dispute_claim` requires `dispute_id` and `note` (lines 141-170); `create_invoice` creates a draft invoice and requires `currency_code`, `primary_recipients`, and `items` (lines 171-183, 535-583); `send_invoice` requires `invoice_id` (lines 588-625); `create_shipment_tracking` requires `tracking_number`, `transaction_id`, and default `status=SHIPPED` (lines 629-681); `list_transactions` has a 31-day date range and optional transaction filters (lines 683-760); `get_merchant_insights` requires `start_date`, `end_date`, `insight_type`, `time_interval` (lines 767-805); `create_order` requires `currencyCode` and `items` (lines 832-949); `pay_order` requires order `id` (lines 955-980).

### Sandbox data seeding facts

- Orders: Orders v2 has `/v2/checkout/orders` with `operationId: orders.create` (`openapi/checkout_orders_v2.json:32-35`). Capturing a wallet order can require payer action; the capture error example says issue `PAYER_ACTION_REQUIRED` and description “Transaction cannot complete successfully, instruct the buyer to return to PayPal,” with a `payer-action` checkout link (`openapi/checkout_orders_v2.json:2674-2695`). Therefore a no-browser paid-order seed path is **not guaranteed** for ordinary wallet orders. A no-browser path may exist only for payment-source flows such as vaulted wallet/card scenarios, but that requires sandbox account/app capability; Phase A did not verify a complete browserless card capture.
- Refunds: Payments v2 says the Payments API can “refund payments that have already been captured” (`openapi/payments_payment_v2.json:5`) and `/captures` is used to “show details for and refund a captured payment” (`openapi/payments_payment_v2.json:28-29`). Refund examples state “For a full refund, include an empty payload… For a partial refund, include an `amount` object” (`openapi/payments_payment_v2.json:1716-1748`).
- Invoices: Invoicing v2 “create[s], send[s], and manage[s] invoices” and customers can pay by PayPal or guest card (`openapi/invoicing_v2.json:5`). Creating an invoice creates a draft and “To move the invoice from a draft to payable state, you must send the invoice” (`openapi/invoicing_v2.json:97-104`). Sending uses `/v2/invoicing/invoices/{invoice_id}/send` and “sends the invoice immediately” for current/past issue dates (`openapi/invoicing_v2.json:337-345`). The invoice payment detail schema includes `payment_id` “Required for the `PAYPAL` payment type” and payment method (`openapi/invoicing_v2.json:6341-6365`), supporting API-side manual/external payment recording but not proving real PayPal settlement without a payer.
- Shipment tracking: the tracking API says `/trackers` creates and manages tracking for PayPal transactions (`openapi/shipping_shipment_tracking_v1.json:21-22`). The legacy batch endpoint accepts tracking info for PayPal transactions but is deprecated in favor of Orders v2 tracking integration (`openapi/shipping_shipment_tracking_v1.json:61-66`). A tracker requires `transaction_id` and `status` (`openapi/shipping_shipment_tracking_v1.json:5111`) and `tracking_number` requires `carrier` (`openapi/shipping_shipment_tracking_v1.json:343-348,4986-4997`).
- Disputes: the API description says merchants cannot create disputes in live but “can create disputes in the sandbox environment,” and “Normally, an agent at PayPal creates a dispute… but now you can run test cases in the sandbox” (`openapi/customer_disputes_v1.json:5`). It also says the create/cancel/compute/change/validate methods are “limited-release” (`openapi/customer_disputes_v1.json:5`). Listing disputes is `/v1/customer/disputes` / `disputes.list` (`openapi/customer_disputes_v1.json:77-84`), and accepting a claim is `/v1/customer/disputes/{id}/accept-claim` / `disputes.accept-claim` (`openapi/customer_disputes_v1.json:431-438`). The required create-dispute OAuth scope is `https://uri.paypal.com/services/disputes/create` (`openapi/customer_disputes_v1.json:1437-1444`).
- Transaction search: `/v1/reporting/transactions` lists transactions and the spec notes, “It takes a maximum of three hours for executed transactions to appear in the list transactions call” (`openapi/reporting_transactions_v1.json:37-42`). Sandbox live tests must tolerate that latency.

### Idempotency facts

- Orders v2 `PayPal-Request-Id`: “The server stores keys for 6 hours. The API callers can request the times to up to 72 hours by speaking to their Account Manager. It is mandatory for all single-step create order calls…” (`openapi/checkout_orders_v2.json:50-53`).
- Payments refund idempotency: the refund spec example says an “Idempotent refund request” using the same `PayPal-Request-Id` returns “200 OK response with the existing refund details” (`openapi/payments_payment_v2.json:1660-1715`).
- Agent Toolkit propagates idempotency if `context.request_id` is set: `headers["PayPal-Request-Id"] = this._context.request_id` (`node_modules/@paypal/agent-toolkit/openai/index.js:2146-2155` observed in package source).

### AG Grid facts

- `ag-grid-community@36.2.0` is MIT-licensed (`node_modules/ag-grid-community/package.json:1-6,80-83`). Its license says permission is granted “free of charge” to use, copy, modify, publish, distribute, sublicense, and/or sell copies, provided the copyright and permission notice are included (`node_modules/ag-grid-community/LICENSE.txt:1-11`).
- AG Grid’s pricing page lists “AG Grid Community | Free” and feature comparison says “Perpetual License: ✗ (MIT license)” for Community (https://www.ag-grid.com/license-pricing/).
- The AG Grid sponsor blog says AG Grid and Bryntum are partners “with our own prize categories,” and the prize is “Best Use of AG Studio: $5,000 for 1st, $2,000 for 2nd, $1,000 each for three more” (https://www.ag-grid.com/blog/hackathon-paypal-and-ag-studio/). It suggests dashboards, agents that build dashboards, data visualizations, and analytics with PayPal + AI.

## Architecture decision

**Decision:** implement PayPal tools in our own MCP server, backed by a `PayPalClient` interface with two adapters: `MockPayPalClient` for default judge/offline mode and `LivePayPalClient` for sandbox when `~/.config/tillwise/paypal-sandbox.env` exists. Use PayPal OpenAPI shapes and PayPal/Agent Toolkit tool names, not `@paypal/mcp` as a second MCP server in Phase B.

**Evidence and rationale:**

1. The existing simulator already gates MCP tools through Copilot SDK permission requests: only Tillwise MCP tools are allowed (`alexa-sim/src/permissionGate.ts:80-83`), human-gated tools wait on `ConfirmationBroker` (`alexa-sim/src/permissionGate.ts:22-31,86-94`), and the Copilot session attaches the local MCP server with `tools: ['*']` (`alexa-sim/src/copilotAgent.ts:149-154`).
2. `@paypal/mcp` takes an access token and fixed PayPal environment, has no documented local mock base URL, and would expose its own external MCP server (`node_modules/@paypal/mcp/README.md:6-12,121-126`; `node_modules/@paypal/mcp/dist/index.js:118-125`). Wrapping it through our own MCP server preserves the proven gate and lets offline tests run with no PayPal credentials.
3. PayPal Server SDK and Agent Toolkit hardcode PayPal production/sandbox base URLs (`node_modules/@paypal/paypal-server-sdk/src/client.ts:142-153`; `node_modules/@paypal/agent-toolkit/openai/index.js:2091-2093`). A local mock therefore requires our own transport layer or dependency injection.
4. The hackathon judges require a working build from repo instructions; mock mode avoids depending on the user or judges having PayPal credentials while sandbox mode still demonstrates real PayPal Developer Platform calls.

## Proposed components

```text
alexa-sim (voice/text UI + AG Grid money desk)
  -> Copilot SDK session with existing permission gate
  -> mcp-server PayPal tools over Streamable HTTP
  -> PayPal service layer
       MockPayPalClient (default, deterministic JSON fixtures following OpenAPI paths)
       LivePayPalClient (enabled only by ~/.config/tillwise/paypal-sandbox.env)
  -> WooCommerce WordPress plugin stores PayPal links/audit rows on Woo orders
```

### Woo order ↔ PayPal object linking

- Add order meta keys: `_tillwise_paypal_order_id`, `_tillwise_paypal_capture_id`, `_tillwise_paypal_refund_ids`, `_tillwise_paypal_invoice_id`, `_tillwise_paypal_tracking_ids`, `_tillwise_paypal_idempotency_keys`.
- Use `custom_id`/`invoice_id` in PayPal order/capture/refund requests where available because PayPal capture examples include `invoice_id` and `custom_id` in capture objects (`openapi/checkout_orders_v2.json:2446-2495`).
- Every mutation writes a local audit row: `tool`, `woo_order_id`, PayPal object IDs, amount, currency, idempotency key, preview hash, confirmer, timestamp, result, and reversal/undo pointer.

## Tool set, gates, caps, idempotency

| Tool | Default mode | Gate | Cap/idempotency |
|---|---|---|---|
| `paypal_money_briefing` | Woo sales + PayPal txns/invoices/disputes | auto | read-only; transaction search may lag up to 3 hours (`reporting_transactions_v1.json:40`) |
| `paypal_refund_preview` | Resolve Woo order to capture, compute refundable amount | auto | read-only; refuses missing capture |
| `paypal_refund_apply` | POST refund for capture | human | max €100 and one order per confirmation; `PayPal-Request-Id=tillwise-refund-{order}-{preview}` |
| `paypal_invoice_create_preview` | Draft invoice request | auto | read-only preview |
| `paypal_invoice_create_apply` | Create invoice draft | human | max €2,000; idempotency key `tillwise-invoice-{hash}` |
| `paypal_invoice_send_apply` | Send invoice | human | only unsent invoice IDs from audit log |
| `paypal_tracking_add_apply` | Add tracking for capture/transaction | human | requires transaction/capture id and carrier when tracking number exists (`shipping_shipment_tracking_v1.json:343-348,4986-4997`) |
| `paypal_disputes_list/get` | List and inspect disputes | auto | read-only |
| `paypal_dispute_accept_claim_apply` | Accept claim | human | max one dispute; warning text states PayPal auto-refunds customer because toolkit prompt says accepting liability closes in customer's favor and refunds money (`paypal-tool-schemas.txt:141-145`) |
| `paypal_guardrail_refusal` | Demonstrate refusal | auto | refuses bulk refunds, over-cap refunds, missing order/capture, unapproved mutations |

## Mock strategy

- Mock route shapes mirror the official OpenAPI files cloned from `https://github.com/paypal/paypal-rest-api-specifications`: `checkout_orders_v2.json`, `payments_payment_v2.json`, `invoicing_v2.json`, `customer_disputes_v1.json`, `shipping_shipment_tracking_v1.json`, and `reporting_transactions_v1.json`.
- Default fixture set: one paid Woo order with PayPal capture and refund link, one unpaid invoice, one open dispute, one tracking-eligible capture, and transactions old enough to bypass the 3-hour search latency constraint.
- The mock must validate the same required fields cited above: refund `capture_id`, invoice `currency_code/items/recipients`, shipment `transaction_id/status`, dispute `dispute_id/note`, and order `currencyCode/items`.
- The mock must implement idempotency by storing `PayPal-Request-Id` and returning the original mutation result for repeated keys, matching refund idempotency evidence (`payments_payment_v2.json:1660-1715`).

## AG Grid “money desk”

- Add `ag-grid-community` to `alexa-sim`; render a live “Money Desk” grid showing PayPal transactions, refunds, invoices, disputes, and tracking records touched by the agent.
- Use Community features only: row sorting/filtering/selection are listed as Community-supported on AG Grid’s pricing page; license is MIT (`ag-grid-community/LICENSE.txt:1-11`).
- Prize fit: AG Grid sponsor blog encourages “dashboards with custom widgets,” “data visualizations,” and “quirky analytics” in PayPal + AI projects (https://www.ag-grid.com/blog/hackathon-paypal-and-ag-studio/).

## Demo script under 3 minutes

1. Owner asks: “Give me my morning money briefing.” Agent summarizes Woo sales, PayPal transactions, unpaid invoices, and disputes; AG Grid Money Desk updates. Targets PayPal+AI, Design, Potential Impact, AG Grid.
2. Owner asks: “Refund order 1006 because the candle arrived broken.” Agent previews capture, amount, and Woo link; no money moves yet. Targets safety and Technological Implementation.
3. Owner says “yes.” Gate confirms; refund posts with idempotency key; Woo order note/audit and Money Desk update. Targets Agentic Commerce and PayPal centrality.
4. Owner asks: “Invoice Brew & Co for 12 mugs.” Agent creates draft invoice, previews recipient/items/amount, asks confirmation, then sends. Targets Business Solutions and PayPal+AI.
5. Owner asks: “Add UPS tracking to today’s gift box order.” Agent adds tracking to the PayPal transaction/capture. Targets seller-protection usefulness.
6. Owner asks: “Refund every order from this week.” Agent refuses due bulk/over-cap guardrail and explains the safer one-order flow. Targets safety, Presentation, real product coherence.

## Judge run instructions

### Mock mode, no credentials

```bash
docker compose up -d
./scripts/seed-local.sh
./scripts/demo-reset.sh
cd mcp-server && npm ci && npm test
cd ../alexa-sim && npm ci && npm test
# run mcp-server and alexa-sim with defaults: WP 8098, MCP 3338, simulator 4179
```

### Sandbox mode, judge-owned credentials

- Create `~/.config/tillwise/paypal-sandbox.env` with `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` only. Do not commit it.
- The app obtains an access token via PayPal OAuth; PayPal docs say to POST to `https://api-m.sandbox.paypal.com/v1/oauth2/token` with Basic Auth `CLIENT_ID:CLIENT_SECRET` and `grant_type=client_credentials` (https://developer.paypal.com/api/rest/authentication/).
- User credential steps: PayPal MCP README says go to PayPal Developer Dashboard, sign up/log in, click **Apps & Credentials**, switch between **Sandbox** and **Live**, create/view an app, and retrieve Client ID/Client Secret (`node_modules/@paypal/mcp/README.md:133-158`).
- The app never prints secrets; it reports only whether sandbox mode is enabled and which PayPal environment is selected.

## Test plan

- Offline unit tests: PayPal mock validates official shapes, idempotency, caps, and guardrail refusals.
- Existing baselines remain green: PHP integration, MCP server tests, simulator offline tests.
- MCP integration test: preview/apply refund through our MCP server against mock, assert Woo order meta/audit and Money Desk event.
- Simulator permission test: PayPal mutation tools require confirmation, read-only PayPal tools auto-approve, unknown PayPal tools reject.
- Opt-in live sandbox E2E: create draft invoice and send it; create order and inspect payer-action/capture behavior; refund only a seeded sandbox capture if one exists; list disputes if scope enabled; tolerate transaction-search delay up to 3 hours.

## Phase B estimate

- PayPal mock + live client skeleton and env loading: 4h.
- WordPress order meta/audit endpoints: 4h.
- MCP PayPal tools with previews/gates/caps/idempotency: 10h.
- AG Grid Money Desk in simulator: 4h.
- Offline tests and docs: 6h.
- Opt-in live sandbox hardening after user creates credentials: 4h.
- Demo script polish: 2h.

Total: 34h engineering time, with user effort limited to PayPal sandbox credential creation and final Devpost submission/video approval.

## Risks and open questions

- Browserless paid-order seeding is UNVERIFIED. OpenAPI shows capture can return `PAYER_ACTION_REQUIRED`; a real no-browser card/vault capture path depends on sandbox account/app capabilities not verified in Phase A.
- Dispute creation is sandbox-capable but limited-release per OpenAPI; live demo should include mock disputes and treat real sandbox disputes as optional unless the user's app has the disputes-create scope.
- `get_merchant_insights` is unsupported in sandbox according to Agent Toolkit source (`executeMethod` throws when `method === "get_merchant_insights" && sandbox === true` observed in `node_modules/@paypal/agent-toolkit/openai/index.js:2208-2209`), so the briefing should use transactions/invoices/disputes in sandbox and mark merchant insights live-only/production-only unless PayPal documents a sandbox path.
- Transaction search can lag up to 3 hours, so live sandbox tests cannot depend on immediately created captures appearing in reports.
- `@paypal/mcp` is not directly mockable and requires access tokens; using our own MCP wrapper is safer for judge reproducibility but may be viewed as less “official AI tooling” than direct @paypal/mcp usage. Mitigation: align names/schemas with Agent Toolkit and document why gating/mockability required the wrapper.
