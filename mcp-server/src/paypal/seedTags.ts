import type { LedgerSegment } from './types.js';

/**
 * Tags written by `npm run sandbox:seed` into PayPal's own fields, so that the sandbox ledger can show
 * customer/segment/product without a local database:
 * - purchase_units[].invoice_id = the seed tag (unique per merchant by default, which makes reruns safe);
 * - purchase_units[].custom_id = "tillwise-demo;seg=<segment>;cust=<customer>;prod=<product>".
 * Transaction Search returns these as transaction_info.invoice_id / custom_field.
 */
export const SEED_TAG_PREFIX = 'TW-DEMO-';
const CUSTOM_PREFIX = 'tillwise-demo;';
const SEGMENTS: LedgerSegment[] = ['Retail', 'Wholesale', 'Subscription'];

export function seedCustomId(input: { segment: LedgerSegment; customer: string; product: string }): string {
  const clean = (value: string) => value.replace(/[;=]/g, ' ').trim();
  return `${CUSTOM_PREFIX}seg=${clean(input.segment)};cust=${clean(input.customer)};prod=${clean(input.product)}`.slice(0, 127);
}

export function parseSeedCustomId(custom: string | undefined | null): { segment: LedgerSegment; customer: string; product: string } | null {
  if (!custom || !custom.startsWith(CUSTOM_PREFIX)) return null;
  const fields = Object.fromEntries(custom.slice(CUSTOM_PREFIX.length).split(';').map((pair) => {
    const at = pair.indexOf('=');
    return at < 0 ? [pair, ''] : [pair.slice(0, at), pair.slice(at + 1)];
  }));
  const segment = SEGMENTS.includes(fields.seg as LedgerSegment) ? fields.seg as LedgerSegment : 'Unknown';
  return { segment, customer: fields.cust || 'Unknown', product: fields.prod || 'Unknown' };
}
