import { ConvexAuthProvider } from "@convex-dev/auth/react"
import { ConvexReactClient } from "convex/react"
import { ThemeProvider } from "next-themes"
import type { PropsWithChildren } from "react"

import { TooltipProvider } from "@/components/ui/tooltip"

const convexUrl = import.meta.env.VITE_CONVEX_URL as string
const convex = convexUrl ? new ConvexReactClient(convexUrl) : undefined

export function AppProviders({ children }: PropsWithChildren) {
  const app = (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <TooltipProvider>{children}</TooltipProvider>
    </ThemeProvider>
  )

  if (!convex) {
    return app
  }

  return <ConvexAuthProvider client={convex}>{app}</ConvexAuthProvider>
}
