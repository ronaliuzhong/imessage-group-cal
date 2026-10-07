import { withAppUser } from "@/lib/app-api";
import { deleteAccountFor } from "@/lib/account";

// DELETE: "Delete account" in the iPhone app (Apple requires apps with
// sign-in to offer it). Same as on the website: see src/lib/account.ts.
export async function DELETE(request: Request) {
  return withAppUser(request, async (user) => {
    await deleteAccountFor(user.id);
    return new Response(null, { status: 204 });
  });
}
