type PageShellProps = {
  title: string
  description?: string
}

export function PageShell({ title, description }: PageShellProps) {
  return (
    <main className="flex min-h-svh flex-1 flex-col bg-transparent p-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-normal">{title}</h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
    </main>
  )
}
