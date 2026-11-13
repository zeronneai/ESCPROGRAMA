import Link from "next/link";
import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={cx("animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Button({
  variant = "primary",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost"; loading?: boolean }) {
  const styles = {
    primary: "bg-gradient-to-b from-brand-500 to-brand-700 text-white shadow-sm shadow-brand-900/20 hover:from-brand-600 hover:to-brand-800",
    secondary: "border border-slate-300 bg-white text-slate-800 shadow-sm hover:border-brand-300 hover:bg-brand-50/60",
    danger: "bg-gradient-to-b from-red-500 to-red-700 text-white shadow-sm hover:from-red-600 hover:to-red-800",
    ghost: "text-slate-700 hover:bg-slate-900/5",
  }[variant];
  return (
    <button
      {...props}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50",
        styles,
        className,
      )}
    >
      {loading && <Spinner />}
      {loading && <span className="sr-only">Cargando...</span>}
      {children}
    </button>
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cx(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 read-only:bg-slate-50",
        className,
      )}
    />
  );
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cx("w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm", className)}
    />
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {error && <span className="block text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cx("rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm", className)} />;
}

export function Alert({ tone = "info", children }: { tone?: "info" | "error" | "success"; children: ReactNode }) {
  const t = {
    info: "border-brand-200 bg-brand-50 text-brand-900",
    error: "border-red-300 bg-red-50 text-red-800",
    success: "border-green-300 bg-green-50 text-green-800",
  }[tone];
  const icono = { info: "i", error: "!", success: "✓" }[tone];
  const bola = { info: "bg-brand-600", error: "bg-red-600", success: "bg-green-600" }[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      data-alerta={tone}
      className={cx("flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm shadow-sm", t)}
    >
      <span className={cx("mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white", bola)} aria-hidden>{icono}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/** Encabezado de pagina: titulo, subtitulo opcional y acciones (se apilan en movil). */
export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 border-l-4 border-brand-500 pl-3">
        <h1 className="text-2xl font-bold tracking-tight text-brand-950">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Indicador numerico compacto. */
export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "brand" | "amber" | "green" | "purple" | "red";
}) {
  const t = {
    default: "border-slate-200 bg-white",
    brand: "border-brand-100 bg-brand-50",
    amber: "border-amber-300 bg-amber-50",
    green: "border-green-200 bg-green-50",
    purple: "border-purple-300 bg-purple-50",
    red: "border-red-200 bg-red-50",
  }[tone];
  return (
    <div className={cx("rounded-lg border p-3 shadow-sm sm:p-4", t)}>
      <p className="text-xs font-medium leading-tight text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Estado vacio con mensaje y accion opcional. */
export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 7h16M4 12h16M4 17h10" strokeLinecap="round" />
        </svg>
      </div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {children && <p className="max-w-sm text-sm text-slate-500">{children}</p>}
      {action}
    </div>
  );
}

/** Bloque gris animado para estados de carga. */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-lg bg-gradient-to-r from-slate-200/80 via-slate-100 to-slate-200/80", className)} aria-hidden />;
}

/** Pagina de carga generica: encabezado, indicadores y lista. */
export function PageSkeleton({ stats = 4, rows = 6 }: { stats?: number; rows?: number }) {
  return (
    <div className="space-y-5" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium text-brand-700">
        <Spinner className="h-5 w-5" /> Cargando...
      </div>
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {stats > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: stats }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      )}
      <div className="space-y-2 rounded-xl border border-slate-200/80 bg-white p-3 shadow-sm">
        {Array.from({ length: rows }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    </div>
  );
}

/** Pastilla de filtro (enlace) con estado activo. */
export function FilterChip({ href, active, children }: { href: string; active?: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-medium transition",
        active ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-slate-300 bg-white text-slate-700 hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700",
      )}
    >
      {children}
    </Link>
  );
}

/** Paginacion simple por enlaces. */
export function Pagination({ page, pages, hrefFor }: { page: number; pages: number; hrefFor: (p: number) => string }) {
  if (pages <= 1) return null;
  const btn = "rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-100";
  return (
    <nav className="flex items-center justify-between gap-2 text-sm" aria-label="Paginacion">
      {page > 1 ? <Link className={btn} href={hrefFor(page - 1)}>Anterior</Link> : <span />}
      <span className="text-slate-500">
        Pagina {page} de {pages}
      </span>
      {page < pages ? <Link className={btn} href={hrefFor(page + 1)}>Siguiente</Link> : <span />}
    </nav>
  );
}
