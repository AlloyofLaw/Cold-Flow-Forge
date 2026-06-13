// ---------------------------------------------------------------------------
// Stripe MCP server (PRD Section 6.5, FR-5.1/5.2/5.5/5.6, SEC-2).
//
// A self-contained MCP server we control (per SEC-9), wrapping the official
// `stripe` Node SDK. Stripe access is via a restricted API key (not OAuth),
// resolved by skills/stripe/client.ts, which also enforces the TEST-MODE
// safety rail (FR-5.6).
//
// Tools exposed (ALL READ-ONLY, Tier 0, FR-5.2):
//   - get_balance:     available/pending balance, by currency.
//   - list_charges:    recent charges/payments.
//   - list_payouts:    recent payouts.
//   - list_customers:  recent customers.
//   - list_disputes:   open/recent disputes.
//   - list_invoices:   recent invoices.
//
// FR-5.5: every monetary figure is converted from Stripe's integer "cents"
// (smallest currency unit) to a decimal amount + currency code in this
// skill, NOT left to the model - e.g. `{ amount: 13.00, currency: "usd" }`
// rather than a raw `1300`. This avoids "$1,300 vs $13,000" misreadings.
//
// EXPLICITLY NOT IMPLEMENTED, ON PURPOSE (FR-5.3/5.4, Phase 4):
//   - No refunds, subscription changes, customer updates, invoice
//     creation/sending, new charges, payout/bank-detail changes, or any
//     account/API-key management. There is NO write tool of any kind in
//     this skill. Adding one is explicitly out of scope for Phase 3 and must
//     go through Tier 3 (strictest confirmation) in a later phase.
//
// Stub mode (no Stripe API key configured, OR a live-mode key without
// STRIPE_ALLOW_LIVE_MODE - see client.ts): every tool still registers and
// returns a clearly-labeled stub/empty result instead of throwing, with zero
// network calls - mirroring skills/google-calendar/server.ts and
// skills/gmail/server.ts.
//
// This server is run IN-PROCESS (see index.ts), connected to its client via
// `InMemoryTransport`, exactly like the other built-in skills.
// ---------------------------------------------------------------------------

import type Stripe from "stripe";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getStripeClient, isConfiguredKeyTestMode } from "./client";

export const STRIPE_SKILL_ID = "stripe";

const STUB_NOTICE =
  "[STUB] No Stripe account is connected (or a live-mode key is configured without " +
  "STRIPE_ALLOW_LIVE_MODE=true). See README 'Connect Stripe' to add a restricted TEST-MODE API key. " +
  "This is a placeholder result, not real Stripe data.";

/** A monetary amount, converted from Stripe's integer "smallest unit" to a decimal (FR-5.5). */
export interface MoneyAmount {
  /** Decimal amount in the major currency unit (e.g. dollars), not cents. */
  amount: number;
  /** ISO currency code, lowercase (e.g. "usd"), as returned by Stripe. */
  currency: string;
}

/**
 * Convert a Stripe integer amount (smallest currency unit, e.g. cents) to a
 * decimal MoneyAmount (FR-5.5: "dollars with currency, not raw integer
 * cents"). Zero-decimal currencies (e.g. JPY) are not special-cased here -
 * Stripe test-mode data used by JARVIS is overwhelmingly USD, and dividing a
 * zero-decimal amount by 100 would be wrong; that refinement is left for when
 * multi-currency support is prioritized.
 */
export function toMoneyAmount(amountInSmallestUnit: number, currency: string): MoneyAmount {
  return { amount: amountInSmallestUnit / 100, currency };
}

export interface BalanceSummary {
  available: MoneyAmount[];
  pending: MoneyAmount[];
}

export interface ChargeSummary {
  id: string;
  amount: MoneyAmount;
  status: string;
  description: string | null;
  customer: string | null;
  created: string; // ISO 8601
  paid: boolean;
  refunded: boolean;
}

export interface PayoutSummary {
  id: string;
  amount: MoneyAmount;
  status: string;
  arrivalDate: string; // ISO 8601
  created: string; // ISO 8601
}

