/**
 * Guia de la norma ISO 9001:2015 para ESC: estructura de clausulas con lo que pide cada una
 * explicado con palabras propias (no es el texto oficial, que tiene derechos de autor de ISO)
 * y donde esta la evidencia en el portal.
 */

export type EstadoIso = "portal" | "parcial" | "fuera" | "no_aplica";

export const ESTADO_ISO: Record<EstadoIso, { label: string; cls: string; ayuda: string }> = {
  portal: { label: "En el portal", cls: "bg-green-100 text-green-800 ring-green-200", ayuda: "La evidencia se genera en el portal." },
  parcial: { label: "Parcial", cls: "bg-amber-100 text-amber-900 ring-amber-200", ayuda: "Una parte está en el portal; falta un documento o registro." },
  fuera: { label: "Fuera del portal", cls: "bg-slate-200 text-slate-700 ring-slate-300", ayuda: "Se lleva en documentos o registros aparte." },
  no_aplica: { label: "No aplica", cls: "bg-slate-100 text-slate-500 ring-slate-200", ayuda: "Se justifica en el alcance del sistema." },
};

export type Evidencia = { texto: string; href?: string };

export type Requisito = {
  num: string;
  titulo: string;
  /** Lo que pide, en palabras sencillas. */
  pide: string;
  estado: EstadoIso;
  evidencia: Evidencia[];
  /** Que falta o que conviene hacer. */
  pendiente?: string;
};

export type Capitulo = { num: string; titulo: string; idea: string; requisitos: Requisito[] };

export const ISO_INTRO: Capitulo = {
  num: "0-3",
  titulo: "Introducción, objeto, referencias y términos",
  idea:
    "Los capítulos 0 a 3 no se auditan: explican el enfoque de la norma. Se basa en el ciclo PHVA (Planear, Hacer, Verificar, Actuar), en el enfoque a procesos y en el pensamiento basado en riesgos. Sus 7 principios: enfoque al cliente, liderazgo, compromiso de las personas, enfoque a procesos, mejora, decisiones basadas en evidencia y gestión de las relaciones (proveedores y otras partes).",
  requisitos: [],
};

