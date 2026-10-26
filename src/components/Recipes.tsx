"use client";
import { useMemo, useRef, useState } from "react";
import { api, errorText, fileToSend, type Draft, type Effort, type Ingredient, type Recipe } from "@/lib/client";
import { searchRecipes } from "@/lib/search";
import { norm } from "@/lib/words";
import { Check } from "./Groceries";
import { Icon } from "./icons";
import { Button, EmptyState, Group, IconButton, Notice, Row, Segmented, Sheet, TopBar } from "./ui";

const EFFORT: Record<Effort, string> = { quick: "Quick", regular: "Regular" };
const FOR = { everyone: "Everyone", kids: "Kids' dinner", adults: "Grown-ups" } as const;

/** "Quick · 25 minutes · Kids' dinner". */
export function summary(r: Pick<Recipe, "effort" | "minutes" | "for" | "makeAhead">, long = false) {
  return [EFFORT[r.effort], r.minutes && (long ? `${r.minutes} minutes` : `${r.minutes} min`), r.for !== "everyone" && FOR[r.for], r.makeAhead && "Make ahead"].filter(Boolean).join(" · ");
}

function RecipeRow({ r, onOpen }: { r: Recipe; onOpen: (r: Recipe) => void }) {
  return <Row title={r.name} subtitle={summary(r)} accessory="chevron" onClick={() => onOpen(r)} />;
}

/** A few of a group, and the rest one tap away (as a search, so the list stays short). */
function Some({ header, items, onOpen, onAll }: { header: string; items: Recipe[]; onOpen: (r: Recipe) => void; onAll: () => void }) {
  if (!items.length) return null;
  return (
    <Group header={header} aside={items.length > 6 ? <button className="t-foot font-semibold text-accent" onClick={onAll}>All {items.length}</button> : undefined}>
      {items.slice(0, 6).map((r) => <RecipeRow key={r.id} r={r} onOpen={onOpen} />)}
    </Group>
  );
}

/** Search (the round button): her collection, searched as she types; before typing, the collection by kind. */
export function SearchScreen({ recipes, query, recent, error, onSearch, onOpen, onAdd }: {
  recipes: Recipe[] | null; query: string; recent: string[]; error: string | null;
  onSearch: (q: string) => void; onOpen: (r: Recipe) => void; onAdd: () => void;
}) {
  const all = useMemo(() => recipes ?? [], [recipes]);
  const found = useMemo(() => (query.trim() ? searchRecipes(all, query) : []), [all, query]);
  const active = all.filter((r) => r.active);
  const byName = (a: Recipe, b: Recipe) => a.name.localeCompare(b.name);
  return (
    <div className="space-y-6">
      <TopBar title="Recipes" subtitle={all.length ? `${all.length} in your collection` : "Your collection"} trailing={<IconButton icon="plus" label="Add recipes" onClick={onAdd} />} />
      {error && <Notice>{error}</Notice>}
      {query.trim() ? (
        found.length ? (
          <Group header={`${found.length} found`}>{found.map((r) => <RecipeRow key={r.id} r={r} onOpen={onOpen} />)}</Group>
        ) : (
          <EmptyState icon="search" title="Nothing found" action={<Button onClick={onAdd} icon="plus">Add recipes</Button>}>
            Nothing in your collection matches &ldquo;{query.trim()}&rdquo;.
          </EmptyState>
        )
      ) : recipes && !all.length ? (
        <EmptyState icon="book" title="No recipes yet" action={<Button onClick={onAdd} icon="plus">Add recipes</Button>}>
          Bring in recipes from a link, a photo or a file, or type in the ones you know by heart.
        </EmptyState>
      ) : (
        <>
          <Group><Row icon="plus" title="Add recipes" subtitle="From a link, a photo, a file, or type it in" accessory="chevron" onClick={onAdd} /></Group>
          {recent.length > 0 && <Group header="Recent">{recent.map((x) => <Row key={x} icon="search" title={x} onClick={() => onSearch(x)} accessory="chevron" />)}</Group>}
          <Some header="Favorites" items={active.filter((r) => (r.rating ?? 0) >= 3).sort(byName)} onOpen={onOpen} onAll={() => onSearch("favorites")} />
          <Some header="Quick" items={active.filter((r) => r.effort === "quick" && r.for !== "kids").sort(byName)} onOpen={onOpen} onAll={() => onSearch("quick")} />
          <Some header="Regular" items={active.filter((r) => r.effort === "regular" && r.for !== "kids").sort(byName)} onOpen={onOpen} onAll={() => onSearch("regular")} />
          <Some header="Kids' dinners" items={active.filter((r) => r.for === "kids").sort(byName)} onOpen={onOpen} onAll={() => onSearch("kids")} />
          <Some header="Not suggested" items={all.filter((r) => !r.active).sort(byName)} onOpen={onOpen} onAll={() => onSearch("not suggested")} />
        </>
      )}
    </div>
  );
}

