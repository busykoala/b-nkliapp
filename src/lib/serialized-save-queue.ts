export type SerializedSaveQueue = {
  enqueue(save: () => Promise<unknown>): void;
  settle(): Promise<void>;
};

/**
 * Runs private draft writes in order and exposes a barrier for destructive
 * actions. A failed write does not prevent later writes or the barrier.
 */
export function createSerializedSaveQueue(): SerializedSaveQueue {
  let tail: Promise<unknown> = Promise.resolve();

  return {
    enqueue(save) {
      tail = tail.catch(() => undefined).then(save);
    },
    async settle() {
      await tail.catch(() => undefined);
    },
  };
}
