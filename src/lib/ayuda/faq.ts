import type { Rol } from "@/lib/auth/route-guard";

/**
 * Asistente de ayuda (sin IA): preguntas frecuentes con palabras clave.
 * roles: quien la ve (vacio = todos). paths: paginas donde se sugiere primero.
 */
export interface Faq {
  id: string;
  q: string;
  keys: string[];
  a: string[];
  links?: { label: string; href: string }[];
  roles?: Rol[];
  paths?: string[];
}

const V: Rol[] = ["vendedor"];
const C: Rol[] = ["comprador"];
const J: Rol[] = ["jefe_ventas"];
const ISO: Rol[] = ["coordinador_iso"];
const MKT: Rol[] = ["marketplaces"];

export const FAQ: Faq[] = [
  // ----- General
  {
    id: "inicio", q: "¿Qué es la página de Inicio?",
    keys: ["inicio", "tablero", "dashboard", "pendientes", "urgente", "resumen", "atencion"],
    a: ["Es tu tablero: arriba, en \"Requiere tu atención\", lo urgente (en rojo) y lo pendiente (en amarillo).", "Abajo, un resumen de cada sección que te toca. Toca cualquier dato o \"Ver detalle\" para entrar."],
    links: [{ label: "Inicio", href: "/inicio" }],
  },
  {
    id: "password", q: "Olvidé mi contraseña o quiero cambiarla",
    keys: ["contraseña", "password", "clave", "olvide", "entrar", "acceso", "login", "sesion"],
    a: ["El comprador (administrador) te genera una contraseña temporal desde Usuarios > Restablecer.", "Al entrar con ella el sistema te pide crear una nueva.", "Si no puedes entrar, pídeselo al comprador."],
  },
  {
    id: "campanita", q: "¿Para qué es la campanita?",
    keys: ["campana", "campanita", "avisos", "notificaciones", "aviso", "notificacion"],
    a: ["Ahí te llegan los avisos de lo que te toca: respuestas de compras, guías listas, consumo aprobado, quejas, etc.", "Toca un aviso para ir directo a lo que pasó."],
  },
  {
    id: "articulos", q: "¿Dónde veo el catálogo de artículos?",
    keys: ["catalogo", "articulos", "articulo", "producto", "productos", "clave", "existencia", "suspendido", "baja"],
    a: ["En el menú Más > Catálogo de artículos.", "Busca por nombre o clave (por ejemplo \"guante nitrilo M\").", "Solo los activos (y los que ya no se compran pero tienen existencia) se pueden elegir en ventas y prospección."],
    links: [{ label: "Abrir catálogo", href: "/articulos" }],
  },

  // ----- Vendedor: solicitudes
  {
    id: "nueva-solicitud", q: "¿Cómo hago una solicitud de cotización?", roles: V, paths: ["/vendedor"],
    keys: ["solicitud", "cotizacion", "cotizar", "nueva", "pedir", "precio", "compras"],
    a: ["Toca \"Nueva solicitud\".", "Elige el cliente con el buscador (o dalo de alta).", "Agrega cada producto con \"Agregar partida\": nombre, descripción, cantidad y unidad. Agrega una referencia (link o imagen) para que compras encuentre lo mismo.", "Puedes \"Guardar borrador\" y seguir después.", "Cuando esté completa, toca \"Enviar solicitud\". Compras tiene 48 horas hábiles para responder."],
    links: [{ label: "Nueva solicitud", href: "/vendedor/solicitudes/nueva" }],
  },
  {
    id: "no-envia", q: "No me deja enviar la solicitud", roles: V, paths: ["/vendedor/solicitudes"],
    keys: ["no", "deja", "enviar", "error", "falta", "rfc", "direccion", "datos", "incompleto"],
    a: ["Revisa el aviso en rojo: casi siempre faltan datos del cliente (RFC, dirección y teléfono o correo).", "Toca \"Completar datos\" junto al cliente, guarda y vuelve a enviar.", "Cada partida necesita nombre, descripción, cantidad, unidad y al menos una referencia."],
  },
  {
    id: "estados", q: "¿Qué significa cada estado de mi solicitud?", roles: V, paths: ["/vendedor"],
    keys: ["estado", "estatus", "significa", "compras", "por enviar", "con el cliente", "ganada", "etapa"],
    a: ["Con compras: compras está buscando precio.", "Lista para enviar: ya tiene precio; elige el precio y regístrala como enviada al cliente.", "Con el cliente: ya la enviaste; espera respuesta y márcala Ganada o Perdida.", "Responde aclaración: compras te hizo una pregunta en el chat de la partida."],
  },
  {
    id: "aclaracion", q: "Compras me pidió una aclaración", roles: V,
    keys: ["aclaracion", "pregunta", "chat", "duda", "compras", "responder", "mensaje"],
    a: ["Abre la solicitud y busca la partida marcada en morado.", "Responde en el chat de esa partida (puedes adjuntar imagen).", "Mientras no respondas, el reloj de 48 horas de compras se detiene."],
  },
  {
    id: "enviar-cliente", q: "¿Cómo registro que ya le mandé la cotización al cliente?", roles: V, paths: ["/vendedor/solicitudes"],
    keys: ["enviar", "cliente", "registrar envio", "mande", "numero", "pdf", "cotizacion", "mandar"],
    a: ["Abre la solicitud, elige el precio de cada partida y revisa el PDF.", "Toca \"Registrar envío\" y elige por qué medio (correo, WhatsApp, etc.).", "Se guarda un número de cotización y una copia fija del PDF; así queda rastro de qué le mandaste."],
  },
  {
    id: "recotizar", q: "El cliente pidió cambios: ¿cómo recotizo?", roles: V,
    keys: ["recotizar", "recotizacion", "cambio", "cambios", "nueva version", "otra cotizacion", "modificar"],
    a: ["En la solicitud toca \"Recotizar\" y explica qué cambió.", "La cotización nueva sale con otro número (-V2, -V3); la que ya enviaste no se sustituye.", "Si es por vigencia vencida usa \"Solicitar actualización\" para que compras confirme el costo."],
  },
  {
    id: "ganada", q: "¿Cómo marco una partida como ganada o perdida?", roles: V,
    keys: ["ganada", "perdida", "gano", "perdio", "resultado", "vendi", "compro", "rechazo"],
    a: ["En la solicitud, en cada partida enviada elige Ganada o Perdida (con el motivo).", "Al marcar Ganada, la venta se registra sola en Bitácora > Ventas diarias; solo complétala con factura, pago y entrega."],
  },
  {
    id: "pdf", q: "¿Cómo descargo o comparto el PDF?", roles: V,
    keys: ["pdf", "descargar", "compartir", "imprimir", "formato", "documento"],
    a: ["Dentro de la solicitud usa \"Descargar PDF\" o \"Compartir PDF\".", "Puedes ajustar cómo se muestra el envío (incluido, aparte, sin envío o mixto) antes de descargar."],
  },

  // ----- Vendedor: clientes
  {
    id: "alta-cliente", q: "¿Cómo doy de alta un cliente o prospecto?", roles: V, paths: ["/vendedor/clientes", "/vendedor/bitacora"],
    keys: ["alta", "cliente", "nuevo", "registrar", "prospecto", "empresa", "agregar"],
    a: ["Desde cualquier pantalla toca el botón \"+ Cliente\" de arriba (junto a la campanita).", "También al elegir cliente en una venta, guía o queja: si no aparece, toca \"Nuevo cliente\".", "Elige si ya es Cliente (ya nos compra) o Prospecto (aún no). Obligatorio: nombre, giro, estado, dirección y teléfono o correo. Para cotizarle también RFC."],
    links: [{ label: "Clientes", href: "/vendedor/clientes" }],
  },
  {
    id: "lista-clientes", q: "¿Por qué no veo la lista completa de clientes?", roles: V,
    keys: ["lista", "clientes", "todos", "ver", "privacidad", "buscar", "no aparece"],
    a: ["Por privacidad los vendedores no ven la lista completa; solo buscan (mínimo 2 letras).", "Tus clientes (los que diste de alta o con los que trabajas) siempre los ves."],
  },
  {
    id: "prospecto-cliente", q: "¿Cuál es la diferencia entre cliente y prospecto?", roles: V,
    keys: ["diferencia", "prospecto", "cliente", "convertir", "ya es cliente", "volvio", "compro"],
    a: ["Cliente: ya nos compra. Sus ventas van en Ventas diarias.", "Prospecto: aún no nos compra. Se le da seguimiento en Prospección.", "Cuando un prospecto compra, registra su primera venta: pasa a cliente solo y cuenta como prospecto convertido."],
  },

  {
    id: "sucursal", q: "¿Cómo agrego otra dirección o sucursal de un cliente?", roles: [...V, ...C, ...J], paths: ["/vendedor/clientes", "/comprador/clientes", "/ventas/clientes"],
    keys: ["sucursal", "sucursales", "direccion", "otra direccion", "planta", "domicilio", "ciudad"],
    a: ["Abre el cliente (Editar) y abajo toca \"Agregar sucursal\".", "Ponle título (por ejemplo \"Sucursal Delicias\"), su dirección y su contacto.", "La sucursal se maneja como cliente aparte en ventas, bitácora y encuesta; la razón social, RFC y giro son los de la matriz."],
  },

  // ----- Vendedor: bitacora
  {
    id: "venta-diaria", q: "¿Cómo registro una venta del día?", roles: V, paths: ["/vendedor/bitacora"],
    keys: ["venta", "ventas", "diaria", "diarias", "registrar", "vendi", "bitacora", "hoy", "factura"],
    a: ["Ve a Bitácora > Ventas diarias y toca \"Registrar venta\".", "Busca al cliente y pon solo el artículo principal (el de mayor costo) con su cantidad.", "Llena pedido u OC, factura, monto sin IVA y si es contado o crédito (días).", "Marca si ya se entregó y cuánto se ha cobrado. Guarda."],
    links: [{ label: "Registrar venta", href: "/vendedor/bitacora/venta/nueva" }],
  },
  {
    id: "visita", q: "Fui con un cliente y no compró: ¿cómo lo registro?", roles: V, paths: ["/vendedor/bitacora"],
    keys: ["visita", "visite", "no compro", "sin venta", "no se concreto", "motivo", "porque no", "fui con", "fui a ver"],
    a: ["En Bitácora > Ventas diarias toca \"Visita sin venta\".", "Elige al cliente y por qué no se concretó (precio, ya tiene proveedor, etc.) y agrega el detalle.", "Queda en tu bitácora de ventas, no cuenta como venta ni en los montos."],
    links: [{ label: "Visita sin venta", href: "/vendedor/bitacora/venta/nueva?tipo=visita" }],
  },
  {
    id: "entregada-cobrada", q: "¿Cómo marco una venta como entregada o cobrada?", roles: V, paths: ["/vendedor/bitacora"],
    keys: ["entregada", "entrega", "cobrada", "cobro", "cobrar", "pago", "pagado", "pago parcial"],
    a: ["En la lista de Ventas diarias usa los botones \"Marcar entregada\" o \"Cobrada\".", "Si el cliente pagó solo una parte, abre la venta y pon el porcentaje cobrado (por ejemplo 50%)."],
  },
  {
    id: "cartera", q: "¿Cómo se calcula la cartera vencida?", roles: [...V, ...J, "gerente"],
    keys: ["cartera", "vencida", "vencido", "dias", "credito", "adeudo", "debe", "saldo"],
    a: ["Sale sola: si la venta es a crédito, se suma la fecha de la venta más los días de crédito.", "Si ya pasó esa fecha y no está cobrada al 100%, aparece en rojo con los días vencidos y el saldo pendiente.", "Para que salga de cartera, marca la venta como cobrada."],
  },
  {
    id: "venta-portal", q: "Me apareció una venta \"Del portal: complétala\"", roles: V,
    keys: ["portal", "completala", "sola", "automatica", "aparecio", "ganada"],
    a: ["Se registró sola porque marcaste Ganada una partida de una solicitud.", "Ábrela y completa factura, pago, entrega y cobranza."],
  },
  {
    id: "prospeccion", q: "¿Cómo le doy seguimiento a un prospecto?", roles: V, paths: ["/vendedor/bitacora"],
    keys: ["prospeccion", "prospecto", "seguimiento", "etapas", "nuevo prospecto", "visita", "catalogo", "muestra"],
    a: ["Ve a Bitácora > Prospección y toca \"Nuevo prospecto\".", "Avanza las etapas con fecha (botón \"Hoy\"): catálogo, necesidad y artículos ofrecidos, muestra, solicitud a compras, cotización y primer pedido.", "Pon el próximo seguimiento y agrega un comentario cada vez que hables con él.", "Cuando compre, toca \"Registrar su primera venta\"."],
    links: [{ label: "Prospección", href: "/vendedor/bitacora?tab=prospeccion" }],
  },
  {
    id: "sitio-web", q: "Hay un prospecto del sitio web sin vendedor", roles: V,
    keys: ["sitio", "web", "pagina", "formulario", "sin vendedor", "tomar", "lead", "leads"],
    a: ["Llegó del formulario de la página. Ábrelo desde el aviso azul en Prospección y toca \"Tomar\".", "El primero que lo toma se lo queda."],
  },

  // ----- Guias
  {
    id: "pedir-guia", q: "¿Cómo pido una guía de paquetería?", roles: V, paths: ["/guias"],
    keys: ["guia", "guias", "paqueteria", "envio", "mandar", "paquete", "dhl", "estafeta", "paquete express", "tinypack", "porteo"],
    a: ["Ve a Guías > \"Pedir guía\".", "Pon la factura, la paquetería y los datos de quien recibe (puedes buscar al cliente para que se llenen solos).", "Agrega bultos, peso y medidas. Marca \"Es urgente\" si aplica.", "Marketplaces la genera y te llega aviso cuando esté lista para descargar."],
    links: [{ label: "Pedir guía", href: "/guias/nueva" }],
  },
  {
    id: "recordar-guia", q: "Mi guía no sale: ¿cómo le recuerdo a Marketplaces?", roles: V, paths: ["/guias"],
    keys: ["recordar", "recordatorio", "tarda", "no sale", "urgente", "pendiente", "24", "horas"],
    a: ["Después de 4 horas aparece el botón \"Recordar a Marketplaces\" dentro de la guía (uno por hora).", "También puedes escribirle en los mensajes de la guía.", "Si pasa de 24 horas la guía se marca en rojo para todos."],
  },
  {
    id: "faltan-datos", q: "Mi guía dice \"Faltan datos\"", roles: V,
    keys: ["faltan", "datos", "corregir", "falta", "requiere"],
    a: ["Marketplaces necesita algo más: abre la guía y lee su mensaje.", "Toca \"Corregir datos\", ajusta y guarda. Vuelve sola a la fila de Marketplaces."],
  },
  {
    id: "tarima", q: "¿Puedo pedir la guía para una tarima?", roles: [...V, ...MKT],
    keys: ["tarima", "tarimas", "bulto", "bultos", "pallet", "medidas", "peso", "dimensiones"],
    a: ["Sí. En el paquete elige \"Bultos\" o \"Tarima\".", "Pon cuántos, el peso total y las medidas (largo, ancho y alto en cm)."],
  },
  {
    id: "asegurar", q: "¿Qué es asegurar el envío?",
    keys: ["asegurar", "seguro", "valor", "declarado", "daño", "pierde"],
    a: ["Es el seguro de la paquetería: si el paquete se pierde o llega dañado, paga el valor declarado.", "Tiene costo extra, por eso solo márcalo cuando valga la pena."],
  },
  {
    id: "mkt-atender", q: "¿Cómo atiendo una guía?", roles: MKT, paths: ["/guias"],
    keys: ["atender", "tomar", "generar", "subir", "guia", "rastreo", "pdf", "archivo"],
    a: ["En Guías > Pendientes abre la guía (las urgentes y más viejas van primero).", "Toca \"Tomar y generar\" para que el vendedor sepa que ya la estás haciendo.", "Si falta algo, usa \"Faltan datos\" y escribe qué necesitas.", "Cuando la tengas, escribe el número de rastreo, elige el archivo (PDF o imagen) y toca \"Subir guía\"."],
  },

  // ----- Consumo interno
  {
    id: "consumo-pedir", q: "¿Cómo pido papelería, limpieza o un servicio?", roles: ["vendedor", "jefe_ventas", "gerente", "coordinador_iso", "marketplaces"], paths: ["/consumo"],
    keys: ["consumo", "papeleria", "limpieza", "servicio", "vehiculo", "carro", "hojas", "cafe", "pedir", "material", "interno"],
    a: ["Ve a Consumo interno > \"Nueva solicitud\".", "Elige producto o servicio, la categoría, qué es, cantidad y para qué se necesita.", "La jefa de ventas la aprueba y luego compras la pide o la agenda. Ves cada paso en la solicitud."],
    links: [{ label: "Nueva solicitud", href: "/consumo/nueva" }],
  },
  {
    id: "consumo-aprobar", q: "¿Cómo apruebo el consumo interno?", roles: J, paths: ["/consumo"],
    keys: ["aprobar", "rechazar", "consumo", "autorizar", "por aprobar"],
    a: ["En Consumo interno > Por aprobar abre la solicitud.", "Toca Aprobar o Rechazar (para rechazar escribe el motivo).", "Solo lo aprobado le llega al comprador."],
  },
  {
    id: "consumo-comprador", q: "¿Cómo atiendo el consumo interno aprobado?", roles: C, paths: ["/consumo"],
    keys: ["consumo", "aprobado", "pedido", "agendado", "recibido", "realizado", "atender"],
    a: ["En Consumo interno > Por atender abre la solicitud.", "Pon la fecha (llegada o cita) y una nota, y toca \"Marcar pedido\" o \"Marcar agendado\".", "Cuando llegue o se haga, toca \"Marcar recibido\" o \"Marcar realizado\". Quien la pidió ve cada paso."],
  },

  // ----- Calidad
  {
    id: "queja", q: "¿Cómo registro una queja de cliente?", roles: [...V, ...ISO], paths: ["/calidad"],
    keys: ["queja", "quejas", "reclamo", "problema", "cliente molesto", "devolucion", "inconformidad"],
    a: ["Ve a Quejas > \"Nueva queja\".", "Pon fecha y vía de recepción, busca al cliente, el pedido o factura y describe el problema.", "Puedes subir evidencias (fotos, PDF). El coordinador ISO recibe el aviso y le da seguimiento."],
    links: [{ label: "Nueva queja", href: "/calidad/quejas/nueva" }],
  },
  {
    id: "queja-estatus", q: "¿Cómo cambio el estatus de una queja?", roles: ISO, paths: ["/calidad"],
    keys: ["estatus", "cerrar", "analisis", "solucion", "queja", "cambiar"],
    a: ["Abre la queja y en el recuadro de Coordinador ISO elige el estatus.", "Para cerrarla escribe la solución o respuesta al cliente.", "Al vendedor le llega aviso de cada cambio."],
  },
  {
    id: "sac", q: "¿Cómo lleno una acción correctiva?", roles: ISO, paths: ["/calidad"],
    keys: ["sac", "accion", "correctiva", "6m", "causa", "raiz", "plan", "verificacion", "ishikawa"],
    a: ["Desde la queja toca \"Crear acción correctiva\" (o en Calidad > Acción correctiva).", "Llena por secciones: datos generales, reacción, 6M y causa raíz, plan de acción, verificación y cierre.", "Puedes guardar y seguir después. Sube evidencias abajo. El vendedor de la queja la ve en solo lectura."],
  },
  {
    id: "sac-vendedor", q: "¿Dónde veo la acción correctiva de mi queja?", roles: V,
    keys: ["accion", "correctiva", "sac", "seguimiento", "mi queja"],
    a: ["Abre tu queja: abajo aparece la acción correctiva ligada. También en Quejas > pestaña Acciones correctivas.", "La llena el coordinador ISO; tú la ves para dar seguimiento con el cliente."],
  },

  // ----- Jefa / gerente
  {
    id: "resumen", q: "¿Qué muestra el resumen de ventas?", roles: [...J, "gerente", ...ISO, ...C], paths: ["/ventas"],
    keys: ["resumen", "vendedores", "reporte", "desempeño", "ventas", "periodo", "mes"],
    a: ["Por vendedor: solicitudes, cotizaciones enviadas, ventas y monto, por cobrar, cartera vencida, prospectos, convertidos y movimientos.", "Cambia el periodo arriba (7 días, mes, mes anterior, año).", "Toca a un vendedor para ver sus ventas diarias, prospección y cotizaciones."],
    links: [{ label: "Resumen", href: "/ventas" }],
  },

  // ----- Comprador
  {
    id: "cotizar", q: "¿Cómo cotizo una partida?", roles: C, paths: ["/comprador"],
    keys: ["cotizar", "costo", "precio", "partida", "proveedor", "tabulador", "pendientes"],
    a: ["En Pendientes abre la solicitud (las más urgentes arriba).", "En cada partida captura costo, envío si aplica, proveedor, tiempo de entrega y compra mínima; el sistema calcula los 5 precios con el tabulador.", "Toca \"Guardar cotización\". Si no existe usa \"No encontrada\" con una nota, o \"Pedir aclaración al vendedor\"."],
  },
  {
    id: "usuarios", q: "¿Cómo creo usuarios?", roles: C, paths: ["/comprador/usuarios"],
    keys: ["usuario", "usuarios", "crear", "alta", "vendedor", "jefa", "gerente", "marketplaces", "iso", "rol", "puesto"],
    a: ["Ve a Más > Usuarios.", "Escribe nombre y correo, elige el puesto y genera una contraseña temporal.", "Pásale la contraseña a la persona; al entrar la cambia."],
    links: [{ label: "Usuarios", href: "/comprador/usuarios" }],
  },
  {
    id: "demo", q: "¿Cómo activo la demostración?", roles: C,
    keys: ["demo", "demostracion", "ejemplo", "ejemplos", "presentar", "mostrar", "prueba", "quitar", "desactivar", "borrar"],
    a: ["Ve a Más > Configuración > Demostración.", "Activa por sección o \"Activar todo\". Cada usuario debe haber entrado al menos una vez.", "Para quitarla toca \"Quitar demostración\": borra solo los clientes (Demo) y todo lo ligado a ellos."],
    links: [{ label: "Configuración", href: "/comprador/configuracion" }],
  },
  {
    id: "por-comprar", q: "¿Qué es Por comprar?", roles: C, paths: ["/comprador/por-comprar"],
    keys: ["por comprar", "comprar", "ganadas", "orden", "proveedor", "comprada"],
    a: ["Son las partidas que el vendedor marcó Ganadas: lo que hay que comprarle al proveedor.", "Cuando hagas la compra márcala como Comprada; queda la fecha y quién la hizo."],
  },

  // ----- Evaluaciones e indicadores
  {
    id: "eval-clientes", q: "¿Cómo mando la evaluación a mis clientes?", roles: V, paths: ["/evaluaciones/clientes", "/vendedor/clientes"],
    keys: ["evaluacion", "encuesta", "satisfaccion", "link", "calificar", "evaluar cliente", "clientes"],
    a: ["Ve a Más > Evaluación de clientes. Está abierta hasta la fecha que aparece arriba.", "En cada cliente toca \"Copiar link\" (o WhatsApp o Correo). Cada cliente tiene su propio link con sus datos ya llenos.", "Al copiarlo queda como Enviada; cuando el cliente contesta cambia a Recibida. Son 10 preguntas, el cliente solo escribe su nombre y puesto."],
    links: [{ label: "Evaluación de clientes", href: "/evaluaciones/clientes" }],
  },
  {
    id: "eval-proveedores", q: "¿Cómo evalúo a un proveedor?", roles: ["comprador", "almacen", "supervisor_almacen"], paths: ["/evaluaciones/proveedores"],
    keys: ["evaluacion", "evaluar", "proveedor", "proveedores", "calificar", "almacen", "recibido", "golpeado", "incompleto"],
    a: ["Ve a Evaluación de proveedores (solo aparece para calificar cuando está activa).", "En \"Me faltan\" abre el proveedor y califica cada punto del 1 (malo) al 5 (excelente).", "El comprador califica comunicación, entrega, precio, documentos y atención; Almacén califica estado, cantidades, empaque, especificación y documentos de entrega."],
    links: [{ label: "Evaluación de proveedores", href: "/evaluaciones/proveedores" }],
  },
  {
    id: "eval-activar", q: "¿Cómo se activan las evaluaciones?", roles: ["comprador", "jefe_ventas"],
    keys: ["activar", "evaluacion", "semestre", "seis meses", "6 meses", "periodo", "automatica"],
    a: ["La primera la activas cuando quieras con \"Activar evaluación\" (proveedores: comprador; clientes: comprador o jefa de ventas).", "Al activarla se programa sola la siguiente a 6 meses y ese día se activa en automático con aviso en la campanita.", "Si necesitas, puedes adelantarla o cerrar el periodo."],
  },
  {
    id: "proveedor-alta", q: "¿Cómo doy de alta un proveedor?", roles: C, paths: ["/comprador/proveedores"],
    keys: ["proveedor", "alta", "nuevo proveedor", "datos", "contacto"],
    a: ["Ve a Más > Proveedores > \"Nuevo proveedor\".", "Llena nombre, razón social, RFC, qué surte, contacto, teléfono y correo.", "Deja marcado \"Incluir en la evaluación\" si se debe evaluar."],
    links: [{ label: "Proveedores", href: "/comprador/proveedores" }],
  },
  {
    id: "minuta-crear", q: "¿Cómo hago una minuta de reunión?", roles: ["jefe_ventas", "gerente", "comprador", "supervisor_almacen", "supervisor_finanzas"], paths: ["/minutas"],
    keys: ["minuta", "minutas", "reunion", "junta", "acuerdos", "compromisos", "acta"],
    a: ["Ve a Minutas > \"Nueva minuta\". Se llena por pasos.", "1) Datos de la reunión. 2) Puntos: tema, explicación, lo que hay que hacer, a quién le aplica y para cuándo. 3) Quién firma (y asistentes que no usan el portal). 4) Revisar.", "Al \"Enviar a firmas\" a cada persona le llega un aviso. Con \"Imprimir\" sale el formato para firmar en papel."],
    links: [{ label: "Nueva minuta", href: "/minutas/nueva" }],
  },
  {
    id: "minuta-firmar", q: "¿Cómo firmo una minuta?", paths: ["/minutas"],
    keys: ["firmar", "firma", "minuta", "enterado", "reunion"],
    a: ["Cuando te toca firmar te llega un aviso en la campanita.", "Abre la minuta, revísala y toca \"Firmar de enterado\". Queda con fecha y hora."],
    links: [{ label: "Minutas", href: "/minutas" }],
  },
  {
    id: "documentos-subir", q: "¿Cómo subo un documento (política, valores, procedimiento)?", roles: ISO, paths: ["/documentos"],
    keys: ["documento", "documentos", "subir", "politica", "valores", "manual", "procedimiento", "pdf", "version"],
    a: ["Ve a Documentos > \"Subir documento\".", "Pon el código, título, categoría, versión y fecha, y elige el PDF.", "Para actualizarlo usa \"Nueva versión\": la anterior queda en el historial. Todos los usuarios lo pueden consultar."],
    links: [{ label: "Documentos", href: "/documentos" }],
  },
  {
    id: "documentos-ver", q: "¿Dónde veo la política de calidad y los documentos?",
    keys: ["documento", "documentos", "politica", "calidad", "valores", "manual", "procedimiento", "formato"],
    a: ["En el menú Más > Documentos.", "Busca por título o código y toca \"Ver PDF\" o \"Descargar\"."],
    links: [{ label: "Documentos", href: "/documentos" }],
  },
  {
    id: "control-cambios", q: "¿Qué es el control de cambios?", roles: [...ISO, "gerente", ...C], paths: ["/calidad/cambios"],
    keys: ["control", "cambios", "cambio", "modificacion", "version", "documento"],
    a: ["Es el registro de cada cambio a un documento o proceso: qué cambió, por qué, versión anterior y nueva, y quién lo aprobó.", "Solo lo llena el Coordinador ISO; la gerente y el comprador lo consultan y reciben aviso de cada cambio."],
    links: [{ label: "Control de cambios", href: "/calidad/cambios" }],
  },
  {
    id: "pagos-comprador", q: "¿Cómo registro una OC y sus facturas para pago?", roles: C, paths: ["/pagos"],
    keys: ["pago", "pagos", "oc", "orden de compra", "factura", "facturas", "anticipo", "extranjero", "liberar", "liberada", "urgente", "ceo", "comprobante"],
    a: ["En Pagos, primero agrega el proveedor con \"Agregar o quitar\" (sale de tu lista de Proveedores).", "Toca \"Nueva OC\": proveedor, número, moneda y, si ya las tienes, facturas o anticipos. Lo que falte (número de factura o monto) lo completas después.", "Al CEO le llega aviso de cada factura con monto. En cada factura marca si la carga ya se liberó, toca \"Marcar urgente\" si urge (por ejemplo, fechas vencidas) y deja un comentario para el CEO como \"Pendiente de pago para liberación\".", "Cuando el CEO pague, descarga el comprobante y mándalo al proveedor: al descargarlo pasa al historial."],
    links: [{ label: "Pagos", href: "/pagos" }],
  },
  {
    id: "pagos-ceo", q: "¿Cómo marco un pago como hecho?", roles: ["ceo"], paths: ["/pagos"],
    keys: ["pago", "pagos", "pagar", "pagado", "comprobante", "transferencia", "swift", "pendiente", "urgente"],
    a: ["En Pagos > Por pagar están todas las facturas pendientes, por proveedor. Primero salen las URGENTES, las vencidas y las que tienen la carga sin liberar (el proveedor puede no soltarla hasta que se pague). Lee el comentario de compras.", "Abre la OC y toca \"Marcar como pagado\": fecha, monto, referencia y sube el comprobante (PDF o imagen).", "A compras le llega aviso para descargarlo y mandarlo al proveedor. Si te equivocaste, \"Deshacer pago\" mientras compras no lo descargue."],
    links: [{ label: "Pagos", href: "/pagos" }],
  },
  {
    id: "proveedores-importar", q: "¿Puedo subir mis proveedores desde Excel?", roles: C, paths: ["/comprador/proveedores"],
    keys: ["importar", "excel", "csv", "subir", "proveedores", "lista", "archivo", "masivo"],
    a: ["Sí. En Proveedores toca \"Importar Excel o CSV\" y elige el archivo (la primera fila con encabezados).", "Revisa qué columna es cada dato (nombre, contacto, teléfono, correo, país...) y toca \"Dar de alta\".", "Los que ya existen con el mismo nombre se omiten. Después completas cada proveedor con \"Completar\"."],
    links: [{ label: "Proveedores", href: "/comprador/proveedores" }],
  },
  {
    id: "recepcion", q: "¿Cómo registro una recepción e imprimo etiquetas?", roles: ["almacen", "supervisor_almacen"], paths: ["/almacen/recepciones"],
    keys: ["recepcion", "recibir", "llego", "material", "etiqueta", "etiquetas", "imprimir", "qr", "inventario"],
    a: ["Entra a Recepciones > Nueva recepción, busca cada producto y pon cuántas piezas (cajas) llegaron.", "Al guardar se crea una etiqueta por pieza: 30 etiquetas = 30 en inventario.", "Toca Imprimir etiquetas: en hoja carta salen 3 columnas que puedes recortar; en etiquetadora usa 50x25 o 100x50 mm.", "Para lo que ya tienes en el almacén usa el tipo Inventario inicial."],
    links: [{ label: "Recepciones", href: "/almacen/recepciones" }],
  },
  {
    id: "cargar", q: "¿Cómo cargo una factura al camión?", roles: ["almacen", "supervisor_almacen"], paths: ["/entregas"],
    keys: ["cargar", "carga", "camion", "escanear", "escaner", "factura", "entrega", "salida", "camara"],
    a: ["Abre Entregas, toca la factura y presiona Usar cámara (o usa el escáner de pistola).", "Escanea cada etiqueta al subir la caja: el contador baja y suena un bip. Si la caja no es de esa factura sale en rojo y no se cuenta.", "Si te equivocas, toca Quitar en la última. Al terminar presiona Terminar carga; si faltó algo te pide una nota."],
    links: [{ label: "Entregas", href: "/entregas" }],
  },
  {
    id: "subir-factura", q: "¿Cómo subo una factura para que almacén la cargue?", roles: ["vendedor", "jefe_ventas", "marketplaces", "almacen", "supervisor_almacen"], paths: ["/entregas"],
    keys: ["factura", "subir", "pdf", "xml", "entrega", "almacen", "cargar", "surtir"],
    a: ["En Entregas > Subir factura elige el PDF (y el XML si lo tienes, es más exacto).", "El sistema lee el folio y los artículos ESC- con su cantidad. Revisa que estén bien antes de enviar.", "Almacén recibe aviso y tú ves el avance; te avisa si salió incompleta."],
    links: [{ label: "Entregas", href: "/entregas" }],
  },
  {
    id: "indicadores", q: "¿Qué son los indicadores?",
    keys: ["indicadores", "kpi", "metas", "desempeño", "medicion", "resultados"],
    a: ["En Más > Indicadores ves los números de tu puesto que salen solos del portal (ventas, tiempos, satisfacción, evaluaciones).", "Verde va bien, ámbar a vigilar y rojo hay que atender. Cuando se definan las metas oficiales se ajustan."],
    links: [{ label: "Indicadores", href: "/indicadores" }],
  },
];

