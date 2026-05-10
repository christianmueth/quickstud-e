export function isInternalOperator(userId: string | null | undefined): boolean {
  if (!userId) return false;

  const configured = getConfiguredOperatorIds();
  if (configured.size === 0) {
    return process.env.NODE_ENV !== "production";
  }

  return configured.has(userId);
}

function getConfiguredOperatorIds(): Set<string> {
  const raw = process.env.INTERNAL_OPERATOR_CLERK_USER_IDS || "";
  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
}