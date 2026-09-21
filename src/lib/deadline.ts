export async function withDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  ms: number,
  parent?: AbortSignal,
): Promise<T | null> {
  if (parent?.aborted) return null;
  const local = new AbortController();
  const timer = setTimeout(() => local.abort(), ms);
  const onParent = () => local.abort();
  parent?.addEventListener("abort", onParent, { once: true });
  try {
    return await work(local.signal);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", onParent);
  }
}
