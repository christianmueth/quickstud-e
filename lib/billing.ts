import { SubscriptionPlan, SubscriptionStatus, type User } from "@prisma/client";
import { prisma } from "@/lib/db";

export const FREE_PLAN_MONTHLY_GENERATION_LIMIT = Number(process.env.FREE_PLAN_MONTHLY_GENERATION_LIMIT || 5);

export type CheckoutPlanKey = "premium";

type BillingUserRecord = Pick<
  User,
  | "id"
  | "clerkUserId"
  | "plan"
  | "subscriptionStatus"
  | "stripeCustomerId"
  | "stripeSubscriptionId"
  | "stripePriceId"
  | "currentPeriodEnd"
  | "monthlyGenerationCount"
  | "usagePeriodStart"
>;

export type BillingSnapshot = {
  user: BillingUserRecord;
  plan: SubscriptionPlan;
  subscriptionStatus: SubscriptionStatus;
  isPaid: boolean;
  monthlyGenerationCount: number;
  monthlyGenerationLimit: number | null;
  monthlyGenerationsRemaining: number | null;
  currentPeriodEnd: Date | null;
  usagePeriodStart: Date;
};

const billingSelect = {
  id: true,
  clerkUserId: true,
  plan: true,
  subscriptionStatus: true,
  stripeCustomerId: true,
  stripeSubscriptionId: true,
  stripePriceId: true,
  currentPeriodEnd: true,
  monthlyGenerationCount: true,
  usagePeriodStart: true,
} as const;

export function getCurrentUsagePeriodStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function formatPlanLabel(plan: SubscriptionPlan) {
  switch (plan) {
    case SubscriptionPlan.PREMIUM:
    case SubscriptionPlan.PRO:
      return "Premium";
    default:
      return "Free";
  }
}

export function formatBillingDate(value: Date | null) {
  if (!value) return null;
  return value.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function isPaidPlan(plan: SubscriptionPlan, status: SubscriptionStatus) {
  return plan !== SubscriptionPlan.FREE && (status === SubscriptionStatus.ACTIVE || status === SubscriptionStatus.TRIALING);
}

export function getCheckoutPlanConfig(planKey: CheckoutPlanKey) {
  const priceId = process.env.STRIPE_PREMIUM_PRICE_ID?.trim();
  if (!priceId) return null;
  return {
    key: planKey,
    plan: SubscriptionPlan.PREMIUM,
    priceId,
    label: "Premium",
    priceLabel: "$9.99/month",
    description: "Unlimited generations, tutor chat, and faster study workflows.",
  };
}

export function listCheckoutPlans() {
  return (["premium"] as CheckoutPlanKey[])
    .map((key) => getCheckoutPlanConfig(key))
    .filter((value): value is NonNullable<ReturnType<typeof getCheckoutPlanConfig>> => Boolean(value));
}

export function resolvePlanFromPriceId(priceId: string | null | undefined) {
  if (!priceId) return SubscriptionPlan.FREE;
  if (priceId === process.env.STRIPE_PREMIUM_PRICE_ID?.trim()) return SubscriptionPlan.PREMIUM;
  if (priceId === process.env.STRIPE_PRO_PRICE_ID?.trim()) return SubscriptionPlan.PREMIUM;
  return SubscriptionPlan.FREE;
}

export function mapStripeStatus(status: string | null | undefined) {
  switch (status) {
    case "active":
      return SubscriptionStatus.ACTIVE;
    case "trialing":
      return SubscriptionStatus.TRIALING;
    case "canceled":
      return SubscriptionStatus.CANCELED;
    case "past_due":
    case "unpaid":
      return SubscriptionStatus.PAST_DUE;
    case "incomplete":
    case "incomplete_expired":
      return SubscriptionStatus.INCOMPLETE;
    default:
      return SubscriptionStatus.FREE;
  }
}

function toBillingSnapshot(user: BillingUserRecord): BillingSnapshot {
  const isPaid = isPaidPlan(user.plan, user.subscriptionStatus);
  const monthlyGenerationLimit = isPaid ? null : FREE_PLAN_MONTHLY_GENERATION_LIMIT;
  const monthlyGenerationsRemaining = isPaid
    ? null
    : Math.max(0, FREE_PLAN_MONTHLY_GENERATION_LIMIT - user.monthlyGenerationCount);

  return {
    user,
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus,
    isPaid,
    monthlyGenerationCount: user.monthlyGenerationCount,
    monthlyGenerationLimit,
    monthlyGenerationsRemaining,
    currentPeriodEnd: user.currentPeriodEnd,
    usagePeriodStart: user.usagePeriodStart,
  };
}

async function normalizeUsageWindow(user: BillingUserRecord) {
  const currentPeriodStart = getCurrentUsagePeriodStart();
  if (user.usagePeriodStart.getTime() === currentPeriodStart.getTime()) {
    return user;
  }

  return prisma.user.update({
    where: { id: user.id },
    data: {
      usagePeriodStart: currentPeriodStart,
      monthlyGenerationCount: 0,
    },
    select: billingSelect,
  });
}

export async function getBillingSnapshot(clerkUserId: string) {
  const currentPeriodStart = getCurrentUsagePeriodStart();
  const user = await prisma.user.upsert({
    where: { clerkUserId },
    update: {},
    create: {
      clerkUserId,
      usagePeriodStart: currentPeriodStart,
    },
    select: billingSelect,
  });

  const normalized = await normalizeUsageWindow(user);
  return toBillingSnapshot(normalized);
}

export async function getGenerationAccess(clerkUserId: string) {
  const snapshot = await getBillingSnapshot(clerkUserId);
  const allowed = snapshot.isPaid || (snapshot.monthlyGenerationsRemaining ?? 0) > 0;
  return {
    allowed,
    snapshot,
  };
}

export async function incrementGenerationUsage(userId: string, amount = 1) {
  await prisma.user.update({
    where: { id: userId },
    data: {
      monthlyGenerationCount: {
        increment: amount,
      },
    },
  });
}

export function buildFreePlanLimitMessage(snapshot: BillingSnapshot) {
  const used = snapshot.monthlyGenerationCount;
  const limit = snapshot.monthlyGenerationLimit ?? FREE_PLAN_MONTHLY_GENERATION_LIMIT;
  return `Free plan limit reached. You have used ${used} of ${limit} AI generations this month. Upgrade to Premium for unlimited study generation.`;
}

export function buildPremiumRequiredMessage(featureLabel: string) {
  return `${featureLabel} is a Premium feature. Upgrade your plan to keep using it.`;
}