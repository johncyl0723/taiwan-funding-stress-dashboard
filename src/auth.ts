import { acceptInvite, getUser, handleAuthCallback, login, logout, onAuthChange, type User } from '@netlify/identity'

export async function initialiseIdentity(
  onUser: (user: User | null) => void,
  onInvite: (token: string) => void,
) {
  try {
    const callback = await handleAuthCallback()
    if (callback?.type === 'invite' && callback.token) onInvite(callback.token)
    onUser(await getUser())
    return onAuthChange((_event, user) => onUser(user))
  } catch {
    onUser(null)
    return () => undefined
  }
}

export { acceptInvite, login, logout }
