import { api, body, noStore } from "@/lib/ops/route";
import { feedbackOf, recordFeedback, type ServerSide } from "@/lib/ops/feedback";
import { HELPER_VERSION, helperStatus } from "@/lib/jobs";
import { loadSettings, serverOn } from "@/lib/checkout";

/** What the server adds: this release, the helper's last check-in, and whether ordering is on (never the limit, store or card). */
async function serverSide(): Promise<ServerSide> {
  const [h, s] = await Promise.all([helperStatus().catch(() => null), loadSettings()]);
  const version = h?.version ?? "";
  return {
    live: process.env.NEXT_PUBLIC_VERSION ?? "",
    helper: version ? `${version}${h?.outdated ? ` (Simmer ships ${HELPER_VERSION})` : ""}${h?.away ? ", not answering" : ""}` : "never seen",
    helperSeen: h?.seen ?? "",
    ordering: `${s.on ? "on" : "off"} in Settings, ${serverOn() ? "on" : "off"} on the server`,
  };
}

/** POST { text, …what the phone showed at the long press } (lib/feedback.ts): kept as one entry, answered { ok }. */
export const POST = api(async (req) => {
  const f = feedbackOf(await body(req));
  await recordFeedback(f, await serverSide());
  return Response.json({ ok: true }, noStore);
});
