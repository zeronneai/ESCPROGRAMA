import type { SacActividad, SacEstado, SacPersona, SacVerificacion } from "@/lib/ops/calidad";

/** Valores del formato de accion correctiva (se usa en el servidor y en el formulario). */
export interface SacValues {
  fecha: string;
  solicitante: string;
  codigo_control: string;
  clausula: string;
  fuente: string;
  fuente_otro: string;
  queja_id: string | null;
  descripcion: string;
  equipo: SacPersona[];
  correccion: string;
  contencion: string;
  consecuencia: string;
  objetivo: string;
  causas: Record<string, string>;
  causa_raiz: string;
  procesos_afectados: string;
  actualizar_riesgos: boolean | null;
  plan: SacActividad[];
  plan_crea_riesgo: boolean | null;
  plan_observaciones: string;
  verificacion: SacVerificacion[];
  verificacion_observaciones: string;
  cumple_objetivo: boolean | null;
  alternativa: string;
  fecha_cierre: string;
  estado: SacEstado;
}

export const emptySac = (today: string, solicitante: string, queja_id: string | null, descripcion = ""): SacValues => ({
  fecha: today, solicitante, codigo_control: "", clausula: "", fuente: queja_id ? "queja_cliente" : "", fuente_otro: "", queja_id, descripcion,
  equipo: [{ nombre: "", puesto: "" }], correccion: "", contencion: "", consecuencia: "", objetivo: "", causas: {}, causa_raiz: "",
  procesos_afectados: "", actualizar_riesgos: null, plan: [], plan_crea_riesgo: null, plan_observaciones: "", verificacion: [],
  verificacion_observaciones: "", cumple_objetivo: null, alternativa: "", fecha_cierre: "", estado: "abierta",
});

