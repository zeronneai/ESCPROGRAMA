/**
 * Copia contenido en dos formatos a la vez (text/html y text/plain) para que al
 * pegar en Outlook o Word salga como tabla y en WhatsApp como texto ordenado.
 * Si el navegador no soporta ClipboardItem, copia solo texto plano.
 */
export async function copyRich(content: { html: string; text: string }): Promise<"rich" | "text"> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([content.html], { type: "text/html" }),
          "text/plain": new Blob([content.text], { type: "text/plain" }),
        }),
      ]);
      return "rich";
    }
  } catch {
    // cae a texto plano
  }
  try {
    await navigator.clipboard.writeText(content.text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = content.text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (!ok) throw new Error("No se pudo copiar");
  }
  return "text";
}
