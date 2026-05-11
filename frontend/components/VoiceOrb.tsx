"use client";

import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { chatWithAgent } from "@/lib/api";
import { stripEmojisForSpeech } from "@/lib/stripEmojisForSpeech";

type VoiceState = "idle" | "listening" | "processing" | "speaking";

const VOICE_THREAD_SESSION_KEY = "aria_session";

function getVoiceFingerprint(): string {
  let fp = localStorage.getItem("aria_user_fp");
  if (!fp) {
    fp = `user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
    localStorage.setItem("aria_user_fp", fp);
  }
  return fp;
}

function getVoiceSessionId(): string {
  let sid = localStorage.getItem(VOICE_THREAD_SESSION_KEY);
  if (!sid) {
    sid = Date.now().toString();
    localStorage.setItem(VOICE_THREAD_SESSION_KEY, sid);
  }
  return sid;
}

function formatVoiceApiError(e: unknown): string {
  if (axios.isAxiosError(e)) {
    if (e.code === "ECONNABORTED") return "Request timed out. Try again or check your connection.";
    const data = e.response?.data as { detail?: unknown } | undefined;
    if (typeof data?.detail === "string") return data.detail;
    if (Array.isArray(data?.detail)) return JSON.stringify(data.detail);
    if (e.response?.status === 502)
      return "Could not reach the API server. Start FastAPI (e.g. uvicorn on port 8000) and reload.";
    if (e.response?.status) return `Chat request failed (${e.response.status}).`;
  }
  if (e instanceof Error) return e.message;
  return "Something went wrong. Try again or use text chat.";
}

export function VoiceOrb() {
  const [state, setState] = useState<VoiceState>("idle");
  const [transcript, setTranscript] = useState("");
  const [response, setResponse] = useState("");
  const [voiceError, setVoiceError] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const transcriptRef = useRef("");
  const voiceDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceSubmittedRef = useRef(false);

  /** Fixed heights for the speaking waveform (avoids impure random during render). */
  const waveHeights = [14, 22, 18, 26, 12, 24, 16, 20, 10, 28, 18, 22];

  const clearVoiceDebounce = useCallback(() => {
    if (voiceDebounceRef.current) {
      clearTimeout(voiceDebounceRef.current);
      voiceDebounceRef.current = null;
    }
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    return () => clearVoiceDebounce();
  }, [clearVoiceDebounce]);

  const processVoiceInput = useCallback(async (text: string) => {
    setVoiceError("");
    setState("processing");

    try {
      const sessionId = getVoiceSessionId();
      const fingerprint = getVoiceFingerprint();

      const result = await chatWithAgent(text, sessionId, [], fingerprint);
      const reply = (result.reply ?? "").trim();
      if (!reply) {
        setVoiceError("ARIA returned an empty reply. Try again or open Chat.");
        setState("idle");
        return;
      }
      setResponse(reply);

      setState("speaking");
      window.speechSynthesis.cancel();

      await new Promise<void>((resolve) => {
        if (window.speechSynthesis.getVoices().length) {
          resolve();
          return;
        }
        const onVoices = () => {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
          resolve();
        };
        window.speechSynthesis.addEventListener("voiceschanged", onVoices);
        window.speechSynthesis.getVoices();
        setTimeout(() => {
          window.speechSynthesis.removeEventListener("voiceschanged", onVoices);
          resolve();
        }, 1500);
      });

      const speechText = stripEmojisForSpeech(reply);
      if (speechText.trim()) {
        const utterance = new SpeechSynthesisUtterance(speechText);
        const voices = window.speechSynthesis.getVoices();
        const preferred = voices.find(
          (v) =>
            v.name.includes("Samantha") ||
            v.name.includes("Google UK English Female") ||
            v.name.includes("Microsoft Aria") ||
            v.lang === "en-GB",
        );
        if (preferred) utterance.voice = preferred;

        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        utterance.onend = () => setState("idle");
        utterance.onerror = () => setState("idle");

        // Chrome often leaves synthesis paused; after await the user gesture is gone — resume unlocks audio.
        try {
          window.speechSynthesis.resume();
        } catch {
          /* ignore */
        }
        window.speechSynthesis.speak(utterance);
      } else {
        setState("idle");
      }
    } catch (e: unknown) {
      setVoiceError(formatVoiceApiError(e));
      setState("idle");
    }
  }, []);

  const startListening = () => {
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      alert("Voice not supported in this browser. Use Chrome.");
      return;
    }

    clearVoiceDebounce();
    voiceSubmittedRef.current = false;
    setState("listening");
    setTranscript("");
    setResponse("");
    setVoiceError("");
    transcriptRef.current = "";

    const recognition = new SpeechRecognitionCtor();
    recognitionRef.current = recognition;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const current = Array.from(event.results)
        .map((r) => r[0].transcript)
        .join("");
      transcriptRef.current = current;
      setTranscript(current);
      clearVoiceDebounce();
      voiceDebounceRef.current = setTimeout(() => {
        voiceDebounceRef.current = null;
        const t = transcriptRef.current.trim();
        if (t && recognitionRef.current) {
          voiceSubmittedRef.current = true;
          recognitionRef.current.stop();
          void processVoiceInput(t);
        }
      }, 1100);
    };

    recognition.onend = () => {
      clearVoiceDebounce();
      if (!voiceSubmittedRef.current) {
        const text = transcriptRef.current.trim();
        if (text) void processVoiceInput(text);
        else setState("idle");
      }
      voiceSubmittedRef.current = false;
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      clearVoiceDebounce();
      const code = event.error;
      if (code === "aborted") {
        setState("idle");
        return;
      }
      if (code === "not-allowed") {
        setVoiceError("Microphone access denied. Allow the mic for this site in the browser address bar.");
      } else if (code === "no-speech") {
        setVoiceError("No speech detected. Speak after the orb turns red, or check your microphone.");
      } else if (code === "network") {
        setVoiceError("Speech recognition needs a working network (browser uses a cloud service).");
      } else {
        setVoiceError(`Voice recognition stopped (${code}). Try again.`);
      }
      setState("idle");
    };

    recognition.start();
  };

  const stopAll = () => {
    clearVoiceDebounce();
    voiceSubmittedRef.current = false;
    recognitionRef.current?.stop();
    window.speechSynthesis.cancel();
    setState("idle");
    setTranscript("");
    setResponse("");
    setVoiceError("");
    transcriptRef.current = "";
  };

  const orbColors = {
    idle: "from-blue-600 to-blue-800",
    listening: "from-red-500 to-pink-600",
    processing: "from-amber-500 to-orange-600",
    speaking: "from-teal-500 to-blue-600",
  };

  const orbLabels = {
    idle: "Ask ARIA by voice",
    listening: "Listening...",
    processing: "ARIA is thinking...",
    speaking: "ARIA is speaking...",
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <motion.button
        type="button"
        onClick={
          state === "idle"
            ? () => {
                setIsOpen(true);
                startListening();
              }
            : stopAll
        }
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={`relative flex h-20 w-20 items-center justify-center rounded-full border-2 border-white/20 bg-gradient-to-br shadow-2xl ${orbColors[state]}`}
      >
        {(state === "listening" || state === "speaking") && (
          <>
            {[1, 2, 3].map((i) => (
              <motion.div
                key={i}
                className={`absolute inset-0 rounded-full bg-gradient-to-br ${orbColors[state]}`}
                initial={{ scale: 1, opacity: 0.6 }}
                animate={{ scale: 1 + i * 0.4, opacity: 0 }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  delay: i * 0.3,
                  ease: "easeOut",
                }}
              />
            ))}
          </>
        )}

        {state === "processing" && (
          <motion.div
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-white/80"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          />
        )}

        <span className="z-10 text-3xl">
          {state === "idle" && "🎤"}
          {state === "listening" && "👂"}
          {state === "processing" && "⚡"}
          {state === "speaking" && "🔊"}
        </span>
      </motion.button>

      <motion.p
        key={state}
        initial={{ opacity: 0, y: 5 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-sm text-gray-400"
      >
        {orbLabels[state]}
      </motion.p>

      {mounted &&
        typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isOpen && (
              <>
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-[2px]"
                  aria-hidden
                  onClick={() => {
                    stopAll();
                    setIsOpen(false);
                  }}
                />
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="voice-orb-panel-title"
                  initial={{ opacity: 0, y: 20, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 20, scale: 0.95 }}
                  transition={{ type: "spring", damping: 26, stiffness: 320 }}
                  className="fixed bottom-8 left-1/2 z-[110] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-white/15 bg-[#0f1728] p-6 shadow-[0_25px_80px_rgba(0,0,0,0.65)]"
                  onClick={(e) => e.stopPropagation()}
                >
            <button
              type="button"
              onClick={() => {
                stopAll();
                setIsOpen(false);
              }}
              className="absolute right-4 top-4 text-xl text-gray-400 hover:text-white"
            >
              ✕
            </button>

            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-teal-500 text-sm font-bold text-white">
                AR
              </div>
              <div>
                <p id="voice-orb-panel-title" className="text-sm font-medium text-white">
                  ARIA
                </p>
                <p className="text-xs text-green-400">
                  {state === "listening" && "● Listening"}
                  {state === "processing" && "● Thinking"}
                  {state === "speaking" && "● Speaking"}
                  {state === "idle" && voiceError && "● Error"}
                  {state === "idle" && !voiceError && (transcript || response) && "● Done"}
                  {state === "idle" && !voiceError && !transcript && !response && "● Voice"}
                </p>
              </div>
            </div>

            {state === "listening" && !transcript.trim() && (
              <p className="mb-4 text-sm leading-relaxed text-slate-400">
                Speak now. Your message is sent about a second after you pause — or when the browser finishes
                capturing audio.
              </p>
            )}

            {state === "processing" && (
              <p className="mb-4 text-sm text-amber-200/90">ARIA is thinking…</p>
            )}

            {voiceError && (
              <div className="mb-4 rounded-lg border border-red-500/35 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {voiceError}
              </div>
            )}

            {transcript && (
              <div className="mb-3">
                <p className="mb-1 text-xs text-gray-500">You said:</p>
                <p className="rounded-lg bg-white/5 px-3 py-2 text-sm italic text-gray-300">&quot;{transcript}&quot;</p>
              </div>
            )}

            {response && (
              <div>
                <p className="mb-1 text-xs text-blue-400">ARIA:</p>
                <p className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-2 text-sm leading-relaxed text-white">
                  {response}
                </p>
              </div>
            )}

            {state === "speaking" && (
              <div className="mt-4 flex items-center justify-center gap-1">
                {waveHeights.map((h, i) => (
                  <motion.div
                    key={i}
                    className="w-1 rounded-full bg-blue-400"
                    animate={{
                      height: [8, h, 8],
                    }}
                    transition={{
                      duration: 0.5 + (i % 3) * 0.15,
                      repeat: Infinity,
                      delay: i * 0.08,
                    }}
                  />
                ))}
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={startListening}
                disabled={state !== "idle"}
                className="flex-1 rounded-lg bg-blue-600 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                🎤 Ask Again
              </button>
              <button
                type="button"
                onClick={() => {
                  if (transcript.trim()) {
                    window.location.href = `/chat?message=${encodeURIComponent(transcript.trim())}`;
                  }
                }}
                disabled={!transcript.trim()}
                className="flex-1 rounded-lg bg-white/10 py-2 text-sm text-white hover:bg-white/20 disabled:opacity-40"
              >
                💬 Open Chat
              </button>
            </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
