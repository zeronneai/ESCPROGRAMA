import { Fragment, type ReactNode } from "react";

/** Markdown sencillo para las respuestas del asistente: titulos, listas, tablas, negritas y codigo. */
function enLinea(t: string): ReactNode[] {
  const partes = t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return partes.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <b key={i}>{p.slice(2, -2)}</b> : p.startsWith("`") && p.endsWith("`") && p.length > 2 ? <code key={i} className="rounded bg-slate-100 px-1 text-[0.9em]">{p.slice(1, -1)}</code> : <Fragment key={i}>{p}</Fragment>,
  );
}

const celdas = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function Markdown({ texto }: { texto: string }) {
  const lineas = texto.replace(/\r/g, "").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  while (i < lineas.length) {
    const l = lineas[i];
    if (!l.trim()) { i++; continue; }
    if (/^\s*\|/.test(l) && i + 1 < lineas.length && /^\s*\|?\s*:?-{2,}/.test(lineas[i + 1])) {
      const cab = celdas(l);
      const filas: string[][] = [];
      i += 2;
      while (i < lineas.length && /^\s*\|/.test(lineas[i])) filas.push(celdas(lineas[i++]));
      out.push(
        <div key={out.length} className="my-2 overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm tabular-nums">
            <thead className="bg-slate-50 text-xs text-slate-600"><tr>{cab.map((c, k) => <th key={k} className="px-2 py-1.5 text-left font-semibold">{enLinea(c)}</th>)}</tr></thead>
            <tbody>{filas.map((f, k) => <tr key={k} className="border-t border-slate-100">{f.map((c, j) => <td key={j} className="px-2 py-1">{enLinea(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = l.match(/^(#{1,4})\s+(.*)/);
    if (h) { out.push(<p key={out.length} className="mt-3 font-semibold">{enLinea(h[2])}</p>); i++; continue; }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
      const num = /^\s*\d/.test(l);
      const items: string[] = [];
      while (i < lineas.length && /^\s*([-*•]|\d+[.)])\s+/.test(lineas[i])) items.push(lineas[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
      const Tag = num ? "ol" : "ul";
      out.push(<Tag key={out.length} className={`my-1 space-y-0.5 pl-5 ${num ? "list-decimal" : "list-disc"}`}>{items.map((t, k) => <li key={k}>{enLinea(t)}</li>)}</Tag>);
      continue;
    }
    const par: string[] = [];
    while (i < lineas.length && lineas[i].trim() && !/^\s*(\||#|[-*•]\s|\d+[.)]\s)/.test(lineas[i])) par.push(lineas[i++]);
    if (!par.length) par.push(lineas[i++]);
    out.push(<p key={out.length} className="my-1">{enLinea(par.join(" "))}</p>);
  }
  return <div className="text-sm leading-relaxed text-slate-800">{out}</div>;
}
