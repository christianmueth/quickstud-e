import Stripe from "stripe";

declare global {
  // eslint-disable-next-line no-var
  var stripeClient: Stripe | undefined;
}

function getStripeSecretKey() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("Missing STRIPE_SECRET_KEY.");
  }
  return secretKey;
}

export function getStripe() {
  if (!global.stripeClient) {
    global.stripeClient = new Stripe(getStripeSecretKey(), {
      apiVersion: "2025-06-30.basil",
    });
  }

  return global.stripeClient;
}