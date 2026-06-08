import IdentityManager from '@arcgis/core/identity/IdentityManager'
import OAuthInfo from '@arcgis/core/identity/OAuthInfo'

const portalUrl = import.meta.env.VITE_ARCGIS_PORTAL_URL || 'https://www.arcgis.com'
const appId = import.meta.env.VITE_ARCGIS_CLIENT_ID || ''
const credentialReadyEventName = 'bio-pto-arcgis-credential-ready'

let configured = false

export type ArcgisUser = {
  username: string
  fullName?: string
  thumbnailUrl?: string
  orgId?: string
}

function configureOAuth() {
  if (configured || !appId) return

  IdentityManager.registerOAuthInfos([
    new OAuthInfo({
      appId,
      portalUrl,
      popup: true,
      popupCallbackUrl: `${window.location.origin}/oauth-callback.html`,
    }),
  ])

  configured = true
}

function notifyCredentialReady() {
  window.dispatchEvent(new Event(credentialReadyEventName))
}

async function getPortalUser(token: string): Promise<ArcgisUser> {
  const profileUrl = new URL(`${portalUrl}/sharing/rest/community/self`)
  profileUrl.searchParams.set('f', 'json')
  profileUrl.searchParams.set('token', token)

  const response = await fetch(profileUrl.toString())
  if (!response.ok) {
    throw new Error(`ArcGIS user profile request failed (${response.status}).`)
  }

  const user = await response.json() as {
    error?: { message?: string }
    username?: string
    fullName?: string
    thumbnail?: string
    thumbnailUrl?: string
    orgId?: string
  }

  if (user.error) {
    throw new Error(user.error.message ?? 'ArcGIS user profile returned an error.')
  }

  if (!user?.username) {
    throw new Error('ArcGIS sign-in completed, but no user profile was returned.')
  }

  return {
    username: user.username,
    fullName: user.fullName || undefined,
    thumbnailUrl: user.thumbnailUrl || user.thumbnail || undefined,
    orgId: user.orgId || undefined,
  }
}

export async function signInToArcGIS(): Promise<ArcgisUser> {
  if (!appId) {
    throw new Error('Missing VITE_ARCGIS_CLIENT_ID in .env.local')
  }

  configureOAuth()
  const credential = await IdentityManager.getCredential(`${portalUrl}/sharing`)
  if (!credential?.token) {
    throw new Error('ArcGIS sign-in did not return a usable token.')
  }
  notifyCredentialReady()
  return getPortalUser(credential.token)
}

export async function restoreArcGISSession(): Promise<ArcgisUser | null> {
  if (!appId) return null

  configureOAuth()

  try {
    const credential = await IdentityManager.checkSignInStatus(`${portalUrl}/sharing`)
    if (!credential?.token) return null
    return getPortalUser(credential.token)
  } catch {
    return null
  }
}

export async function getArcGISToken(): Promise<string> {
  configureOAuth()
  const credential = await IdentityManager.getCredential(`${portalUrl}/sharing`)
  if (!credential?.token) {
    throw new Error('ArcGIS sign-in did not return a usable token.')
  }
  notifyCredentialReady()
  return credential.token
}

export function signOutOfArcGIS() {
  IdentityManager.destroyCredentials()
}

export { credentialReadyEventName }




