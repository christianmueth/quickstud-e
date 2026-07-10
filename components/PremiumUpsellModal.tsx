"use client";

import Link from "next/link";
import BillingActionButton from "@/components/BillingActionButton";

type PremiumUpsellModalProps = {
  open: boolean;
  title: string;
  message: string;
  onClose: () => void;
  upgradePath?: string;
};

export default function PremiumUpsellModal({
  open,
  title,
  message,
  onClose,
  upgradePath = "/app/billing",
}: PremiumUpsellModalProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/45 px-4">
      <div className="w-full max-w-lg rounded-3xl border border-amber-200 bg-white p-6 shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">Premium feature</p>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
        <p className="mt-3 text-sm leading-7 text-slate-700">{message}</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <BillingActionButton
            action="checkout"
            plan="premium"
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            pendingLabel="Opening checkout..."
          >
            Upgrade to Premium
          </BillingActionButton>
          <Link href={upgradePath} className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
            View billing
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}