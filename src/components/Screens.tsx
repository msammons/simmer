"use client";
import { hourNow, list, type Person } from "@/lib/client";
import { EmptyState, Group, IconButton, Notice, Row, TopBar } from "./ui";

// Placeholder screens for the starter: each shows where its real content goes. Replace them as the app takes shape.

const greeting = () => { const h = hourNow(); return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening"; };

export function WeekScreen({ people, error, onSettings }: { people: Person[]; error: string | null; onSettings: () => void }) {
  return (
    <div className="space-y-6">
      <TopBar title="This week" subtitle={`${greeting()} · What's cooking?`} trailing={<IconButton icon="sliders" label="Settings" onClick={onSettings} />} />
      {error && <Notice>{error}</Notice>}
      <EmptyState icon="pot" title="Nothing planned yet">
        This week&apos;s dinners show here{people.length ? `, planned for ${list(people.map((p) => p.name))}` : ""}.
      </EmptyState>
    </div>
  );
}

export function SearchScreen({ recent, onSearch }: { recent: string[]; onSearch: (q: string) => void }) {
  const ideas = recent.length ? recent : ["Tacos", "Soup", "Something with salmon"];
  return (
    <div className="space-y-6">
      <TopBar title="Search" subtitle="Recipes and ideas" />
      <Group header={recent.length ? "Recent" : "Try"}>
        {ideas.map((x) => <Row key={x} icon="search" title={x} onClick={() => onSearch(x)} accessory="chevron" />)}
      </Group>
    </div>
  );
}
