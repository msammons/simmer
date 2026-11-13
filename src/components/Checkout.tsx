"use client";
// Shop → Check out (Sam, Nov 13: "ordering lives where you check out"). The first time, a short set-up right here, in
// order: Face ID, the limit per order, the pickup store, the card's last 4 digits, then Turn on ordering (asking first).
// Once set up: the cart and Simmer's estimate (as Shop's Safeway heading shows them), and ordering's switch, limit, store
// and card. Placing an order isn't here yet: it comes after the test runs on Safeway, and nothing here orders.
import { useState } from "react";
import { money } from "@/lib/shop";
import { useOrdering } from "./Ordering";
import { Button, Group, Held, Row, Sheet } from "./ui";

export function CheckoutSheet({ count, total, estimate, onClose }: { count: number; total: number; estimate: boolean; onClose: () => void }) {
  const o = useOrdering();
  const ready = o.faceIds > 0 && o.s.limitCents > 0 && Boolean(o.s.store) && Boolean(o.s.card);
  // Which view is decided once, when the settings arrive, so the set-up stays put while its last step is done and
  // ends with Turn on ordering rather than jumping away.
  const [firstTime, setFirstTime] = useState<boolean | null>(null);
  if (o.loaded && firstTime === null) setFirstTime(!ready);

  return (
    <Sheet label="Check out" title="Check out" onClose={onClose}>
      <div className="space-y-5 pb-2">
        {firstTime === null ? <Held /> : firstTime ? (
          <>
            <Group header="Set up ordering" footer="Face ID comes first: each of the others needs it.">
              {o.faceIdRows}
              {o.limitRow}
              {o.storeRow}
              {o.cardRow}
            </Group>
            <Button className="w-full" disabled={!ready || o.s.on} onClick={o.turnOn}>{o.s.on ? "Ordering is on" : "Turn on ordering"}</Button>
          </>
        ) : (
          <>
            <Group header="Cart">
              <Row icon="cart" title="In the cart" value={`${count} thing${count === 1 ? "" : "s"}`} />
              <Row icon="bag" title="Simmer's estimate" value={`${estimate ? "about " : ""}${money(total)}`} />
            </Group>
            <Group header="Ordering" footer="Placing orders from here comes after a few test runs on Safeway.">
              {o.onOffRow}
              {o.limitRow}
              {o.storeRow}
              {o.cardRow}
            </Group>
          </>
        )}
      </div>
      {o.sheets}
    </Sheet>
  );
}
