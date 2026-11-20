/** A problem written for people ("Pick at least one person."), shown as is. Anything else is a failure and gets a plain "try again". */
export class AppError extends Error {}

/**
 * Another service failed or answered something unreadable (Gemini, Nov 19). The error list keeps only the service and
 * `status` (a code, or a word like "no answer"), never the message: it can hold a reply, a recipe or a name.
 */
export class UpstreamError extends Error {
  constructor(readonly service: string, readonly status: number | string, message: string) {
    super(message);
    this.name = "UpstreamError";
  }
}
