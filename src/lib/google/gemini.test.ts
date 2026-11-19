// Gemini calls (review, Nov 19): one deadline for every attempt, server errors retried, bad or empty answers handled.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateJson } from "./gemini";

const ok = (text: string, extra: object = {}) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, ...extra }] }), { status: 200 });
const schema = { type: "OBJECT" };
let f: import("vitest").MockInstance<typeof fetch>;
beforeEach(() => { process.env.GEMINI_API_KEY = "test-key"; f = vi.spyOn(globalThis, "fetch"); });
afterEach(() => { f.mockRestore(); delete process.env.GEMINI_API_KEY; });

describe("asking Gemini", () => {
  it("won't call without a key", async () => {
    delete process.env.GEMINI_API_KEY;
    await expect(generateJson("x", schema)).rejects.toThrow(/set up/);
    expect(f).not.toHaveBeenCalled();
  });
  it("tries again after a server error", async () => {
    f.mockResolvedValueOnce(new Response("oops", { status: 500 })).mockResolvedValueOnce(new Response("", { status: 504 })).mockResolvedValueOnce(ok('{"a":1}'));
    expect((await generateJson<{ a: number }>("x", schema, { timeoutMs: 20_000 })).data).toEqual({ a: 1 });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("tries again after a cut-off answer", async () => {
    f.mockResolvedValueOnce(ok('{"a":', { finishReason: "MAX_TOKENS" })).mockResolvedValueOnce(ok('{"a":2}'));
    expect((await generateJson<{ a: number }>("x", schema)).data).toEqual({ a: 2 });
  });
  it("says so when there's no answer (blocked)", async () => {
    f.mockResolvedValue(new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 }));
    await expect(generateJson("x", schema)).rejects.toThrow(/no answer/);
  });
  it("gives up at one deadline for all the attempts", async () => {
    f.mockImplementation(((_: unknown, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) as never);
    const t = Date.now();
    await expect(generateJson("x", schema, { timeoutMs: 2_500 })).rejects.toThrow(/busy/);
    expect(Date.now() - t).toBeLessThan(3_000);
    expect(f).toHaveBeenCalledTimes(1); // the one attempt used the time; none started without enough left
  });
});
