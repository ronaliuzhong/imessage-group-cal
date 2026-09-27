import { randomBytes } from "node:crypto";
import { normalizeColor } from "@/lib/colors";
import { prisma } from "@/lib/db";

// Creating and joining groups. Shared by the website's Server Actions and the
// iPhone app's endpoints, so both behave the same.

export const MAX_GROUP_NAME = 60;

// 16 random bytes ≈ 3.4×10^38 possibilities: impossible to guess.
const newInviteCode = () => randomBytes(16).toString("base64url");

// "Rona Liu-Zhong" → "Rona"; falls back to the part of the email before "@".
export function firstName(user: { name: string | null; email: string }) {
  return user.name?.trim().split(/\s+/)[0] || user.email.split("@")[0];
}

// A name for a group nobody named, from its members' first names (in the
// order they joined).
export function autoGroupName(firstNames: string[]) {
  const [a, b, c] = firstNames;
  let name: string;
  if (firstNames.length <= 1) name = `${a ?? "Group"}'s chat`;
  else if (firstNames.length === 2) name = `${a} & ${b}`;
  else if (firstNames.length === 3) name = `${a}, ${b} & ${c}`;
  else name = `${a}, ${b} & ${firstNames.length - 2} others`;
  return name.slice(0, MAX_GROUP_NAME);
}

// Creates a group with `userId` as its first member. Returns null if the name
// is empty. normalizeColor() falls back to the default for anything that
// isn't a color.
export async function createGroupFor(userId: string, name: string, color?: string) {
  const trimmed = name.trim().slice(0, MAX_GROUP_NAME);
  if (!trimmed) return null;
  return prisma.group.create({
    data: {
      name: trimmed,
      color: normalizeColor(color),
      inviteCode: newInviteCode(),
      members: { create: { userId } },
    },
  });
}

// A group nobody named (one-on-one chats started from iMessage). It's called
// "Rona's chat" until someone joins, then "Rona & Sam".
export async function createAutoNamedGroupFor(userId: string) {
  const creator = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true } });
  return prisma.group.create({
    data: {
      name: autoGroupName([firstName(creator)]),
      autoNamed: true,
      color: normalizeColor(undefined),
      inviteCode: newInviteCode(),
      members: { create: { userId } },
    },
  });
}

// Adds `userId` to the group with this invite code. Returns the group, or null
// if the code doesn't match one.
export async function joinGroupFor(userId: string, inviteCode: string) {
  const group = await prisma.group.findUnique({ where: { inviteCode } });
  if (!group) return null;
  // upsert = "insert, or do nothing if already a member", so joining twice
  // is harmless.
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId } },
    create: { groupId: group.id, userId },
    update: {},
  });
  if (!group.autoNamed) return group;

  // Keep an unnamed group's name in step with who's in it.
  const members = await prisma.groupMember.findMany({
    where: { groupId: group.id },
    orderBy: { joinedAt: "asc" },
    include: { user: { select: { name: true, email: true } } },
  });
  const name = autoGroupName(members.map((m) => firstName(m.user)));
  if (name === group.name) return group;
  return prisma.group.update({ where: { id: group.id }, data: { name } });
}
