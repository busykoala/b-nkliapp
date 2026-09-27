import { describe, expect, it } from "vitest";

import { createSerializedSaveQueue } from "./serialized-save-queue";

describe("serialized save queue", () => {
  it("waits for queued writes before a destructive action can continue", async () => {
    let releaseSave!: () => void;
    let markStarted!: () => void;
    const events: string[] = [];
    const queue = createSerializedSaveQueue();
    const started = new Promise<void>((resolve) => { markStarted = resolve; });

    queue.enqueue(async () => {
      events.push("save started");
      markStarted();
      await new Promise<void>((resolve) => { releaseSave = resolve; });
      events.push("save finished");
    });

    const end = queue.settle().then(() => events.push("discard"));
    await started;
    expect(events).toEqual(["save started"]);

    releaseSave();
    await end;
    expect(events).toEqual(["save started", "save finished", "discard"]);
  });

  it("continues after a failed write and still releases the barrier", async () => {
    const events: string[] = [];
    const queue = createSerializedSaveQueue();
    queue.enqueue(async () => { throw new Error("offline"); });
    queue.enqueue(async () => { events.push("latest save"); });

    await queue.settle();
    expect(events).toEqual(["latest save"]);
  });
});
