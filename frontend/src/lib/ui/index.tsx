import type {
    ButtonHTMLAttributes,
    InputHTMLAttributes,
    ReactElement,
    ReactNode,
    SelectHTMLAttributes,
    TextareaHTMLAttributes,
} from 'react'

function classes(...values: Array<string | false | undefined>): string {
    return values.filter(Boolean).join(' ')
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'secondary' | 'danger' | 'quiet'
}

export function Button({ className, variant = 'secondary', type = 'button', ...props }: ButtonProps): ReactElement {
    return (
        <button
            className={classes(
                'inline-flex items-center justify-center rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
                variant === 'primary' && 'bg-fuchsia-700 text-white hover:bg-fuchsia-800',
                variant === 'secondary' && 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50',
                variant === 'danger' && 'border border-red-300 bg-white text-red-700 hover:bg-red-50',
                variant === 'quiet' && 'text-slate-600 hover:bg-slate-100',
                className
            )}
            type={type}
            {...props}
        />
    )
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>): ReactElement {
    return (
        <input
            className={classes(
                'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-fuchsia-600 focus:ring-2 focus:ring-fuchsia-100',
                className
            )}
            {...props}
        />
    )
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>): ReactElement {
    return (
        <textarea
            className={classes(
                'w-full rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 outline-none focus:border-fuchsia-600 focus:ring-2 focus:ring-fuchsia-100',
                className
            )}
            {...props}
        />
    )
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>): ReactElement {
    return (
        <select
            className={classes(
                'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-fuchsia-600 focus:ring-2 focus:ring-fuchsia-100',
                className
            )}
            {...props}
        />
    )
}

type FieldProps = {
    label: string
    hint?: string
    error?: string
    children: ReactNode
}

export function Field({ label, hint, error, children }: FieldProps): ReactElement {
    return (
        <label className="block space-y-1">
            <span className="block text-sm font-medium text-slate-800">{label}</span>
            {children}
            {error !== undefined ? (
                <span className="block text-sm text-red-700">{error}</span>
            ) : hint !== undefined ? (
                <span className="block text-xs text-slate-500">{hint}</span>
            ) : null}
        </label>
    )
}

type CardProps = {
    title?: string
    actions?: ReactNode
    children: ReactNode
    className?: string
}

export function Card({ title, actions, children, className }: CardProps): ReactElement {
    return (
        <section className={classes('rounded-xl border border-slate-200 bg-white p-5 shadow-sm', className)}>
            {title !== undefined || actions !== undefined ? (
                <div className="mb-4 flex items-center justify-between gap-3">
                    {title !== undefined ? (
                        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
                    ) : (
                        <span />
                    )}
                    {actions}
                </div>
            ) : null}
            {children}
        </section>
    )
}

export function Tag({ children }: { children: ReactNode }): ReactElement {
    return (
        <span className="inline-flex rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">
            {children}
        </span>
    )
}

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
    label: string
}

export function Switch({ label, checked, ...props }: SwitchProps): ReactElement {
    return (
        <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-800">
            <input className="size-4 accent-fuchsia-700" type="checkbox" checked={checked} {...props} />
            {label}
        </label>
    )
}

export function ErrorBanner({ children }: { children: ReactNode }): ReactElement {
    return <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{children}</div>
}
