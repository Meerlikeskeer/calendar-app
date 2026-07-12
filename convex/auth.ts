import { convexAuth } from "@convex-dev/auth/server"
import { Password } from "@convex-dev/auth/providers/Password"

function normalizeUsername(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Username is required")
  }

  const username = value.trim().toLowerCase()

  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(username)) {
    throw new Error("Username must be 3-32 letters, numbers, underscores, or hyphens")
  }

  return username
}

function allowedUsernames() {
  return new Set(
    (process.env.HOUSEHOLD_ALLOWED_USERNAMES ?? "")
      .split(",")
      .map((username) => username.trim().toLowerCase())
      .filter(Boolean),
  )
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const username = normalizeUsername(params.username)
        const allowed = allowedUsernames()

        if (allowed.size === 0 || !allowed.has(username)) {
          throw new Error("This username is not approved for household access")
        }

        if (params.flow === "signUp") {
          const setupCode = process.env.HOUSEHOLD_SETUP_CODE

          if (
            !setupCode ||
            typeof params.setupCode !== "string" ||
            params.setupCode !== setupCode
          ) {
            throw new Error("A valid household setup code is required")
          }
        }

        return {
          // Convex Password requires an email identifier. Keep it internal while
          // presenting a username-only household sign-in experience.
          email: `${username}@household.local`,
          name: username,
        }
      },
    }),
  ],
})