/** Minusculas y sin acentos. */
export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]/g, " ");

const STOP = new Set("como que cual cuales donde para por una uno unos unas los las del con sin mas pero porque quiero puedo hago hacer esta este esto mis tus sus hay ser tengo".split(" "));

export function visibleFaq(rol: Rol): Faq[] {
  return FAQ.filter((f) => !f.roles || f.roles.includes(rol));
}

/** Busca la mejor respuesta: palabras clave (y frases), titulo y pagina actual. */
export function searchFaq(text: string, rol: Rol, path = ""): { best: Faq | null; others: Faq[] } {
  const t = ` ${norm(text)} `;
  const words = t.split(/\s+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return { best: null, others: [] };
  const scored = visibleFaq(rol)
    .map((f) => {
      let s = 0;
      for (const k of f.keys) {
        const nk = norm(k).trim();
        if (nk.includes(" ")) {
          if (t.includes(` ${nk} `) || t.includes(nk)) s += 3;
        } else if (words.some((w) => w === nk || (w.length >= 5 && nk.length >= 5 && (w.startsWith(nk.slice(0, 5)) || nk.startsWith(w.slice(0, 5)))))) {
          s += 2;
        }
      }
      const title = norm(f.q).split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w));
      s += words.filter((w) => title.includes(w)).length;
      if (path && f.paths?.some((p) => path.startsWith(p))) s += 0.5;
      return { f, s };
    })
    .filter((x) => x.s >= 2)
    .sort((a, b) => b.s - a.s);
  return { best: scored[0]?.f ?? null, others: scored.slice(1, 4).map((x) => x.f) };
}

/** Sugerencias para la pagina actual (o generales). */
export function suggestions(rol: Rol, path: string, n = 4): Faq[] {
  // Primero lo de la pagina mas especifica (ej. /vendedor/bitacora antes que /vendedor).
  const len = (f: Faq) => Math.max(0, ...(f.paths ?? []).filter((p) => path === p || path.startsWith(p === "/" ? p : `${p}`)).map((p) => p.length));
  return [...visibleFaq(rol)].sort((a, b) => len(b) - len(a)).slice(0, n);
}
