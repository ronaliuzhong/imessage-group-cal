-- CreateTable
CREATE TABLE "PlanColor" (
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "color" TEXT NOT NULL,

    CONSTRAINT "PlanColor_pkey" PRIMARY KEY ("planId","userId")
);

-- AddForeignKey
ALTER TABLE "PlanColor" ADD CONSTRAINT "PlanColor_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanColor" ADD CONSTRAINT "PlanColor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
