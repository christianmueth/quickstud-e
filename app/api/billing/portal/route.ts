import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getBillingSnapshot } from "@/lib/billing";
import { getStripe } from "@/lib/stripe";

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

  const billing = await getBillingSnapshot(clerkUserId);
  if (!billing.user.stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe customer found for this account yet.", code: "NO_CUSTOMER" }, { status: 400 });
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: billing.user.stripeCustomerId,
    return_url: `${getBaseUrl(req)}/app/billing`,
  });

  return NextResponse.json({ ok: true, url: session.url });
}