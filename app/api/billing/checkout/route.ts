import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getBillingSnapshot, getCheckoutPlanConfig, type CheckoutPlanKey } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";
import { resolveStripeCustomerId } from "@/lib/stripeCustomers";

export const runtime = "nodejs";

function getBaseUrl(req: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(req: Request) {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) {
    return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { plan?: CheckoutPlanKey };
  const planKey: CheckoutPlanKey = "premium";
  const planConfig = getCheckoutPlanConfig(planKey);

  if (!planConfig) {
    return NextResponse.json({ error: "That plan is not configured yet.", code: "PLAN_NOT_CONFIGURED" }, { status: 400 });
  }

  let billing = await getBillingSnapshot(clerkUserId).catch(() => null);
  if (!billing) {
    const user = await prisma.user.upsert({
      where: { clerkUserId },
      update: {},
      create: { clerkUserId },
      select: { id: true, clerkUserId: true },
    });
    billing = {
      user: {
        id: user.id,
        clerkUserId: user.clerkUserId,
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
      monthlyGenerationLimit: null,
      monthlyGenerationsRemaining: null,
      currentPeriodEnd: null,
      usagePeriodStart: new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 0, 0)),
    } as Awaited<ReturnType<typeof getBillingSnapshot>>;
  }
  const clerkProfile = await currentUser().catch(() => null);
  const email = clerkProfile?.emailAddresses?.find((entry) => entry.id === clerkProfile.primaryEmailAddressId)?.emailAddress
    || clerkProfile?.emailAddresses?.[0]?.emailAddress
    || undefined;
  const stripe = getStripe();

  const customerId = await resolveStripeCustomerId({
    stripe,
    clerkUserId,
    appUserId: billing.user.id,
    email,
    persistedCustomerId: billing.user.stripeCustomerId,
  });

  const baseUrl = getBaseUrl(req);
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: planConfig.priceId, quantity: 1 }],
    allow_promotion_codes: true,
    success_url: `${baseUrl}/app/billing?checkout=success`,
    cancel_url: `${baseUrl}/app/billing?checkout=canceled`,
    client_reference_id: clerkUserId,
    metadata: {
      clerkUserId,
      appUserId: billing.user.id,
      plan: planConfig.plan,
    },
    subscription_data: {
      metadata: {
        clerkUserId,
        appUserId: billing.user.id,
        plan: planConfig.plan,
      },
    },
  });

  if (!session.url) {
    return NextResponse.json({ error: "Stripe did not return a checkout URL.", code: "CHECKOUT_URL_MISSING" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, url: session.url });
}