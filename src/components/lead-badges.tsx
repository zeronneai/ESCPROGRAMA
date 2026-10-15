import { FOLLOW_TONE, followUpState, formatFollowUp } from "@/lib/leads/format";
import { PRIORITY_LABEL, PRIORITY_TONE, STAGE_SHORT, STAGE_TONE, type LeadStage, type Priority } from "@/lib/leads/types";

export function StageBadge({ etapa }: { etapa: LeadStage }) {
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_TONE[etapa]}`}>{STAGE_SHORT[etapa]}</span>;
}

export function PriorityBadge({ prioridad }: { prioridad: Priority }) {
  if (prioridad === "media") return null;
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY_TONE[prioridad]}`}>{PRIORITY_LABEL[prioridad]}</span>;
}

export function FollowUpBadge({ date, now, timezone }: { date: string | null; now?: Date; timezone?: string }) {
  const s = followUpState(date, now, timezone);
  if (!s) return <span className="text-xs text-slate-400">Sin agendar</span>;
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${FOLLOW_TONE[s]}`}>{formatFollowUp(date, now, timezone)}</span>;
}
