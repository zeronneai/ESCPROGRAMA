"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { postMessageAction } from "@/actions/clarifications";
import { Alert, Button } from "@/components/ui";
import type { MessageRow } from "@/lib/quotes/types";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "@/lib/validation/request";

/** Mini chat por partida entre vendedor y comprador, con imagen opcional. */
export function ItemChat({
  itemId,
  requestId,
  me,
  messages,
  waitingForSeller,
}: {
  itemId: string;
  requestId: string;
  me: "vendedor" | "comprador";
  messages: MessageRow[];
  /** La partida espera la respuesta del vendedor (reloj en pausa). */
  waitingForSeller: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sorted = [...messages].sort((a, b) => a.created_at.localeCompare(b.created_at));

  function send() {
    setError(null);
    if (file && (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_BYTES)) {
      setError("La imagen debe ser PNG, JPG, WEBP o GIF de máximo 5 MB");
      return;
    }
    const fd = new FormData();
    fd.set("itemId", itemId);
    fd.set("requestId", requestId);
    fd.set("body", body);
    if (file) fd.set("file", file);
    start(async () => {
      const r = await postMessageAction(fd);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setBody("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  const needsReply = waitingForSeller && me === "vendedor";
  return (
    <details className="rounded-md border border-slate-200" open={needsReply || sorted.length > 0 ? needsReply : false}>
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        Aclaraciones y mensajes ({sorted.length})
        {needsReply && <span className="ml-2 rounded-full bg-purple-100 px-2 py-0.5 text-xs text-purple-800">Te piden una aclaración</span>}
      </summary>
      <div className="space-y-2 border-t border-slate-200 p-3">
        {needsReply && <Alert tone="info">El comprador necesita una aclaración. Al responder se reanuda el plazo.</Alert>}
        {waitingForSeller && me === "comprador" && <Alert tone="info">Esperando la respuesta del vendedor. El reloj de 48 horas hábiles está en pausa.</Alert>}
        <ul className="space-y-2">
          {sorted.length === 0 && <li className="text-sm text-slate-500">Sin mensajes.</li>}
          {sorted.map((m) => (
            <li key={m.id} className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${m.author_rol === me ? "ml-auto bg-brand-50" : "bg-slate-100"}`}>
              <p className="text-[11px] text-slate-500">
                {m.author_rol === "comprador" ? "Comprador" : "Vendedor"} · {new Date(m.created_at).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" })}
                {m.kind === "pedir_aclaracion" && " · Pidió aclaración"}
              </p>
              {m.body && <p className="whitespace-pre-wrap">{m.body}</p>}
              {m.imageUrl && (
                <a href={m.imageUrl} target="_blank" rel="noreferrer noopener">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.imageUrl} alt="Imagen adjunta" className="mt-1 max-h-40 rounded border border-slate-200" />
                </a>
              )}
            </li>
          ))}
        </ul>
        {error && <Alert tone="error">{error}</Alert>}
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="Escribe un mensaje..." className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100">
            {file ? file.name.slice(0, 24) : "Adjuntar imagen"}
            <input ref={fileRef} type="file" accept={IMAGE_TYPES.join(",")} className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <Button onClick={send} disabled={pending || (!body.trim() && !file)}>
            {needsReply ? "Responder aclaración" : "Enviar"}
          </Button>
        </div>
      </div>
    </details>
  );
}
