import { useState } from "react";
import { useNavigate } from "react-router-dom";

//Media
import NeroLogo from "../../../Media/nero_logo.jpeg";
import SynthwaveBg from "../../../Media/synthwave1.jpg";

const API_BASE = "http://localhost:3000";

export default function LandingPage() {
  const nav = useNavigate();

  const [hostName, setHostName] = useState("");
  const [partyName, setPartyName] = useState("Nero Party");
  const [maxQueueLength, setMaxQueueLength] = useState(30);
  const [maxSongsPerUser, setMaxSongsPerUser] = useState(5);
  const [timeLimitMin, setTimeLimitMin] = useState(60);

  const [joinCode, setJoinCode] = useState("");
  const [joinName, setJoinName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function createParty() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/party`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: partyName.trim(),
          hostName: hostName.trim(),
          maxQueueLength,
          maxSongsPerUser,
          timeLimitSec: timeLimitMin * 60,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "failed to create party");

      nav(`/party/${data.partyCode}?name=${encodeURIComponent(hostName.trim())}&pid=${data.hostParticipantId}`);
    } catch (e: any) {
      setError(e?.message ?? "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  function joinParty() {
    setError(null);
    const code = joinCode.trim().toUpperCase();
    const jn = joinName.trim();
    if (!code) {
      setError("Enter a party code");
      return;
    }
    if (!jn) {
      setError("Enter your name");
      return;
    }
    nav(`/party/${code}?name=${encodeURIComponent(jn)}`);
  }

  return (
    <div className="relative min-h-screen bg-zinc-950 text-zinc-50">
      <div
        className="pointer-events-none absolute inset-0 bg-cover bg-center bg-no-repeat opacity-15"
        style={{ backgroundImage: `url(${SynthwaveBg})` }}
      />
      <div className="relative mx-auto max-w-5xl px-6 py-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={NeroLogo}
              alt="Nero logo"
              className="h-10 w-10 rounded-full border border-zinc-800 object-cover"
            />
            <div>
            <div className="text-sm tracking-widest text-zinc-400">NERO PARTY</div>
            <h1 className="mt-2 text-4xl font-semibold">Listen together. Build your crate.</h1>
            <p className="mt-2 text-zinc-300">
              Build a crate of your favorite 5 songs. The most saved song wins!
            </p>
          </div>
          </div>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {/* Create */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Start a new party</h2>
            <div className="mt-5 grid gap-3">
              <Field label="Host name">
                <Input value={hostName} onChange={setHostName} placeholder="Tom" />
              </Field>
              <Field label="Party name">
                <Input value={partyName} onChange={setPartyName} placeholder="Friday Night" />
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="Max queue">
                  <NumberInput value={maxQueueLength} onChange={setMaxQueueLength} min={1} />
                </Field>
                <Field label="Songs/user">
                  <NumberInput value={maxSongsPerUser} onChange={setMaxSongsPerUser} min={1} max={10} />
                </Field>
                <Field label="Time (min)">
                  <NumberInput value={timeLimitMin} onChange={setTimeLimitMin} min={5} step={5} />
                </Field>
              </div>

              <button
                className="mt-2 rounded-xl bg-zinc-50 px-4 py-2 font-medium text-zinc-950 hover:bg-white disabled:opacity-50"
                onClick={createParty}
                disabled={loading || !hostName.trim() || !partyName.trim()}
              >
                {loading ? "Creating..." : "Create party"}
              </button>
            </div>
          </div>

          {/* Join */}
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Join a party</h2>
            <p className="mt-2 text-sm text-zinc-300">Paste a code from a friend.</p>

            <div className="mt-5 grid gap-3">
              <Field label="Your name">
                <Input value={joinName} onChange={setJoinName} placeholder="Your name" />
              </Field>
              <Field label="Party code">
                <div className="flex gap-3">
                  <Input value={joinCode} onChange={setJoinCode} placeholder="JZUX3F" />
                  <button
                    className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-2 font-medium hover:bg-zinc-800 disabled:opacity-50"
                    onClick={joinParty}
                    disabled={!joinName.trim() || !joinCode.trim()}
                  >
                    Join
                  </button>
                </div>
              </Field>
            </div>

            {error && (
              <div className="mt-4 rounded-xl border border-red-900/60 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="mt-10 text-xs text-zinc-500">

        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <div className="text-xs text-zinc-400">{label}</div>
      {children}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-zinc-600"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-zinc-100 outline-none focus:border-zinc-600"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