/** A recipe (drill-in from Search): what it is, what's in it, how it's made, and her one-tap corrections. */
export function RecipeScreen({ r, onBack, onEdit, onEffort, onActive, onAddToList }: {
  r: Recipe; onBack: () => void; onEdit: () => void; onEffort: (e: Effort) => void; onActive: (a: boolean) => void; onAddToList: () => void;
}) {
  const fresh = r.ingredients.filter((i) => i.section === "fresh"), rest = r.ingredients.filter((i) => i.section !== "fresh");
  const link = /^https?:\/\//.test(r.source) ? r.source : "";
  return (
    <div className="space-y-6">
      <TopBar title={r.name} subtitle={[summary(r, true), r.serves && `Serves ${r.serves}`].filter(Boolean).join(" · ")} onBack={onBack} backLabel="Recipes"
        trailing={<IconButton icon="pencil" label="Edit" onClick={onEdit} />} />
      {!r.active && <Notice tone="info">This one isn&apos;t suggested for plans. It stays here for when you want it.</Notice>}
      <Group header="How long it takes" footer="Quick nights get quick dinners when the week is planned.">
        <div className="p-3"><Segmented label="How long it takes" value={r.effort} onChange={onEffort} options={[{ value: "quick", label: "Quick" }, { value: "regular", label: "Regular" }]} /></div>
      </Group>
      {r.ingredients.length ? (
        <>
          {fresh.length > 0 && <Group header="Fresh">{fresh.map((i, n) => <Row key={n} title={i.line} />)}</Group>}
          {rest.length > 0 && <Group header="From the pantry">{rest.map((i, n) => <Row key={n} title={i.line} />)}</Group>}
          <Button onClick={onAddToList} icon="list" className="w-full">Add to the list</Button>
        </>
      ) : (
        <Group><Row icon="pencil" title="Add the ingredients" subtitle="So they can go on the grocery list" accessory="chevron" onClick={onEdit} /></Group>
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

/** Which of a recipe's ingredients go on the list: fresh ones ticked, pantry ones left for her to check she has. */
export function AddToListSheet({ r, onAdd, onClose }: { r: Recipe; onAdd: (items: Ingredient[]) => void; onClose: () => void }) {
  const [on, setOn] = useState(() => new Set(r.ingredients.flatMap((i, n) => (i.section === "fresh" ? [n] : []))));
  const flip = (n: number) => setOn((s) => { const t = new Set(s); if (t.has(n)) t.delete(n); else t.add(n); return t; });
  const row = (i: Ingredient, n: number) => <Row key={n} lead={<Check on={on.has(n)} />} title={i.line} role="checkbox" checked={on.has(n)} onClick={() => flip(n)} />;
  const fresh = r.ingredients.map((i, n) => [i, n] as const).filter(([i]) => i.section === "fresh");
  const rest = r.ingredients.map((i, n) => [i, n] as const).filter(([i]) => i.section !== "fresh");
  return (
    <Sheet label="Add to the list" title={r.name} onClose={onClose}
      footer={<Button className="w-full" disabled={!on.size} onClick={() => { onAdd(r.ingredients.filter((_, n) => on.has(n))); onClose(); }}>{on.size ? `Add ${on.size} to the list` : "Nothing ticked"}</Button>}>
      <div className="space-y-5">
        {fresh.length > 0 && <Group header="To buy">{fresh.map(([i, n]) => row(i, n))}</Group>}
        {rest.length > 0 && <Group header="Check you have these" footer="Tick any you're out of.">{rest.map(([i, n]) => row(i, n))}</Group>}
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
      <Group><Row lead={<Check on={d.makeAhead} />} title="Can be made ahead" subtitle="Earlier in the day or the night before" role="checkbox" checked={d.makeAhead} onClick={() => set({ makeAhead: !d.makeAhead })} /></Group>
      <Field label="Ingredients, one per line"><textarea className={`${FIELD} min-h-40`} value={d.ingredients.join("\n")} onChange={(e) => set({ ingredients: e.target.value.split("\n") })} placeholder={"1 lb ground turkey\n1 onion"} /></Field>
      <Field label="Steps, one per line"><textarea className={`${FIELD} min-h-32`} value={d.steps.join("\n")} onChange={(e) => set({ steps: e.target.value.split("\n") })} placeholder="Optional" /></Field>
      <Field label="Find it by"><input className={FIELD} value={d.tags.join(", ")} onChange={(e) => set({ tags: e.target.value.split(",").map((t) => t.trimStart()) })} placeholder="tacos, one-pan" /></Field>
      <Field label="Notes"><textarea className={`${FIELD} min-h-20`} value={d.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Double the spice for Matt" /></Field>
    </div>
  );
}

const tidy = (d: Draft): Draft => ({ ...d, ingredients: d.ingredients.filter((l) => l.trim()), steps: d.steps.filter((s) => s.trim()), tags: d.tags.map((t) => t.trim()).filter(Boolean) });

/** Editing a saved recipe. */
export function EditSheet({ r, onSave, onClose }: { r: Recipe; onSave: (d: Draft) => Promise<void>; onClose: () => void }) {
  const [d, setD] = useState(() => draftOf(r));
  const [busy, setBusy] = useState(false);
  return (
    <Sheet label={`Edit ${r.name}`} title="Edit" onClose={onClose}
      footer={<Button className="w-full" disabled={busy || !d.name.trim()} onClick={async () => { setBusy(true); await onSave(tidy(d)); setBusy(false); }}>{busy ? "Saving…" : "Save"}</Button>}>
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
      <Group footer="Simmer shows you what it found. Nothing is added until you say so.">
        <Row icon="link" title="From a link" subtitle="A recipe page you like" accessory="chevron" onClick={() => setStep({ at: "link" })} />
        <Row icon="camera" title="From a photo" subtitle="A recipe card, a cookbook page, or a screenshot" accessory="chevron" onClick={() => photo.current?.click()} />
        <Row icon="book" title="From my files" subtitle="A PDF or a picture, from your phone or Drive" accessory="chevron" onClick={() => files.current?.click()} />
        <Row icon="pencil" title="Type it in" subtitle="A family recipe, or your list of meal ideas" accessory="chevron" onClick={() => setStep({ at: "text" })} />
      </Group>
    );
    if (busy) body = <div className="py-10 text-center"><p className="t-headline">Reading it…</p><p className="t-sub mt-1 text-muted">A page full of recipes can take a minute.</p></div>;
  } else if (step.at === "link") {
    body = <Field label="Link to the recipe"><input className={FIELD} type="url" inputMode="url" autoFocus value={link} onChange={(e) => setLink(e.target.value)} placeholder="Paste the link" /></Field>;
    footer = <Button className="w-full" disabled={busy || !link.trim()} onClick={() => read({ link })}>{busy ? "Reading the page…" : "Read it"}</Button>;
  } else if (step.at === "text") {
    body = (
      <Field label="The recipe, or a list of meal ideas">
        <textarea className={`${FIELD} min-h-56`} autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={"Grandma's enchiladas\n2 cups shredded chicken\n…\n\nOr one idea per line:\nTacos\nSalmon and broccoli"} />
      </Field>
    );
    footer = <Button className="w-full" disabled={busy || !text.trim()} onClick={() => read({ text })}>{busy ? "Reading it…" : "Read it"}</Button>;
  } else if (step.at === "pick") {
    const flip = (i: number) => setPicked((s) => { const t = new Set(s); if (t.has(i)) t.delete(i); else t.add(i); return t; });
    body = (
      <Group header={`Found ${step.found.length}`} footer="Untick any you don't want to keep. Ones already in your collection are left out.">
        {step.found.map((d, i) => (
          <Row key={i} lead={<Check on={picked.has(i)} />} title={d.name} subtitle={twin(d.name) ? "Already in your collection" : summary(d)} role="checkbox" checked={picked.has(i)} onClick={() => flip(i)} />
        ))}
      </Group>
    );
    footer = <Button className="w-full" disabled={busy || !picked.size} onClick={() => save(step.found.filter((_, i) => picked.has(i)), "skip")}>{busy ? "Saving…" : `Save ${picked.size}`}</Button>;
  } else {
    const t = twin(step.d.name);
    body = (
      <div className="space-y-4">
        {t && (
          <div className="space-y-3">
            <Notice tone="info">You already have {t.name}.</Notice>
            <Segmented label="Already in your collection" value={dup} onChange={setDup} options={[{ value: "replace", label: "Replace it" }, { value: "both", label: "Keep both" }]} />
          </div>
        )}
        <Editor d={step.d} onChange={(d) => setStep({ at: "review", d })} />
      </div>
    );
    footer = <Button className="w-full" disabled={busy || !step.d.name.trim()} onClick={() => save([step.d], t && dup === "replace" ? "replace" : undefined)}>{busy ? "Saving…" : "Save"}</Button>;
  }
  return (
    <Sheet label="Add recipes" title="Add recipes" onClose={onClose} footer={footer}>
      <div className="space-y-4 pb-2">
        {back && <button className="t-sub -mt-1 flex items-center gap-1 font-semibold text-accent" onClick={back}><Icon name="left" className="size-4" strokeWidth={2.4} />Back</button>}
        {error && <Notice>{error}</Notice>}
        {body}
        <input ref={photo} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        <input ref={files} type="file" accept="application/pdf,image/*,text/plain,.pdf,.txt" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      </div>
    </Sheet>
  );
}
