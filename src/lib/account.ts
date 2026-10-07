import { removeUserFromPlan, syncPlanForEveryone } from "@/lib/calendar-sync";
import { prisma } from "@/lib/db";
import { deleteAppCalendar, revokeGoogleAccess } from "@/lib/google";

// Deleting someone's account, from the website or the app (Apple requires
// apps with sign-in to offer this, and the privacy policy promises it).
// Groups shared with others keep going without them; plans they proposed
// stay for everyone else.
export async function deleteAccountFor(userId: string) {
  // 1. Their Google Calendar: delete the whole "Coucal" calendar in one go.
  //    If that's not possible, take each plan off it one by one.
  if (!(await deleteAppCalendar(userId))) {
    const answered = await prisma.plan.findMany({
      where: { OR: [{ rsvps: { some: { userId } } }, { occurrenceRsvps: { some: { userId } } }] },
      select: { id: true },
    });
    for (const plan of answered) await removeUserFromPlan(plan.id, userId);
  }

  // 2. Groups where they're the last member go away. Anyone who answered
  //    those plans from a link gets them taken off their calendar first.
  const memberships = await prisma.groupMember.findMany({
    where: { userId },
    select: { groupId: true, group: { select: { _count: { select: { members: true } } } } },
  });
  const lastMemberOf = memberships.filter((m) => m.group._count.members === 1).map((m) => m.groupId);
  const orphanedPlans = await prisma.plan.findMany({
    where: { groupId: { in: lastMemberOf }, cancelledAt: null },
    select: { id: true },
  });
  for (const plan of orphanedPlans) {
    await prisma.plan.update({ where: { id: plan.id }, data: { cancelledAt: new Date() } });
    await syncPlanForEveryone(plan.id);
  }
  await prisma.group.deleteMany({ where: { id: { in: lastMemberOf } } });

  // 3. Google forgets Coucal's access; 4. everything else of theirs is
  //    deleted with them (sign-ins, answers, memberships, app sign-ins...).
  await revokeGoogleAccess(userId);
  await prisma.user.delete({ where: { id: userId } });
}
