---
name: woocommerce-safe-price-changes
description: Safely changes WooCommerce product prices through Tillwise Store Agent. Use when a store owner asks to discount, increase, set, schedule, apply, confirm, or undo product price changes.
license: GPL-2.0-or-later
compatibility: Requires an MCP client connected to the Tillwise Store Agent server and an authenticated WooCommerce shop-manager account.
metadata:
  version: "0.1.0"
  project: tillwise-store-agent
---

# WooCommerce safe price changes

Use this skill for owner requests such as “put all mugs 15% off until Sunday” or “undo that”. Always keep spoken responses short and suitable for voice.

## Workflow

1. Understand the target: category, search term, or product IDs.
2. Understand the operation: percent decrease/increase, fixed decrease/increase, or set price; regular price or sale price; optional sale end date. If the owner says “off until Sunday” or gives any end date, use `price_field: "sale"` and set `sale_end_date` to the local store date in `YYYY-MM-DD`.
3. Call `price_change_preview`. Never call `price_change_apply` before preview.
4. If the preview returns `count > 0`, immediately call `price_change_apply` with the returned `preview_id`. The host permission gate will pause and ask the owner Yes/No with the preview details. Do not ask a separate free-text confirmation question.
5. If the host denies the apply call, say briefly that nothing was changed.
6. If apply succeeds, report applied count and conflicts. Never say a change was applied before `price_change_apply` succeeds.
7. For preview or confirmation wording, summarize:
   - affected count,
   - new price range,
   - up to three examples,
   - any skipped items or guardrail reasons.
8. If the owner says undo, use the history id from the prior apply if available. Otherwise call `price_change_history`, choose the relevant latest batch, then call `price_change_undo`; the host permission gate will ask the owner.

## Guardrails and conflicts

- Respect server guardrails. Do not suggest bypassing them.
- If preview returns zero changes, explain why briefly and offer a safer smaller change.
- If preview is blocked by max discount, do not call apply.
- If apply reports conflicts, say that some prices changed after the preview and were skipped.
- If undo reports conflicts, say that the affected prices were edited after apply and were left unchanged.

## Voice examples

- “I found 5 mugs. The new prices would run from €12.66 to €20.40. Examples: Ceramic Sunrise Mug, Midnight Espresso Mug, and Travel Cork Mug. Should I apply it?”
- “Done. I changed 5 prices. One item was skipped because its price changed after the preview. I can undo this if needed.”
