// Which build the server is running, so an app left open for days can tell a newer one has shipped. No passcode: it's only an id.
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD ?? "" }, { headers: { "cache-control": "no-store" } });
}
