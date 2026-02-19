import { useEffect, useRef, useState } from "react";  
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { parseIsoDurationToSeconds } from "../utils/youtube";
import type { YouTubePlayer } from "react-youtube";
import YouTube from "react-youtube";

// Media
import NeroLogo from "../../../Media/nero_logo.jpeg";
import VinylRing from "../../../Media/vinyl2.png";
import SynthwaveBg from "../../../Media/synthwave1.jpg";
import CrateImg from "../../../Media/crate.png";

const API_BASE = "http://localhost:3000";

type Participant = { id: string; name: string; isHost: boolean };
type Track = { title: string; providerId: string; artworkUrl?: string | null; artist?: string | null };
type QueueItem = { id: string; status: string; position: number; track: Track; addedBy?: { name: string } };
type YTItem = {
videoId: string;
  title: string;
  channelTitle: string;
  artworkUrl: string | null;
  durationIso: string | null;
};
type CrateSlot = { track: Track } | null;
type DragPayload = { track: Track; fromIndex: number | null };


export default function PartyRoomPage() {
  const { code } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();

  const partyCode = (code ?? "").toUpperCase();
  const initialName = sp.get("name") ?? "";
  const pid = sp.get("pid");

  const [name] = useState(initialName);
  const [participantId, setParticipantId] = useState<string | null>(null);

  const [participants, setParticipants] = useState<Participant[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const [socketReady, setSocketReady] = useState(false);

  // Search state
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<YTItem[]>([]);
  const [searching, setSearching] = useState(false);

  // My Crate state
  const [crateSlots, setCrateSlots] = useState<CrateSlot[]>(Array(5).fill(null));
  const draggingItemRef = useRef<DragPayload | null>(null);
  const [isDraggingCrateItem, setIsDraggingCrateItem] = useState(false);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);

  // YT Audio state
  const [currentVideoId, setCurrentVideoId] = useState<string | null>(null);

  // Playback state for sync w/ YT player
  const [currentQueueItemId, setCurrentQueueItemId] = useState<string | null>(null);
  const [currentStartedAt, setCurrentStartedAt] = useState<string | null>(null);
  const [player, setPlayer] = useState<YouTubePlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  // End-party results
  const [showResults, setShowResults] = useState(false);
  const [partyResults, setPartyResults] = useState<{
    hasStandouts: boolean;
    topSongs: { rank: number; title: string; artist: string | null; artworkUrl: string | null; score: number }[];
  } | null>(null);

  // Refs for socket-based playback sync
  const playerRef = useRef<YouTubePlayer | null>(null);
  const crateTouched = useRef(false);

  const me = participants.find((p) => p.id === participantId);
  const isHost = !!me?.isHost;

  const currentItem = queue.find((q) => q.id === currentQueueItemId) ?? null;
  const currentVideoIdFromParty = currentItem?.track?.providerId ?? null;
  const firstQueued = queue.find((q) => q.status === "QUEUED") ?? null;
  const displayCurrentItem = currentItem ?? firstQueued;
  const upcomingQueue = queue.filter((q) => q.status === "QUEUED");

  function handleVinylDragStart(e: React.DragEvent) {
    if (!displayCurrentItem?.track) return;
    e.dataTransfer.setData("text/plain", "");
    e.dataTransfer.effectAllowed = "move";
    draggingItemRef.current = { track: displayCurrentItem.track, fromIndex: null };
    setIsDraggingCrateItem(true);
  }

  function handleVinylDragEnd() {
    draggingItemRef.current = null;
    setIsDraggingCrateItem(false);
    setDragOverSlotIndex(null);
  }

  function handleSlotDragStart(e: React.DragEvent, slotIndex: number) {
    const slot = crateSlots[slotIndex];
    if (!slot?.track) return;
    e.dataTransfer.setData("text/plain", "");
    e.dataTransfer.effectAllowed = "move";
    draggingItemRef.current = { track: slot.track, fromIndex: slotIndex };
    setIsDraggingCrateItem(true);
  }

  function handleSlotDragEnd() {
    draggingItemRef.current = null;
    setIsDraggingCrateItem(false);
    setDragOverSlotIndex(null);
  }

  function handleCrateDrop(e: React.DragEvent, slotIndex: number) {
    e.preventDefault();
    const payload = draggingItemRef.current;
    if (!payload) return;

    crateTouched.current = true;
    setCrateSlots((prev) => {
      const next = [...prev];
      const existingIndex = next.findIndex((slot) => slot?.track.providerId === payload.track.providerId);

      if (payload.fromIndex !== null) {
        if (payload.fromIndex === slotIndex) return prev;
        const temp = next[slotIndex];
        next[slotIndex] = next[payload.fromIndex];
        next[payload.fromIndex] = temp;
        return next;
      }

      if (existingIndex !== -1 && existingIndex !== slotIndex) {
        return prev; // prevent duplicates from vinyl drag
      }

      next[slotIndex] = { track: payload.track };
      return next;
    });

    draggingItemRef.current = null;
    setIsDraggingCrateItem(false);
    setDragOverSlotIndex(null);
  }

  // Setup 
  useEffect(() => {
    if (!partyCode) return;

    const s = io(API_BASE, { transports: ["websocket"] });
    socketRef.current = s;

    s.on("connect", () => {
      console.log("socket connected", s.id);
      setSocketReady(true);
    });

    s.on("connect_error", (err: any) => {
      console.error("socket error", err);
      setError(err?.message ?? "socket error");
    });

    s.on("party:participants", (list: Participant[]) => setParticipants(list));

    s.on("party:state", (snapshot: any) => {
      const p = snapshot?.party;
      setCurrentQueueItemId(p?.currentQueueItemId ?? null);
      setCurrentStartedAt(p?.currentStartedAt ?? null);
      if (p?.participants) setParticipants(p.participants);
      if (p?.queue) setQueue(p.queue);
    });

    s.on("queue:update", (q: QueueItem[]) => setQueue(q));

    s.on("playback:sync", (msg: any) => {
      setCurrentQueueItemId(msg?.currentQueueItemId ?? null);
      setCurrentStartedAt(msg?.currentStartedAt ?? null);

      // Direct player sync: if the player is ready, seek + play immediately
      const p = playerRef.current;
      if (p && msg?.currentStartedAt) {
        const elapsed = Math.max(0, (Date.now() - new Date(msg.currentStartedAt).getTime()) / 1000);
        try {
          p.seekTo(elapsed, true);
          p.playVideo();
        } catch {}
      }
    });

    s.on("party:results", (data: any) => {
      setPartyResults(data);
      setShowResults(true);
      setCurrentQueueItemId(null);
      setCurrentStartedAt(null);
      playerRef.current?.stopVideo?.();
    });

    s.on("playback:do-pause", () => {
      playerRef.current?.pauseVideo?.();
    });

    s.on("playback:do-resume", (data: any) => {
      const p = playerRef.current;
      if (p) {
        p.seekTo(data?.currentTime ?? 0, true);
        p.playVideo();
      }
    });

    s.on("playback:do-seek", (data: any) => {
      playerRef.current?.seekTo?.(data?.currentTime ?? 0, true);
    });

    return () => {
      setSocketReady(false);
      s.disconnect();
      socketRef.current = null;
    };
  }, [partyCode]);

  // Load and sync current video
  useEffect(() => {
    if (!player) return;
    if (!currentStartedAt) return;
    if (!currentVideoIdFromParty) return;

    const startedMs = new Date(currentStartedAt).getTime();
    const elapsedSec = Math.max(0, (Date.now() - startedMs) / 1000);

    // wait a beat to ensure iframe is ready
    const t = setTimeout(() => {
      try {
        player.seekTo(elapsedSec, true);
        player.playVideo();
      } catch (e) {
        console.warn("seek/play failed (will retry on next sync)", e);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [player, currentVideoIdFromParty, currentStartedAt]);


  // Resume mechanic
  useEffect(() => {
    if (!socketReady) return;
    const s = socketRef.current;
    if (!s) return;

    if (pid && !participantId) {
      s.emit("party:resume", { partyCode, participantId: pid }, (ack: any) => {
        if (!ack?.ok) setError(ack?.error ?? "failed to resume");
        else setParticipantId(pid);
      });
    } else if (initialName && !pid && !participantId) {
      // Joining participant — auto-join with name from URL
      s.emit("party:join", { partyCode, name: initialName.trim() }, (ack: any) => {
        if (!ack?.ok) setError(ack?.error ?? "failed to join");
        else setParticipantId(ack.participantId);
      });
    }
  }, [socketReady]);

  useEffect(() => {
    const q = query.trim();
    if (!q || q.length < 3) {
      setResults([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setSearching(true);
        const resp = await fetch(`http://localhost:3000/api/youtube/search?q=${encodeURIComponent(q)}`);
        const data = await resp.json();
        if (!resp.ok) throw new Error(data?.error ?? "search failed");
        setResults(data.items ?? []);
      } catch (e: any) {
        setError(e?.message ?? "search error");
      } finally {
        setSearching(false);
      }
    }, 800);

    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const first = queue[0]?.track?.providerId ?? null;
    setCurrentVideoId(first);
  }, [queue]);

  // Keep playerRef in sync with player state
  useEffect(() => { playerRef.current = player; }, [player]);

  // Sync crate to server whenever user modifies it
  useEffect(() => {
    if (!crateTouched.current) return;
    const s = socketRef.current;
    if (!s || !participantId) return;
    const crate = crateSlots
      .map((slot, i) => (slot ? { rank: i + 1, providerId: slot.track.providerId } : null))
      .filter(Boolean);
    s.emit("crate:set", { partyCode, participantId, crate });
  }, [crateSlots, participantId, partyCode]);

  function addFromSearch(item: YTItem) {
    setError(null);
    const s = socketRef.current;
    if (!s || !s.connected) return setError("Socket not connected");
    if (!participantId) return setError("Join first");

    s.emit(
      "queue:add",
      {
        partyCode,
        participantId,
        youtubeVideoId: item.videoId,
        title: item.title,
        artworkUrl: item.artworkUrl,
        durationSec: parseIsoDurationToSeconds(item.durationIso),
        artist: item.channelTitle,
      },
      (ack: any) => {
        if (!ack?.ok) setError(ack?.error ?? "failed to add");
        else setQuery(""); // nice UX: clear search on add
      }
    );
  }

  function onPlayerStateChange(e: any) {
    const state = e?.data;
    setIsPlaying(state === 1);
    // 0 == ended
    if (state === 0 && isHost && participantId) {
      socketRef.current?.emit("playback:ended", { partyCode, participantId });
    }
  }

  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-50">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat opacity-20"
        style={{ backgroundImage: `url(${SynthwaveBg})` }}
      />
      <div className="relative mx-auto max-w-6xl px-6 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={NeroLogo}
              alt="Nero logo"
              className="h-10 w-10 rounded-full border border-zinc-800 object-cover"
            />
            <div>
              <div className="text-xs tracking-widest text-zinc-400">PARTY</div>
              <div className="mt-1 text-2xl font-semibold">#{partyCode}</div>
            </div>
          </div>

          {!participantId ? (
            <div className="text-sm text-zinc-400">Joining…</div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="text-sm text-zinc-300">You're in as <span className="text-zinc-50">{name}</span></div>
              {isHost && (
                <button
                  className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
                  onClick={() => {
                    socketRef.current?.emit("party:end", { partyCode, participantId }, (ack: any) => {
                      if (!ack?.ok) setError(ack?.error ?? "failed to end party");
                    });
                  }}
                >
                  End Party
                </button>
              )}
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        )}

        <div className="mt-6 grid gap-4 md:grid-cols-[260px_1fr_320px]">
          {/* Left: My Crate */}
          <Panel title="My Crate">
            <div className="grid gap-2">
              {crateSlots.map((slot, i) => (
                <div
                  key={i}
                  className={`flex items-center justify-between rounded-xl border px-3 py-3 transition ${
                    isDraggingCrateItem
                      ? "border-zinc-700 bg-zinc-900/30"
                      : "border-zinc-800 bg-zinc-900/20"
                  } ${dragOverSlotIndex === i ? "ring-2 ring-zinc-500" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDragEnter={(e) => { e.preventDefault(); setDragOverSlotIndex(i); }}
                  onDragLeave={() => setDragOverSlotIndex((prev) => (prev === i ? null : prev))}
                  onDrop={(e) => handleCrateDrop(e, i)}
                >
                  <div className="text-sm text-zinc-200">#{i + 1}</div>
                  {slot ? (
                    <div
                      className="flex min-w-0 items-center gap-2"
                      draggable
                      onDragStart={(e) => handleSlotDragStart(e, i)}
                      onDragEnd={handleSlotDragEnd}
                    >
                      <img
                        src={slot.track.artworkUrl ?? ""}
                        className="h-8 w-8 rounded-md object-cover"
                        alt=""
                      />
                      <div className="max-w-[8rem] truncate text-xs text-zinc-300">
                        {slot.track.title}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-zinc-500">Drop a song here</div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-3 text-xs text-zinc-500">
              Drag the vinyl into your crate to save it. Rank songs 1-5. Higher rank = more points.
            </div>
            <img
              src={CrateImg}
              alt="Milk crate"
              className="mt-20 h-44 w-full rounded-xl object-contain"
            />
          </Panel>

          {/* Center: Vinyl + Control Bar */}
          <Panel title="Now Spinning">
            <div className="flex flex-col items-center justify-center py-8">
              <div
                draggable={!!displayCurrentItem?.track}
                onDragStart={(e) => handleVinylDragStart(e)}
                onDragEnd={handleVinylDragEnd}
              >
                <VinylPlaceholder
                  artworkUrl={displayCurrentItem?.track?.artworkUrl ?? null}
                  title={displayCurrentItem?.track?.title ?? "Nothing playing yet"}
                  isPlaying={isPlaying}
                />
              </div>

              <div className="mt-4 text-center">
                <div className="max-w-[22rem] truncate text-lg font-semibold">
                  {displayCurrentItem?.track?.title ?? "Add something to the queue"}
                </div>
                <div className="mt-1 text-sm text-zinc-400">
                  {displayCurrentItem?.track?.artist ?? ""}
                </div>
              </div>

              {/* Hidden YouTube player (audio engine) */}
              <div className="absolute -left-[9999px] -top-[9999px] h-0 w-0 overflow-hidden">
                {currentVideoIdFromParty ? (
                  <YouTube
                    key={currentVideoIdFromParty}
                    videoId={currentVideoIdFromParty}
                    onReady={(e: any) => {
                      const p = e.target;
                      setPlayer(p);
                      // Immediately sync if playback is in progress
                      if (currentStartedAt) {
                        const elapsed = Math.max(0, (Date.now() - new Date(currentStartedAt).getTime()) / 1000);
                        setTimeout(() => {
                          try {
                            p.seekTo(elapsed, true);
                            p.playVideo();
                          } catch {}
                        }, 300);
                      }
                    }}
                    onStateChange={onPlayerStateChange}
                    opts={{
                      width: "1",
                      height: "1",
                      playerVars: {
                        autoplay: 1,  
                        controls: 0,
                        rel: 0,
                        modestbranding: 1,
                      },
                    }}
                  />
                ) : null}
              </div>

              <PlaybackBar
                player={player}
                title={currentItem?.track?.title ?? "Nothing playing"}
                artist={currentItem?.track?.artist ?? ""}
                artworkUrl={currentItem?.track?.artworkUrl ?? null}
                isHost={isHost}
                onNext={() => socketRef.current?.emit("playback:next", { partyCode, participantId })}
                onPause={() => socketRef.current?.emit("playback:pause", { partyCode, participantId })}
                onResume={async () => {
                  const ct = player ? await player.getCurrentTime() : 0;
                  socketRef.current?.emit("playback:resume", { partyCode, participantId, currentTime: ct });
                }}
                onSeek={(time: number) => socketRef.current?.emit("playback:seek", { partyCode, participantId, currentTime: time })}
                onStart={() => socketRef.current?.emit("playback:start", { partyCode, participantId })}
                hasQueuedSongs={upcomingQueue.length > 0}
                isTrackLoaded={!!currentQueueItemId}
                disabled={!participantId || !socketReady}
              />

            </div>
          </Panel>
          
          { /* Right: Search, Queue, People */ }
          <div className="grid w-full min-w-0 gap-4">
            <Panel title="Search YouTube">
              <div className="w-full overflow-x-hidden">
                <input
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search a track…"
                  disabled={!participantId}
                />
                {searching && <div className="mt-2 text-xs text-zinc-500">Searching…</div>}

                <div className="mt-3 max-h-[calc(100vh-22rem)] overflow-x-hidden overflow-y-auto pr-1">
                  <div className="grid min-w-0 gap-2">
                    {results.slice(0, 6).map((r) => (
                      <button
                        key={r.videoId}
                        className="flex w-full min-w-0 items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/20 p-3 text-left hover:bg-zinc-800/30"
                        onClick={() => addFromSearch(r)}
                      >
                        <img
                          src={r.artworkUrl ?? ""}
                          className="h-10 w-10 rounded-lg object-cover"
                          alt=""
                        />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{r.title}</div>
                          <div className="text-xs text-zinc-500">{r.channelTitle}</div>
                        </div>
                        <div className="text-xs text-zinc-500">Add</div>
                      </button>
                    ))}
                  </div>
                </div>

                {!participantId && (
                  <div className="mt-3 text-xs text-zinc-500">Join the party to search and add.</div>
                )}
              </div>
            </Panel>

            <Panel title="Queue">
              {upcomingQueue.length === 0 ? (
                <div className="text-sm text-zinc-500">No upcoming tracks.</div>
              ) : (
                <div className="grid gap-2">
                  {upcomingQueue.map((qi) => (
                    <div
                      key={qi.id}
                      className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-900/20 p-3"
                    >
                      <img
                        src={qi.track.artworkUrl ?? ""}
                        className="h-10 w-10 rounded-lg object-cover"
                        alt=""
                      />
                      <div className="min-w-0 flex-1">
                        <div className="max-w-[14rem] truncate text-sm font-medium">
                          {qi.track.title}
                        </div>
                        <div className="text-xs text-zinc-500">
                          added by {qi.addedBy?.name ?? "?"}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="People">
              {participants.length === 0 ? (
                <div className="text-sm text-zinc-500">No one here yet.</div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {participants.map((p) => (
                    <div
                      key={p.id}
                      className="rounded-full border border-zinc-800 bg-zinc-900/30 px-3 py-1 text-sm"
                    >
                      {p.name}
                      {p.isHost ? <span className="ml-2 text-xs text-zinc-400">host</span> : null}
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>
        </div>
      </div>

      {/* End-party results modal */}
      {showResults && partyResults && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="mx-4 w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
            <h2 className="text-center text-2xl font-bold text-zinc-50">Party's Over!</h2>
            {partyResults.hasStandouts ? (
              <div className="mt-6 space-y-3">
                <div className="text-center text-sm text-zinc-400">Top Songs</div>
                {partyResults.topSongs.map((song) => (
                  <div
                    key={song.rank}
                    className="flex items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-3"
                  >
                    <div className="text-lg font-bold text-zinc-400">#{song.rank}</div>
                    {song.artworkUrl && (
                      <img src={song.artworkUrl} className="h-12 w-12 rounded-lg object-cover" alt="" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-zinc-100">{song.title}</div>
                      <div className="text-xs text-zinc-500">{song.artist ?? ""}</div>
                    </div>
                    <div className="text-sm font-bold text-zinc-300">{song.score} pts</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-6 text-center text-lg text-zinc-400">No songs stood out!</div>
            )}
            <button
              className="mt-6 w-full rounded-xl bg-zinc-800 px-4 py-3 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
              onClick={() => navigate("/")}
            >
              Start / Join a New Party
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/20 p-4 shadow-sm">
      <div className="mb-3 text-sm font-semibold text-zinc-200">{title}</div>
      {children}
    </div>
  );
}

function VinylPlaceholder({
  artworkUrl,
  title,
  isPlaying,
}: {
  artworkUrl: string | null;
  title: string;
  isPlaying: boolean;
}) {
  return (
    <div className="relative h-72 w-72">
      <img
        src={VinylRing}
        alt="Vinyl record"
        draggable={false}
        className={`absolute inset-0 h-full w-full object-contain ${
          isPlaying ? "animate-[spin_18s_linear_infinite]" : ""
        }`}
      />

      <div className="absolute left-1/2 top-[50%] h-32 w-32 -translate-x-1/2 -translate-y-1/2">
        <div
          className={`h-full w-full overflow-hidden rounded-full ring-1 ring-zinc-700 ${
            isPlaying ? "animate-[spin_18s_linear_infinite]" : ""
          }`}
        >
          {artworkUrl ? (
            <img src={artworkUrl} alt={title} draggable={false} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-zinc-800 text-xs text-zinc-300">
              
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PlaybackBar({
  player,
  title,
  artist,
  artworkUrl,
  isHost,
  onNext,
  onPause,
  onResume,
  onSeek,
  onStart,
  hasQueuedSongs,
  isTrackLoaded,
  disabled,
}: {
  player: any;
  title: string;
  artist: string;
  artworkUrl: string | null;
  isHost: boolean;
  onNext: () => void;
  onPause: () => void;
  onResume: () => void;
  onSeek: (time: number) => void;
  onStart: () => void;
  hasQueuedSongs: boolean;
  isTrackLoaded: boolean;
  disabled: boolean;
}) {
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [paused, setPaused] = useState(true);

  useEffect(() => {
    let t: any = null;

    async function tick() {
      if (!player) return;
      try {
        const d = await player.getDuration();
        const c = await player.getCurrentTime();
        const state = await player.getPlayerState(); // 1 playing, 2 paused
        setDur(d || 0);
        setCur(c || 0);
        setPaused(state !== 1);
      } catch {}
    }

    t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [player]);

  function fmt(x: number) {
    if (!isFinite(x)) return "0:00";
    const m = Math.floor(x / 60);
    const s = Math.floor(x % 60);
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  async function toggle() {
    // Nothing loaded yet — kick off the first queued song
    if (!isTrackLoaded && hasQueuedSongs) {
      onStart();
      return;
    }
    if (!player) return;
    const state = await player.getPlayerState();
    if (state === 1) {
      player.pauseVideo();
      onPause();
    } else {
      player.playVideo();
      onResume();
    }
  }

  async function seek(v: number) {
    if (!player) return;
    player.seekTo(v, true);
    setCur(v);
    onSeek(v);
  }

  return (
    <div className="mt-6 w-full max-w-xl rounded-2xl border border-zinc-800 bg-zinc-900/20 p-4">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-800/40">
          {artworkUrl ? <img src={artworkUrl} className="h-full w-full object-cover" /> : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="max-w-[14rem] truncate text-sm font-semibold">{title}</div>
          <div className="truncate text-xs text-zinc-500">{artist}</div>
        </div>

        {isHost ? (
          <>
            <button
              className="rounded-xl border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
              onClick={toggle}
              disabled={disabled || (!player && !hasQueuedSongs)}
            >
              {paused ? "Play" : "Pause"}
            </button>
            <button
              className="rounded-xl border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
              onClick={onNext}
              disabled={disabled}
            >
              Next
            </button>
          </>
        ) : null}
      </div>

      <div className="mt-3">
        <input
          type="range"
          min={0}
          max={Math.max(1, dur)}
          value={Math.min(cur, Math.max(1, dur))}
          onChange={(e) => seek(Number(e.target.value))}
          className="w-full"
          disabled={!isHost}
        />
        <div className="mt-1 flex justify-between text-xs text-zinc-500">
          <span>{fmt(cur)}</span>
          <span>{fmt(dur)}</span>
        </div>
      </div>
    </div>
  );
}



