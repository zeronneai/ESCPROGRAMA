"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import {
  discardDraftAction,
  saveDraftAction,
  submitRequestAction,
  uploadReferenceAction,
} from "@/actions/requests";
import { CustomerPicker } from "@/components/customers";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import { irACampo, toast } from "@/components/feedback-global";
import { customerMissing, type CustomerRecord } from "@/lib/validation/customer";
import {
  IMAGE_TYPES,
  isHttpUrl,
  MAX_IMAGE_BYTES,
  submitProblems,
  UNIDADES,
  type ItemDraft,
} from "@/lib/validation/request";

export type CustomerOption = CustomerRecord;

export interface EditorInitial {
  request_id: string;
  customer_id: string;
  notas: string;
  atencion: string;
  destino_entrega: string;
  items: ItemDraft[];
  /** refId -> URL firmada, para mostrar miniaturas de imagenes ya subidas. */
  previews: Record<string, string>;
  saved: boolean;
}

interface FormValues {
  request_id: string;
  customer_id: string;
  notas: string;
  atencion: string;
  destino_entrega: string;
  items: ItemDraft[];
}

const newItem = (): ItemDraft => ({
  id: crypto.randomUUID(),
  producto: "",
  descripcion: "",
  cantidad: "",
  unidad: "pieza",
  talla: "",
  notas: "",
  refs: [],
});

