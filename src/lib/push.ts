// Waking the Safeway helper (Nov 3): when a job is queued, Simmer sends the helper's Chrome a push (Web Push, signed
// with Simmer's VAPID keys), and the helper checks for jobs at once. The push carries nothing: it only says "look now".
// The helper has no timers (26.11.11): without the keys (local dev, tests) nothing is sent, and it looks only when Chrome
// starts or its panel opens.
import webpush from "web-push";
import { helperPush, savePush } from "./jobs";

/** The keys, from Vercel's environment (never in code). Null when they aren't all set. */
export function vapid(): { publicKey: string; privateKey: string; subject: string } | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim(), privateKey = process.env.VAPID_PRIVATE_KEY?.trim(), subject = process.env.VAPID_SUBJECT?.trim();
  return publicKey && privateKey && subject ? { publicKey, privateKey, subject } : null;
}

/** The public key the helper subscribes with (it's public: it's in every subscription). */
export const pushKey = () => vapid()?.publicKey ?? "";

/**
 * Sends the wake-up. A subscription the push service says is gone is taken off. (Nov 19: no more once-a-second limit;
 * it was per server instance anyway, and could drop the wake-up for a job queued right after another.)
 */
export async function wakeHelper(): Promise<void> {
  const keys = vapid();
  if (!keys) return;
  const push = await helperPush();
  if (!push || push.key !== keys.publicKey) return;
  try {
    await webpush.sendNotification(push.sub, null, { vapidDetails: keys, TTL: 60, urgency: "high", timeout: 5000 });
  } catch (e) {
    const code = (e as { statusCode?: number }).statusCode;
    if (code === 404 || code === 410) { console.error("the helper's wake-up subscription is gone; it subscribes again when it next looks for jobs"); await savePush(null); }
    else console.error("couldn't wake the helper", code ?? e);
  }
}
