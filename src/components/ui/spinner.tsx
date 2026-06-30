import { cn } from "@/lib/utils"
import { SpinnerOne } from "@mynaui/icons-react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  return (
    <SpinnerOne data-slot="spinner" role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
