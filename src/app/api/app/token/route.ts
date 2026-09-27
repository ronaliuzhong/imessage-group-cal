import { exchangeAuthCode, revokeAppToken } from "@/lib/app-auth";

// POST: step 4 of the app sign-in (see src/lib/app-auth.ts). Body:
// { "code": "...", "verifier": "..." } → { "token": "...", "user": {...} }
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { code, verifier } = body ?? {};
  if (typeof code !== "string" || typeof verifier !== "string") {
    return Response.json({ error: "Send a code and a verifier." }, { status: 400 });
  }

  const result = await exchangeAuthCode(code, verifier);
  if (!result) {
    return Response.json({ error: "That sign-in didn't work. Please try again." }, { status: 400 });
  }
  const { token, user } = result;
  return Response.json({ token, user: { id: user.id, name: user.name ?? user.email, email: user.email } });
}

// DELETE: sign this device out (the token comes in the Authorization header).
export async function DELETE(request: Request) {
  await revokeAppToken(request);
  return new Response(null, { status: 204 });
}
