// Project persistence for the BIO PTO app.
//
// STORAGE BACKEND = B (shared ArcGIS hosted table). Projects live in one hosted
// table in ArcGIS Online, shared with the organization, so every signed-in team
// member reads/writes the SAME list (survives devices and cache clears). One row
// per project; the `snapshot` field holds the full serialized project state.
//
// Reads/writes go through the signed-in user's ArcGIS token, so all calls here
// require an authenticated session (the app gates on sign-in before using these).
//
// The table URL comes from VITE_PROJECTS_TABLE_URL. If it is unset the functions
// no-op gracefully (empty list), so the app still runs.

import { getArcGISToken } from './arcgisAuth'
import type { ProjectSketchSummary } from './ArcGISMap'

const TABLE_URL = import.meta.env.VITE_PROJECTS_TABLE_URL || ''

export type StoredPtoCriteria = {
  bufferDistance: number
  highDistance: number
  moderateDistance: number
  lowDistance: number
  currentWindowYears: number
}

export type StoredReviewEdit = {
  rating?: string
  habitatSummary?: string
  status?: string
}

// The serializable workspace state that defines a saved project.
export type ProjectSnapshot = {
  client: string
  projectName: string
  projectLayerUrl: string
  loadedProjectLayerUrl: string
  statsTableUrl: string
  cnddbLayerUrl: string
  bufferLayerUrl: string
  existingSummaryTableUrl: string
  existingCnddbLayerUrl: string
  ptoCriteria: StoredPtoCriteria
  projectSketch: ProjectSketchSummary
  reviewEdits: Record<number, StoredReviewEdit>
}

export type ProjectSummary = {
  hasResults: boolean
  reviewedCount: number
}

export type ProjectMeta = {
  id: string
  name: string
  client: string
  createdAt: string
  modifiedAt: string
  summary: ProjectSummary
}

export type StoredProject = ProjectMeta & {
  snapshot: ProjectSnapshot
}

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // fall through
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}

/** POST a feature-service operation with the signed-in user's token. */
async function postOp(op: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  if (!TABLE_URL) throw new Error('Project store is not configured (VITE_PROJECTS_TABLE_URL).')
  const token = await getArcGISToken()
  const body = new URLSearchParams({ ...params, f: 'json', token })
  const res = await fetch(`${TABLE_URL}/${op}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`ArcGIS ${op} request failed: ${res.status}`)
  const data = await res.json() as Record<string, unknown>
  const error = data.error as { message?: string } | undefined
  if (error) throw new Error(error.message ?? `ArcGIS ${op} returned an error.`)
  return data
}

type Row = { attributes: Record<string, unknown> }

function rowToMeta(attrs: Record<string, unknown>): ProjectMeta {
  return {
    id: String(attrs.project_id ?? ''),
    name: String(attrs.name ?? ''),
    client: String(attrs.client ?? ''),
    createdAt: String(attrs.created_at ?? ''),
    modifiedAt: String(attrs.modified_at ?? ''),
    summary: {
      hasResults: Number(attrs.has_results) === 1,
      reviewedCount: Number(attrs.reviewed_count ?? 0),
    },
  }
}

/** Lightweight list for the home screen (no snapshots), newest first. */
export async function listProjects(): Promise<ProjectMeta[]> {
  if (!TABLE_URL) return []
  const data = await postOp('query', {
    where: '1=1',
    outFields: 'project_id,client,name,created_at,modified_at,has_results,reviewed_count',
    returnGeometry: 'false',
    orderByFields: 'modified_at DESC',
  })
  const features = (data.features as Row[] | undefined) ?? []
  return features.map((feature) => rowToMeta(feature.attributes))
}

/** Full project (with snapshot) for opening into the workspace. */
export async function getProject(id: string): Promise<StoredProject | null> {
  if (!TABLE_URL) return null
  const data = await postOp('query', {
    where: `project_id='${escapeSql(id)}'`,
    outFields: '*',
    returnGeometry: 'false',
  })
  const feature = ((data.features as Row[] | undefined) ?? [])[0]
  if (!feature) return null
  const attrs = feature.attributes
  let snapshot: ProjectSnapshot
  try {
    snapshot = JSON.parse(String(attrs.snapshot ?? '{}')) as ProjectSnapshot
  } catch {
    return null
  }
  return { ...rowToMeta(attrs), snapshot }
}

/** Create a brand-new project row and return its metadata + snapshot. */
export async function createProject(name: string, client: string, snapshot: ProjectSnapshot): Promise<StoredProject> {
  const id = newId()
  const now = new Date().toISOString()
  const summary = summarize(snapshot)
  const safeName = name.trim() || 'Untitled project'
  const attributes = {
    project_id: id,
    name: safeName,
    client: client.trim(),
    created_at: now,
    modified_at: now,
    has_results: summary.hasResults ? 1 : 0,
    reviewed_count: summary.reviewedCount,
    snapshot: JSON.stringify(snapshot),
  }
  await postOp('addFeatures', { features: JSON.stringify([{ attributes }]) })
  return { id, name: safeName, client: client.trim(), createdAt: now, modifiedAt: now, summary, snapshot }
}

async function findObjectId(id: string): Promise<number | null> {
  const data = await postOp('query', {
    where: `project_id='${escapeSql(id)}'`,
    outFields: 'OBJECTID',
    returnGeometry: 'false',
  })
  const feature = ((data.features as Row[] | undefined) ?? [])[0]
  const objectId = feature ? Number(feature.attributes.OBJECTID) : NaN
  return Number.isFinite(objectId) ? objectId : null
}

/** Persist the current snapshot for an existing project (updates modifiedAt). */
export async function saveSnapshot(id: string, snapshot: ProjectSnapshot): Promise<void> {
  if (!TABLE_URL) return
  const objectId = await findObjectId(id)
  if (objectId == null) return
  const summary = summarize(snapshot)
  const attributes: Record<string, unknown> = {
    OBJECTID: objectId,
    modified_at: new Date().toISOString(),
    has_results: summary.hasResults ? 1 : 0,
    reviewed_count: summary.reviewedCount,
    snapshot: JSON.stringify(snapshot),
  }
  const name = (snapshot.projectName ?? '').trim()
  if (name) attributes.name = name
  const client = (snapshot.client ?? '').trim()
  if (client) attributes.client = client
  await postOp('updateFeatures', { features: JSON.stringify([{ attributes }]) })
}

export async function renameProject(id: string, name: string): Promise<void> {
  if (!TABLE_URL) return
  const objectId = await findObjectId(id)
  if (objectId == null) return
  const trimmed = name.trim()
  if (!trimmed) return
  await postOp('updateFeatures', {
    features: JSON.stringify([{ attributes: { OBJECTID: objectId, name: trimmed, modified_at: new Date().toISOString() } }]),
  })
}

export async function deleteProject(id: string): Promise<void> {
  if (!TABLE_URL) return
  await postOp('deleteFeatures', { where: `project_id='${escapeSql(id)}'` })
}

function summarize(snapshot: ProjectSnapshot): ProjectSummary {
  const edits = snapshot.reviewEdits ?? {}
  const reviewedCount = Object.values(edits).filter(
    (edit) => edit && (edit.status === 'Reviewed' || edit.status === 'Needs Senior Review'),
  ).length
  return {
    hasResults: Boolean(snapshot.statsTableUrl?.trim()),
    reviewedCount,
  }
}
