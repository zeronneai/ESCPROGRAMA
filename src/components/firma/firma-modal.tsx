"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { guardarFirmaAction, posponerFirmaAction } from "@/actions/firma";
import { Alert, Button, Field, Input } from "@/components/ui";
import { copyRich } from "@/lib/clipboard";
import { ABRIR_FIRMA, archivoFirma, linkCorto, type Firma } from "@/lib/firma";


const W = 640; // ancho logico de la firma (se dibuja al doble para que se vea nitida)
const ESCALA = 2;
const FUENTE = "Inter, 'Segoe UI', Arial, sans-serif";

function cargarImagen(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, mal) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = mal;
    i.src = src;
  });
}

/** Parte un texto en renglones que quepan en el ancho. */
function renglones(ctx: CanvasRenderingContext2D, texto: string, ancho: number, max = 2): string[] {
  const out: string[] = [];
  let linea = "";
  for (const w of texto.split(/\s+/).filter(Boolean)) {
    const prueba = linea ? `${linea} ${w}` : w;
    if (ctx.measureText(prueba).width <= ancho || !linea) linea = prueba;
    else {
      out.push(linea);
      linea = w;
    }
  }
  if (linea) out.push(linea);
  if (out.length > max) {
    const r = out.slice(0, max);
    r[max - 1] = `${r[max - 1].replace(/\s+\S*$/, "")}…`;
    return r;
  }
  return out;
}

/** Dibuja la firma en un canvas. */
async function dibujar(f: Firma): Promise<HTMLCanvasElement> {
  await document.fonts?.ready;
  const [logo, qr] = await Promise.all([
    cargarImagen("/logo-esc.png"),
    f.link ? QRCode.toDataURL(f.link, { margin: 1, width: 300, color: { dark: "#0a1a44", light: "#ffffff" } }).then(cargarImagen) : Promise.resolve(null),
  ]);
  const medir = document.createElement("canvas").getContext("2d")!;

  const xDatos = 234;
  const qrT = 84;
  const xQr = W - 24 - qrT;
  const anchoValor = (qr ? xQr - 16 : W - 24) - (xDatos + 56);
  medir.font = `400 12.5px ${FUENTE}`;
  const filas: [string, string[]][] = [];
  if (f.telefono) filas.push(["Tel.", [f.telefono]]);
  if (f.telefono2) filas.push(["Cel.", [f.telefono2]]);
  if (f.correo) filas.push(["Correo", [f.correo]]);
  if (f.web) filas.push(["Web", [linkCorto(f.web)]]);
  if (f.direccion) filas.push(["Dir.", renglones(medir, f.direccion, anchoValor, 3)]);
  const yFilas = f.puesto ? 98 : 80;
  const finFilas = yFilas + filas.reduce((a, [, v]) => a + 19 + (v.length - 1) * 16, 0);
  const alto = Math.max(170, finFilas + 14);
  const banda = f.leyenda || f.link ? 60 : 0;
  const H = alto + banda;

  const cv = document.createElement("canvas");
  cv.width = W * ESCALA;
  cv.height = H * ESCALA;
  const c = cv.getContext("2d")!;
  c.scale(ESCALA, ESCALA);
  c.fillStyle = "#ffffff";
  c.fillRect(0, 0, W, H);

  // Logo y nombre de la empresa
  const lw = 172;
  const lh = (logo.height / logo.width) * lw;
  const ly = Math.max(28, (alto - lh - 26) / 2);
  c.drawImage(logo, 22, ly, lw, lh);
  c.fillStyle = "#64748b";
  c.font = `600 10px ${FUENTE}`;
  c.letterSpacing = "2px";
  c.fillText("ESC REPRESENTACIONES", 24, ly + lh + 22);
  c.letterSpacing = "0px";

  // Linea divisoria
  const g = c.createLinearGradient(0, 24, 0, alto - 24);
  g.addColorStop(0, "#0f2f7a");
  g.addColorStop(1, "#38bdf8");
  c.fillStyle = g;
  c.fillRect(213, 24, 3, alto - 48);

  // Nombre y puesto
  c.fillStyle = "#0a1a44";
  c.font = `700 22px ${FUENTE}`;
  c.fillText(f.nombre, xDatos, 50, (qr ? xQr - 12 : W - 24) - xDatos);
  if (f.puesto) {
    c.fillStyle = "#1d5fd6";
    c.font = `600 13px ${FUENTE}`;
    c.fillText(f.puesto, xDatos, 72);
  }

  // Datos de contacto
  let y = yFilas;
  for (const [etq, vals] of filas) {
    c.fillStyle = "#1d5fd6";
    c.font = `700 10.5px ${FUENTE}`;
    c.fillText(etq.toUpperCase(), xDatos, y);
    c.fillStyle = "#334155";
    c.font = `400 12.5px ${FUENTE}`;
    vals.forEach((v, i) => c.fillText(v, xDatos + 56, y + i * 16));
    y += 19 + (vals.length - 1) * 16;
  }

  // QR del link de quejas
  if (qr) {
    const yq = Math.max(22, (alto - qrT - 16) / 2);
    c.strokeStyle = "#dbeafe";
    c.lineWidth = 1;
    c.beginPath();
    c.roundRect(xQr - 5, yq - 5, qrT + 10, qrT + 10, 8);
    c.stroke();
    c.drawImage(qr, xQr, yq, qrT, qrT);
    c.fillStyle = "#64748b";
    c.font = `600 9.5px ${FUENTE}`;
    c.textAlign = "center";
    c.fillText("Quejas y sugerencias", xQr + qrT / 2, yq + qrT + 18);
    c.textAlign = "left";
  }

  // Banda azul con curvas y la leyenda
  if (banda) {
    const b = c.createLinearGradient(0, alto, W, H);
    b.addColorStop(0, "#0a1a44");
    b.addColorStop(0.6, "#0f2f7a");
    b.addColorStop(1, "#1d5fd6");
    c.fillStyle = b;
    c.fillRect(0, alto, W, banda);
    const ola = (base: number, amp: number, fase: number, color: string) => {
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += 8) c.lineTo(x, alto + base + Math.sin((x / W) * Math.PI * 2 + fase) * amp);
      c.lineTo(W, H);
      c.closePath();
      c.fillStyle = color;
      c.fill();
    };
    ola(38, 8, 0.6, "rgba(59,130,246,0.30)");
    ola(46, 6, 2.2, "rgba(147,197,253,0.25)");
    c.fillStyle = "#ffffff";
    c.font = `500 12px ${FUENTE}`;
    if (f.leyenda) c.fillText(f.leyenda, 24, alto + 24, W - 48);
    if (f.link) {
      c.fillStyle = "#7dd3fc";
      c.font = `700 13.5px ${FUENTE}`;
      c.fillText(linkCorto(f.link), 24, alto + 44, W - 48);
    }
  }
  return cv;
}

