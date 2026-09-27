import { appUserFrom } from "@/lib/app-auth";
import { getGrantedScopes } from "@/lib/google";

// Who the app is signed in as, and whether their calendar is connected.
// Also the simplest way for the app to check its token still works.
export async function GET(request: Request) {
  const user = await appUserFrom(request);
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });

  const scopes = await getGrantedScopes(user.id);
  return Response.json({ user, calendarConnected: scopes.freeBusy });
}
