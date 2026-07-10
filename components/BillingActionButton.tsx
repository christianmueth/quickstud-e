"use client";

import { useState } from "react";
import { toast } from "sonner";

type BillingActionButtonProps = {
  action: "checkout" | "portal";
  plan?: "premium" | "pro";
  className?: string;
  children: React.ReactNode;
  pendingLabel?: string;
};

export default function BillingActionButton({
  action,
  plan,
  className,
  children,
  pendingLabel,
}: BillingActionButtonProps) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch(action === "checkout" ? "/api/billing/checkout" : "/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan ? { plan } : {}),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; url?: string } | null;
      if (!res.ok || !data?.url) {
        throw new Error(data?.error || "We couldn't open billing right now.");
      }
      window.location.href = data.url;
    } catch (error: any) {
      toast.error(error?.message || "We couldn't open billing right now.");
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" className={className} onClick={handleClick} disabled={pending}>
      {pending ? pendingLabel || "Opening..." : children}
    </button>
  );
}