/** HTML de la firma (para pegar en Outlook o Gmail con el link de quejas que se puede abrir). */
function firmaHtml(f: Firma, img?: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const linea = (t: string, v: string) => (v ? `<div><b style="color:#1d5fd6">${t}</b> ${esc(v)}</div>` : "");
  const imagen = img ? `<a href="${esc(f.link)}"><img src="${img}" width="${W}" alt="${esc(f.nombre)} · ESC Representaciones" style="display:block;border:0"></a>` : "";
  return (
    imagen ||
    `<div style="font-family:Arial,sans-serif;font-size:12px;color:#334155;line-height:1.5">` +
      `<div style="font-size:16px;font-weight:bold;color:#0a1a44">${esc(f.nombre)}</div>` +
      (f.puesto ? `<div style="color:#1d5fd6;font-weight:bold">${esc(f.puesto)}</div>` : "") +
      `<div style="color:#64748b;font-weight:bold;letter-spacing:1px;font-size:10px;margin:4px 0">ESC REPRESENTACIONES</div>` +
      linea("Tel.", f.telefono) + linea("Cel.", f.telefono2) + linea("Correo", f.correo) + linea("Web", f.web ? linkCorto(f.web) : "") + linea("Dir.", f.direccion) +
      (f.link ? `<div style="margin-top:6px">${esc(f.leyenda)} <a href="${esc(f.link)}" style="color:#1d4ed8;font-weight:bold">${esc(linkCorto(f.link))}</a></div>` : "") +
      `</div>`
  );
}

