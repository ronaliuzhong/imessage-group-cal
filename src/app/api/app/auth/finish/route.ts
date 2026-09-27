import { auth } from "@/auth";
import { APP_CALLBACK_URL, createAuthCode, isValidChallenge } from "@/lib/app-auth";

// Step 3 of the app sign-in (see src/lib/app-auth.ts): the person is signed
// in on the website, so send the browser back to the app with a one-time code.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const challenge = url.searchParams.get("challenge");
  if (!isValidChallenge(challenge)) {
    return new Response("This sign-in link doesn't work. Try signing in from the app again.", { status: 400 });
  }

  const userId = (await auth())?.user?.id;
  if (!userId) return Response.redirect(new URL(`/app-auth?challenge=${challenge}`, url), 302);

  const code = await createAuthCode(userId, challenge);
  return Response.redirect(`${APP_CALLBACK_URL}?code=${code}`, 302);
}
