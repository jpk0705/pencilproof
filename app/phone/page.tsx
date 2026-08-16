"use client";

import { useEffect, useRef, useState } from "react";

const PHONE_API_ORIGIN = "https://audit.pencilproof.com";
const PHONE_SOCKET_ORIGIN = PHONE_API_ORIGIN.replace(/^https:/, "wss:");
const PHONE_CHUNK_SIZE = 256 * 1024;
const PHONE_SESSION_MAX_AGE = 15 * 60 * 1000;

type PhoneState = "connecting" | "ready" | "sending" | "sent" | "error";

export default function PhoneCameraPage() {
  const [state, setState] = useState<PhoneState>("connecting");
  const [message, setMessage] = useState("Connecting to your computer…");
  const [progress, setProgress] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const heartbeatTimerRef = useRef<number | null>(null);
  const sessionExpiresAtRef = useRef<number>(0);
  const manualCloseRef = useRef(false);
  const sentRef = useRef(false);

  const clearConnectionTimers = () => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current !== null) {
      window.clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  };

  const startHeartbeat = (socket: WebSocket) => {
    if (heartbeatTimerRef.current !== null) window.clearInterval(heartbeatTimerRef.current);
    heartbeatTimerRef.current = window.setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "keepalive" }));
    }, 15_000);
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get("session") ?? "";
    const token = params.get("token") ?? "";
    if (!session || !token) {
      setState("error");
      setMessage("This camera link is incomplete. Scan the QR code again from your computer.");
      return;
    }
    manualCloseRef.current = false;
    sessionExpiresAtRef.current = Date.now() + PHONE_SESSION_MAX_AGE;
    const connect = () => {
      if (manualCloseRef.current) return;
      if (sessionExpiresAtRef.current && Date.now() >= sessionExpiresAtRef.current) {
        setState("error");
        setMessage("This camera session expired. Scan a new code from your computer.");
        return;
      }
      setState((current) => current === "sent" ? current : "connecting");
      setMessage("Connecting to your computer…");
      const socket = new WebSocket(`${PHONE_SOCKET_ORIGIN}/api/phone-session?session=${encodeURIComponent(session)}&token=${encodeURIComponent(token)}&role=phone`);
      socketRef.current = socket;
      socket.onopen = () => {
        startHeartbeat(socket);
        setState("ready");
        setMessage("Connected. Take a clear photo of the full quote.");
        socket.send(JSON.stringify({ type: "hello" }));
      };
      socket.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const payload = JSON.parse(event.data) as { type?: string };
          if (payload.type === "peer_disconnected") {
            setState((current) => current === "sent" ? current : "connecting");
            setMessage("Your computer connection briefly dropped. Reconnecting automatically…");
          } else if (payload.type === "desktop_connected" && !sentRef.current) {
            setState("ready");
            setMessage("Connected. Take a clear photo of the full quote.");
          }
        } catch {
          // Ignore malformed status messages; the bridge remains usable.
        }
      };
      socket.onerror = () => {
        if (!manualCloseRef.current) setMessage("Connection interrupted. Reconnecting automatically…");
      };
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (heartbeatTimerRef.current !== null) {
          window.clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        if (manualCloseRef.current || sentRef.current) return;
        if (reconnectTimerRef.current === null) {
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            connect();
          }, 1_500);
        }
      };
    };
    connect();
    return () => {
      manualCloseRef.current = true;
      clearConnectionTimers();
      socketRef.current?.close(1000, "closed");
      socketRef.current = null;
    };
  }, []);

  const sendPhoto = async (file: File) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setState("connecting");
      setMessage("Your computer connection is recovering. Please wait a moment and choose the photo again.");
      return;
    }
    if (!file.type.startsWith("image/") || file.size > 15 * 1024 * 1024) {
      setState("error");
      setMessage("Choose an image smaller than 15 MB.");
      return;
    }
    setState("sending");
    sentRef.current = false;
    setProgress(0);
    setMessage("Sending the quote photo to your computer…");
    try {
      socket.send(JSON.stringify({ type: "photo-start", fileName: file.name || "phone-quote.jpg", mimeType: file.type || "image/jpeg" }));
      const bytes = new Uint8Array(await file.arrayBuffer());
      for (let offset = 0; offset < bytes.byteLength; offset += PHONE_CHUNK_SIZE) {
        const chunk = bytes.slice(offset, Math.min(bytes.byteLength, offset + PHONE_CHUNK_SIZE));
        while (socket.bufferedAmount > PHONE_CHUNK_SIZE * 8) {
          await new Promise((resolve) => window.setTimeout(resolve, 25));
        }
        if (socket.readyState !== WebSocket.OPEN) throw new Error("connection");
        socket.send(chunk);
        setProgress(Math.min(1, (offset + chunk.byteLength) / bytes.byteLength));
      }
      socket.send(JSON.stringify({ type: "photo-end" }));
      sentRef.current = true;
      setState("sent");
      setProgress(1);
      setMessage("Photo sent. You can return to your computer.");
    } catch {
      setState("error");
      setMessage("The connection dropped while sending. Reconnect and take the photo again.");
    }
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