export const ISO_9001: Capitulo[] = [
  {
    num: "4",
    titulo: "Contexto de la organización",
    idea: "Entender la empresa, quién le importa y qué procesos forman el sistema de calidad.",
    requisitos: [
      {
        num: "4.1", titulo: "Comprensión de la organización y de su contexto",
        pide: "Identificar los temas internos y externos que afectan los resultados (mercado, proveedores de Asia, tipo de cambio, competencia, personal, sistemas) y revisarlos de vez en cuando.",
        estado: "parcial",
        evidencia: [{ texto: "Análisis de riesgo por proceso (causas y riesgos ya identificados)", href: "/calidad/riesgos" }],
        pendiente: "Tener un FODA o matriz de contexto en Documentos y revisarlo al menos una vez al año.",
      },
      {
        num: "4.2", titulo: "Necesidades y expectativas de las partes interesadas",
        pide: "Saber quiénes influyen en el sistema (clientes, proveedores, personal, SAT, aduana, dueños) y qué esperan de ESC, y darle seguimiento.",
        estado: "parcial",
        evidencia: [
          { texto: "Evaluación de clientes y de proveedores", href: "/evaluaciones/clientes" },
          { texto: "Quejas de cliente", href: "/calidad" },
        ],
        pendiente: "Una matriz de partes interesadas (quién, qué espera, cómo se le da seguimiento) en Documentos.",
      },
      {
        num: "4.3", titulo: "Alcance del sistema de gestión de la calidad",
        pide: "Escribir qué abarca el sistema (comercialización e importación de productos, sucursal o sucursales) y justificar lo que no aplica (por ejemplo, diseño).",
        estado: "fuera",
        evidencia: [{ texto: "Manual o documento de alcance en Documentos", href: "/documentos" }],
      },
      {
        num: "4.4", titulo: "Sistema de gestión de la calidad y sus procesos",
        pide: "Definir los procesos (ventas, compras, almacén, finanzas, calidad...), cómo se relacionan, quién es responsable, cómo se miden y sus riesgos.",
        estado: "parcial",
        evidencia: [
          { texto: "Análisis de riesgo por proceso", href: "/calidad/riesgos" },
          { texto: "Indicadores por proceso", href: "/indicadores" },
        ],
        pendiente: "Mapa de procesos y fichas de proceso en Documentos.",
      },
    ],
  },
  {
    num: "5",
    titulo: "Liderazgo",
    idea: "La dirección se compromete, define la política de calidad y deja claro quién hace qué.",
    requisitos: [
      {
        num: "5.1", titulo: "Liderazgo y compromiso (incluye enfoque al cliente)",
        pide: "La dirección se hace responsable del sistema, da recursos, revisa resultados y se asegura de que se cumplan los requisitos del cliente y se busque su satisfacción.",
        estado: "parcial",
        evidencia: [
          { texto: "Minutas de reunión con acuerdos de la dirección", href: "/minutas" },
          { texto: "Quejas y encuestas de satisfacción", href: "/calidad" },
        ],
      },
      {
        num: "5.2", titulo: "Política de la calidad",
        pide: "Tener una política de calidad escrita, alineada al negocio, que el personal conozca y entienda.",
        estado: "fuera",
        evidencia: [{ texto: "Política de calidad en Documentos", href: "/documentos" }],
        pendiente: "Comunicarla: puede ponerse visible en el portal o en la firma de correo.",
      },
      {
        num: "5.3", titulo: "Roles, responsabilidades y autoridades",
        pide: "Que cada puesto sepa qué le toca y qué puede autorizar.",
        estado: "parcial",
        evidencia: [{ texto: "Puestos y permisos de cada usuario en el portal", href: "/comprador/usuarios" }],
        pendiente: "Organigrama y descripciones de puesto en Documentos.",
      },
    ],
  },
  {
    num: "6",
    titulo: "Planificación",
    idea: "Pensar en riesgos y oportunidades, poner objetivos medibles y planear los cambios.",
    requisitos: [
      {
        num: "6.1", titulo: "Acciones para abordar riesgos y oportunidades",
        pide: "Identificar riesgos y oportunidades de cada proceso, calificarlos y definir acciones, revisando después si funcionaron.",
        estado: "portal",
        evidencia: [{ texto: "Análisis de riesgo (severidad, ocurrencia, detección, acciones y riesgo residual)", href: "/calidad/riesgos" }],
      },
      {
        num: "6.2", titulo: "Objetivos de la calidad y planificación para lograrlos",
        pide: "Tener objetivos medibles por proceso, con responsable, plazo y forma de medirlos.",
        estado: "portal",
        evidencia: [{ texto: "Indicadores (tiempo de respuesta de cotizaciones, quejas, ventas, etc.)", href: "/indicadores" }],
      },
      {
        num: "6.3", titulo: "Planificación de los cambios",
        pide: "Cuando se cambie algo del sistema (procesos, documentos, puestos), planearlo: propósito, consecuencias, recursos y responsables.",
        estado: "portal",
        evidencia: [{ texto: "Control de cambios", href: "/calidad/cambios" }],
      },
    ],
  },
  {
    num: "7",
    titulo: "Apoyo",
    idea: "Personas, infraestructura, conocimiento, comunicación y documentos para que el sistema funcione.",
    requisitos: [
      {
        num: "7.1.1-7.1.4", titulo: "Recursos, personas, infraestructura y ambiente de trabajo",
        pide: "Tener el personal, instalaciones, equipo, sistemas y ambiente adecuados, y darles mantenimiento.",
        estado: "fuera",
        evidencia: [{ texto: "Programa de mantenimiento de equipo, vehículos y sistemas (Documentos)", href: "/documentos" }],
      },
      {
        num: "7.1.5", titulo: "Recursos de seguimiento y medición",
        pide: "Si se mide algo que afecta la calidad (básculas, cintas, instrumentos), que sea confiable: calibrado o verificado y con registro.",
        estado: "fuera",
        evidencia: [{ texto: "Registros de calibración o verificación (por ejemplo, la báscula del almacén)" }],
      },
      {
        num: "7.1.6", titulo: "Conocimientos de la organización",
        pide: "Guardar y compartir lo que la empresa sabe hacer, para que no se pierda si alguien se va.",
        estado: "portal",
        evidencia: [
          { texto: "Preguntas frecuentes y ayuda dentro del portal" },
          { texto: "Catálogo de artículos", href: "/articulos" },
          { texto: "Documentos", href: "/documentos" },
        ],
      },
      {
        num: "7.2", titulo: "Competencia",
        pide: "Definir qué debe saber cada puesto, capacitar a quien le falte y guardar evidencia.",
        estado: "fuera",
        evidencia: [{ texto: "Perfiles de puesto y registros de capacitación (Documentos)", href: "/documentos" }],
        pendiente: "Plan anual de capacitación con registro de asistencia y evaluación.",
      },
      {
        num: "7.3", titulo: "Toma de conciencia",
        pide: "Que el personal conozca la política y objetivos de calidad, cómo contribuye y qué pasa si no se cumple.",
        estado: "fuera",
        evidencia: [{ texto: "Pláticas, firmas de enterado o minutas de capacitación", href: "/minutas" }],
      },
      {
        num: "7.4", titulo: "Comunicación",
        pide: "Definir qué se comunica, cuándo, a quién y por qué medio.",
        estado: "portal",
        evidencia: [
          { texto: "Notificaciones del portal en tiempo real (campanita)" },
          { texto: "Chat por partida en cotizaciones y comentarios" },
          { texto: "Minutas de reunión", href: "/minutas" },
        ],
      },
      {
        num: "7.5", titulo: "Información documentada",
        pide: "Crear, revisar, aprobar y controlar documentos y registros: versión vigente, quién lo cambió, cómo se guarda y cuánto tiempo.",
        estado: "portal",
        evidencia: [
          { texto: "Documentos controlados", href: "/documentos" },
          { texto: "Control de cambios", href: "/calidad/cambios" },
          { texto: "Historial de cambios (quién modificó qué)", href: "/comprador/auditoria" },
        ],
      },
    ],
  },
  {
    num: "8",
    titulo: "Operación",
    idea: "Hacer el trabajo diario bajo control: requisitos del cliente, proveedores, entrega y producto no conforme.",
    requisitos: [
      {
        num: "8.1", titulo: "Planificación y control operacional",
        pide: "Planear los procesos operativos con criterios claros (plazos, responsables, registros).",
        estado: "portal",
        evidencia: [{ texto: "Flujo de solicitudes de cotización con plazos y alertas de vencimiento", href: "/comprador" }],
      },
      {
        num: "8.2", titulo: "Requisitos para los productos y servicios",
        pide: "Comunicarse con el cliente, entender bien lo que pide (especificación, cantidad, entrega), revisar que se pueda cumplir antes de comprometerse y controlar los cambios.",
        estado: "portal",
        evidencia: [
          { texto: "Solicitudes de cotización con descripción, imagen y aclaraciones", href: "/vendedor" },
          { texto: "Cotizaciones en PDF con versiones", href: "/vendedor" },
          { texto: "Pedidos Pegatron: OC del cliente con el artículo ESC", href: "/pedidos-pegatron" },
        ],
      },
      {
        num: "8.3", titulo: "Diseño y desarrollo de productos y servicios",
        pide: "Solo aplica si la empresa diseña productos.",
        estado: "no_aplica",
        evidencia: [{ texto: "ESC comercializa e importa; no diseña. Justificarlo en el alcance (4.3)." }],
      },
      {
        num: "8.4", titulo: "Control de procesos, productos y servicios suministrados externamente",
        pide: "Seleccionar, evaluar y dar seguimiento a los proveedores, y comunicarles bien lo que se les compra (OC clara).",
        estado: "portal",
        evidencia: [
          { texto: "Catálogo de proveedores", href: "/comprador/proveedores" },
          { texto: "Evaluación de proveedores", href: "/evaluaciones/proveedores" },
          { texto: "Órdenes de compra y pagos a proveedores", href: "/pagos" },
          { texto: "Guías de recolección con la OC", href: "/guias" },
        ],
      },
      {
        num: "8.5.1", titulo: "Control de la provisión del servicio",
        pide: "Entregar bajo condiciones controladas: información disponible, actividades de seguimiento y personal competente.",
        estado: "portal",
        evidencia: [
          { texto: "Entregas de facturas", href: "/entregas" },
          { texto: "Guías con partidas palomeadas", href: "/guias" },
          { texto: "Recepciones de almacén", href: "/almacen/recepciones" },
        ],
      },
      {
        num: "8.5.2", titulo: "Identificación y trazabilidad",
        pide: "Poder identificar el producto y, cuando se requiera, rastrearlo (lote, folio) desde el proveedor hasta el cliente.",
        estado: "parcial",
        evidencia: [
          { texto: "Folios de cotización, OC, factura y guía; etiquetas de almacén", href: "/almacen/inventario" },
        ],
        pendiente: "Control de lote o certificado en los artículos que lo requieran (es el riesgo en rojo del análisis de Compras).",
      },
      {
        num: "8.5.3", titulo: "Propiedad de clientes o proveedores externos",
        pide: "Cuidar lo que sea de clientes o proveedores mientras esté en ESC (material en consignación, muestras, datos) y avisar si se daña o pierde.",
        estado: "fuera",
        evidencia: [{ texto: "Registro de material de terceros si aplica" }],
      },
      {
        num: "8.5.4", titulo: "Preservación",
        pide: "Que el producto no se dañe al almacenarlo, empacarlo y enviarlo.",
        estado: "parcial",
        evidencia: [
          { texto: "Inventario y ubicaciones de almacén", href: "/almacen/inventario" },
          { texto: "Guías con tipo de empaque, medidas y peso", href: "/guias" },
        ],
      },
      {
        num: "8.5.5", titulo: "Actividades posteriores a la entrega",
        pide: "Atender lo que pase después de entregar: garantías, devoluciones, quejas.",
        estado: "portal",
        evidencia: [{ texto: "Quejas de cliente y liga pública de quejas", href: "/calidad" }],
      },
      {
        num: "8.5.6", titulo: "Control de los cambios",
        pide: "Revisar y controlar los cambios en la operación para que se sigan cumpliendo los requisitos.",
        estado: "portal",
        evidencia: [{ texto: "Control de cambios", href: "/calidad/cambios" }],
      },
      {
        num: "8.6", titulo: "Liberación de los productos y servicios",
        pide: "Verificar que el producto cumple antes de entregarlo al cliente y dejar registro de quién lo liberó.",
        estado: "portal",
        evidencia: [
          { texto: "Recepción e inspección en almacén", href: "/almacen/recepciones" },
          { texto: "Palomeo de partidas al armar la guía", href: "/guias" },
        ],
      },
      {
        num: "8.7", titulo: "Control de las salidas no conformes",
        pide: "Identificar y apartar lo que no cumple para que no llegue al cliente, decidir qué se hace (devolver, reponer, aceptar con concesión) y registrarlo.",
        estado: "portal",
        evidencia: [
          { texto: "Quejas de cliente con dictamen (aplica / no aplica)", href: "/calidad" },
          { texto: "Solicitudes de acción correctiva (SAC)", href: "/calidad" },
        ],
      },
    ],
  },
  {
    num: "9",
    titulo: "Evaluación del desempeño",
    idea: "Medir, preguntar al cliente, auditar y que la dirección revise todo.",
    requisitos: [
      {
        num: "9.1.1", titulo: "Seguimiento, medición, análisis y evaluación",
        pide: "Decidir qué se mide, cómo y cuándo, y analizar los resultados.",
        estado: "portal",
        evidencia: [
          { texto: "Indicadores", href: "/indicadores" },
          { texto: "Estadísticas de compras", href: "/comprador/estadisticas" },
          { texto: "Resumen de ventas", href: "/ventas" },
        ],
      },
      {
        num: "9.1.2", titulo: "Satisfacción del cliente",
        pide: "Saber qué opina el cliente de ESC (encuestas, quejas, felicitaciones) y usar esa información.",
        estado: "portal",
        evidencia: [
          { texto: "Encuestas de satisfacción por liga al cliente", href: "/evaluaciones/clientes" },
          { texto: "Quejas de cliente", href: "/calidad" },
        ],
      },
      {
        num: "9.1.3", titulo: "Análisis y evaluación",
        pide: "Con los datos, evaluar conformidad del producto, satisfacción, desempeño de procesos y proveedores, y si las acciones de riesgos funcionaron.",
        estado: "portal",
        evidencia: [
          { texto: "Indicadores", href: "/indicadores" },
          { texto: "Riesgo residual en el análisis de riesgo", href: "/calidad/riesgos" },
        ],
      },
      {
        num: "9.2", titulo: "Auditoría interna",
        pide: "Auditar el sistema en intervalos planificados con un programa, auditores imparciales, informe de resultados y acciones.",
        estado: "fuera",
        evidencia: [{ texto: "Programa anual de auditorías, planes e informes (Documentos)", href: "/documentos" }],
        pendiente: "Si quieren, se puede agregar al portal un módulo de auditorías internas con hallazgos ligados a SAC.",
      },
      {
        num: "9.3", titulo: "Revisión por la dirección",
        pide: "La dirección revisa el sistema periódicamente: resultados, quejas, auditorías, proveedores, riesgos, recursos y oportunidades de mejora, y deja decisiones registradas.",
        estado: "parcial",
        evidencia: [{ texto: "Minuta de la revisión por la dirección", href: "/minutas" }],
        pendiente: "Usar una minuta con todas las entradas que pide la norma (indicadores, quejas, auditorías, proveedores, riesgos).",
      },
    ],
  },
  {
    num: "10",
    titulo: "Mejora",
    idea: "Corregir lo que falla, atacar la causa raíz y mejorar continuamente.",
    requisitos: [
      {
        num: "10.1", titulo: "Generalidades",
        pide: "Buscar oportunidades de mejora para cumplir requisitos y aumentar la satisfacción del cliente.",
        estado: "portal",
        evidencia: [
          { texto: "Oportunidades en el análisis de riesgo", href: "/calidad/riesgos" },
          { texto: "Comentarios del catálogo", href: "/comprador/catalogo" },
        ],
      },
      {
        num: "10.2", titulo: "No conformidad y acción correctiva",
        pide: "Cuando algo falla: corregirlo, buscar la causa raíz, actuar para que no se repita, verificar que funcionó y guardar registro.",
        estado: "portal",
        evidencia: [{ texto: "Solicitudes de acción correctiva (SAC) y quejas", href: "/calidad" }],
      },
      {
        num: "10.3", titulo: "Mejora continua",
        pide: "Mejorar el sistema de forma constante, usando los resultados del análisis y de la revisión por la dirección.",
        estado: "portal",
        evidencia: [
          { texto: "Indicadores", href: "/indicadores" },
          { texto: "Minutas con acuerdos de mejora", href: "/minutas" },
        ],
      },
    ],
  },
];

export function resumenIso(caps: Capitulo[] = ISO_9001) {
  const todos = caps.flatMap((c) => c.requisitos);
  const cuenta = (e: EstadoIso) => todos.filter((r) => r.estado === e).length;
  return { total: todos.length, portal: cuenta("portal"), parcial: cuenta("parcial"), fuera: cuenta("fuera"), no_aplica: cuenta("no_aplica") };
}
