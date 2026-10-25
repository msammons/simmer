import { AppError } from "./errors";

/**
 * What a person sees when something goes wrong. AppErrors are already written for people; anything else is a service
 * or code failure, so it gets a plain "try again" (the real message goes to the server log, not the screen).
 */
export function friendly(e: unknown): string {
  if (e instanceof AppError) return e.message;
  const m = e instanceof Error ? e.message : String(e);
  console.error(m);
  if (/busy|429|quota|rate|timed? ?out|abort/i.test(m)) return "It's busy right now. Try again in a minute.";
  if (/sheet|tab|sign-in/i.test(m)) return "Couldn't load your kitchen just now. Try again in a minute.";
  return "That didn't load. Try again in a minute.";
}
