import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { env } from "./env.js";
import { prisma } from "./prisma.js";
import { makePartyCode } from "./utils.js";

const app = express();
const server = createServer(app);

const io = new Server(server, {
  cors: {
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
  },
});

app.use(cors());
app.use(express.json());

// Helper funcs
async function getPartySnapshot(partyCode: string) {
  const party = await prisma.party.findUnique({
    where: { code: partyCode },
    include: {
      participants: { orderBy: { joinedAt: "asc" } },
      queue: {
        orderBy: { position: "asc" },
        include: { track: true, addedBy: true },
      },
    },
  });

  if (!party) return null;

  // crate entries need separate include since they hang off participants
  const crateEntries = await prisma.crateEntry.findMany({
    where: { participant: { partyId: party.id } },
    include: {
      participant: true,
      queueItem: { include: { track: true } },
    },
  });

  return { party, crateEntries };
}
async function broadcastPlayback(partyCode: string) {
  const snapshot = await getPartySnapshot(partyCode);
  if (!snapshot) return;

  const party = snapshot.party;
  io.to(`party:${partyCode}`).emit("playback:sync", {
    currentQueueItemId: party.currentQueueItemId,
    currentStartedAt: party.currentStartedAt,
    status: party.status,
  });

  // Also keep queue UI fresh
  io.to(`party:${partyCode}`).emit("queue:update", snapshot.party.queue);
}

async function startFirstQueued(partyCode: string) {
  const party = await prisma.party.findUnique({ where: { code: partyCode } });
  if (!party) throw new Error("party not found");

  // already playing? check if the current item is actually still QUEUED/PLAYING
  if (party.currentQueueItemId) {
    const current = await prisma.queueItem.findUnique({ where: { id: party.currentQueueItemId } });
    if (current && (current.status === "QUEUED" || current.status === "PLAYING")) {
      // genuinely still active — just re-broadcast in case clients are out of sync
      await broadcastPlayback(partyCode);
      return;
    }
    // stale reference — clear it and fall through to start next
    await prisma.party.update({
      where: { id: party.id },
      data: { currentQueueItemId: null, currentStartedAt: null },
    });
  }

  const next = await prisma.queueItem.findFirst({
    where: { partyId: party.id, status: "QUEUED" },
    orderBy: { position: "asc" },
  });

  if (!next) {
    // no songs
    await prisma.party.update({
      where: { id: party.id },
      data: { status: "ENDED", endedAt: new Date(), currentQueueItemId: null, currentStartedAt: null },
    });
    await broadcastPlayback(partyCode);
    io.to(`party:${partyCode}`).emit("party:ended");
    return;
  }

  await prisma.queueItem.update({
    where: { id: next.id },
    data: { status: "PLAYING", startedAt: new Date() },
  });

  await prisma.party.update({
    where: { id: party.id },
    data: {
      status: "PLAYING",
      startedAt: party.startedAt ?? new Date(),
      currentQueueItemId: next.id,
      currentStartedAt: new Date(),
    },
  });

  await broadcastPlayback(partyCode);
}

async function advanceToNext(partyCode: string, reason: "ENDED" | "NEXT" | "KICK" = "NEXT") {
  const party = await prisma.party.findUnique({ where: { code: partyCode } });
  if (!party) throw new Error("party not found");

  const currentId = party.currentQueueItemId;

  if (currentId) {
    await prisma.queueItem.update({
      where: { id: currentId },
      data: { status: reason === "KICK" ? "SKIPPED" : "PLAYED", endedAt: new Date() },
    });
  }

  const next = await prisma.queueItem.findFirst({
    where: { partyId: party.id, status: "QUEUED" },
    orderBy: { position: "asc" },
  });

  if (!next) {
    await prisma.party.update({
      where: { id: party.id },
      data: { status: "ENDED", endedAt: new Date(), currentQueueItemId: null, currentStartedAt: null },
    });
    await broadcastPlayback(partyCode);
    io.to(`party:${partyCode}`).emit("party:ended");
    return;
  }

  await prisma.queueItem.update({
    where: { id: next.id },
    data: { status: "PLAYING", startedAt: new Date() },
  });

  await prisma.party.update({
    where: { id: party.id },
    data: { currentQueueItemId: next.id, currentStartedAt: new Date(), status: "PLAYING" },
  });

  await broadcastPlayback(partyCode);
}


