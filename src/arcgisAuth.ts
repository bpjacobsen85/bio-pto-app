import IdentityManager from '@arcgis/core/identity/IdentityManager'
import OAuthInfo from '@arcgis/core/identity/OAuthInfo'
import Portal from '@arcgis/core/portal/Portal'

const portalUrl = import.meta.env.VITE_ARCGIS_PORTAL_URL || 'https://www.arcgis.com'
const appId = import.meta.env.VITE_ARCGIS_CLIENT_ID || ''

let configured = false

export type ArcgisUser = {
  username: string
  fullName?: string
  thumbnailUrl?: string
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

async function getPortalUser(): Promise<ArcgisUser> {
  const portal = new Portal({ url: portalUrl })
  await portal.load()
  const user = portal.user

  if (!user?.username) {
    throw new Error('ArcGIS sign-in completed, but no user profile was returned.')
  }

  return {
    username: user.username,
    fullName: user.fullName || undefined,
    thumbnailUrl: user.thumbnailUrl || undefined,
  }
}

export async function signInToArcGIS(): Promise<ArcgisUser> {
  if (!appId) {
    throw new Error('Missing VITE_ARCGIS_CLIENT_ID in .env.local')
  }

  configureOAuth()
  await IdentityManager.getCredential(`${portalUrl}/sharing`)
  return getPortalUser()
}

export async function restoreArcGISSession(): Promise<ArcgisUser | null> {
  if (!appId) return null

  configureOAuth()

  try {
    const credential = await IdentityManager.checkSignInStatus(`${portalUrl}/sharing`)
    if (!credential) return null
    return getPortalUser()
  } catch {
    return null
  }
}

export function signOutOfArcGIS() {
  IdentityManager.destroyCredentials()
}




