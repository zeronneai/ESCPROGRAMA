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
  tipo: "cliente" | "prospecto";
}

export interface EditorInitial {
  request_id: string;
  customer_id: string;
  notas: string;
  items: ItemDraft[];
  /** refId -> URL firmada, para mostrar miniaturas de imagenes ya subidas. */
  previews: Record<string, string>;
  saved: boolean;
}

interface FormValues {
  request_id: string;
  customer_id: string;
  notas: string;
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
  const [newCustomer, setNewCustomer] = useState<{ nombre: string; tipo: "cliente" | "prospecto" } | null>(null);

  const form = useForm<FormValues>({
    defaultValues: {
      request_id: initial.request_id,
      customer_id: initial.customer_id,
      notas: initial.notas,
      items: initial.items.length ? initial.items : [newItem()],
    },
  });
  const { register, control, watch, getValues, setValue } = form;
  const { fields, append, remove } = useFieldArray({ control, name: "items" });
  const values = watch();
  const problems = submitProblems(values);

  async function save(): Promise<boolean> {
    const v = getValues();
    if (!v.customer_id) {
      setNotice({ tone: "error", text: "Elige el cliente antes de guardar." });
      return false;
    }
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
      const r = await submitRequestAction(getValues());
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

  function createCustomer() {
    if (!newCustomer) return;
    start(async () => {
      const r = await createCustomerAction(newCustomer);
      if (!r.ok) {
        setNotice({ tone: "error", text: r.error });
        return;
      }
      setCustomers((c) => [...c, { id: r.id, nombre: r.nombre, tipo: r.tipo }].sort((a, b) => a.nombre.localeCompare(b.nombre)));
      setValue("customer_id", r.id);
      setNewCustomer(null);
    });
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
        <Field label="Cliente">
          <div className="flex flex-wrap gap-2">
            <Select {...register("customer_id")} className="max-w-md">
              <option value="">Elige un cliente...</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} ({c.tipo})
                </option>
              ))}
            </Select>
            <Button type="button" variant="secondary" onClick={() => setNewCustomer({ nombre: "", tipo: "prospecto" })}>
              Nuevo cliente
            </Button>
          </div>
        </Field>
        {newCustomer && (
          <div className="flex flex-wrap items-end gap-2 rounded-md bg-slate-50 p-3">
            <Field label="Nombre del cliente">
              <Input value={newCustomer.nombre} onChange={(e) => setNewCustomer({ ...newCustomer, nombre: e.target.value })} />
            </Field>
            <Field label="Tipo">
              <Select value={newCustomer.tipo} onChange={(e) => setNewCustomer({ ...newCustomer, tipo: e.target.value as "cliente" | "prospecto" })}>
                <option value="prospecto">Prospecto</option>
                <option value="cliente">Cliente actual</option>
              </Select>
            </Field>
            <Button type="button" onClick={createCustomer} disabled={pending}>
              Crear cliente
            </Button>
            <Button type="button" variant="ghost" onClick={() => setNewCustomer(null)}>
              Cancelar
            </Button>
          </div>
        )}
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
          <Field label={`Descripcion breve y/o uso * (${props.descLength}/10 minimo)`}>
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
