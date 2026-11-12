// Waking the Safeway helper (Nov 3): when a job is queued, Simmer sends the helper's Chrome a push (Web Push, signed
// with Simmer's VAPID keys), and the helper checks for jobs at once instead of at its next half-minute check. The push
// carries nothing: it only says "look now". Without the keys (local dev, tests) nothing is sent, and the half-minute
// check is the backstop either way.
import webpush from "web-push";
import { helperPush, savePush } from "./jobs";

/** The keys, from Vercel's environment (never in code). Null when they aren't all set. */
export function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim(), privateKey = process.env.VAPID_PRIVATE_KEY?.trim(), subject = process.env.VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/** The public key the helper subscribes with (it's public: it's in every subscription). */
export const pushKey = () => vapid()?.publicKey ?? "";

let last = 0;

/** Sends the wake-up, at most once a second. A subscription the push service says is gone is taken off. */
export async function wakeHelper(): Promise<void> {
  const keys = vapid();
  if (!keys || Date.now() - last < 1000) return;
  const push = await helperPush();
  if (!push || push.key !== keys.publicKey) return;
  last = Date.now();
  try {
    await webpush.sendNotification(push.sub, null, { vapidDetails: keys, TTL: 60, urgency: "high", timeout: 5000 });
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) { console.error("the helper's wake-up subscription is gone; it subscribes again when it next looks for jobs"); await savePush(null); }
    else console.error("couldn't wake the helper", code ?? e);
  }
}
