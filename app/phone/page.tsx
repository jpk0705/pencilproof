"use client";

import { useEffect, useRef, useState } from "react";

const PHONE_API_ORIGIN = "https://audit.pencilproof.com";
const PHONE_SOCKET_ORIGIN = PHONE_API_ORIGIN.replace(/^https:/, "wss:");
const PHONE_CHUNK_SIZE = 256 * 1024;
const PHONE_KEEPALIVE_INTERVAL_MS = 20_000;
const PHONE_RECONNECT_MAX_DELAY_MS = 5_000;
const PHONE_SESSION_FALLBACK_MAX_AGE_MS = 10 * 60 * 1000;

type PhoneState = "connecting" | "ready" | "sending" | "sent" | "error";

export default function PhoneCameraPage() {
  const [state, setState] = useState<PhoneState>("connecting");
  const [message, setMessage] = useState("Connecting to your computer…");
  const [progress, setProgress] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const sentRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get("session") ?? "";
    const token = params.get("token") ?? "";
    const parsedExpiresAt = Number(params.get("expiresAt"));
    const expiresAt = Number.isFinite(parsedExpiresAt) && parsedExpiresAt > Date.now()
      ? parsedExpiresAt
      : Date.now() + PHONE_SESSION_FALLBACK_MAX_AGE_MS;
    if (!session || !token) {
      setState("error");
      setMessage("This camera link is incomplete. Scan the QR code again from your computer.");
      return;
    }
    let stopped = false;
    let reconnectTimer: number | null = null;
    let keepaliveTimer: number | null = null;
    let reconnectDelay = 1_000;
    sentRef.current = false;

    const clearTimers = () => {
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (keepaliveTimer !== null) window.clearInterval(keepaliveTimer);
      reconnectTimer = null;
      keepaliveTimer = null;
    };

    const connect = () => {
      if (stopped || sentRef.current || Date.now() >= expiresAt) {
        if (!stopped && !sentRef.current) {
          setState("error");
          setMessage("This phone camera session expired. Scan the QR code again to reconnect.");
        }
        return;
      }
      const socket = new WebSocket(`${PHONE_SOCKET_ORIGIN}/api/phone-session?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}&role=phone`);
      socketRef.current = socket;
      socket.onopen = () => {
        if (stopped) return;
        reconnectDelay = 1_000;
        if (keepaliveTimer !== null) window.clearInterval(keepaliveTimer);
        keepaliveTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "keepalive" }));
        }, PHONE_KEEPALIVE_INTERVAL_MS);
        setState("ready");
        setMessage("Connected. Take a clear photo of the full quote.");
        socket.send(JSON.stringify({ type: "hello" }));
      };
      socket.onerror = () => {
        if (stopped || sentRef.current) return;
        setState("connecting");
        setMessage("The connection paused. Reconnecting...");
      };
      socket.onclose = () => {
        if (keepaliveTimer !== null) window.clearInterval(keepaliveTimer);
        keepaliveTimer = null;
        if (stopped || sentRef.current || socketRef.current !== socket) return;
        socketRef.current = null;
        if (Date.now() >= expiresAt) {
          setState("error");
          setMessage("This phone camera session expired. Scan the QR code again to reconnect.");
          return;
        }
        setState("connecting");
        setMessage("The connection paused. Reconnecting...");
        const delay = Math.min(reconnectDelay, PHONE_RECONNECT_MAX_DELAY_MS);
        reconnectDelay = Math.min(delay * 2, PHONE_RECONNECT_MAX_DELAY_MS);
        reconnectTimer = window.setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      clearTimers();
      socketRef.current?.close(1000, "closed");
      socketRef.current = null;
    };
  }, []);

  const sendPhoto = async (file: File) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setState("error");
      setMessage("Your computer is no longer connected. Scan the QR code again.");
      return;
    }
    if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) {
      setState("error");
      setMessage("Choose an image smaller than 15 MB.");
      return;
    }
    setState("sending");
    setProgress(0);
    setMessage("Sending the quote photo to your computer…");
    socket.send(JSON.stringify({ type: "photo-start", fileName: file.name || "phone-quote.jpg", mimeType: file.type || "image/jpeg" }));
    const bytes = new Uint8Array(await file.arrayBuffer());
    for (let offset = 0; offset < bytes.byteLength; offset += PHONE_CHUNK_SIZE) {
      const chunk = bytes.slice(offset, Math.min(bytes.byteLength, offset + PHONE_CHUNK_SIZE));
      while (socket.bufferedAmount > PHONE_CHUNK_SIZE * 8) {
        await new Promise((resolve) => window.setTimeout(resolve, 25));
      }
      socket.send(chunk);
      setProgress(Math.min(1, (offset + chunk.byteLength) / bytes.byteLength));
    }
    socket.send(JSON.stringify({ type: "photo-end" }));
    sentRef.current = true;
    setState("sent");
    setProgress(1);
    setMessage("Photo sent. You can return to your computer.");
  };

  return (
    <main className="phone-camera-page">
      <section className="phone-camera-card">
        <div className="phone-camera-brand"><img src="/pencilproof-profile-mark.png" alt="" width="42" height="42" /><strong>PencilProof</strong></div>
        <p className="eyebrow">PHONE CAMERA</p>
        <h1>Send your quote photo</h1>
        <p className="phone-camera-lede">Take a picture here and it will appear on your computer automatically.</p>
        <div className={`phone-camera-status phone-camera-status-${state}`} role="status" aria-live="polite">
          <span className="phone-camera-status-dot" aria-hidden="true" />
          <span>{message}</span>
        </div>
        {state === "sending" ? (
          <div className="phone-camera-send-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span style={{ width: `${Math.max(3, Math.round(progress * 100))}%` }} />
          </div>
        ) : null}
        <label className="phone-camera-take-button">
          <span>{state === "sending" ? "Sending…" : state === "sent" ? "Take another photo" : "Take photo"}</span>
          <input type="file" accept="image/*" capture="environment" disabled={state === "connecting" || state === "sending"} onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void sendPhoto(file);
          }} />
        </label>
        <p className="phone-camera-footnote">Use the back camera and include all four corners of the quote. The image is sent only to the computer that opened this session.</p>
      </section>
    </main>
  );
}
