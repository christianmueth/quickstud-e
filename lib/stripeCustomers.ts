import Stripe from "stripe";
import { prisma } from "@/lib/db";

type ResolveStripeCustomerIdArgs = {
  stripe: Stripe;
  clerkUserId: string;
  appUserId?: string | null;
  email?: string;
  persistedCustomerId?: string | null;
};

export async function resolveStripeCustomerId({
  stripe,
  clerkUserId,
  appUserId,
  email,
  persistedCustomerId,
}: ResolveStripeCustomerIdArgs) {
  const validPersisted = await getValidCustomerId(stripe, persistedCustomerId);
  if (validPersisted) {
    await persistStripeCustomerId(appUserId, validPersisted);
    return validPersisted;
  }

  const searched = await searchStripeCustomerId(stripe, clerkUserId, appUserId);
  if (searched) {
    await persistStripeCustomerId(appUserId, searched);
    return searched;
  }

  const created = await stripe.customers.create({
    email,
    metadata: {
      clerkUserId,
      appUserId: appUserId || "",
    },
  });

  await persistStripeCustomerId(appUserId, created.id);
  return created.id;
}

async function getValidCustomerId(stripe: Stripe, customerId: string | null | undefined) {
  const cleanCustomerId = String(customerId || "").trim();
  if (!cleanCustomerId) return null;

  try {
    const customer = await stripe.customers.retrieve(cleanCustomerId);
    if (!customer || customer.deleted) return null;
    return customer.id;
  } catch (error: any) {
    if (error?.code === "resource_missing" || error?.statusCode === 404) {
      return null;
    }
    throw error;
  }
}

async function searchStripeCustomerId(stripe: Stripe, clerkUserId: string, appUserId?: string | null) {
  const customerSearch = await stripe.customers.search({
    query: appUserId
      ? `metadata['appUserId']:'${appUserId}' OR metadata['clerkUserId']:'${clerkUserId}'`
      : `metadata['clerkUserId']:'${clerkUserId}'`,
    limit: 1,
  }).catch(() => null);

  return customerSearch?.data?.[0]?.id || null;
}

async function persistStripeCustomerId(appUserId: string | null | undefined, customerId: string) {
  if (!appUserId) return;

  await prisma.user.update({
    where: { id: appUserId },
    data: { stripeCustomerId: customerId },
  }).catch(() => null);
}