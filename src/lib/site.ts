import { headers } from "next/headers";

// This site's address (e.g. "http://localhost:3000"), for links we put inside
// calendar events. Uses AUTH_URL when it's set; otherwise works it out from
// the incoming request.
export async function siteOrigin(): Promise<string> {
  if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
