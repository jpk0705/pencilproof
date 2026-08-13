"use client";

import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

const PHONE_API_ORIGIN = "https://audit.pencilproof.com";
const PHONE_SOCKET_ORIGIN = PHONE_API_ORIGIN.replace(/^https:/, "wss:");
const PHONE_CHUNK_SIZE = 256 * 1024;

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const incomingRef = useRef<IncomingPhoto | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      socketRef.current?.close(1000, "closed");
      socketRef.current = null;
    };
  }, []);

  const close = () => {
    socketRef.current?.close(1000, "closed");
    socketRef.current = null;
    incomingRef.current = null;
    setOpen(false);
    setStatus("idle");
    setMessage("");
    setQrDataUrl("");
  };

  const start = async () => {
    if (disabled || status === "creating") return;
    const isPhoneSizedDevice = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
      || window.matchMedia("(max-width: 700px)").matches;
    if (isPhoneSizedDevice) {
      fileInputRef.current?.click();
      return;
    }
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

      const socket = new WebSocket(sessionSocketUrl(completeSession));
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.onopen = () => {
        if (!mountedRef.current) return;
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
            setMessage("The phone disconnected. Scan the code again to reconnect.");
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
        if (!mountedRef.current) return;
        setStatus("error");
        setMessage("The phone camera connection could not start. Try again or upload the file here.");
      };
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
      <input
        ref={fileInputRef}
        className="phone-camera-local-input"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (file) void onFile(file);
        }}
      />
      {open ? (
        <div className="phone-camera-panel" role="dialog" aria-modal="true" aria-labelledby="phone-camera-title">
          <div className="phone-camera-panel-head">
            <div><p className="eyebrow">DESKTOP CAMERA BRIDGE</p><h3 id="phone-camera-title">Scan the quote with your phone</h3></div>
            <button className="phone-camera-close" type="button" onClick={close} aria-label="Close phone camera panel">Close</button>
          </div>
          {status === "creating" ? <div className="phone-camera-loading" role="status">{message}</div> : null}
          {qrDataUrl ? (
            <div className="phone-camera-content">
              <div className="phone-camera-qr-wrap"><img className="phone-camera-qr" src={qrDataUrl} alt="QR code to open the PencilProof phone camera" /></div>
              <div className="phone-camera-instructions"><strong>{message}</strong><ol><li>Open your phone camera.</li><li>Point it at this QR code.</li><li>Tap the link, then take the quote photo.</li></ol><small>The code expires in about 10 minutes. Your photo streams directly to this browser.</small></div>
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