// --- Routes ---
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Create party
 * body: { name, hostName, maxQueueLength?, maxSongsPerUser?, timeLimitSec? }
 */
app.post("/api/party", async (req, res) => {
  try {
    const { name, hostName, maxQueueLength, maxSongsPerUser, timeLimitSec } = req.body ?? {};

    if (!name || !hostName) {
      return res.status(400).json({ error: "name and hostName are required" });
    }

    // generate unique party code
    let code = makePartyCode();
    for (let i = 0; i < 5; i++) {
      const exists = await prisma.party.findUnique({ where: { code } });
      if (!exists) break;
      code = makePartyCode();
    }

    const party = await prisma.party.create({
      data: {
        code,
        name,
        status: "LOBBY",
        maxQueueLength: typeof maxQueueLength === "number" ? maxQueueLength : null,
        maxSongsPerUser: typeof maxSongsPerUser === "number" ? maxSongsPerUser : null,
        timeLimitSec: typeof timeLimitSec === "number" ? timeLimitSec : null,
        crateSize: 5,
        participants: {
          create: {
            name: hostName,
            isHost: true,
          },
        },
      },
      include: { participants: true },
    });

    const host = party.participants.find((p) => p.isHost);

    res.json({
      partyCode: party.code,
      partyId: party.id,
      hostParticipantId: host?.id,
    }); 

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to create party" });
  }
});

app.get("/api/party/:code", async (req, res) => {
  try {
    const code = req.params.code;
    const snapshot = await getPartySnapshot(code);
    if (!snapshot) return res.status(404).json({ error: "party not found" });
    res.json(snapshot);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed to load party" });
  }
});  

// YouTube search proxy -- GET /api/youtube/search?q=...
// In-memory cache: query -> { items, timestamp }
const ytCache = new Map<string, { items: any[]; ts: number }>();
const YT_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

app.get("/api/youtube/search", async (req, res) => {
  try {
    const q = String(req.query.q ?? "").trim();
    if (!q) return res.status(400).json({ error: "q is required" });

    if (!env.YOUTUBE_API_KEY) {
      return res.status(500).json({ error: "Missing YOUTUBE_API_KEY" });
    }

    // Check cache
    const cached = ytCache.get(q);
    if (cached && Date.now() - cached.ts < YT_CACHE_TTL) {
      return res.json({ items: cached.items });
    }

    // Search videos
    const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
    searchUrl.searchParams.set("part", "snippet");
    searchUrl.searchParams.set("type", "video");
    searchUrl.searchParams.set("maxResults", "5");
    searchUrl.searchParams.set("q", q);
    searchUrl.searchParams.set("key", env.YOUTUBE_API_KEY);

    const searchResp = await fetch(searchUrl);
    const searchJson: any = await searchResp.json();
    if (!searchResp.ok) {
      return res.status(searchResp.status).json({ error: searchJson?.error?.message ?? "YouTube search failed" });
    }

    const videoIds: string[] = (searchJson.items ?? [])
      .map((it: any) => it?.id?.videoId)
      .filter(Boolean);

    if (videoIds.length === 0) return res.json({ items: [] });

    // Fetch durations + better thumbnails
    const videosUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
    videosUrl.searchParams.set("part", "snippet,contentDetails");
    videosUrl.searchParams.set("id", videoIds.join(","));
    videosUrl.searchParams.set("key", env.YOUTUBE_API_KEY);

    const vidsResp = await fetch(videosUrl);
    const vidsJson: any = await vidsResp.json();
    if (!vidsResp.ok) {
      return res.status(vidsResp.status).json({ error: vidsJson?.error?.message ?? "YouTube videos lookup failed" });
    }

    const items = (vidsJson.items ?? []).map((v: any) => {
      const sn = v.snippet ?? {};
      const cd = v.contentDetails ?? {};
      const thumbs = sn.thumbnails ?? {};

      // pick a nice thumbnail if available
      const thumb =
        thumbs.maxres?.url ||
        thumbs.high?.url ||
        thumbs.medium?.url ||
        thumbs.default?.url ||
        null;

      return {
        videoId: v.id,
        title: sn.title ?? "",
        channelTitle: sn.channelTitle ?? "",
        artworkUrl: thumb,
        durationIso: cd.duration ?? null,
      };
    });

    // Cache result
    ytCache.set(q, { items, ts: Date.now() });

    // Evict old entries periodically
    if (ytCache.size > 200) {
      const now = Date.now();
      for (const [key, val] of ytCache) {
        if (now - val.ts > YT_CACHE_TTL) ytCache.delete(key);
      }
    }

    res.json({ items });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "YouTube proxy error" });
  }
});


