// Project persistence for the BIO PTO app.
//
// STORAGE BACKEND = A (browser localStorage). Projects live only in this
// browser, on this machine. This is the deliberate first-pass backend.
//
// To upgrade to B (shared ArcGIS Online storage so other staff can open a
// project), reimplement ONLY the functions in this file to read/write a JSON
// item in the signed-in user's ArcGIS content. The HomeView UI and App wiring
// call these functions and do not care where the bytes live — keep these
// signatures and the HomeView/App code is untouched.

import type { ProjectSketchSummary } from './ArcGISMap'

const STORE_KEY = 'bioPto:projects:v1'

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

// Small, cheap-to-render summary shown on the home-page cards.
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

function readAll(): StoredProject[] {
  try {
    const raw = window.localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is StoredProject =>
      Boolean(item) && typeof item === 'object' && typeof (item as StoredProject).id === 'string')
  } catch {
    return []
  }
}

function writeAll(projects: StoredProject[]): void {
  try {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(projects))
  } catch {
    // Storage can be unavailable (private mode / blocked / quota). Saving is a
    // best-effort convenience here; the running session still works in memory.
  }
}

function byModifiedDesc(a: ProjectMeta, b: ProjectMeta): number {
  return b.modifiedAt.localeCompare(a.modifiedAt)
}

/** Lightweight list for the home screen (no snapshots), newest first. */
export function listProjects(): ProjectMeta[] {
  return readAll()
    .map(({ snapshot: _snapshot, ...meta }) => meta)
    .sort(byModifiedDesc)
}

/** Full project (with snapshot) for opening into the workspace. */
export function getProject(id: string): StoredProject | null {
  return readAll().find((project) => project.id === id) ?? null
}

/** Create a brand-new empty project record and return it. */
export function createProject(name: string, client: string, snapshot: ProjectSnapshot): StoredProject {
  const now = new Date().toISOString()
  const project: StoredProject = {
    id: newId(),
    name: name.trim() || 'Untitled project',
    client: client.trim(),
    createdAt: now,
    modifiedAt: now,
    summary: summarize(snapshot),
    snapshot,
  }
  const projects = readAll()
  projects.push(project)
  writeAll(projects)
  return project
}

/** Persist the current snapshot for an existing project (updates modifiedAt). */
export function saveSnapshot(id: string, snapshot: ProjectSnapshot): StoredProject | null {
  const projects = readAll()
  const index = projects.findIndex((project) => project.id === id)
  if (index === -1) return null
  const updated: StoredProject = {
    ...projects[index],
    name: (snapshot.projectName ?? '').trim() || projects[index].name,
    client: (snapshot.client ?? '').trim() || projects[index].client,
    modifiedAt: new Date().toISOString(),
    summary: summarize(snapshot),
    snapshot,
  }
  projects[index] = updated
  writeAll(projects)
  return updated
}

export function renameProject(id: string, name: string): void {
  const projects = readAll()
  const index = projects.findIndex((project) => project.id === id)
  if (index === -1) return
  projects[index] = {
    ...projects[index],
    name: name.trim() || projects[index].name,
    modifiedAt: new Date().toISOString(),
  }
  writeAll(projects)
}

export function deleteProject(id: string): void {
  writeAll(readAll().filter((project) => project.id !== id))
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
