type ArcgisJson = Record<string, unknown>

export type NotebookJobStatus = {
  status: string
  jobStatus?: string
  messages?: Array<{ description?: string; type?: string }>
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}

function encodeParams(params: Record<string, unknown>) {
  const body = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return
    body.set(key, typeof value === 'string' ? value : JSON.stringify(value))
  })
  return body
}

async function requestArcgisJson(url: string, params: Record<string, unknown>, method: 'GET' | 'POST' = 'GET'): Promise<ArcgisJson> {
  const body = encodeParams({ ...params, f: 'json' })
  const requestUrl = method === 'GET' ? `${url}?${body.toString()}` : url
  const response = await fetch(requestUrl, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : undefined,
    body: method === 'POST' ? body : undefined,
  })

  if (!response.ok) {
    throw new Error(`ArcGIS request failed (${response.status})`)
  }

  const data = await response.json() as ArcgisJson
  const error = data.error as { message?: string; details?: string[] } | undefined
  if (error) {
    throw new Error([error.message, ...(error.details ?? [])].filter(Boolean).join(' ') || 'ArcGIS returned an error.')
  }

  return data
}

async function getFirstTaskUrl(gpServerUrl: string, token: string) {
  const rootUrl = trimTrailingSlash(gpServerUrl)
  const metadata = await requestArcgisJson(rootUrl, { token })
  const tasks = metadata.tasks as string[] | undefined
  const taskName = tasks?.[0]

  if (!taskName) {
    throw new Error('No geoprocessing task was found at the Notebook web tool URL.')
  }

  return `${rootUrl}/${encodeURIComponent(taskName)}`
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function newestMessage(status: NotebookJobStatus) {
  return [...(status.messages ?? [])].reverse().find((message) => message.description)?.description
}

function normalizedJobStatus(status: NotebookJobStatus) {
  return String(status.jobStatus ?? status.status ?? '')
}

export async function runNotebookWebTool(
  gpServerUrl: string,
  token: string,
  inputs: Record<string, unknown>,
  onStatus?: (status: NotebookJobStatus) => void,
) {
  const taskUrl = await getFirstTaskUrl(gpServerUrl, token)
  const submit = await requestArcgisJson(`${taskUrl}/submitJob`, { token, ...inputs }, 'POST')
  const jobId = String(submit.jobId ?? '')

  if (!jobId) {
    throw new Error('Notebook web tool did not return a job ID.')
  }

  for (;;) {
    const statusResponse = await requestArcgisJson(`${taskUrl}/jobs/${jobId}`, { token }) as NotebookJobStatus
    const status = {
      ...statusResponse,
      status: normalizedJobStatus(statusResponse),
    }
    onStatus?.(status)

    if (status.status === 'esriJobSucceeded') {
      return { taskUrl, jobId, status }
    }

    if (status.status === 'esriJobFailed' || status.status === 'esriJobCancelled' || status.status === 'esriJobTimedOut') {
      throw new Error(newestMessage(status) ?? `Notebook web tool failed: ${status.status}`)
    }

    await sleep(4000)
  }
}

export async function getNotebookJobOutput(taskUrl: string, jobId: string, token: string, outputName: string) {
  return requestArcgisJson(`${taskUrl}/jobs/${jobId}/results/${outputName}`, { token })
}

export function outputValue(output: ArcgisJson) {
  return output.value ?? output
}

export function outputUrl(output: ArcgisJson) {
  const value = outputValue(output)

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed.startsWith('http')) return trimmed

    try {
      const parsed = JSON.parse(trimmed) as { url?: string }
      if (parsed.url) return parsed.url
    } catch {
      const match = trimmed.match(/['"]url['"]\s*:\s*['"]([^'"]+)['"]/)
      if (match?.[1]) return match[1]
    }
  }

  if (value && typeof value === 'object' && 'url' in value && typeof (value as { url?: unknown }).url === 'string') {
    return (value as { url: string }).url
  }

  return ''
}
