---
name: woocommerce-daily-briefing
description: Creates concise voice-friendly WooCommerce owner briefings using Tillwise Store Agent. Use when the owner asks how the shop did today, what needs attention, low stock, waiting orders, or sales ending soon.
license: GPL-2.0-or-later
compatibility: Requires an MCP client connected to the Tillwise Store Agent server and an authenticated WooCommerce shop-manager account.
metadata:
  version: "0.1.0"
  project: tillwise-store-agent
---

# WooCommerce daily briefing

Use this skill for daily store status questions. Keep answers short enough for text-to-speech and avoid reading long tables.

## Workflow

1. Call `store_briefing` for a full daily briefing.
2. Lead with the `speech` field from the tool.
3. If the owner asks for detail, call focused tools:
   - `sales_summary` for today, yesterday, last 7 days, or this month,
   - `low_stock` for stock issues,
   - `price_change_history` for recent price operations.
4. Mention only the top few products or issues aloud. Keep full lists in structured content for cards or screens.
5. If action is needed, offer a safe next step, such as previewing a sale for slow stock. Never apply a price change from a briefing without the safe-price-change workflow.

## Voice examples

- “Today sales are €312, up €48 versus last Tuesday. Six orders are waiting, three items are low on stock, and two sales end soon.”
- “The low-stock items are Midnight Espresso Mug, Relax Evening Gift Box, and Recycled Notebook. I can show the full list on screen.”