export function RequestEditor({ initial, customer: initialCustomer }: { initial: EditorInitial; customer: CustomerOption | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customer, setCustomer] = useState<CustomerRecord | null>(initialCustomer);
  const [previews, setPreviews] = useState(initial.previews);
  const [savedOnce, setSavedOnce] = useState(initial.saved);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string; list?: string[] } | null>(null);

  const form = useForm<FormValues>({
    defaultValues: {
      request_id: initial.request_id,
      customer_id: initial.customer_id,
      notas: initial.notas,
      atencion: initial.atencion,
      destino_entrega: initial.destino_entrega,
      items: initial.items.length ? initial.items : [newItem()],
    },
  });
  const { register, control, watch, getValues, setValue } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const values = watch();
  const missing = customer ? customerMissing(customer) : [];
  const problems = [
    ...submitProblems({ ...values, customer_id: customer?.id ?? "" }),
    ...(customer && missing.length ? [{ item: null, field: "customer" as const, message: `Completa los datos del cliente (${missing.join(", ")})` }] : []),
  ];

  /** Id del cliente elegido, o null (con aviso) si aun no se elige. */
  async function resolveCustomer(): Promise<string | null> {
    if (customer) {
      setValue("customer_id", customer.id);
      return customer.id;
    }
    setNotice({ tone: "error", text: "Elige o da de alta el cliente." });
    return null;
  }

  async function save(): Promise<boolean> {
    const customerId = await resolveCustomer();
    if (!customerId) return false;
    const v = { ...getValues(), customer_id: customerId };
    const r = await saveDraftAction(v);
    if (!r.ok) {
      setNotice({ tone: "error", text: r.error, list: r.problems });
      return false;
    }
    setSavedOnce(true);
    return true;
  }

  function onSave() {
    setNotice(null);
    start(async () => {
      if (await save()) setNotice({ tone: "success", text: "Borrador guardado" });
    });
  }

  function onSubmit() {
    setNotice(null);
    start(async () => {
      const customerId = await resolveCustomer();
      if (!customerId) return;
      const r = await submitRequestAction({ ...getValues(), customer_id: customerId });
      if (!r.ok) {
        setNotice({ tone: "error", text: r.error, list: r.problems });
        return;
      }
      router.push(`/vendedor/solicitudes/${r.id}`);
    });
  }

  function onDiscard() {
    if (!confirm("Descartar este borrador?")) return;
    start(async () => {
      const r = await discardDraftAction(getValues().request_id);
      if (r.ok) router.push("/vendedor");
      else setNotice({ tone: "error", text: r.error });
    });
  }

  /** Sube la imagen a la partida; regresa el id de la referencia o null si no se pudo. */
  async function addImage(index: number, file: File): Promise<string | null> {
    setNotice(null);
    if (!IMAGE_TYPES.includes(file.type)) {
      toast(`"${file.name}" no es imagen: solo PNG, JPG, WEBP o GIF.`, "error");
      return null;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast(`"${file.name}" pesa más de 5 MB.`, "error");
      return null;
    }
    // El archivo necesita que el borrador exista (politicas de Storage).
    if (!(await save())) return null;
    const fd = new FormData();
    fd.set("requestId", getValues().request_id);
    fd.set("itemId", getValues().items[index].id);
    fd.set("file", file);
    const r = await uploadReferenceAction(fd);
    if (!r.ok) {
      toast(`No se subió la imagen: ${r.error}`, "error");
      return null;
    }
    const refs = getValues().items[index].refs;
    setValue(`items.${index}.refs`, [...refs, { id: r.id, tipo: "imagen", url: r.path }], { shouldDirty: true });
    if (r.signedUrl) setPreviews((p) => ({ ...p, [r.id]: r.signedUrl! }));
    await save();
    toast(`Imagen subida a la partida ${index + 1}`, "success");
    return r.id;
  }

  function addLink(index: number, url: string): boolean {
    if (!isHttpUrl(url)) {
      toast("El link no es válido: debe iniciar con http:// o https://", "error");
      return false;
    }
    const refs = getValues().items[index].refs;
    setValue(`items.${index}.refs`, [...refs, { id: crypto.randomUUID(), tipo: "link", url: url.trim() }], { shouldDirty: true });
    toast(`Link agregado a la partida ${index + 1}`, "success");
    return true;
  }

  function removeRef(index: number, refId: string) {
    const refs = getValues().items[index].refs;
    setValue(`items.${index}.refs`, refs.filter((r) => r.id !== refId), { shouldDirty: true });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{savedOnce ? "Editar borrador" : "Nueva solicitud"}</h1>
        {savedOnce && (
          <Button variant="ghost" onClick={onDiscard} disabled={pending}>
            Descartar borrador
          </Button>
        )}
      </div>

      {notice && (
        <Alert tone={notice.tone}>
          {notice.text}
          {notice.list && (
            <ul className="mt-1 list-disc pl-5">
              {notice.list.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}

      <Card className={`space-y-3 border-l-4 ${customer ? (missing.length ? "border-l-amber-400" : "border-l-green-500") : "border-l-slate-300"}`} data-campo="cliente">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold text-slate-800">Cliente *</p>
            <Estado ok={!!customer && !missing.length} texto={!customer ? "Falta elegir cliente" : missing.length ? "Faltan datos del cliente" : "Cliente listo"} />
          </div>
          <CustomerPicker
            value={customer}
            onChange={(c) => {
              setCustomer(c);
              setValue("customer_id", c?.id ?? "");
              if (c && !getValues().atencion && c.contacto_nombre) setValue("atencion", c.contacto_nombre);
            }}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Atención (persona de contacto, opcional)">
            <Input {...register("atencion")} />
          </Field>
          <Field label="Destino de entrega (opcional)">
            <Input {...register("destino_entrega")} placeholder="Ej. Cd. Juárez, planta Pegatron" />
          </Field>
        </div>
        <Field label="Notas generales (opcional)">
          <textarea {...register("notas")} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </Field>
      </Card>

      {fields.map((f, i) => {
        const itemProblems = problems.filter((p) => p.item === i);
        const refs = values.items?.[i]?.refs ?? [];
        return (
          <ItemCard
            key={f.id}
            index={i}
            total={fields.length}
            problems={itemProblems.map((p) => p.message.replace(/^Partida \d+: /, ""))}
            refs={refs}
            previews={previews}
            register={register}
            onRemove={() => remove(i)}
            onAddImage={(file) => addImage(i, file)}
            onAddLink={(url) => addLink(i, url)}
            onRemoveRef={(id) => removeRef(i, id)}
            descLength={(values.items?.[i]?.descripcion ?? "").trim().length}
          />
        );
      })}

      <Button type="button" variant="secondary" onClick={() => append(newItem())}>
        Agregar partida
      </Button>

      <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 -mx-4 space-y-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur md:bottom-0">
        {problems.length > 0 ? (
          <p className="text-xs font-medium text-amber-800">
            <span className="mr-1 rounded-full bg-amber-200 px-2 py-0.5 font-bold">Faltan {problems.length}</span>
            {problems.map((p) => p.message).join(" · ")}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm font-semibold text-green-800">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-xs text-white" aria-hidden>✓</span>
            Todo listo: ya puedes enviar la solicitud
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onSave} loading={pending}>
            Guardar borrador
          </Button>
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              const p = problems[0];
              if (!p) return void onSubmit();
              const destino = p.item != null
                ? document.querySelector<HTMLElement>(`[name="items.${p.item}.${p.field === "cantidad" && !values.items?.[p.item]?.cantidad ? "cantidad" : p.field}"]`) ?? document.querySelector<HTMLElement>(`[data-partida="${p.item}"]`)
                : document.querySelector<HTMLElement>('[data-campo="cliente"]');
              irACampo(destino, p.message);
            }}
            className={problems.length ? "opacity-80" : undefined}
          >
            Enviar solicitud
          </Button>
        </div>
      </div>
    </div>
  );
}

function ItemCard(props: {
  index: number;
  total: number;
  problems: string[];
  refs: ItemDraft["refs"];
  previews: Record<string, string>;
  register: ReturnType<typeof useForm<FormValues>>["register"];
  onRemove: () => void;
  onAddImage: (file: File) => Promise<string | null>;
  onAddLink: (url: string) => boolean;
  onRemoveRef: (id: string) => void;
  descLength: number;
}) {
  const { index: i, register } = props;
  const [link, setLink] = useState("");
  const [subiendo, setSubiendo] = useState(0);
  const [nuevas, setNuevas] = useState<string[]>([]);
  const busy = subiendo > 0;

  async function handleFiles(files: FileList | File[] | null) {
    if (!files) return;
    const lista = Array.from(files);
    setSubiendo(lista.length);
    for (const f of lista) {
      const id = await props.onAddImage(f);
      setSubiendo((n) => Math.max(0, n - 1));
      if (id) {
        setNuevas((x) => [...x, id]);
        setTimeout(() => setNuevas((x) => x.filter((y) => y !== id)), 4000);
      }
    }
  }
  const nImg = props.refs.filter((r) => r.tipo === "imagen").length;
  const nLink = props.refs.length - nImg;

  return (
    <Card
      data-partida={i}
      className={`space-y-3 border-l-4 ${props.problems.length ? "border-l-amber-400" : "border-l-green-500"}`}
      // Pegar imagenes desde el portapapeles dentro de la partida.
      onPaste={(e: React.ClipboardEvent) => {
        const files = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
        if (files.length) {
          e.preventDefault();
          void handleFiles(files);
        }
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">Partida {i + 1}</h2>
          <Estado ok={!props.problems.length} texto={props.problems.length ? (props.problems.length === 1 ? "Falta 1 dato" : `Faltan ${props.problems.length} datos`) : "Completa"} />
        </div>
        {props.total > 1 && (
          <Button type="button" variant="ghost" onClick={props.onRemove}>
            Quitar
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Nombre del producto *">
          <Input {...register(`items.${i}.producto`)} />
        </Field>
        <Field label="Talla (si aplica)">
          <Input {...register(`items.${i}.talla`)} placeholder="M, L, 9, 42..." />
        </Field>
        <div className="sm:col-span-2">
          <Field label={`Para qué se usa / descripción (interno) * (${props.descLength}/10 mínimo)`}>
            <textarea {...register(`items.${i}.descripcion`)} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </Field>
        </div>
        <Field label="Cantidad (con cantidad o talla basta)">
          <Input {...register(`items.${i}.cantidad`)} inputMode="decimal" />
        </Field>
        <Field label="Unidad">
          <Select {...register(`items.${i}.unidad`)}>
            {UNIDADES.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notas para el comprador (opcional)">
            <textarea {...register(`items.${i}.notas`)} rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
          </Field>
        </div>
      </div>

      <div className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
          Referencias (opcional: imagen o link)
          {props.refs.length > 0 && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">
              ✓ {[nImg ? `${nImg} imagen${nImg > 1 ? "es" : ""}` : "", nLink ? `${nLink} link${nLink > 1 ? "s" : ""}` : ""].filter(Boolean).join(" y ")} {props.refs.length > 1 ? "agregados" : nImg ? "subida" : "agregado"}
            </span>
          )}
        </p>
        <ul className="flex flex-wrap gap-2">
          {props.refs.map((r) => {
            const nueva = nuevas.includes(r.id);
            return (
              <li key={r.id} className={`relative flex items-center gap-1 rounded-lg border p-1 text-xs transition ${nueva ? "toast-in border-green-500 bg-green-50 ring-4 ring-green-200" : "border-slate-200 bg-slate-50"}`}>
                {r.tipo === "imagen" ? (
                  props.previews[r.id] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={props.previews[r.id]} alt="Referencia" className="h-16 w-16 rounded object-cover" />
                  ) : (
                    <span className="px-2 py-5">Imagen</span>
                  )
                ) : (
                  <span className="max-w-[16rem] truncate">{r.url}</span>
                )}
                {r.tipo === "imagen" && (
                  <span className="absolute -left-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-green-600 text-[11px] font-bold text-white shadow" title="Imagen subida">✓</span>
                )}
                <button type="button" className="px-1 text-red-600" onClick={() => props.onRemoveRef(r.id)} aria-label="Quitar referencia">
                  x
                </button>
              </li>
            );
          })}
          {Array.from({ length: subiendo }).map((_, k) => (
            <li key={`sub-${k}`} className="flex h-[4.6rem] w-[4.6rem] flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-brand-300 bg-brand-50 text-[11px] font-medium text-brand-700">
              <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden><circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" /><path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>
              Subiendo
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`rounded-md border px-3 py-2 text-sm font-medium ${busy ? "cursor-wait border-slate-300 bg-slate-200 text-slate-500" : "cursor-pointer border-brand-300 bg-white text-brand-700 hover:bg-brand-50"}`}>
            {busy ? `Subiendo ${subiendo} imagen${subiendo > 1 ? "es" : ""}...` : "Subir imagen"}
            <input type="file" accept={IMAGE_TYPES.join(",")} multiple className="hidden" disabled={busy} onChange={(e) => { void handleFiles(e.target.files); e.target.value = ""; }} />
          </label>
          <span className="text-xs text-slate-500">o pega una imagen (Ctrl+V) en esta partida</span>
        </div>
        <div className="flex gap-2">
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://..." />
          <Button type="button" variant="secondary" className="shrink-0" onClick={() => props.onAddLink(link) && setLink("")}>
            Agregar link
          </Button>
        </div>
      </div>

      {props.problems.length > 0 && <p className="rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">Falta: {props.problems.join("; ")}</p>}
    </Card>
  );
}

/** Pastilla de estado: verde con palomita cuando ya esta, ambar cuando falta algo. */
function Estado({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${ok ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>
      <span aria-hidden>{ok ? "✓" : "!"}</span>
      {texto}
    </span>
  );
}
