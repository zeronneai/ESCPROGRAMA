# Roadmap

Mejoras futuras, sin orden definido:

- **WhatsApp** como canal de notificaciones (la capa de notificaciones esta desacoplada).
- Aviso de "por vencer" con mayor precision: en el plan Hobby el cron es diario; con plan Pro puede correr cada 15 minutos (basta cambiar `vercel.json`).
- **Correo automatico** (se descarto por ahora; las notificaciones son solo dentro del portal).
- Historial de costos por proveedor.
- Catalogo interno de productos.
- Conexion con el ERP.
- Calculo de `due_at` tambien en SQL, con prueba de paridad, para no depender del servidor al enviar.
- Cerrar sesiones activas al restablecer contraseña o desactivar un usuario.
- Interfaz en ingles (estructura de mensajes lista en `src/messages`).
- PDF: elegir entre varias plantillas o agregar firma y sello (la plantilla esta aislada en `src/lib/pdf/quote-template.tsx`).
- Datos completos del cliente (RFC, direccion, contactos) cuando ESC los comparta; `customers` ya tiene columnas preparadas.
- Importacion de clientes desde Excel (se dejo fuera a proposito).
- Vigencia distinta por cliente o por tipo de producto.
- Avisos de vigencia por vencer al vendedor (hoy solo se muestra la etiqueta al consultar).
