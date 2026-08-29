export function shouldReopenRejected(
  status: string | undefined,
  previousPayloadHash: string | undefined,
  nextPayloadHash: string
) {
  if (status !== "rejected") return true;
  if (!previousPayloadHash) return true;
  return previousPayloadHash !== nextPayloadHash;
}