// Socket.IO
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("party:join", async (payload, ack) => {
    try {
      const { partyCode, name } = payload ?? {};
      if (!partyCode || !name) {
        ack?.({ ok: false, error: "partyCode and name are required" });
        return;
      }

      const party = await prisma.party.findUnique({ where: { code: partyCode } });
      if (!party) {
        ack?.({ ok: false, error: "party not found" });
        return;
      }

      // Create participant
      const participant = await prisma.participant.create({
        data: {
          partyId: party.id,
          name,
          socketId: socket.id,
          isHost: false,
        },
      });

      // Join Socket.IO room
      socket.join(`party:${partyCode}`);

      // Emit updated participants list
      const participants = await prisma.participant.findMany({
        where: { partyId: party.id },
        orderBy: { joinedAt: "asc" },
      });

      io.to(`party:${partyCode}`).emit("party:participants", participants);

      // Send full state to this socket
      const snapshot = await getPartySnapshot(partyCode);
      socket.emit("party:state", snapshot);

      ack?.({ ok: true, participantId: participant.id, partyId: party.id });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "join failed" });
    }
  });

  // Mainly for adding host as participant automatically
  socket.on("party:resume", async (payload, ack) => {
    try {
      const { partyCode, participantId } = payload ?? {};
      if (!partyCode || !participantId) {
        ack?.({ ok: false, error: "partyCode and participantId required" });
        return;
      }

      const party = await prisma.party.findUnique({ where: { code: partyCode } });
      if (!party) {
        ack?.({ ok: false, error: "party not found" });
        return;
      }

      const participant = await prisma.participant.findFirst({
        where: { id: participantId, partyId: party.id },
      });
      if (!participant) {
        ack?.({ ok: false, error: "participant not found" });
        return;
      }

      await prisma.participant.update({
        where: { id: participant.id },
        data: { socketId: socket.id },
      });

      socket.join(`party:${partyCode}`);

      const participants = await prisma.participant.findMany({
        where: { partyId: party.id },
        orderBy: { joinedAt: "asc" },
      });
      io.to(`party:${partyCode}`).emit("party:participants", participants);

      const snapshot = await getPartySnapshot(partyCode);
      socket.emit("party:state", snapshot);

      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "resume failed" });
    }
  });

  // Queue add functionality
  socket.on("queue:add", async (payload, ack) => {
  try {
    const {
      partyCode,
      participantId,
      youtubeVideoId,
      title,
      artworkUrl,
      durationSec,
      artist,
    } = payload ?? {};

    if (!partyCode || !participantId || !youtubeVideoId || !title) {
      ack?.({ ok: false, error: "missing required fields" });
      return;
    }

    const party = await prisma.party.findUnique({ where: { code: partyCode } });
    if (!party) {
      ack?.({ ok: false, error: "party not found" });
      return;
    }

    const participant = await prisma.participant.findFirst({
      where: { id: participantId, partyId: party.id },
    });
    if (!participant) {
      ack?.({ ok: false, error: "participant not found" });
      return;
    }

    // Enforce max queue length
    if (typeof party.maxQueueLength === "number") {
      const queueCount = await prisma.queueItem.count({
        where: { partyId: party.id, status: { in: ["QUEUED", "PLAYING"] } },
      });
      if (queueCount >= party.maxQueueLength) {
        ack?.({ ok: false, error: "queue is full" });
        return;
      }
    }

    // Enforce max songs per user 
    if (typeof party.maxSongsPerUser === "number") {
      const userCount = await prisma.queueItem.count({
        where: {
          partyId: party.id,
          addedById: participant.id,
          status: { in: ["QUEUED", "PLAYING"] },
        },
      });
      if (userCount >= party.maxSongsPerUser) {
        ack?.({ ok: false, error: "song limit reached" });
        return;
      }
    }

    // Upsert track into per-party Track pool (unique: partyId+provider+providerId)
    const track = await prisma.track.upsert({
      where: {
        partyId_provider_providerId: {
          partyId: party.id,
          provider: "youtube",
          providerId: youtubeVideoId,
        },
      },
      update: {
        title,
        artist: artist ?? null,
        artworkUrl: artworkUrl ?? null,
        durationSec: typeof durationSec === "number" ? durationSec : null,
      },
      create: {
        partyId: party.id,
        provider: "youtube",
        providerId: youtubeVideoId,
        title,
        artist: artist ?? null,
        artworkUrl: artworkUrl ?? null,
        durationSec: typeof durationSec === "number" ? durationSec : null,
      },
    });

    // Check for existing queue entry for this track
    const existing = await prisma.queueItem.findUnique({
      where: { partyId_trackId: { partyId: party.id, trackId: track.id } },
    });
    if (existing) {
      if (existing.status === "QUEUED" || existing.status === "PLAYING") {
        ack?.({ ok: false, error: "already in queue" });
        return;
      }
      // Song was previously played/skipped — clean up old entry so it can be re-added
      await prisma.crateEntry.deleteMany({ where: { queueItemId: existing.id } });
      await prisma.kickVote.deleteMany({ where: { queueItemId: existing.id } });
      await prisma.queueItem.delete({ where: { id: existing.id } });
    }

    // Next position
    const last = await prisma.queueItem.findFirst({
      where: { partyId: party.id },
      orderBy: { position: "desc" },
    });
    const nextPos = (last?.position ?? 0) + 1;

    const queueItem = await prisma.queueItem.create({
      data: {
        partyId: party.id,
        trackId: track.id,
        addedById: participant.id,
        position: nextPos,
        status: "QUEUED",
      },
      include: { track: true, addedBy: true },
    });

    // Broadcast queue update
    const updatedQueue = await prisma.queueItem.findMany({
      where: { partyId: party.id },
      orderBy: { position: "asc" },
      include: { track: true, addedBy: true },
    });

    io.to(`party:${partyCode}`).emit("queue:update", updatedQueue);

      ack?.({ ok: true, queueItem });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "failed to add to queue" });
    }
  });

  // Playback controls (host only)
  socket.on("playback:start", async (payload, ack) => {
    try {
      const { partyCode, participantId } = payload ?? {};
      if (!partyCode || !participantId) return ack?.({ ok: false, error: "missing fields" });

      const party = await prisma.party.findUnique({ where: { code: partyCode } });
      if (!party) return ack?.({ ok: false, error: "party not found" });

      const p = await prisma.participant.findFirst({ where: { id: participantId, partyId: party.id } });
      if (!p?.isHost) return ack?.({ ok: false, error: "host only" });

      await startFirstQueued(partyCode);
      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "failed to start" });
    }
  });

  socket.on("playback:next", async (payload, ack) => {
    try {
      const { partyCode, participantId } = payload ?? {};
      if (!partyCode || !participantId) return ack?.({ ok: false, error: "missing fields" });

      const party = await prisma.party.findUnique({ where: { code: partyCode } });
      if (!party) return ack?.({ ok: false, error: "party not found" });

      const p = await prisma.participant.findFirst({ where: { id: participantId, partyId: party.id } });
      if (!p?.isHost) return ack?.({ ok: false, error: "host only" });

      await advanceToNext(partyCode, "NEXT");
      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "failed to next" });
    }
  });

  socket.on("playback:ended", async (payload, ack) => {
    try {
      const { partyCode, participantId } = payload ?? {};
      if (!partyCode || !participantId) return ack?.({ ok: false, error: "missing fields" });

      const party = await prisma.party.findUnique({ where: { code: partyCode } });
      if (!party) return ack?.({ ok: false, error: "party not found" });

      const p = await prisma.participant.findFirst({ where: { id: participantId, partyId: party.id } });
      if (!p?.isHost) return ack?.({ ok: false, error: "host only" });

      await advanceToNext(partyCode, "ENDED");
      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "failed on ended" });
    }
  });

  // Persist crate entries
  socket.on("crate:set", async (payload, ack) => {
    try {
      const { partyCode, participantId, crate } = payload ?? {};
      if (!partyCode || !participantId) return ack?.({ ok: false, error: "missing fields" });

      const party = await prisma.party.findUnique({ where: { code: partyCode } });
      if (!party) return ack?.({ ok: false, error: "party not found" });

      const participant = await prisma.participant.findFirst({
        where: { id: participantId, partyId: party.id },
      });
      if (!participant) return ack?.({ ok: false, error: "participant not found" });

      // Clear existing crate
      await prisma.crateEntry.deleteMany({ where: { participantId: participant.id } });

      // Re-create entries
      if (Array.isArray(crate)) {
        for (const entry of crate) {
          if (!entry?.providerId) continue;

          const track = await prisma.track.findFirst({
            where: { partyId: party.id, provider: "youtube", providerId: entry.providerId },
          });
          if (!track) continue;

          const queueItem = await prisma.queueItem.findFirst({
            where: { partyId: party.id, trackId: track.id },
          });
          if (!queueItem) continue;

          await prisma.crateEntry.create({
            data: {
              participantId: participant.id,
              queueItemId: queueItem.id,
              rank: entry.rank,
            },
          });
        }
      }

      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "failed to set crate" });
    }
  });

  // End Party (host only) – score crates and broadcast results
  socket.on("party:end", async (payload, ack) => {
    try {
      const { partyCode, participantId } = payload ?? {};
      if (!partyCode || !participantId) return ack?.({ ok: false, error: "missing fields" });

      const party = await prisma.party.findUnique({ where: { code: partyCode } });
      if (!party) return ack?.({ ok: false, error: "party not found" });

      const p = await prisma.participant.findFirst({ where: { id: participantId, partyId: party.id } });
      if (!p?.isHost) return ack?.({ ok: false, error: "host only" });

      // Collect all crate entries for this party
      const crateEntries = await prisma.crateEntry.findMany({
        where: { participant: { partyId: party.id } },
        include: {
          queueItem: { include: { track: true } },
          participant: true,
        },
      });

      // Score: rank 1 = 5 pts, rank 2 = 4 pts, …, rank 5 = 1 pt
      const crateSize = party.crateSize || 5;
      const scores: Record<string, { track: { title: string; artist: string | null; artworkUrl: string | null }; score: number }> = {};

      for (const entry of crateEntries) {
        const trackId = entry.queueItem.trackId;
        const points = crateSize - entry.rank + 1;

        if (!scores[trackId]) {
          scores[trackId] = {
            track: {
              title: entry.queueItem.track.title,
              artist: entry.queueItem.track.artist,
              artworkUrl: entry.queueItem.track.artworkUrl,
            },
            score: 0,
          };
        }
        scores[trackId].score += points;
      }

      const sorted = Object.values(scores).sort((a, b) => b.score - a.score);
      const top3 = sorted.slice(0, 3);
      const hasStandouts = top3.length > 0;

      // End the party
      await prisma.party.update({
        where: { id: party.id },
        data: { status: "ENDED", endedAt: new Date(), currentQueueItemId: null, currentStartedAt: null },
      });

      // Mark any playing items as played
      await prisma.queueItem.updateMany({
        where: { partyId: party.id, status: "PLAYING" },
        data: { status: "PLAYED", endedAt: new Date() },
      });

      // Broadcast results to everyone
      io.to(`party:${partyCode}`).emit("party:results", {
        hasStandouts,
        topSongs: top3.map((s, i) => ({
          rank: i + 1,
          title: s.track.title,
          artist: s.track.artist,
          artworkUrl: s.track.artworkUrl,
          score: s.score,
        })),
      });

      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "failed to end party" });
    }
  });

  // Playback sync: pause (host → all listeners)
  socket.on("playback:pause", async (payload, ack) => {
    try {
      const { partyCode, participantId } = payload ?? {};
      if (!partyCode || !participantId) return ack?.({ ok: false, error: "missing fields" });

      const party = await prisma.party.findUnique({ where: { code: partyCode } });
      if (!party) return ack?.({ ok: false, error: "party not found" });

      const p = await prisma.participant.findFirst({ where: { id: participantId, partyId: party.id } });
      if (!p?.isHost) return ack?.({ ok: false, error: "host only" });

      socket.to(`party:${partyCode}`).emit("playback:do-pause");
      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "pause failed" });
    }
  });

  // Playback sync: resume (host → all listeners)
  socket.on("playback:resume", async (payload, ack) => {
    try {
      const { partyCode, participantId, currentTime } = payload ?? {};
      if (!partyCode || !participantId) return ack?.({ ok: false, error: "missing fields" });

      const party = await prisma.party.findUnique({ where: { code: partyCode } });
      if (!party) return ack?.({ ok: false, error: "party not found" });

      const p = await prisma.participant.findFirst({ where: { id: participantId, partyId: party.id } });
      if (!p?.isHost) return ack?.({ ok: false, error: "host only" });

      socket.to(`party:${partyCode}`).emit("playback:do-resume", { currentTime: currentTime ?? 0 });
      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "resume failed" });
    }
  });

  // Playback sync: seek (host → all listeners)
  socket.on("playback:seek", async (payload, ack) => {
    try {
      const { partyCode, participantId, currentTime } = payload ?? {};
      if (!partyCode || !participantId) return ack?.({ ok: false, error: "missing fields" });

      const party = await prisma.party.findUnique({ where: { code: partyCode } });
      if (!party) return ack?.({ ok: false, error: "party not found" });

      const p = await prisma.participant.findFirst({ where: { id: participantId, partyId: party.id } });
      if (!p?.isHost) return ack?.({ ok: false, error: "host only" });

      socket.to(`party:${partyCode}`).emit("playback:do-seek", { currentTime: currentTime ?? 0 });
      ack?.({ ok: true });
    } catch (e) {
      console.error(e);
      ack?.({ ok: false, error: "seek failed" });
    }
  });

  socket.on("disconnect", async () => {
    console.log("Client disconnected:", socket.id);
    // For now, we keep the participants in the database but just null socketID so rejoin is easy. Good enough for MVP.
    try {
      await prisma.participant.updateMany({
        where: { socketId: socket.id },
        data: { socketId: null },
      });
    } catch (e) {
      console.error("disconnect cleanup failed", e);
    }
  });
});

server.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
