"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { api, errorText, fileToSend, type Draft, type Frozen, type Effort, type Ingredient, type Recipe } from "@/lib/client";
import { freezerMatch } from "@/lib/week";
import { isSpice, norm } from "@/lib/words";
import { Check } from "./Shop";
import { Icon } from "./icons";
import { Alert, BrandBar, Button, EmptyState, Group, Held, IconButton, Row, Segmented, Sheet, TopBar, useSwipe } from "./ui";

const EFFORT: Record<Effort, string> = { quick: "Quick", regular: "Regular" };
const FOR = { everyone: "Everyone", kids: "Kids' dinner", adults: "Grown-ups" } as const;

/** "Quick · 25 minutes · Kids' dinner". */
/** `kind`: false where a header already says quick or regular (Meals), so a dessert doesn't read "Regular". */
export function summary(r: Pick<Recipe, "effort" | "minutes" | "for" | "makeAhead">, long = false, kind = true) {
  return [kind && EFFORT[r.effort], r.minutes && (long ? `${r.minutes} minutes` : `${r.minutes} min`), r.for !== "everyone" && FOR[r.for], r.makeAhead && "Make ahead"].filter(Boolean).join(" · ");
}

/** Shown wherever a recipe has no ingredients yet (Nov 3), so a typed idea reads as unfinished, not empty. */
const NO_INGREDIENTS = "No ingredients yet · Add them";

type Opens = { onOpen: (r: Recipe) => void };

/** A recipe in the collection: tap to open it (Add to the list is on the recipe; the row's own button went, Nov 9). */
function RecipeRow({ r, onOpen }: { r: Recipe } & Opens) {
  // Only what needs doing (Matt, Nov 10: no minutes or labels under rows); the rest is on the recipe's page.
  return <Row title={r.name} subtitle={r.ingredients.length ? undefined : NO_INGREDIENTS} accessory="chevron" onClick={() => onOpen(r)} />;
}

/** A few of a group, and the rest one tap away, so the list stays short. */
function Some({ header, items, onOpen }: { header: string; items: Recipe[] } & Opens) {
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  return (
    <Group header={header} aside={items.length > 6 ? <button className="t-foot font-semibold text-accent" onClick={() => setAll(!all)}>{all ? "Fewer" : `All ${items.length}`}</button> : undefined}>
      {(all ? items : items.slice(0, 6)).map((r) => <RecipeRow key={r.id} r={r} onOpen={onOpen} />)}
    </Group>
  );
}

/** The Recipes tab: her collection by kind, each kind opening to all of it. */
export function RecipesScreen({ recipes, onOpen, onAdd, freezer = [] }: {
  recipes: Recipe[] | null; freezer?: Frozen[]; onAdd: () => void;
} & Opens) {
  const opens = { onOpen };
  const all = useMemo(() => recipes ?? [], [recipes]);
  const active = all.filter((r) => r.active);
  const byName = (a: Recipe, b: Recipe) => a.name.localeCompare(b.name);
  return (
    <div className="space-y-6">
      <BrandBar />
      <h1 className="sr-only">Recipes</h1>
      {!recipes ? <Held groups={[1, 5, 4]} /> : !all.length ? (
        <EmptyState icon="book" title="No recipes yet" action={<Button onClick={onAdd} icon="plus">Add recipes</Button>}>
        </EmptyState>
      ) : (
        <>
          <Group><Row icon="plus" title="Add recipes" accessory="chevron" onClick={onAdd} /></Group>
          <Some header="From the freezer" items={active.filter((r) => r.for !== "kids" && freezer.some((f) => [r.protein, ...r.ingredients.map((i) => i.item)].some((it) => it && freezerMatch(f.item, it)))).sort((a, b) => (a.effort === b.effort ? byName(a, b) : a.effort === "quick" ? -1 : 1))} {...opens} />
          <Some header="Favorites" items={active.filter((r) => (r.rating ?? 0) >= 3).sort(byName)} {...opens} />
          <Some header="Quick" items={active.filter((r) => r.effort === "quick" && r.for !== "kids").sort(byName)} {...opens} />
          <Some header="Regular" items={active.filter((r) => r.effort === "regular" && r.for !== "kids").sort(byName)} {...opens} />
          <Some header="Kids' dinners" items={active.filter((r) => r.for === "kids").sort(byName)} {...opens} />
          <Some header="Not suggested" items={all.filter((r) => !r.active).sort(byName)} {...opens} />
        </>
      )}
    </div>
  );
}

