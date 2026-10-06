import { useMemo, useState } from 'react'
import { FolderOpen, Leaf, Pencil, Plus, Trash2 } from 'lucide-react'
import type { ProjectMeta } from './projectStore'

type HomeViewProps = {
  projects: ProjectMeta[]
  onNew: (name: string, client: string) => void
  onOpen: (id: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export function HomeView({ projects, onNew, onOpen, onRename, onDelete }: HomeViewProps) {
  const [newName, setNewName] = useState('')
  const [newClient, setNewClient] = useState('')
  const canCreate = newName.trim().length > 0 && newClient.trim().length > 0

  // Clients used on past projects, for the autocomplete (free-type still allowed).
  const clientOptions = useMemo(
    () => Array.from(new Set(projects.map((project) => project.client).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b)),
    [projects],
  )

  function handleCreate() {
    if (!canCreate) return
    onNew(newName.trim(), newClient.trim())
    setNewName('')
    setNewClient('')
  }

  return (
    <main className="home-shell">
      <header className="home-header">
        <div className="home-brand">
          <span className="home-logo"><Leaf size={22} /></span>
          <div>
            <h1>Potential to Occur</h1>
            <p className="app-subtitle">Species screening</p>
          </div>
        </div>
      </header>

      <section className="home-body">
        <div className="home-new-card">
          <div className="home-new-copy">
            <h2>Start a new project</h2>
            <p>Name a project, then draw or load a project area and run the screening.</p>
          </div>
          <div className="home-new-fields">
            <label className="home-field">
              <span className="home-field-label">Client<span className="home-req">*</span></span>
              <input
                type="text"
                className="home-new-input"
                placeholder="e.g. PG&E"
                list="home-client-options"
                autoComplete="off"
                value={newClient}
                onChange={(event) => setNewClient(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleCreate()
                }}
              />
              <datalist id="home-client-options">
                {clientOptions.map((client) => (
                  <option key={client} value={client} />
                ))}
              </datalist>
            </label>
            <label className="home-field">
              <span className="home-field-label">Project name<span className="home-req">*</span></span>
              <input
                type="text"
                className="home-new-input"
                placeholder="e.g. Newark-Dixon Route Segments"
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleCreate()
                }}
              />
            </label>
            <button type="button" className="primary-button home-create-button" onClick={handleCreate} disabled={!canCreate}>
              <Plus size={17} />
              New Project
            </button>
          </div>
          <p className="home-new-note">
            The run date is captured automatically. You can screen the same project again later
            (e.g. if the design changes) — each run is saved as its own dated entry.
            A full screening analysis generally takes about 10–15 minutes to run.
          </p>
        </div>

        <div className="home-projects">
          <div className="home-projects-heading">
            <h2>Your projects</h2>
            <span className="home-count">{projects.length}</span>
          </div>

          {projects.length === 0 ? (
            <div className="home-empty">
              <FolderOpen size={26} />
              <p>No saved projects yet. Create one above to get started.</p>
            </div>
          ) : (
            <ul className="home-project-list">
              {projects.map((project) => (
                <li key={project.id} className="home-project-card">
                  <button
                    type="button"
                    className="home-project-open"
                    onClick={() => onOpen(project.id)}
                    title="Open project"
                  >
                    <span className="home-project-title-row">
                      {project.client && <span className="home-project-client">{project.client}</span>}
                      <span className="home-project-name">{project.name}</span>
                    </span>
                    <span className="home-project-meta">
                      <span className={`home-chip ${project.summary.hasResults ? 'chip-ready' : 'chip-draft'}`}>
                        {project.summary.hasResults ? 'Results loaded' : 'Not run yet'}
                      </span>
                      {project.summary.reviewedCount > 0 && (
                        <span className="home-chip chip-reviewed">{project.summary.reviewedCount} reviewed</span>
                      )}
                      <span className="home-project-date">Run {formatDate(project.createdAt)} · updated {formatWhen(project.modifiedAt)}</span>
                    </span>
                  </button>
                  <div className="home-project-actions">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="Rename project"
                      title="Rename"
                      onClick={() => {
                        const next = window.prompt('Rename project', project.name)
                        if (next && next.trim()) onRename(project.id, next.trim())
                      }}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      aria-label="Delete project"
                      title="Delete"
                      onClick={() => {
                        if (window.confirm(`Delete "${project.name}"? This cannot be undone.`)) {
                          onDelete(project.id)
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  )
}
