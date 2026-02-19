import { io } from "socket.io-client";

const PARTY_CODE = process.env.PARTY_CODE;      
const PARTICIPANT_ID = process.env.PARTICIPANT_ID;
const NAME = process.env.NAME || "Tom";

if (!PARTY_CODE || !PARTICIPANT_ID) {
  console.error("Missing PARTY_CODE or PARTICIPANT_ID env vars.");
  console.error("Example:");
  console.error('PARTY_CODE=JZUX3F PARTICIPANT_ID=... node scripts/test-queue-add.mjs');
  process.exit(1);
}

const socket = io("http://localhost:3000", { transports: ["websocket"] });

socket.on("connect", () => {
  console.log("connected:", socket.id);

  socket.emit("party:join", { partyCode: PARTY_CODE, name: NAME }, (ack) => {
    console.log("party:join ack:", ack);

    // Try adding a song
    const song = {
      partyCode: PARTY_CODE,
      participantId: PARTICIPANT_ID,
      youtubeVideoId: "dQw4w9WgXcQ",
      title: "Rick Astley - Never Gonna Give You Up",
      artworkUrl: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
      durationSec: 213,
      artist: "Rick Astley",
    };

    socket.emit("queue:add", song, (ack2) => {
      console.log("queue:add ack:", ack2);

      // Attempt duplicate add to confirm rejection
      socket.emit("queue:add", song, (ack3) => {
        console.log("queue:add duplicate ack:", ack3);
        socket.disconnect();
      });
    });
  });
});

socket.on("party:state", (snapshot) => {
  console.log("party:state received. queue length:", snapshot?.party?.queue?.length);
});

socket.on("queue:update", (queue) => {
  console.log("queue:update received. queue length:", queue?.length);
  if (queue?.length) {
    console.log("first item:", {
      title: queue[0]?.track?.title,
      providerId: queue[0]?.track?.providerId,
      addedBy: queue[0]?.addedBy?.name,
      status: queue[0]?.status,
    });
  }
});

socket.on("connect_error", (err) => {
  console.error("connect_error:", err.message);
});