/** A recipe (drill-in from Recipes or the week): what it is, what's in it, how it's made, and her one-tap corrections. */
export function RecipeScreen({ r, onBack, backLabel, onEdit, onActive, onAddToList, planned, onAddToWeek }: {
  r: Recipe; onBack: () => void; backLabel: string; onEdit: () => void; onActive: (a: boolean) => void; onAddToList: () => void;
  /** It's one of this week's dinners: its groceries went on the list when it was planned. */
  planned?: boolean;
  /**
   * Puts it on the plan with its groceries, as Add a meal does (absent for snacks and sauces, never planned): at once,
   * saved behind it (Nov 11: no "Adding…"); one that fails comes back off, and the alert says why.
   */
  onAddToWeek?: () => void;
}) {
  const screen = useRef<HTMLDivElement>(null);
  useSwipe(screen, { onRight: onBack }); // swipe right to go back
  useEffect(() => {
    // Keep the screen awake while cooking, where the browser allows it.
    let lock: { release: () => Promise<void> } | null = null;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
    const take = () => { if (document.visibilityState === "visible") nav.wakeLock?.request("screen").then((l) => { lock = l; }, () => {}); };
    take();
    document.addEventListener("visibilitychange", take);
    return () => { document.removeEventListener("visibilitychange", take); lock?.release().catch(() => {}); };
  }, []);
  const fresh = r.ingredients.filter((i) => i.section === "fresh"), rest = r.ingredients.filter((i) => i.section !== "fresh");
  const link = /^https?:\/\//.test(r.source) ? r.source : "";
  return (
    <div ref={screen} className="space-y-6">
      <TopBar title={r.name} subtitle={[summary(r, true), r.serves && `Serves ${r.serves}`].filter(Boolean).join(" · ")} onBack={onBack} backLabel={backLabel}
        trailing={<IconButton icon="pencil" label="Edit" onClick={onEdit} />} />
      {planned && <p className="t-sub px-1 text-muted">On the plan.</p>}
      {/* Not planned: putting it on this week is the main thing (Nov 9); just its groceries is the quieter choice. */}
      <div className="space-y-3 empty:hidden">
        {!planned && onAddToWeek && <Button onClick={onAddToWeek} icon="calendarPlus" className="w-full">Add to the plan</Button>}
        {r.ingredients.length > 0 && (planned || onAddToWeek
          ? <Button onClick={onAddToList} icon="list" variant="secondary" className="w-full">{planned ? "Add to the list again" : "Just add to the list"}</Button>
          : <Button onClick={onAddToList} icon="list" className="w-full">Add to the list</Button>)}
      </div>
      {r.ingredients.length ? (
        <>
          {fresh.length > 0 && <Group header="Fresh">{fresh.map((i, n) => <Row key={n} title={i.line} />)}</Group>}
          {rest.length > 0 && <Group header="From the pantry">{rest.map((i, n) => <Row key={n} title={i.line} />)}</Group>}
        </>
      ) : (
        <Group><Row icon="pencil" title="No ingredients yet" value="Add them" accessory="chevron" onClick={onEdit} /></Group>
      )}
      {r.steps.length > 0 && (
        <Group header="Steps">
          {r.steps.map((s, n) => <Row key={n} lead={<span className="t-sub w-6 shrink-0 text-center font-semibold text-accent tabular-nums">{n + 1}</span>} title={<span className="font-normal">{s}</span>} />)}
        </Group>
      )}
      {r.notes && <Group header="Notes"><p className="t-sub whitespace-pre-line px-4 py-3">{r.notes}</p></Group>}
      {(r.tags.length > 0 || r.source) && (
        <Group>
          {r.tags.length > 0 && <Row title="Find it by" value={r.tags.join(", ")} />}
          {link ? <Row title="Where it's from" value={new URL(link).hostname.replace(/^www\./, "")} accessory="external" href={link} /> : r.source && <Row title="Where it's from" value={r.source} />}
        </Group>
      )}
      <Button variant="plain" onClick={() => onActive(!r.active)} className="w-full">{r.active ? "Stop suggesting this" : "Suggest this again"}</Button>
    </div>
  );
}

