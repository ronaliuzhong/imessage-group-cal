import { redirect } from "next/navigation";
import { auth } from "@/auth";

// For pages and Server Actions that only make sense when signed in. Sends
// signed-out visitors to the home page instead of rendering.
export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  return { id: session.user.id, name: session.user.name ?? session.user.email ?? "You" };
}
