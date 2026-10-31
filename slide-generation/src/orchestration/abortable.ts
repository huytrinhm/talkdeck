/** Stop awaiting obsolete provider work even if a provider ignores AbortSignal.
 * The underlying promise remains handled, and must have no publication side effects.
 */
export function abortable<T>(
  promise: PromiseLike<T>,
  signal: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Work cancelled"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}
