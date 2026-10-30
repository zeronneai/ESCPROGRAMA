export const SEND_MEDIA = ["correo", "whatsapp", "en_persona", "telefono", "otro"] as const;
export type SendMedium = (typeof SEND_MEDIA)[number];
