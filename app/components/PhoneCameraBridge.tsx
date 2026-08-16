"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

const PHONE_API_ORIGIN = "https://audit.pencilproof.com";
const PHONE_SOCKET_ORIGIN = PHONE_API_ORIGIN.replace(/^https:/, "wss:");
const PHONE_CHUNK_SIZE = 256 * 1024;
const PHONE_KEEPALIVE_INTERVAL_MS = 20_000;
const PHONE_RECONNECT_MAX_DELAY_MS = 5_000;

type PhoneSession = { expiresAt: number; phoneUrl: string; sessionId: string; token: string };
type PhoneCameraBridgeProps = { disabled?: boolean; buttonLabel?: string; onFile: (file: File) => void | Promise<void> };
type IncomingPhoto = { chunks: Uint8Array[]; fileName: string; mimeType: string };

const sessionSocketUrl = (session: PhoneSession) =>
  `${PHONE_SOCKET_ORIGIN}/api/phone-session?session=${encodeURIComponent(session.sessionId)}&token=${encodeURIComponent(session.token)}&role=desktop`;

export default function PhoneCameraBridge({ disabled = false, buttonLabel = "Scan with phone", onFile }: PhoneCameraBridgeProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<"idle" | "creating" | "waiting" | "connected" | "receiving" | "complete" | "error">("idle");
  const [message, setMessage] = useState("");
  const [qrDataUrl, setQrDataUrl] = useState("");
  const socketRef = useRef<WebSocket | null>(null);
  const incomingRef = useRef<IncomingPhoto | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const keepaliveTimerRef = useRef<number | null>(null);
  const reconnectDelayRef = useRef(1_000);
  const manualCloseRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
      if (keepaliveTimerRef.current !== null) window.clearInterval(keepaliveTimerRef.current);
      socketRef.current?.close(1000, "closed");
      socketRef.current = null;
    };
  }, []);

  const close = () => {
    manualCloseRef.current = true;
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    if (keepaliveTimerRef.current !== null) window.clearInterval(keepaliveTimerRef.current);
    socketRef.current?.close(1000, "closed");
    socketRef.current = null;
    incomingRef.current = null;
    setOpen(false);
    setStatus("idle");
    setMessage("");
    setQrDataUrl("");
  };

  const connectDesktopSocket = (session: PhoneSession, delay = 1_000) => {
    if (!mountedRef.current || manualCloseRef.current || Date.now() >= session.expiresAt) return;
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (!mountedRef.current || manualCloseRef.current || Date.now() >= session.expiresAt) return;
      socketRef.current?.close(1000, "reconnecting");
      socketRef.current = null;
      const socket = new WebSocket(sessionSocketUrl(session));
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        if (!mountedRef.current || manualCloseRef.current) return;
        reconnectDelayRef.current = 1_000;
        if (keepaliveTimerRef.current !== null) window.clearInterval(keepaliveTimerRef.current);
        keepaliveTimerRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "keepalive" }));
        }, PHONE_KEEPALIVE_INTERVAL_MS);
        setStatus("waiting");
        setMessage("Waiting for your phone to connect...");
        socket.send(JSON.stringify({ type: "hello" }));
      };
      socket.onmessage = async (event) => {
        if (typeof event.data === "string") {
          let payload: { type?: string; fileName?: string; mimeType?: string };
          try { payload = JSON.parse(event.data) as typeof payload; } catch { return; }
          if (payload.type === "phone_connected") {
            setStatus("connected");
            setMessage("Phone connected. Take a clear photo of the full quote.");
          } else if (payload.type === "photo-start") {
            incomingRef.current = { chunks: [], fileName: payload.fileName || "phone-quote.jpg", mimeType: payload.mimeType || "image/jpeg" };
            setStatus("receiving");
            setMessage("Receiving the quote photo...");
          } else if (payload.type === "photo-end") {
            const incoming = incomingRef.current;
            if (!incoming) return;
            const parts = incoming.chunks.map((chunk) => {
              const copy = new ArrayBuffer(chunk.byteLength);
              new Uint8Array(copy).set(chunk);
              return copy;
            });
            const file = new File(parts, incoming.fileName, { type: incoming.mimeType });
            incomingRef.current = null;
            setStatus("complete");
            setMessage("Photo received. Starting the quote scan...");
            await onFile(file);
            if (mountedRef.current) window.setTimeout(() => close(), 900);
          } else if (payload.type === "peer_disconnected" && mountedRef.current) {
            setStatus("waiting");
            setMessage("The phone disconnected. Reconnecting if the camera page is still open...");
          }
          return;
        }
        const incoming = incomingRef.current;
        if (!incoming) return;
        const bytes = event.data instanceof Blob
          ? new Uint8Array(await event.data.arrayBuffer())
          : new Uint8Array(event.data as ArrayBuffer);
        if (bytes.byteLength <= PHONE_CHUNK_SIZE) incoming.chunks.push(bytes);
      };
      socket.onerror = () => {
        if (!mountedRef.current || manualCloseRef.current) return;
        setStatus("waiting");
        setMessage("The connection paused. Reconnecting...");
      };
      socket.onclose = () => {
        if (keepaliveTimerRef.current !== null) window.clearInterval(keepaliveTimerRef.current);
        if (!mountedRef.current || manualCloseRef.current || socketRef.current !== socket) return;
        socketRef.current = null;
        if (Date.now() >= session.expiresAt) {
          setStatus("error");
          setMessage("This phone camera session expired. Start a new scan to reconnect.");
          return;
        }
        setStatus("waiting");
        setMessage("The connection paused. Reconnecting...");
        const nextDelay = Math.min(reconnectDelayRef.current, PHONE_RECONNECT_MAX_DELAY_MS);
        reconnectDelayRef.current = Math.min(nextDelay * 2, PHONE_RECONNECT_MAX_DELAY_MS);
        connectDesktopSocket(session, nextDelay);
      };
    }, delay);
  };

  const start = async () => {
    if (disabled || status === "creating") return;
    manualCloseRef.current = false;
    reconnectDelayRef.current = 1_000;
    setOpen(true);
    setStatus("creating");
    setMessage("Creating a secure camera session...");
    try {
      const response = await fetch(`${PHONE_API_ORIGIN}/api/phone-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
      });
      const session = await response.json() as Partial<PhoneSession> & { error?: string };
      if (!response.ok || !session.sessionId || !session.token || !session.phoneUrl || !session.expiresAt) throw new Error(session.error ?? "session");
      const completeSession = session as PhoneSession;
      const dataUrl = await QRCode.toDataURL(completeSession.phoneUrl, {
        width: 280,
        margin: 2,
        errorCorrectionLevel: "M",
        color: { dark: "#10284b", light: "#ffffff" },
      });
      if (!mountedRef.current) return;
      setQrDataUrl(dataUrl);
      setStatus("waiting");
      setMessage("Scan this code with your phone camera.");
      connectDesktopSocket(completeSession, 0);
    } catch {
      setStatus("error");
      setMessage("Could not create the phone camera session. Try again or upload the file here.");
    }
  };

  return (
    <>
      <button className="phone-camera-trigger" type="button" disabled={disabled} onClick={() => void start()}>
        {buttonLabel}
      </button>
      {open ? (
        <div className="phone-camera-panel" role="dialog" aria-modal="true" aria-labelledby="phone-camera-title">
          <div className="phone-camera-panel-head">
            <div><p className="eyebrow">DESKTOP CAMERA BRIDGE</p><h3 id="phone-camera-title">Scan the quote with your phone</h3></div>
            <button className="phone-camera-close" type="button" onClick={close} aria-label="Close phone camera panel" title="Close">×</button>
          </div>
          {status === "creating" ? <div className="phone-camera-loading" role="status">{message}</div> : null}
          {qrDataUrl ? (
            <div className="phone-camera-content">
              <div className="phone-camera-qr-wrap"><img className="phone-camera-qr" src={qrDataUrl} alt="QR code to open the PencilProof phone camera" /></div>
              <div className="phone-camera-instructions"><strong>{message}</strong><ol><li>Open your phone camera.</li><li>Point it at this QR code.</li><li>Tap the link, then take the quote photo.</li></ol><small>The code stays active for about 10 minutes. If the phone briefly sleeps or changes network, the connection will try to reconnect automatically.</small></div>
            </div>
          ) : null}
          {status === "error" ? <p className="phone-camera-error" role="alert">{message}</p> : null}
          {status === "complete" ? <p className="phone-camera-success" role="status">{message}</p> : null}
          <button className="phone-camera-upload-fallback" type="button" onClick={close}>Use this computer instead</button>
        </div>
      ) : null}
    </>
  );
}
