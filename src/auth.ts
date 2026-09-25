import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { Adapter, AdapterAccount } from "next-auth/adapters";
import { prisma } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { APP_CALENDAR_SCOPE, CALENDAR_LIST_SCOPE, FREEBUSY_SCOPE } from "@/lib/google";

// The Prisma adapter saves users, accounts and sessions to our database. We
// wrap its linkAccount (called the first time someone signs in) so tokens are
// encrypted before they're written — the stock adapter stores them as-is.
const baseAdapter = PrismaAdapter(prisma);

function encryptTokens(account: AdapterAccount): AdapterAccount {
  return {
    ...account,
    access_token: account.access_token && encrypt(account.access_token),
    refresh_token: account.refresh_token && encrypt(account.refresh_token),
  };
}

const adapter: Adapter = {
  ...baseAdapter,
  linkAccount: (account) => baseAdapter.linkAccount!(encryptTokens(account)),
};

// Reads AUTH_SECRET, AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from the environment.
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter,
  // "database" sessions: the cookie is a random ID pointing at a Session row,
  // so we can log someone out server-side by deleting the row.
  session: { strategy: "database" },
  providers: [
    Google({
      authorization: {
        params: {
          scope: `openid email profile ${FREEBUSY_SCOPE} ${CALENDAR_LIST_SCOPE} ${APP_CALENDAR_SCOPE}`,
          // "offline" asks Google for a refresh token, so we can check this
          // person's availability later when a friend views the group.
          access_type: "offline",
          // select_account: always show Google's account picker, so people
          // with several Google accounts on one browser choose the right one.
          // consent: Google only issues a refresh token when the consent
          // screen is shown, so show it every time to be sure we get one.
          prompt: "select_account consent",
        },
      },
    }),
  ],
  callbacks: {
    // Expose the user's database ID to our pages and API routes.
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
  events: {
    // linkAccount only runs on someone's very first sign-in. On later sign-ins
    // (e.g. reconnecting after a token expired) Google hands us fresh tokens,
    // and this saves them.
    async signIn({ account }) {
      if (account?.provider !== "google" || !account.access_token) return;
      await prisma.account.updateMany({
        where: { provider: "google", providerAccountId: account.providerAccountId },
        data: {
          access_token: encrypt(account.access_token),
          expires_at: account.expires_at,
          scope: account.scope,
          ...(account.refresh_token && { refresh_token: encrypt(account.refresh_token) }),
        },
      });
    },
  },
});