export function FirmaModal({ inicial, auto, guardar }: { inicial: Firma; auto: boolean; guardar: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState<Firma>(inicial);
  const [vista, setVista] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hecho, setHecho] = useState(false);
  const [aviso, setAviso] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const turno = useRef(0);

  useEffect(() => {
    if (auto) {
      const t = setTimeout(() => setAbierto(true), 900);
      return () => clearTimeout(t);
    }
  }, [auto]);
  useEffect(() => {
    const abrir = () => setAbierto(true);
    window.addEventListener(ABRIR_FIRMA, abrir);
    return () => window.removeEventListener(ABRIR_FIRMA, abrir);
  }, []);
  useEffect(() => {
    if (!abierto) return;
    const n = ++turno.current;
    const t = setTimeout(async () => {
      try {
        const cv = await dibujar({ ...f, nombre: f.nombre || "Tu nombre" });
        if (n === turno.current) setVista(cv.toDataURL("image/png"));
      } catch {
        /* se reintenta con el siguiente cambio */
      }
    }, 180);
    return () => clearTimeout(t);
  }, [f, abierto]);
  useEffect(() => {
    document.body.style.overflow = abierto ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [abierto]);

  const set = (k: keyof Firma) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const cerrar = useCallback(() => {
    setAbierto(false);
    setAviso(null);
    if (auto && guardar && !hecho) void posponerFirmaAction();
  }, [auto, guardar, hecho]);

  const descargar = async () => {
    if (f.nombre.trim().length < 2) return setAviso({ tone: "error", text: "Escribe tu nombre." });
    setBusy(true);
    setAviso(null);
    try {
      const cv = await dibujar(f);
      const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, "image/png"));
      if (!blob) throw new Error("png");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = archivoFirma(f.nombre);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      if (guardar) {
        const r = await guardarFirmaAction(f);
        if (!r.ok) return setAviso({ tone: "error", text: `Se descargó, pero no se guardaron tus datos: ${r.error}` });
      }
      setHecho(true);
      setAviso({ tone: "success", text: "Listo, se descargó tu firma. Abajo te decimos cómo ponerla en tu correo." });
    } catch {
      setAviso({ tone: "error", text: "No se pudo generar la imagen. Intenta de nuevo." });
    } finally {
      setBusy(false);
    }
  };
  const copiar = async () => {
    try {
      const cv = await dibujar(f);
      await copyRich({ html: firmaHtml(f, cv.toDataURL("image/png")), text: `${f.nombre}\n${f.puesto}\nESC Representaciones\n${[f.telefono, f.telefono2, f.correo].filter(Boolean).join(" · ")}\n${f.leyenda} ${f.link}` });
      setAviso({ tone: "success", text: "Firma copiada. Pégala (Ctrl+V) en la configuración de firma de tu correo: la imagen abre el link de quejas." });
    } catch {
      setAviso({ tone: "error", text: "No se pudo copiar. Usa Descargar imagen." });
    }
  };

  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4" onClick={cerrar}>
      <div
        role="dialog"
        aria-modal
        aria-label="Tu firma de correo"
        className="flex max-h-[95dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative isolate shrink-0 overflow-hidden bg-gradient-to-r from-[#0a1a44] via-[#0f2f7a] to-[#1d5fd6] px-5 py-4 text-white">
          <div className="absolute -right-16 -top-24 h-56 w-56 rounded-full border border-white/15" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Tu firma de correo</h2>
              <p className="text-sm text-sky-100/90">Revisa tus datos y descarga la imagen. Ya trae la leyenda y el link de quejas para tus clientes.</p>
            </div>
            <button type="button" onClick={cerrar} aria-label="Cerrar" className="rounded-md p-1 text-white/80 hover:bg-white/10 hover:text-white">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 lg:grid-cols-[1fr_1.15fr]">
          <div className="space-y-3">
            {aviso && <Alert tone={aviso.tone}>{aviso.text}</Alert>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nombre *"><Input value={f.nombre} onChange={set("nombre")} maxLength={80} /></Field>
              <Field label="Puesto"><Input value={f.puesto} onChange={set("puesto")} maxLength={80} /></Field>
              <Field label="Correo"><Input type="email" value={f.correo} onChange={set("correo")} maxLength={120} /></Field>
              <Field label="Teléfono de oficina"><Input value={f.telefono} onChange={set("telefono")} maxLength={60} /></Field>
              <Field label="Celular / WhatsApp"><Input value={f.telefono2} onChange={set("telefono2")} maxLength={60} placeholder="Opcional" /></Field>
              <Field label="Sitio web"><Input value={f.web} onChange={set("web")} maxLength={80} placeholder="Opcional" /></Field>
            </div>
            <Field label="Dirección de ESC"><Input value={f.direccion} onChange={set("direccion")} maxLength={200} /></Field>
            <Field label="Leyenda de quejas"><Input value={f.leyenda} onChange={set("leyenda")} maxLength={140} /></Field>
            <p className="text-xs text-slate-500">Link de quejas: <span className="font-medium text-slate-700">{linkCorto(f.link)}</span></p>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Vista previa</p>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              {vista ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={vista} alt="Vista previa de tu firma" className="w-full rounded-md shadow-sm ring-1 ring-slate-200" />
              ) : (
                <div className="flex h-40 items-center justify-center text-sm text-slate-400">Generando…</div>
              )}
            </div>
            <details className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
              <summary className="cursor-pointer font-medium text-slate-800">¿Cómo la pongo en mi correo?</summary>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li><b>Outlook:</b> Archivo › Opciones › Correo › Firmas › Nueva. Toca el ícono de imagen y elige el archivo que descargaste. Para que abra las quejas, selecciona la imagen, presiona Ctrl+K y pega el link.</li>
                <li><b>Outlook (más rápido):</b> toca “Copiar firma” aquí y pégala con Ctrl+V en la firma; ya lleva el link.</li>
                <li><b>Gmail:</b> Configuración › Ver toda la configuración › Firma › Crear. Inserta la imagen y guarda abajo.</li>
                <li><b>Celular:</b> la imagen también sirve para mandarla por WhatsApp.</li>
              </ul>
            </details>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3">
          <Button variant="ghost" onClick={cerrar}>{auto && !hecho ? "Ahora no" : "Cerrar"}</Button>
          <Button variant="secondary" onClick={copiar}>Copiar firma</Button>
          <Button loading={busy} onClick={descargar}>Descargar imagen</Button>
        </div>
      </div>
    </div>
  );
}
