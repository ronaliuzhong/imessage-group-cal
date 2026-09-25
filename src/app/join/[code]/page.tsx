import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { joinGroup } from "@/app/actions";
import { SignInButton } from "@/components/auth-buttons";
import { SubmitButton } from "@/components/submit-button";
import { prisma } from "@/lib/db";

// Where invite links land: /join/<inviteCode>. Signed-out visitors sign in
// first and come straight back here; then one tap joins the group.
export default async function JoinPage({ params }: PageProps<"/join/[code]">) {
  const { code } = await params;
  const [group, session] = await Promise.all([
    prisma.group.findUnique({
      where: { inviteCode: code },
      include: { _count: { select: { members: true } } },
    }),
    auth(),
  ]);

  if (!group) {
    return (
      <Card>
        <h1 className="text-2xl font-semibold">This invite link doesn&apos;t work</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Double-check you copied the whole link, or ask for a new one.
        </p>
        <Link href="/" className="underline">Go to Group Cal</Link>
      </Card>
    );
  }

  const userId = session?.user?.id;
  if (userId) {
    const alreadyMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: group.id, userId } },
    });
    if (alreadyMember) redirect(`/groups/${group.id}`);
  }

  const count = group._count.members;
  return (
    <Card>
      <p className="text-sm uppercase tracking-wide text-zinc-500">You&apos;re invited to</p>
      <h1 className="text-3xl font-semibold">{group.name}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {count} {count === 1 ? "person has" : "people have"} joined. Joining shares when you&apos;re
        busy or free with this group — never what your events are.
      </p>
      {userId ? (
        <form action={joinGroup.bind(null, code)}>
          <SubmitButton
            pendingLabel="Joining…"
            className="rounded-lg bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700"
          >
            Join group
          </SubmitButton>
        </form>
      ) : (
        <SignInButton label="Sign in with Google to join" redirectTo={`/join/${code}`} />
      )}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-12 sm:px-6 sm:py-24">{children}</main>;
}