/**
 * Adding a recipe to the list (Nov 3): the fresh things to buy are listed, each can be unticked; the pantry things and
 * spices aren't a checklist, they're highlighted in Stock for her to check, as planning does.
 */
export function AddToListSheet({ r, ticks, onAdd, onClose }: {
  r: Recipe;
  /** The ticks as they were, when adding failed and the sheet opens again. */
  ticks?: number[];
  /** Closes the sheet and adds behind it (Nov 11: no "Adding…"); `ticks` come back if it fails. */
  onAdd: (buy: Ingredient[], pantry: Ingredient[], ticks: number[]) => void; onClose: () => void;
}) {
  const fresh = r.ingredients.map((i, n) => [i, n] as const).filter(([i]) => i.section === "fresh" && !isSpice(i.item));
  const pantry = r.ingredients.filter((i) => i.section !== "fresh" || isSpice(i.item));
  const [on, setOn] = useState(() => new Set(ticks ?? fresh.map(([, n]) => n)));
  const flip = (n: number) => setOn((s) => { const t = new Set(s); if (t.has(n)) t.delete(n); else t.add(n); return t; });
  const add = () => onAdd(fresh.filter(([, n]) => on.has(n)).map(([i]) => i), pantry, [...on]);
  return (
    <Sheet label="Add to the list" title={r.name} onClose={onClose}
      footer={<Button className="w-full" disabled={!on.size && !pantry.length} onClick={add}>{on.size ? `Add ${on.size} to the list` : "Highlight in Stock"}</Button>}>
      <div className="space-y-5">
        {fresh.length > 0 && <Group header="To buy">{fresh.map(([i, n]) => <Row key={n} lead={<Check on={on.has(n)} />} title={i.line} role="checkbox" checked={on.has(n)} onClick={() => flip(n)} />)}</Group>}
      </div>
    </Sheet>
  );
}

// ---- adding and editing

const FIELD = "w-full rounded-2xl bg-card px-4 py-3 text-base outline-none ring-accent focus:ring-2";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block space-y-1.5"><span className="t-foot px-4 uppercase tracking-wide text-muted">{label}</span>{children}</label>;
}

const draftOf = (r: Recipe): Draft => ({ ...r, ingredients: r.ingredients.map((i) => i.line) });

