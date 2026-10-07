import { randomBytes } from "node:crypto";
import type { Plan } from "@/generated/prisma/client";
import { syncPlanForUser } from "@/lib/calendar-sync";
import { normalizeColor } from "@/lib/colors";
import { prisma } from "@/lib/db";
import { deleteEvent } from "@/lib/google";
import { parsePlanInput, type PlanInput } from "@/lib/plan-input";
import { findOccurrence } from "@/lib/plan-occurrences";

// Creating plans and answering them. Shared by the website's Server Actions
// and the iPhone app's endpoints, so both behave the same (including keeping
// Google Calendar in step).

// Creates a plan in a group `userId` belongs to. The organizer is marked as
// going and it's added to their Google Calendar.
export async function createPlanFor(
  userId: string,
  groupId: string,
  input: PlanInput,
): Promise<{ plan: Plan } | { error: string }> {
  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });
  if (!membership) return { error: "You're not in this group." };

  const parsed = parsePlanInput(input);
  if ("error" in parsed) return parsed;

  const plan = await prisma.plan.create({
    data: {
      ...parsed.fields,
      groupId,
      createdById: userId,
      shareCode: randomBytes(12).toString("base64url"),
      // The organizer is presumably going to their own plan (all of it).
      rsvps: { create: { userId, response: "GOING" } },
    },
  });
  await syncPlanForUser(plan.id, userId);
  return { plan };
}

type PlanWithExceptions = Parameters<typeof findOccurrence>[0] & {
  exceptions: Parameters<typeof findOccurrence>[1];
};

// Parses a "which date" value and checks it's a real date of the plan.
export function parseOccurrence(plan: PlanWithExceptions, value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return findOccurrence(plan, plan.exceptions, date) ? date : null;
}

// Going / can't make it. For repeating plans, `occurrence` is the date being
// answered ("just this one"); leaving it out answers every date ("all of
// them"), replacing any per-date answers. Their Google Calendar is updated to
// match. Returns false if the plan doesn't exist or was cancelled.
export async function setRsvpFor(
  userId: string,
  planId: string,
  response: "GOING" | "NOT_GOING",
  occurrence?: string | null,
) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, include: { exceptions: true } });
  if (!plan || plan.cancelledAt) return false;

  const originalStart = plan.repeatFreq ? parseOccurrence(plan, occurrence) : null;
  if (originalStart) {
    await prisma.occurrenceRsvp.upsert({
      where: { planId_userId_originalStart: { planId, userId, originalStart } },
      create: { planId, userId, originalStart, response },
      update: { response },
    });
  } else {
    // "All of them" replaces any per-date answers, like Google Calendar.
    const dateRsvps = await prisma.occurrenceRsvp.findMany({ where: { planId, userId } });
    for (const r of dateRsvps) if (r.googleEventId) await deleteEvent(userId, r.googleEventId);
    await prisma.occurrenceRsvp.deleteMany({ where: { planId, userId } });
    await prisma.rsvp.upsert({
      where: { planId_userId: { planId, userId } },
      create: { planId, userId, response },
      update: { response },
    });
  }
  await syncPlanForUser(planId, userId);
  return true;
}

// Someone's own color for a plan (null = back to their group color). Only
// they see it; their Google Calendar event is recolored to match. Returns
// false if there's no such plan.
export async function setPlanColorFor(userId: string, planId: string, value: string | null) {
  const plan = await prisma.plan.findUnique({ where: { id: planId }, select: { id: true } });
  if (!plan) return false;
  if (value === null) {
    await prisma.planColor.deleteMany({ where: { planId, userId } });
  } else {
    // normalizeColor() turns anything unrecognized into the default.
    const color = normalizeColor(value);
    await prisma.planColor.upsert({
      where: { planId_userId: { planId, userId } },
      create: { planId, userId, color },
      update: { color },
    });
  }
  await syncPlanForUser(planId, userId);
  return true;
}

