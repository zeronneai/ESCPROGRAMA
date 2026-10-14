"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { DateTime } from "luxon";
import {
  addActivityAction,
  archiveLeadAction,
  changeStageAction,
  claimLeadAction,
  convertLeadAction,
  linkLeadCustomerAction,
} from "@/actions/leads";
import { Icon } from "@/components/icons";
import { FollowUpBadge, PriorityBadge, StageBadge } from "@/components/lead-badges";
import { LeadForm } from "@/components/lead-form";
import { Alert, Button, Card, Field, Input } from "@/components/ui";
import { money, relativeDays } from "@/lib/leads/format";
import {
  ACTIVITY_ICON,
  ACTIVITY_KINDS,
  ACTIVITY_LABEL,
  ACTIVITY_RESULTS,
  LOST_REASONS,
  OPEN_STAGES,
  SOURCE_LABEL,
  STAGE_LABEL,
  STAGE_SHORT,
  isClosed,
  whatsappNumber,
  type ActivityKind,
  type LeadActivityRow,
  type LeadRow,
  type LeadStage,
} from "@/lib/leads/types";

type Notice = { tone: "success" | "error"; text: string } | null;
const textarea =
  "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600";

export function LeadDetail({
  lead,
  activities,
  isMine,
  customer,
  timezone,
}: {
  lead: LeadRow;
  activities: LeadActivityRow[];
  isMine: boolean;
  customer: { id: string; nombre: string; tipo: string } | null;
  timezone: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [editing, setEditing] = useState(false);
  const [lost, setLost] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const [converting, setConverting] = useState(false);
  const [convertName, setConvertName] = useState(lead.empresa);
  const [tipo, setTipo] = useState<ActivityKind>("llamada");
  const [resultado, setResultado] = useState("");
  const [nota, setNota] = useState("");
  const [seguimiento, setSeguimiento] = useState("");

  const wa = whatsappNumber(lead.telefono);
  const waText = encodeURIComponent(
    `Hola${lead.contacto_nombre ? ` ${lead.contacto_nombre.split(" ")[0]}` : ""}, le saluda ESC Representaciones (El Sauz).`,
  );
  const closed = isClosed(lead.etapa);
  const unassigned = lead.vendedor_id === null;
  const today = DateTime.now().setZone(timezone);
  const quick = [
    ["Mañana", today.plus({ days: 1 })],
    ["En 3 días", today.plus({ days: 3 })],
    ["En 1 semana", today.plus({ weeks: 1 })],
    ["En 2 semanas", today.plus({ weeks: 2 })],
  ] as const;

  function run(key: string, fn: () => Promise<{ ok: boolean; error?: string }>, ok: string, after?: () => void) {
    setNotice(null);
    setBusy(key);
    start(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) {
        setNotice({ tone: "error", text: r.error ?? "Ocurrió un error" });
        return;
      }
      setNotice({ tone: "success", text: ok });
      after?.();
      router.refresh();
    });
  }

  function saveActivity(e: React.FormEvent) {
    e.preventDefault();
    run(
      "activity",
      () => addActivityAction(lead.id, { tipo: tipo as (typeof ACTIVITY_KINDS)[number], resultado, nota, proximo_seguimiento: seguimiento }),
      `${ACTIVITY_LABEL[tipo]} registrada`,
      () => {
        setResultado("");
        setNota("");
        setSeguimiento("");
      },
    );
  }

  function quoteForLead() {
    setNotice(null);
    setBusy("quote");
    start(async () => {
      const r = await linkLeadCustomerAction(lead.id);
      if (!r.ok) {
        setBusy(null);
        setNotice({ tone: "error", text: r.error });
        return;
      }
      if (["nuevo", "contactado", "interesado"].includes(lead.etapa)) await changeStageAction(lead.id, "cotizando");
      router.push(`/vendedor/solicitudes/nueva?cliente=${r.customerId}`);
    });
  }

  const contactLink = (kind: ActivityKind) => () => {
    setTipo(kind);
    document.getElementById("registrar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (editing) {
    return (
      <Card className="p-4 sm:p-6">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">Editar lead</h1>
        <LeadForm lead={lead} onDone={() => setEditing(false)} />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Encabezado */}
      <Card className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">{lead.empresa}</h1>
              <StageBadge etapa={lead.etapa} />
              <PriorityBadge prioridad={lead.prioridad} />
              {lead.archived_at && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-700">Archivado</span>}
            </div>
            <p className="text-sm text-slate-600">
              {[lead.contacto_nombre, lead.contacto_puesto].filter(Boolean).join(" · ") || "Sin nombre de contacto"}
            </p>
            <p className="text-xs text-slate-500">
              {SOURCE_LABEL[lead.origen]}
              {lead.origen_detalle && ` (${lead.origen_detalle})`} · Registrado {relativeDays(lead.created_at, undefined, timezone).toLowerCase()}
            </p>
          </div>
          {isMine && (
            <div className="flex shrink-0 gap-2">
              <Button variant="secondary" onClick={() => setEditing(true)}>
                Editar
              </Button>
              <Button
                variant="ghost"
                loading={busy === "archive"}
                onClick={() => run("archive", () => archiveLeadAction(lead.id, !lead.archived_at), lead.archived_at ? "Lead restaurado" : "Lead archivado")}
              >
                {lead.archived_at ? "Restaurar" : "Archivar"}
              </Button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          {lead.telefono ? (
            <a
              href={`tel:${lead.telefono.replace(/[^\d+]/g, "")}`}
              onClick={contactLink("llamada")}
              className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 py-2.5 text-xs font-medium text-slate-700 hover:border-brand-600 hover:text-brand-700"
            >
              <Icon name="phone" />
              Llamar
            </a>
          ) : (
            <span className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-slate-200 py-2.5 text-xs text-slate-400">
              <Icon name="phone" />
              Sin teléfono
            </span>
          )}
          {wa ? (
            <a
              href={`https://wa.me/${wa}?text=${waText}`}
              target="_blank"
              rel="noreferrer"
              onClick={contactLink("whatsapp")}
              className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 py-2.5 text-xs font-medium text-slate-700 hover:border-green-600 hover:text-green-700"
            >
              <Icon name="chat" />
              WhatsApp
            </a>
          ) : (
            <span className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-slate-200 py-2.5 text-xs text-slate-400">
              <Icon name="chat" />
              Sin WhatsApp
            </span>
          )}
          {lead.correo ? (
            <a
              href={`mailto:${lead.correo}`}
              onClick={contactLink("correo")}
              className="flex flex-col items-center gap-1 rounded-lg border border-slate-200 py-2.5 text-xs font-medium text-slate-700 hover:border-brand-600 hover:text-brand-700"
            >
              <Icon name="mail" />
              Correo
            </a>
          ) : (
            <span className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-slate-200 py-2.5 text-xs text-slate-400">
              <Icon name="mail" />
              Sin correo
            </span>
          )}
        </div>
      </Card>

      {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}

      {unassigned && (
        <Card className="flex flex-col gap-3 border-brand-100 bg-brand-50 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-brand-900">Este lead no tiene vendedor asignado. Tómalo para darle seguimiento.</p>
          <Button loading={busy === "claim"} onClick={() => run("claim", () => claimLeadAction(lead.id), "Ahora este lead es tuyo")}>
            Tomar lead
          </Button>
        </Card>
      )}

      {isMine && (
        <>
          {/* Etapa */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Etapa</h2>
              <span className="text-xs text-slate-500">Desde {relativeDays(lead.etapa_at, undefined, timezone).toLowerCase()}</span>
            </div>
            <ol className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
              {[...OPEN_STAGES, "ganado" as const].map((s, i, arr) => {
                const idx = arr.indexOf(lead.etapa as (typeof arr)[number]);
                const done = idx >= 0 && i < idx;
                const current = s === lead.etapa;
                return (
                  <li key={s} className="flex-1">
                    <button
                      type="button"
                      disabled={pending || current}
                      onClick={() =>
                        s === "ganado"
                          ? setConverting(true)
                          : run(`stage-${s}`, () => changeStageAction(lead.id, s), `Etapa: ${STAGE_LABEL[s]}`)
                      }
                      className={`flex w-full min-w-[5.5rem] flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs font-medium transition ${
                        current
                          ? s === "ganado"
                            ? "border-green-600 bg-green-600 text-white"
                            : "border-brand-600 bg-brand-600 text-white"
                          : done
                            ? "border-brand-100 bg-brand-50 text-brand-700 hover:border-brand-600"
                            : "border-slate-200 bg-white text-slate-600 hover:border-brand-600 hover:text-brand-700"
                      }`}
                    >
                      <span className="tabular-nums opacity-70">{i + 1}</span>
                      {busy === `stage-${s}` ? "..." : STAGE_SHORT[s]}
                    </button>
                  </li>
                );
              })}
            </ol>
            {lead.etapa === "perdido" ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                <span>Perdido: {lead.motivo_perdida}</span>
                <Button variant="secondary" loading={busy === "reopen"} onClick={() => run("reopen", () => changeStageAction(lead.id, "contactado"), "Lead reabierto")}>
                  Reabrir
                </Button>
              </div>
            ) : (
              !lost && (
                <button type="button" onClick={() => setLost(true)} className="text-xs text-slate-500 underline hover:text-red-700">
                  Marcar como perdido
                </button>
              )
            )}
            {lost && (
              <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
                <Field label="¿Por qué se perdió?">
                  <Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} list="motivos-perdida-d" autoFocus />
                  <datalist id="motivos-perdida-d">{LOST_REASONS.map((m) => <option key={m} value={m} />)}</datalist>
                </Field>
                <div className="flex flex-wrap gap-1.5">
                  {LOST_REASONS.map((m) => (
                    <button key={m} type="button" onClick={() => setLostReason(m)} className="rounded-full border border-red-200 bg-white px-2.5 py-1 text-xs text-red-800">
                      {m}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    loading={busy === "lost"}
                    onClick={() => run("lost", () => changeStageAction(lead.id, "perdido", lostReason), "Marcado como perdido", () => setLost(false))}
                  >
                    Confirmar
                  </Button>
                  <Button variant="ghost" onClick={() => setLost(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Cliente y cotizacion */}
          <Card className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-800">Cliente y cotización</h2>
            {customer ? (
              <p className="text-sm text-slate-700">
                Vinculado al cliente <strong>{customer.nombre}</strong>{" "}
                <span className="text-xs text-slate-500">({customer.tipo === "cliente" ? "cliente" : "prospecto"})</span>
              </p>
            ) : (
              <p className="text-sm text-slate-500">Aún no está en el catálogo de clientes.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={busy === "quote"} onClick={quoteForLead}>
                <Icon name="note" className="h-4 w-4" />
                Crear solicitud de cotización
              </Button>
              {lead.etapa !== "ganado" && (
                <Button onClick={() => setConverting(true)} className="bg-green-600 hover:bg-green-700">
                  Convertir a cliente
                </Button>
              )}
            </div>
            {converting && (
              <div className="space-y-2 rounded-md border border-green-200 bg-green-50 p-3">
                <p className="text-sm text-green-900">
                  Se marcará como <strong>ganado</strong> y quedará en el catálogo de clientes. Si ya existe un cliente con ese nombre, se reutiliza.
                </p>
                <Field label="Nombre del cliente">
                  <Input value={convertName} onChange={(e) => setConvertName(e.target.value)} />
                </Field>
                <div className="flex gap-2">
                  <Button
                    className="bg-green-600 hover:bg-green-700"
                    loading={busy === "convert"}
                    onClick={() => run("convert", () => convertLeadAction(lead.id, convertName), "¡Listo! Ahora es cliente.", () => setConverting(false))}
                  >
                    Confirmar
                  </Button>
                  <Button variant="ghost" onClick={() => setConverting(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Registrar actividad */}
          <Card id="registrar" className="scroll-mt-20 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-slate-800">Registrar contacto</h2>
              {!closed && <FollowUpBadge date={lead.proximo_seguimiento} timezone={timezone} />}
            </div>
            <form onSubmit={saveActivity} className="space-y-3">
              <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
                {ACTIVITY_KINDS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setTipo(k);
                      setResultado("");
                    }}
                    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                      tipo === k ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-700"
                    }`}
                  >
                    <Icon name={ACTIVITY_ICON[k]} className="h-3.5 w-3.5" />
                    {ACTIVITY_LABEL[k]}
                  </button>
                ))}
              </div>
              {ACTIVITY_RESULTS[tipo] && (
                <div className="flex flex-wrap gap-1.5">
                  {ACTIVITY_RESULTS[tipo]!.map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setResultado(resultado === r ? "" : r)}
                      className={`rounded-full px-2.5 py-1 text-xs ${resultado === r ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={2}
                className={textarea}
                placeholder={tipo === "nota" ? "Escribe la nota" : "¿Qué se platicó? (opcional)"}
              />
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-slate-600">Próximo seguimiento (opcional)</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {quick.map(([label, d]) => (
                    <button
                      key={label}
                      type="button"
                      onClick={() => setSeguimiento(seguimiento === d.toISODate() ? "" : d.toISODate()!)}
                      className={`rounded-full border px-2.5 py-1 text-xs ${
                        seguimiento === d.toISODate() ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                  <input
                    type="date"
                    value={seguimiento}
                    onChange={(e) => setSeguimiento(e.target.value)}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                    aria-label="Fecha de seguimiento"
                  />
                </div>
              </div>
              <Button type="submit" loading={busy === "activity"} className="w-full sm:w-auto">
                Guardar {ACTIVITY_LABEL[tipo].toLowerCase()}
              </Button>
            </form>
          </Card>
        </>
      )}

      <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
        {/* Datos */}
        <Card className="space-y-3 self-start">
          <h2 className="text-sm font-semibold text-slate-800">Datos</h2>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2 text-sm">
            <Row label="Le interesa">{lead.producto_interes}</Row>
            <Row label="Teléfono">{lead.telefono}</Row>
            <Row label="Correo">{lead.correo && <span className="break-all">{lead.correo}</span>}</Row>
            <Row label="Ciudad">{lead.ciudad}</Row>
            <Row label="Industria">{lead.industria}</Row>
            <Row label="Valor estimado">{money(lead.valor_estimado, lead.moneda)}</Row>
            <Row label="Último contacto">{relativeDays(lead.ultimo_contacto_at, undefined, timezone)}</Row>
            <Row label="Notas">{lead.notas && <span className="whitespace-pre-line">{lead.notas}</span>}</Row>
          </dl>
        </Card>

        {/* Historial */}
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-800">Historial ({activities.length})</h2>
          {activities.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Aún no hay contactos registrados.</p>
          ) : (
            <ol className="relative space-y-4 border-l border-slate-200 pl-5">
              {activities.map((a) => (
                <li key={a.id} className="relative">
                  <span
                    className={`absolute -left-[1.95rem] flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white ${
                      a.tipo === "cambio_etapa" ? "bg-slate-100 text-slate-500" : "bg-brand-50 text-brand-700"
                    }`}
                  >
                    <Icon name={ACTIVITY_ICON[a.tipo]} className="h-3.5 w-3.5" />
                  </span>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <p className="text-sm font-medium text-slate-800">
                      {a.tipo === "cambio_etapa" ? (
                        <>
                          {a.etapa_antes ? STAGE_SHORT[a.etapa_antes as LeadStage] : "?"} → {STAGE_SHORT[a.etapa_despues as LeadStage]}
                        </>
                      ) : (
                        ACTIVITY_LABEL[a.tipo]
                      )}
                      {a.resultado && <span className="font-normal text-slate-500"> · {a.resultado}</span>}
                    </p>
                    <time className="text-xs text-slate-400" dateTime={a.created_at}>
                      {DateTime.fromISO(a.created_at, { zone: timezone }).setLocale("es-MX").toFormat("d LLL yyyy, HH:mm")}
                    </time>
                  </div>
                  {a.nota && <p className="mt-0.5 whitespace-pre-line text-sm text-slate-600">{a.nota}</p>}
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {customer && (
        <p className="text-center text-xs text-slate-400">
          <Link href={`/vendedor?cliente=${customer.id}`} className="underline">
            Ver solicitudes de este cliente
          </Link>
        </p>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="min-w-0 text-slate-800">{children || <span className="text-slate-400">-</span>}</dd>
    </>
  );
}
