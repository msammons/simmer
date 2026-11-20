// Unexpected server errors the routes didn't answer themselves (a page failing to render, a route throwing) go to the
// owner's error list (src/lib/ops/errors.ts): the route, the message, the digest and the time; nothing from the request.
import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { messageOf, recordError } = await import("./lib/ops/errors");
    const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
    await recordError({ route: context.routePath || request.path, method: request.method, message: messageOf(err), digest, where: context.routeType });
  } catch (e) {
    console.error("couldn't record an error", e);
  }
};
