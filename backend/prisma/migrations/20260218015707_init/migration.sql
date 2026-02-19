-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOBBY',
    "maxQueueLength" INTEGER,
    "maxSongsPerUser" INTEGER,
    "timeLimitSec" INTEGER,
    "crateSize" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    "currentQueueItemId" TEXT,
    "currentStartedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isHost" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "socketId" TEXT,
    CONSTRAINT "Participant_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Track" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "artworkUrl" TEXT,
    "durationSec" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Track_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "QueueItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partyId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" DATETIME,
    "endedAt" DATETIME,
    CONSTRAINT "QueueItem_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QueueItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "QueueItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CrateEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "participantId" TEXT NOT NULL,
    "queueItemId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CrateEntry_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CrateEntry_queueItemId_fkey" FOREIGN KEY ("queueItemId") REFERENCES "QueueItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "KickVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "partyId" TEXT NOT NULL,
    "queueItemId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KickVote_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KickVote_queueItemId_fkey" FOREIGN KEY ("queueItemId") REFERENCES "QueueItem" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "KickVote_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Party_code_key" ON "Party"("code");

-- CreateIndex
CREATE INDEX "Participant_partyId_idx" ON "Participant"("partyId");

-- CreateIndex
CREATE INDEX "Track_partyId_idx" ON "Track"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "Track_partyId_provider_providerId_key" ON "Track"("partyId", "provider", "providerId");

-- CreateIndex
CREATE INDEX "QueueItem_partyId_position_idx" ON "QueueItem"("partyId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "QueueItem_partyId_trackId_key" ON "QueueItem"("partyId", "trackId");

-- CreateIndex
CREATE INDEX "CrateEntry_participantId_idx" ON "CrateEntry"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "CrateEntry_participantId_rank_key" ON "CrateEntry"("participantId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "CrateEntry_participantId_queueItemId_key" ON "CrateEntry"("participantId", "queueItemId");

-- CreateIndex
CREATE INDEX "KickVote_partyId_idx" ON "KickVote"("partyId");

-- CreateIndex
CREATE INDEX "KickVote_queueItemId_idx" ON "KickVote"("queueItemId");

-- CreateIndex
CREATE UNIQUE INDEX "KickVote_queueItemId_participantId_key" ON "KickVote"("queueItemId", "participantId");
