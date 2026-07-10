import { NextResponse } from "next/server";
import Stripe from "stripe";
import { SubscriptionPlan, SubscriptionStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { mapStripeStatus, resolvePlanFromPriceId } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";

function getWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing STRIPE_WEBHOOK_SECRET.");
  }
  return secret;
}

async function findUserForSubscription(subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const appUserId = subscription.metadata?.appUserId;
  const clerkUserId = subscription.metadata?.clerkUserId;
  if (appUserId) {
    const user = await prisma.user.findUnique({ where: { id: appUserId } });
    if (user) return user;
  }
  if (clerkUserId) {
    const user = await prisma.user.findUnique({ where: { clerkUserId } });
    if (user) return user;
  }
  if (customerId) {
    return prisma.user.findFirst({ where: { stripeCustomerId: customerId } });
  }
  return null;
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const user = await findUserForSubscription(subscription);
  if (!user) return;

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const priceId = subscription.items.data[0]?.price?.id ?? null;
  const subscriptionStatus = mapStripeStatus(subscription.status);
  const derivedPlan = resolvePlanFromPriceId(priceId);
  const activePlan = subscriptionStatus === SubscriptionStatus.ACTIVE || subscriptionStatus === SubscriptionStatus.TRIALING
    ? derivedPlan
    : SubscriptionPlan.FREE;

  await prisma.user.update({
    where: { id: user.id },
    data: {
      stripeCustomerId: customerId || user.stripeCustomerId,
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      subscriptionStatus,
      plan: activePlan,
      currentPeriodEnd: subscription.items.data[0]?.current_period_end
        ? new Date(subscription.items.data[0].current_period_end * 1000)
        : null,
    },
  });
}

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  const appUserId = session.metadata?.appUserId;
  const clerkUserId = session.metadata?.clerkUserId || session.client_reference_id;
  if (!appUserId && !clerkUserId) return;

  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;

  await prisma.user.updateMany({
    where: appUserId ? { id: appUserId } : { clerkUserId: clerkUserId! },
    data: {
      stripeCustomerId: customerId || undefined,
      stripeSubscriptionId: subscriptionId || undefined,
    },
  });

  if (subscriptionId) {
    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    await syncSubscription(subscription);
  }
}

export async function POST(req: Request) {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(body, signature, getWebhookSecret());
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Webhook signature verification failed." }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await syncSubscription(event.data.object as Stripe.Subscription);
      break;
    default:
      break;
  }

  return NextResponse.json({ received: true });
}