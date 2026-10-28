import { beforeEach, describe, expect, it } from "vitest";
import { answerOrder, askOrder, claimOrder, endOrder, loadOrder, reportOrder, resetOrder, startOrder } from "./order";

const line = { itemId: "a", item: "eggs", quantity: "", state: "to do" as const };

describe("a Safeway order", () => {
  beforeEach(resetOrder);

  it("goes from the phone to the helper and back", async () => {
    const o = await startOrder();
    expect(o.status).toBe("waiting");
    expect((await startOrder()).id).toBe(o.id); // starting again keeps the one going
    expect((await claimOrder([line]))?.status).toBe("filling");
    expect(await claimOrder([line])).toBeNull(); // only one helper takes it
    const asked = await askOrder(o.id, { itemId: "a", item: "eggs", quantity: "", options: [{ id: "1", name: "Eggs", price: "$3", image: "" }] });
    expect(asked?.status).toBe("asking");
    expect((await answerOrder(o.id, { itemId: "b", skip: true }))?.status).toBe("asking"); // an answer to another question is ignored
    const answered = await answerOrder(o.id, { itemId: "a", pick: { id: "1", name: "Eggs" } });
    expect(answered).toMatchObject({ status: "filling", question: null, answer: { pick: { id: "1" } } });
    await reportOrder(o.id, [{ ...line, state: "in cart", qty: 1, name: "Eggs", productId: "1" }], "");
    expect((await endOrder(o.id, "done"))?.status).toBe("done");
    expect((await loadOrder())?.lines[0].state).toBe("in cart");
    expect((await reportOrder(o.id, [line], "late"))?.lines[0].state).toBe("in cart"); // nothing changes once it's over
  });

  it("can be stopped from the phone, and a new one started after", async () => {
    const o = await startOrder();
    await endOrder(o.id, "stopped", "Stopped.");
    expect((await loadOrder())?.status).toBe("stopped");
    expect((await startOrder()).id).not.toBe(o.id);
  });
});