/** The recipe as it will be saved, every part hers to fix. Also how a saved recipe is edited. */
function Editor({ d, onChange }: { d: Draft; onChange: (d: Draft) => void }) {
  const set = (p: Partial<Draft>) => onChange({ ...d, ...p });
  const n = (s: string) => { const v = parseInt(s, 10); return Number.isFinite(v) && v > 0 ? v : null; };
  return (
    <div className="space-y-4">
      <Field label="Name"><input className={FIELD} value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Turkey chili" /></Field>
      <Segmented label="How long it takes" value={d.effort} onChange={(effort) => set({ effort })} options={[{ value: "quick", label: "Quick" }, { value: "regular", label: "Regular" }]} />
      <div className="flex gap-3">
        <Field label="Minutes"><input className={FIELD} inputMode="numeric" value={d.minutes ?? ""} onChange={(e) => set({ minutes: n(e.target.value) })} placeholder="—" /></Field>
        <Field label="Serves"><input className={FIELD} inputMode="numeric" value={d.serves ?? ""} onChange={(e) => set({ serves: n(e.target.value) })} placeholder="—" /></Field>
      </div>
      <Segmented label="Who it's for" value={d.for} onChange={(f) => set({ for: f })} options={[{ value: "everyone", label: "Everyone" }, { value: "kids", label: "Kids" }, { value: "adults", label: "Grown-ups" }]} />
      <Group><Row lead={<Check on={d.makeAhead} />} title="Can be made ahead" role="checkbox" checked={d.makeAhead} onClick={() => set({ makeAhead: !d.makeAhead })} /></Group>
      <Field label="Ingredients, one per line"><textarea className={`${FIELD} min-h-40`} value={d.ingredients.join("\n")} onChange={(e) => set({ ingredients: e.target.value.split("\n") })} placeholder={"1 lb ground turkey\n1 onion"} /></Field>
      <Field label="Steps, one per line"><textarea className={`${FIELD} min-h-32`} value={d.steps.join("\n")} onChange={(e) => set({ steps: e.target.value.split("\n") })} placeholder="Optional" /></Field>
      <Field label="Find it by"><input className={FIELD} value={d.tags.join(", ")} onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trimStart()) })} placeholder="tacos, one-pan" /></Field>
      <Field label="Notes"><textarea className={`${FIELD} min-h-20`} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Double the spice for Sam" /></Field>
    </div>
  );
}

const tidy = (d: Draft): Draft => ({ ...d, ingredients: d.ingredients.filter((l) => l.trim()), steps: d.steps.filter((s) => s.trim()), tags: d.tags.map((t) => t.trim()).filter(Boolean) });

/** Editing a saved recipe. Save closes it at once (Nov 11: no "Saving…"); if the save fails it opens again with `initial`. */
export function EditSheet({ r, initial, onSave, onClose }: { r: Recipe; initial?: Draft; onSave: (d: Draft) => void; onClose: () => void }) {
  const [d, setD] = useState(() => initial ?? draftOf(r));
  return (
    <Sheet label={`Edit ${r.name}`} title="Edit" onClose={onClose}
      footer={<Button className="w-full" disabled={!d.name.trim()} onClick={() => onSave(tidy(d))}>Save</Button>}>
      <Editor d={d} onChange={setD} />
    </Sheet>
  );
}

type Step = { at: "choose" } | { at: "link" } | { at: "text" } | { at: "pick"; found: Draft[] } | { at: "review"; d: Draft };

/**
 * Add recipes: from a link or typed in. Simmer reads it and shows what it found; nothing is saved until she says so.
 * One recipe goes straight to its review page; a list (her meal ideas) gets a checkbox each.
 */
