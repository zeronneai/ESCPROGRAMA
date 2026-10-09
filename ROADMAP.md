# Roadmap

Mejoras futuras, sin orden definido:

- **PDF de cotizacion para el cliente.** Requiere datos completos del cliente (`customers` ya tiene columnas nulas preparadas) y el formato oficial de ESC. El formato de la tabla de precios vive en `src/lib/format/price-table.ts`.
- **WhatsApp** como canal de notificaciones (la capa de notificaciones esta desacoplada).
- **Correo automatico** (se descarto por ahora; las notificaciones son solo dentro del portal).
- Historial de costos por proveedor.
- Catalogo interno de productos.
- Conexion con el ERP.
- Calculo de `due_at` tambien en SQL, con prueba de paridad, para no depender del servidor al enviar.
- Cerrar sesiones activas al restablecer contraseña o desactivar un usuario.
- Interfaz en ingles (estructura de mensajes lista en `src/messages`).