export interface CustomerSummary {
  id: string;
  email: string | null;
  name: string | null;
  created: string; // ISO 8601
}

export interface DisputeSummary {
  id: string;
  amount: MoneyAmount;
  status: string;
  reason: string;
  charge: string | null;
  created: string; // ISO 8601
}

export interface InvoiceSummary {
  id: string;
  amountDue: MoneyAmount;
  status: string | null;
  customer: string | null;
  created: string; // ISO 8601
}

function toIso(unixSeconds: number | null | undefined): string {
  return unixSeconds ? new Date(unixSeconds * 1000).toISOString() : "";
}

const maxResultsSchema = z
  .number()
  .int()
  .min(1)
  .max(100)
  .optional()
  .describe("Maximum number of results to return (default 10).");

/**
 * Build the Stripe MCP server.
 *
 * The Stripe client is constructed lazily and re-checked on every tool call
 * (not cached at server-build time), mirroring the other skills: this lets a
 * user add a Stripe key after JARVIS has started, and re-applies the
 * test-mode safety rail (client.ts) on every call.
 */
export function createStripeServer(): McpServer {
  const server = new McpServer({ name: "jarvis-stripe", version: "0.1.0" });

  server.registerTool(
    "get_balance",
    {
      title: "Get Stripe balance",
      description:
        "Get the current Stripe account balance - available and pending amounts, by currency " +
        "(read-only, FR-5.2). Figures are returned as decimal amounts with currency codes " +
        "(e.g. { amount: 1300.00, currency: 'usd' }), not raw cents (FR-5.5). Useful for " +
        "'how much money do we have' / 'what's our balance' style requests.",
      inputSchema: {},
    },
    async () => {
      const stripe = await getStripeClient();
      if (!stripe) {
        const stubBalance: BalanceSummary = {
          available: [{ amount: 1234.56, currency: "usd" }],
          pending: [{ amount: 78.9, currency: "usd" }],
        };
        return {
          content: [
            { type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, testMode: undefined, balance: stubBalance }) },
          ],
        };
      }

      try {
        const balance = await stripe.balance.retrieve();
        const summary: BalanceSummary = {
          available: balance.available.map((b) => toMoneyAmount(b.amount, b.currency)),
          pending: balance.pending.map((b) => toMoneyAmount(b.amount, b.currency)),
        };
        return {
          content: [{ type: "text", text: JSON.stringify({ stub: false, testMode: await isConfiguredKeyTestMode(), balance: summary }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to get Stripe balance: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_charges",
    {
      title: "List recent Stripe charges",
      description:
        "List recent Stripe charges/payments (read-only, FR-5.2) - useful for 'how much revenue did " +
        "we do this week?' style requests. Each charge includes its amount (decimal + currency, " +
        "FR-5.5), status, description, customer id, creation time, and whether it was paid/refunded.",
      inputSchema: {
        limit: maxResultsSchema,
      },
    },
    async ({ limit }) => {
      const stripe = await getStripeClient();
      if (!stripe) {
        return {
          content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, testMode: undefined, charges: [] }) }],
        };
      }

      try {
        const result = await stripe.charges.list({ limit: limit ?? 10 });
        const charges: ChargeSummary[] = result.data.map((charge: Stripe.Charge) => ({
          id: charge.id,
          amount: toMoneyAmount(charge.amount, charge.currency),
          status: charge.status,
          description: charge.description,
          customer: typeof charge.customer === "string" ? charge.customer : charge.customer?.id ?? null,
          created: toIso(charge.created),
          paid: charge.paid,
          refunded: charge.refunded,
        }));

        return {
          content: [{ type: "text", text: JSON.stringify({ stub: false, testMode: await isConfiguredKeyTestMode(), charges }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list Stripe charges: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_payouts",
    {
      title: "List recent Stripe payouts",
      description:
        "List recent Stripe payouts to the connected bank account (read-only, FR-5.2). Each payout " +
        "includes its amount (decimal + currency, FR-5.5), status, arrival date, and creation time.",
      inputSchema: {
        limit: maxResultsSchema,
      },
    },
    async ({ limit }) => {
      const stripe = await getStripeClient();
      if (!stripe) {
        return {
          content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, testMode: undefined, payouts: [] }) }],
        };
      }

      try {
        const result = await stripe.payouts.list({ limit: limit ?? 10 });
        const payouts: PayoutSummary[] = result.data.map((payout: Stripe.Payout) => ({
          id: payout.id,
          amount: toMoneyAmount(payout.amount, payout.currency),
          status: payout.status,
          arrivalDate: toIso(payout.arrival_date),
          created: toIso(payout.created),
        }));

        return {
          content: [{ type: "text", text: JSON.stringify({ stub: false, testMode: await isConfiguredKeyTestMode(), payouts }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list Stripe payouts: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_customers",
    {
      title: "List recent Stripe customers",
      description:
        "List recent Stripe customers (read-only, FR-5.2). Each customer includes its id, email, " +
        "name, and creation time.",
      inputSchema: {
        limit: maxResultsSchema,
      },
    },
    async ({ limit }) => {
      const stripe = await getStripeClient();
      if (!stripe) {
        return {
          content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, testMode: undefined, customers: [] }) }],
        };
      }

      try {
        const result = await stripe.customers.list({ limit: limit ?? 10 });
        const customers: CustomerSummary[] = result.data.map((customer: Stripe.Customer) => ({
          id: customer.id,
          email: customer.email,
          name: customer.name ?? null,
          created: toIso(customer.created),
        }));

        return {
          content: [{ type: "text", text: JSON.stringify({ stub: false, testMode: await isConfiguredKeyTestMode(), customers }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list Stripe customers: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_disputes",
    {
      title: "List Stripe disputes",
      description:
        "List recent Stripe disputes/chargebacks (read-only, FR-5.2). Each dispute includes its " +
        "amount (decimal + currency, FR-5.5), status, reason, and the disputed charge id.",
      inputSchema: {
        limit: maxResultsSchema,
      },
    },
    async ({ limit }) => {
      const stripe = await getStripeClient();
      if (!stripe) {
        return {
          content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, testMode: undefined, disputes: [] }) }],
        };
      }

      try {
        const result = await stripe.disputes.list({ limit: limit ?? 10 });
        const disputes: DisputeSummary[] = result.data.map((dispute: Stripe.Dispute) => ({
          id: dispute.id,
          amount: toMoneyAmount(dispute.amount, dispute.currency),
          status: dispute.status,
          reason: dispute.reason,
          charge: typeof dispute.charge === "string" ? dispute.charge : dispute.charge?.id ?? null,
          created: toIso(dispute.created),
        }));

        return {
          content: [{ type: "text", text: JSON.stringify({ stub: false, testMode: await isConfiguredKeyTestMode(), disputes }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list Stripe disputes: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "list_invoices",
    {
      title: "List recent Stripe invoices",
      description:
        "List recent Stripe invoices (read-only, FR-5.2). Each invoice includes its amount due " +
        "(decimal + currency, FR-5.5), status, and customer id.",
      inputSchema: {
        limit: maxResultsSchema,
      },
    },
    async ({ limit }) => {
      const stripe = await getStripeClient();
      if (!stripe) {
        return {
          content: [{ type: "text", text: JSON.stringify({ stub: true, notice: STUB_NOTICE, testMode: undefined, invoices: [] }) }],
        };
      }

      try {
        const result = await stripe.invoices.list({ limit: limit ?? 10 });
        const invoices: InvoiceSummary[] = result.data.map((invoice: Stripe.Invoice) => ({
          id: invoice.id ?? "",
          amountDue: toMoneyAmount(invoice.amount_due, invoice.currency),
          status: invoice.status,
          customer: typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null,
          created: toIso(invoice.created),
        }));

        return {
          content: [{ type: "text", text: JSON.stringify({ stub: false, testMode: await isConfiguredKeyTestMode(), invoices }) }],
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: `Failed to list Stripe invoices: ${(error as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  return server;
}
