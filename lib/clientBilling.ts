export type PremiumApiResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  upgradePath?: string;
};

export type UpgradePrompt = {
  title: string;
  message: string;
  upgradePath: string;
};

export function getUpgradePrompt(
  data: PremiumApiResponse | null | undefined,
  title: string,
): UpgradePrompt | null {
  if (!data || (data.code !== "PREMIUM_REQUIRED" && data.code !== "FREE_PLAN_LIMIT")) {
    return null;
  }

  return {
    title,
    message: data.error || "Upgrade to Premium to continue.",
    upgradePath: data.upgradePath || "/app/billing",
  };
}