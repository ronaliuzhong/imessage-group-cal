-- CreateTable
CREATE TABLE "CancelUndo" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancelUndo_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "CancelUndo" ADD CONSTRAINT "CancelUndo_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
