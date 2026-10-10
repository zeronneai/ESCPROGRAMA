"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import {
  createCustomerAction,
  discardDraftAction,
  saveDraftAction,
  submitRequestAction,
  uploadReferenceAction,
} from "@/actions/requests";
import { Alert, Button, Card, Field, Input, Select } from "@/components/ui";
import {
  IMAGE_TYPES,
  isHttpUrl,
  MAX_IMAGE_BYTES,
  submitProblems,
  UNIDADES,
  type ItemDraft,
} from "@/lib/validation/request";

export interface CustomerOption {
  id: string;
  nombre: string;
}

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

export function RequestEditor({ initial, customers: initialCustomers }: { initial: EditorInitial; customers: CustomerOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [customers, setCustomers] = useState(initialCustomers);
  const [previews, setPreviews] = useState(initial.previews);
  const [savedOnce, setSavedOnce] = useState(initial.saved);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string; list?: string[] } | null>(null);
  const [customerName, setCustomerName] = useState(initialCustomers.find((c) => c.id === initial.customer_id)?.nombre ?? "");

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
  // El cliente es solo el nombre de la empresa: si el nombre escrito ya existe se reutiliza; si no, se crea al guardar.
  const matched = customers.find((c) => c.nombre.trim().toLowerCase() === customerName.trim().toLowerCase());
  const problems = submitProblems({ ...values, customer_id: matched?.id ?? (customerName.trim().length >= 2 ? "nuevo" : "") });

  /** Devuelve el id del cliente (creandolo si hace falta) o null si no se pudo. */
  async function resolveCustomer(): Promise<string | null> {
    if (matched) {
      setValue("customer_id", matched.id);
      return matched.id;
    }
    if (customerName.trim().length < 2) {
      setNotice({ tone: "error", text: "Escribe el nombre de la empresa (cliente)." });
      return null;
    }
    const r = await createCustomerAction({ nombre: customerName });
    if (!r.ok) {
      setNotice({ tone: "error", text: r.error });
      return null;
    }
    setCustomers((c) => (c.some((x) => x.id === r.id) ? c : [...c, { id: r.id, nombre: r.nombre }].sort((a, b) => a.nombre.localeCompare(b.nombre))));
    setCustomerName(r.nombre);
    setValue("customer_id", r.id);
    return r.id;
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

  async function addImage(index: number, file: File) {
    setNotice(null);
    if (!IMAGE_TYPES.includes(file.type)) {
      setNotice({ tone: "error", text: "Solo se aceptan imagenes PNG, JPG, WEBP o GIF" });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setNotice({ tone: "error", text: "La imagen pesa mas de 5 MB" });
      return;
    }
    // El archivo necesita que el borrador exista (politicas de Storage).
    if (!(await save())) return;
    const fd = new FormData();
    fd.set("requestId", getValues().request_id);
    fd.set("itemId", getValues().items[index].id);
    fd.set("file", file);
    const r = await uploadReferenceAction(fd);
    if (!r.ok) {
      setNotice({ tone: "error", text: r.error });
      return;
    }
    const refs = getValues().items[index].refs;
    setValue(`items.${index}.refs`, [...refs, { id: r.id, tipo: "imagen", url: r.path }], { shouldDirty: true });
    if (r.signedUrl) setPreviews((p) => ({ ...p, [r.id]: r.signedUrl! }));
    await save();
  }

  function addLink(index: number, url: string): boolean {
    if (!isHttpUrl(url)) {
      setNotice({ tone: "error", text: "El link no es valido: debe iniciar con http:// o https://" });
      return false;
    }
    const refs = getValues().items[index].refs;
    setValue(`items.${index}.refs`, [...refs, { id: crypto.randomUUID(), tipo: "link", url: url.trim() }], { shouldDirty: true });
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

      <Card className="space-y-3">
        <Field label="Cliente (nombre de la empresa)">
          <Input list="clientes-previos" value={customerName} onChange={(e) => setCustomerName(e.target.value)} autoComplete="off" placeholder="Escribe o elige una empresa" />
          <datalist id="clientes-previos">
            {customers.map((c) => (
              <option key={c.id} value={c.nombre} />
            ))}
          </datalist>
        </Field>
        {customerName.trim().length >= 2 && !matched && (
          <p className="text-xs text-slate-500">Es una empresa nueva: se agregará al catálogo al guardar.</p>
        )}
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

      <div className="sticky bottom-0 -mx-4 space-y-2 border-t border-slate-200 bg-slate-50/95 px-4 py-3 backdrop-blur">
        {problems.length > 0 && (
          <p className="text-xs text-amber-800">
            Para enviar falta: {problems.map((p) => p.message).join(" · ")}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onSave} disabled={pending}>
            Guardar borrador
          </Button>
          <Button type="button" onClick={onSubmit} disabled={pending || problems.length > 0}>
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
  onAddImage: (file: File) => Promise<void>;
  onAddLink: (url: string) => boolean;
  onRemoveRef: (id: string) => void;
  descLength: number;
}) {
  const { index: i, register } = props;
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleFiles(files: FileList | File[] | null) {
    if (!files) return;
    setBusy(true);
    for (const f of Array.from(files)) await props.onAddImage(f);
    setBusy(false);
  }

  return (
    <Card
      className="space-y-3"
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
        <h2 className="font-medium">Partida {i + 1}</h2>
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
        <p className="text-sm font-medium text-slate-700">Referencias * (al menos una imagen o link)</p>
        <ul className="flex flex-wrap gap-2">
          {props.refs.map((r) => (
            <li key={r.id} className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50 p-1 text-xs">
              {r.tipo === "imagen" ? (
                props.previews[r.id] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={props.previews[r.id]} alt="Referencia" className="h-16 w-16 rounded object-cover" />
                ) : (
                  <span>Imagen</span>
                )
              ) : (
                <span className="max-w-[16rem] truncate">{r.url}</span>
              )}
              <button type="button" className="px-1 text-red-600" onClick={() => props.onRemoveRef(r.id)} aria-label="Quitar referencia">
                x
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-2">
          <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-100">
            {busy ? "Subiendo..." : "Subir imagen"}
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

      {props.problems.length > 0 && <p className="text-xs text-amber-800">Falta: {props.problems.join("; ")}</p>}
    </Card>
  );
}
