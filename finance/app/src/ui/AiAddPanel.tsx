import { useEffect, useRef, useState } from "react";
import { MicIcon } from "./icons.tsx";
import { extForMime } from "./ledgerParse.ts";

type RecState = "idle" | "recording" | "ready";

function pickMime(): string {
  const types = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  return types.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type AiAddPanelProps = {
  mode: "type" | "speak";
  busy: boolean;
  status: string | null;
  error: string | null;
  text: string;
  onText: (value: string) => void;
  onSubmitText: () => void;
  onSubmitVoice: (blob: Blob, filename: string) => void;
};

export function AiAddPanel({
  mode,
  busy,
  status,
  error,
  text,
  onText,
  onSubmitText,
  onSubmitVoice,
}: AiAddPanelProps) {
  const [rec, setRec] = useState<RecState>("idle");
  const [elapsed, setElapsed] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  function clearTimer() {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function stopTracks() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  useEffect(() => {
    return () => {
      clearTimer();
      stopTracks();
      const mr = recorderRef.current;
      if (mr && mr.state !== "inactive") {
        try {
          mr.stop();
        } catch {
          /* ignore */
        }
      }
    };
  }, []);

  async function startRecording() {
    if (busy || rec === "recording") return;
    setRecError(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setRecError("This browser cannot record audio.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickMime();
      const options: MediaRecorderOptions = {};
      if (mime) options.mimeType = mime;
      options.audioBitsPerSecond = 128000;
      let mr: MediaRecorder;
      try {
        mr = new MediaRecorder(stream, options);
      } catch {
        mr = new MediaRecorder(stream);
      }
      chunksRef.current = [];
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorderRef.current = mr;
      startedRef.current = Date.now();
      setElapsed(0);
      setRec("recording");
      clearTimer();
      timerRef.current = window.setInterval(() => {
        setElapsed(Date.now() - startedRef.current);
      }, 200);
      mr.start(1000);
    } catch (err) {
      stopTracks();
      setRec("idle");
      setRecError(err instanceof Error ? err.message : "Microphone permission denied.");
    }
  }

  function finishRecording(): Promise<Blob | null> {
    return new Promise((resolve) => {
      clearTimer();
      const mr = recorderRef.current;
      if (!mr || mr.state === "inactive") {
        stopTracks();
        setRec("idle");
        resolve(null);
        return;
      }
      const done = () => {
        const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
        stopTracks();
        recorderRef.current = null;
        setElapsed(Date.now() - startedRef.current);
        setRec(blob.size > 0 ? "ready" : "idle");
        resolve(blob.size > 0 ? blob : null);
      };
      mr.addEventListener("stop", done, { once: true });
      try {
        if (mr.state === "recording") mr.requestData();
        mr.stop();
      } catch {
        done();
      }
    });
  }

  async function stopAndSend() {
    const blob = await finishRecording();
    if (!blob) {
      setRecError("Nothing to send.");
      return;
    }
    onSubmitVoice(blob, `finance-voice.${extForMime(blob.type)}`);
  }

  if (mode === "type") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pb-2">
          <p className="text-sm text-muted">
            Type a money event. Example: curd 20 rupee from savings.
          </p>
          <label className="block">
            <span className="kicker">What happened</span>
            <textarea
              value={text}
              onChange={(e) => onText(e.target.value)}
              rows={4}
              placeholder="curd 20 rupee from savings"
              aria-label="What happened"
              className="field mt-1 min-h-28 resize-y py-2"
              disabled={busy}
            />
          </label>
          {status ? <p className="text-sm text-muted">{status}</p> : null}
          {error ? <p className="text-sm font-medium text-warn">{error}</p> : null}
        </div>
        <div className="mt-3 grid shrink-0 grid-cols-1 gap-2 border-t border-line pt-3">
          <button
            type="button"
            disabled={busy || text.trim() === ""}
            onClick={onSubmitText}
            className="btn-primary min-h-12"
          >
            {busy ? "Adding…" : "Add to ledger"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-2">
        <p className="text-sm text-muted">
          Speak a money event. It is saved like a Voice note, then added to the ledger.
        </p>
        <div className="flex flex-col items-center gap-3 py-4">
          <button
            type="button"
            aria-label={rec === "recording" ? "Stop recording" : "Start recording"}
            disabled={busy}
            onClick={() => {
              if (rec === "recording") void stopAndSend();
              else void startRecording();
            }}
            className={`inline-flex h-20 w-20 items-center justify-center rounded-full shadow-lg transition-transform active:scale-95 ${
              rec === "recording"
                ? "bg-danger text-danger-fg shadow-danger/30"
                : "bg-accent text-accent-fg shadow-accent/30"
            }`}
          >
            <MicIcon className="h-8 w-8" />
          </button>
          <p className="text-base font-semibold tabular-nums text-ink">
            {rec === "recording" || rec === "ready" ? formatElapsed(elapsed) : "00:00"}
          </p>
          <p className="text-sm text-muted">
            {busy
              ? status || "Working…"
              : rec === "recording"
                ? "Recording — tap to stop"
                : "Tap to speak"}
          </p>
        </div>
        {text ? (
          <label className="block">
            <span className="kicker">Heard</span>
            <textarea
              value={text}
              onChange={(e) => onText(e.target.value)}
              rows={3}
              aria-label="Heard"
              className="field mt-1 min-h-24 resize-y py-2"
              disabled={busy}
            />
          </label>
        ) : null}
        {recError ? <p className="text-sm font-medium text-warn">{recError}</p> : null}
        {error ? <p className="text-sm font-medium text-warn">{error}</p> : null}
      </div>
      {text.trim() !== "" ? (
        <div className="mt-3 grid shrink-0 grid-cols-1 gap-2 border-t border-line pt-3">
          <button
            type="button"
            disabled={busy}
            onClick={onSubmitText}
            className="btn-primary min-h-12"
          >
            {busy ? "Adding…" : "Add to ledger"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
