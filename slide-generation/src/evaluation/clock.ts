export interface EvaluationClock {
  now(): number;
  until(deadlineMs: number, signal?: AbortSignal): Promise<void>;
}
export const monotonicClock: EvaluationClock = {
  now: () => performance.now(),
  until(deadline, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason ?? new Error('Clock aborted')); return; }
      let timer: ReturnType<typeof setTimeout>;
      const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(signal?.reason ?? new Error('Clock aborted')); };
      const tick = () => {
        const remaining = deadline - performance.now();
        if (remaining <= 0) { signal?.removeEventListener('abort', cancel); resolve(); }
        else timer = setTimeout(tick, Math.min(remaining, 60_000));
      };
      signal?.addEventListener('abort', cancel, { once: true }); tick();
    });
  },
};
/** A bounded wait does not convert a hung operation into a successful observation. */
export async function beforeDeadline<T>(operation: Promise<T>, deadline: number, clock: EvaluationClock): Promise<{ completed: true; value: T } | { completed: false }> {
  const controller = new AbortController();
  try {
    return await Promise.race([
      operation.then(value => ({ completed: true as const, value })),
      clock.until(deadline, controller.signal).then(() => ({ completed: false as const })),
    ]);
  } finally { controller.abort(); }
}
