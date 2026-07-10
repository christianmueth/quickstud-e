import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import BillingActionButton from "@/components/BillingActionButton";
import {
  formatBillingDate,
  formatPlanLabel,
  getBillingSnapshot,
  listCheckoutPlans,
} from "@/lib/billing";

type BillingPageProps = {
  searchParams?: Promise<{ checkout?: string }>;
};

export default async function BillingPage({ searchParams }: BillingPageProps) {
  const { userId } = await auth();
  if (!userId) {
    redirect(`/?next=${encodeURIComponent("/app/billing")}`);
  }

  let billingUnavailable = false;
  const billing = await getBillingSnapshot(userId).catch((error) => {
    billingUnavailable = true;
    console.error("[BillingPage] Billing snapshot fallback:", error);
    return {
      user: {
        id: userId,
        clerkUserId: userId,
        plan: "FREE",
        subscriptionStatus: "FREE",
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
        currentPeriodEnd: null,
        monthlyGenerationCount: 0,
        usagePeriodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 0, 0)),
      },
      plan: "FREE",
      subscriptionStatus: "FREE",
      isPaid: false,
      monthlyGenerationCount: 0,
      monthlyGenerationLimit: 5,
      monthlyGenerationsRemaining: 5,
      currentPeriodEnd: null,
      usagePeriodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 0, 0)),
    } as Awaited<ReturnType<typeof getBillingSnapshot>>;
  });
  const plans = listCheckoutPlans();
  const nextBillingDate = formatBillingDate(billing.currentPeriodEnd);
  const checkoutState = (await searchParams)?.checkout || "";

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 p-6">
      <section className="rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Billing</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Plan and subscription</h1>
        {checkoutState === "success" ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
            Checkout completed. Stripe will confirm the subscription and unlock paid access as soon as the webhook arrives.
          </div>
        ) : null}
        {checkoutState === "canceled" ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Checkout was canceled. Your current plan has not changed.
          </div>
        ) : null}
        {billingUnavailable ? (
          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Billing history is temporarily unavailable, but Stripe checkout and portal access are still available.
          </div>
        ) : null}
      </section>

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Current plan</p>
          <h2 className="mt-3 text-2xl font-semibold text-slate-950">{formatPlanLabel(billing.plan)}</h2>
          <div className="mt-5 space-y-3 text-sm text-slate-700">
            <p>
              Subscription status: <span className="font-medium text-slate-950">{billing.subscriptionStatus}</span>
            </p>
            <p>
              AI generations this month: <span className="font-medium text-slate-950">{billing.monthlyGenerationCount}</span>
              {billing.monthlyGenerationLimit ? ` of ${billing.monthlyGenerationLimit}` : " (unlimited)"}
            </p>
            <p>
              Remaining this month: <span className="font-medium text-slate-950">{billing.monthlyGenerationsRemaining ?? "Unlimited"}</span>
            </p>
            <p>
              Next billing date: <span className="font-medium text-slate-950">{nextBillingDate || "Not scheduled"}</span>
            </p>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <BillingActionButton
              action="portal"
              className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
              pendingLabel="Opening portal..."
            >
              Manage subscription
            </BillingActionButton>
            <Link href="/app" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
              Back to study
            </Link>
          </div>
        </div>

        <div className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Included now</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Free plan starts with 5 AI generations each month.</h2>
          <div className="mt-5 space-y-3 text-sm leading-7 text-slate-700">
            <p>Free for trying the workflow.</p>
            <p>Premium for unlimited access.</p>
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-2">
        {plans.length ? (
          plans.map((plan) => {
            const isCurrentPlan = billing.plan === plan.plan && billing.isPaid;
            return (
              <article key={plan.key} className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{plan.label}</p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-950">{plan.priceLabel}</h2>
                <p className="mt-3 text-sm leading-7 text-slate-700">{plan.description}</p>
                <div className="mt-6">
                  {isCurrentPlan ? (
                    <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm font-medium text-emerald-900">
                      Current plan
                    </div>
                  ) : (
                    <BillingActionButton
                      action="checkout"
                      plan={plan.key}
                      className="w-full rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
                      pendingLabel="Opening checkout..."
                    >
                      Upgrade to {plan.label}
                    </BillingActionButton>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-900 md:col-span-2">
            Stripe price IDs are not configured yet. Add STRIPE_PREMIUM_PRICE_ID before opening billing to customers.
          </div>
        )}
      </section>
    </div>
  );
}