export function AddRecipesSheet({ recipes, onSaved, onClose }: { recipes: Recipe[]; onSaved: (all: Recipe[], saved: string[]) => void; onClose: () => void }) {
  const [step, setStep] = useState<Step>({ at: "choose" });
  const [link, setLink] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [dup, setDup] = useState<"both" | "replace">("replace");
  const twin = (name: string) => recipes.find((r) => norm(r.name) === norm(name));

  const photo = useRef<HTMLInputElement>(null), files = useRef<HTMLInputElement>(null);
  async function pick(f: File | undefined) {
    if (!f) return;
    setBusy(true); setError(null);
    try { await read({ file: await fileToSend(f) }); } catch (e) { setError(errorText(e)); setBusy(false); }
  }
  async function read(from: Parameters<typeof api.readRecipe>[0]) {
    setBusy(true); setError(null);
    try {
      const { found } = await api.readRecipe(from);
      if (found.length === 1) setStep({ at: "review", d: found[0] });
      else { setPicked(new Set(found.flatMap((d, i) => (twin(d.name) ? [] : [i])))); setStep({ at: "pick", found }); }
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }
  async function save(ds: Draft[], duplicates: "skip" | "replace" | undefined) {
    setBusy(true); setError(null);
    try { const res = await api.saveRecipes(ds.map(tidy), duplicates); onSaved(res.recipes, res.saved); }
    catch (e) { setError(errorText(e)); setBusy(false); }
  }

  const back = step.at === "choose" ? undefined : () => { setError(null); setStep({ at: "choose" }); };
  let body: React.ReactNode, footer: React.ReactNode = null;
  if (step.at === "choose") {
    body = (
      <Group>
        <Row icon="link" title="From a link" accessory="chevron" onClick={() => setStep({ at: "link" })} />
        <Row icon="camera" title="From a photo" accessory="chevron" onClick={() => photo.current?.click()} />
        <Row icon="book" title="From my files" accessory="chevron" onClick={() => files.current?.click()} />
        <Row icon="pencil" title="Type it in" accessory="chevron" onClick={() => setStep({ at: "text" })} />
      </Group>
    );
    // Reading a photo or a file: the shimmer, as every first load looks (Nov 11: no "Reading it…").
    if (busy) body = <Held groups={[4]} label="Reading the recipe" />;
  } else if (step.at === "link") {
    body = <>
      <Field label="Link to the recipe"><input className={FIELD} type="url" inputMode="url" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the link" /></Field>
      {busy && <Held groups={[4]} label="Reading the recipe" />}
    </>;
    footer = <Button className="w-full" disabled={busy || !link.trim()} onClick={() => read({ link })}>Read it</Button>;
  } else if (step.at === "text") {
    body = (
      <Field label="The recipe, or a list of meal ideas">
        <textarea className={`${FIELD} min-h-56`} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={"Grandma's enchiladas\n2 cups shredded chicken\n…\n\nOr one idea per line:\nTacos\nSalmon and broccoli"} />
      </Field>
    );
    if (busy) body = <Held groups={[4]} label="Reading the recipe" />;
    footer = <Button className="w-full" disabled={busy || !text.trim()} onClick={() => read({ text })}>Read it</Button>;
  } else if (step.at === "pick") {
    const flip = (i: number) => setPicked((s) => { const t = new Set(s); if (t.has(i)) t.delete(i); else t.add(i); return t; });
    body = (
      <Group header={`Found ${step.found.length}`}>
        {step.found.map((d, i) => (
          <Row key={i} lead={<Check on={picked.has(i)} />} title={d.name} subtitle={twin(d.name) ? "Already in your collection" : undefined} role="checkbox" checked={picked.has(i)} onClick={() => flip(i)} />
        ))}
      </Group>
    );
    footer = <Button className="w-full" disabled={busy || !picked.size} onClick={() => save(step.found.filter((_, i) => picked.has(i)), "skip")}>{`Save ${picked.size}`}</Button>;
  } else {
    const t = twin(step.d.name);
    body = (
      <div className="space-y-4">
        {t && (
          <div className="space-y-3">
            <p className="px-4 t-foot text-muted">You already have {t.name}.</p>
            <Segmented label="Already in your collection" value={dup} onChange={setDup} options={[{ value: "replace", label: "Replace it" }, { value: "both", label: "Keep both" }]} />
          </div>
        )}
        <Editor d={step.d} onChange={(d) => setStep({ at: "review", d })} />
      </div>
    );
    footer = <Button className="w-full" disabled={busy || !step.d.name.trim()} onClick={() => save([step.d], t && dup === "replace" ? "replace" : undefined)}>Save</Button>;
  }
  return (
    <Sheet label="Add recipes" title="Add recipes" onClose={onClose} footer={footer}>
      <div className="space-y-4 pb-2">
        {back && <button aria-label="Back to Add recipes" className="t-sub -mt-1 flex items-center gap-1 font-semibold text-accent" onClick={back}><Icon name="left" className="size-4" strokeWidth={2.4} />Back</button>}
        {body}
        <input ref={photo} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={files} type="file" accept="application/pdf,image/*,text/plain,.pdf,.txt" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
      <Alert open={Boolean(error)} title="That didn't go through" message={error ?? ""} onClose={() => setError(null)} />
    </Sheet>
  );
}
