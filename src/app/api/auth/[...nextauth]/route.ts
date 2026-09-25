// Auth.js handles every URL under /api/auth/* — the redirect to Google, the
// callback Google sends people back to, sign-out, and so on.
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
