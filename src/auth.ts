import { getUser, handleAuthCallback, login, logout, onAuthChange, type User } from '@netlify/identity'

export async function initialiseIdentity(onUser: (user: User | null) => void) {
  try {
    await handleAuthCallback()
    onUser(await getUser())
    return onAuthChange((_event, user) => onUser(user))
  } catch {
    onUser(null)
    return () => undefined
  }
}

export { login, logout }
