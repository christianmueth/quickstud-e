import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getBillingSnapshot } from "@/lib/billing";
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

  const stripe = getStripe();
  const billing = await getBillingSnapshot(clerkUserId).catch(() => null);
  const appUser = await prisma.user.findFirst({ where: { clerkUserId }, select: { id: true } }).catch(() => null);
  const clerkProfile = await currentUser().catch(() => null);
  const email = clerkProfile?.emailAddresses?.find((entry) => entry.id === clerkProfile.primaryEmailAddressId)?.emailAddress
    || clerkProfile?.emailAddresses?.[0]?.emailAddress
    || undefined;
  const customerId = await resolveStripeCustomerId({
    stripe,
    clerkUserId,
    appUserId: appUser?.id,
    email,
    persistedCustomerId: billing?.user.stripeCustomerId,
  });

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${getBaseUrl(req)}/app/billing`,
  });

  return NextResponse.json({ ok: true, url: session.url });
}