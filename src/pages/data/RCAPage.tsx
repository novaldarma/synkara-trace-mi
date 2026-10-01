import { useEffect, useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '../../services/supabase'

type Document = {
  document_id: string; source_id: string; source_file: string; source_sha256: string
  asset_id: string; plant_code: string; ar_no_as_provided: string
  incident_occurred_date: string; reported_date_raw: string
  linked_incident_record_id: string; available_at: string | null
  slide_count: number; link_status: string; visual_review_status: string
}
type SlideBlock = { shape_path: string; kind: string; text: string | null; row?: number; column?: number }
type Slide = {
  slide_id: string; source_slide_number: number; source_file: string
  content_role_hint: string; visual_review_status: string
  text_block_count: number; unread_visual_count: number
  blocks_in_powerpoint_order: SlideBlock[]
}
type HistoricalAction = {
  historical_action_id: string; slide_id: string; action_as_written: string
  owner_as_written: string | null; plan_date_as_written: string | null
  source_status_as_written: string | null
}
type Status = 'loading' | 'ready' | 'error'

// Team-prepared PDFs are for viewing. The supplied PPTX files remain the source of record.
const pdfRenditions: Record<string, { asset: string; ar: string; file: string; pages: number }> = {
  '2f800b7a46d1a0522c3c1ef3372e8faf39cfac0f33996a01a7a7936e4b3f0ad1': { asset: 'PU-2101B', ar: 'AR-2026-ARP-0117', file: 'RCA1_PU-2101B_Team_Rendition.pdf', pages: 3 },
  '7db64c0b6e9492713b461d26397aa08392c7c071032d0a610e5844245f13baa9': { asset: 'KO-3201', ar: 'AR-2026-ZCU-0142', file: 'RCA2_KO-3201_Team_Rendition.pdf', pages: 3 },
  'a980f954c748241b3a7d672d5abdfc404bb205bb28d996980e9e62c6a0f1ff23': { asset: 'PM-4405B', ar: 'AR-2026-NUP-0089', file: 'RCA3_PM-4405B_Team_Rendition.pdf', pages: 4 },
  '43b49807de2387f1d5ce84d2989bb0adfb916c2f0ae40682f3e04bafe8a2abb9': { asset: 'HE-3301', ar: 'AR-2026-ZCU-0165', file: 'RCA4_HE-3301_Team_Rendition.pdf', pages: 4 },
  '260f106bf3909801920f7d46ab357c5acee18a0c730a2c986ccd55604fc574ae': { asset: 'BL-5702', ar: 'AR-2026-OPP-0203', file: 'RCA5_BL-5702_Team_Rendition.pdf', pages: 11 },
}

function RcaPdfViewer({ document: source }: { document: Document }) {
  const rendition = pdfRenditions[source.source_sha256.toLowerCase()]
  const matches = !!rendition && rendition.ar === source.ar_no_as_provided && fileName(source.source_file).includes(rendition.asset)
  const url = matches ? import.meta.env.BASE_URL + 'rca/' + rendition.file : null
  const [fileStatus, setFileStatus] = useState<'checking' | 'available' | 'missing'>('checking')

  useEffect(() => {
    if (!url) return
    let active = true
    setFileStatus('checking')
    void fetch(url, { method: 'HEAD' })
      .then((response) => { if (active) setFileStatus(response.ok && response.headers.get('content-type')?.toLowerCase().includes('pdf') ? 'available' : 'missing') })
      .catch(() => { if (active) setFileStatus('missing') })
    return () => { active = false }
  }, [url])

  return <section className="panel" aria-labelledby="rca-pdf-heading">
    <p className="scope-label">VISUAL VIEWING LAYER</p>
    <h2 id="rca-pdf-heading">RCA PDF rendition · {rendition?.asset ?? fileName(source.source_file)}</h2>
    <p className="source-note">Team-prepared rendition ({matches ? rendition.pages : 'unknown'} PDF pages) for visual orientation. It is not an 11-slide, page-for-slide copy. The supplied PowerPoint is the source of record; extracted text below is a separate search layer. Check the original slide before treating any diagram, matrix, or conclusion as verified.</p>
    {!matches && <p role="alert" className="route-status">No PDF rendition matches this source hash and asset identity.</p>}
    {url && fileStatus === 'checking' && <p role="status">Checking PDF rendition…</p>}
    {url && fileStatus === 'missing' && <p role="alert">The PDF rendition is unavailable. The source slide extracts remain below.</p>}
    {url && fileStatus === 'available' && <>
      <div className="rca-pdf-frame"><iframe title={'Team-prepared RCA PDF rendition for ' + (rendition?.asset ?? fileName(source.source_file))} src={url + '#toolbar=1&navpanes=0'} loading="lazy" /></div>
      <p className="source-note">If the embedded viewer is unavailable in your browser, open the PDF directly.</p>
      <a className="secondary-link" href={url} target="_blank" rel="noopener noreferrer">Open RCA PDF rendition in a new tab ↗<span className="sr-only"> (opens a new tab)</span></a>
    </>}
  </section>
}

const frame: CSSProperties = { overflowX: 'auto', border: '1px solid #d7e1e3', borderRadius: 6 }
const table: CSSProperties = { width: '100%', minWidth: 700, borderCollapse: 'collapse', fontSize: '.875rem' }
const header: CSSProperties = { textAlign: 'left', whiteSpace: 'nowrap', padding: 11, background: '#eaf3f1', borderBottom: '1px solid #b9ceca' }
const cell: CSSProperties = { padding: 11, verticalAlign: 'top', borderBottom: '1px solid #e2eaeb' }

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDocument(value: unknown): value is Document {
  return object(value) && typeof value['document_id'] === 'string' &&
    typeof value['source_id'] === 'string' && typeof value['source_file'] === 'string' &&
    typeof value['source_sha256'] === 'string' && typeof value['asset_id'] === 'string' &&
    typeof value['plant_code'] === 'string' && typeof value['ar_no_as_provided'] === 'string' &&
    typeof value['incident_occurred_date'] === 'string' && typeof value['reported_date_raw'] === 'string' &&
    typeof value['linked_incident_record_id'] === 'string' && value['available_at'] === null &&
    value['slide_count'] === 11 && typeof value['link_status'] === 'string' &&
    (value['visual_review_status'] === 'pending' || value['visual_review_status'] === 'reviewed')
}

function isSlide(value: unknown): value is Slide {
  return object(value) && typeof value['slide_id'] === 'string' &&
    typeof value['source_slide_number'] === 'number' &&
    typeof value['source_file'] === 'string' && typeof value['content_role_hint'] === 'string' &&
    (value['visual_review_status'] === 'pending' || value['visual_review_status'] === 'reviewed') &&
    typeof value['text_block_count'] === 'number' && typeof value['unread_visual_count'] === 'number' &&
    Array.isArray(value['blocks_in_powerpoint_order']) &&
    value['blocks_in_powerpoint_order'].every((block: unknown) => object(block) &&
      typeof block['shape_path'] === 'string' && typeof block['kind'] === 'string' &&
      (typeof block['text'] === 'string' || block['text'] === null))
}

function isAction(value: unknown): value is HistoricalAction {
  return object(value) && typeof value['historical_action_id'] === 'string' &&
    typeof value['slide_id'] === 'string' && typeof value['action_as_written'] === 'string' &&
    (value['owner_as_written'] === null || typeof value['owner_as_written'] === 'string') &&
    (value['plan_date_as_written'] === null || typeof value['plan_date_as_written'] === 'string') &&
    (value['source_status_as_written'] === null || typeof value['source_status_as_written'] === 'string')
}

function show(value: string | null): string { return value === null || value === '' ? 'Unavailable' : value }
function fileName(path: string): string { return path.split(/[\\/]/).pop() ?? path }

export default function RCAPage() {
  const [params, setParams] = useSearchParams()
  const requestedDocumentId = params.get('document')
  const requestedSlide = Number(params.get('slide'))
  const [documents, setDocuments] = useState<Document[]>([])
  const [docStatus, setDocStatus] = useState<Status>('loading')
  const [documentId, setDocumentId] = useState('')
  const [slides, setSlides] = useState<Slide[]>([])
  const [actions, setActions] = useState<HistoricalAction[]>([])
  const [detailStatus, setDetailStatus] = useState<Status>('loading')

  useEffect(() => {
    let active = true
    async function loadDocuments() {
      const { data, error } = await supabase.from('rca_documents')
        .select('document_id,source_id,source_file,source_sha256,asset_id,plant_code,ar_no_as_provided,incident_occurred_date,reported_date_raw,linked_incident_record_id,available_at,slide_count,link_status,visual_review_status')
        .eq('dataset_id', 'caliber2026_case2').order('source_file')
      if (!active) return
      if (error || (data ?? []).some((row) => !isDocument(row))) {
        setDocStatus('error')
        return
      }
      const valid = (data ?? []) as Document[]
      setDocuments(valid)
      setDocumentId(valid.find((doc) => doc.document_id === requestedDocumentId)?.document_id ?? valid[0]?.document_id ?? '')
      setDocStatus('ready')
    }
    void loadDocuments()
    return () => { active = false }
  }, [requestedDocumentId])

  useEffect(() => {
    if (!documentId) return
    let active = true
    setSlides([])
    setActions([])
    setDetailStatus('loading')
    async function loadDocument() {
      const [slideResult, actionResult] = await Promise.all([
        supabase.from('rca_sections')
          .select('slide_id,source_slide_number,source_file,content_role_hint,visual_review_status,text_block_count,unread_visual_count,blocks_in_powerpoint_order')
          .eq('document_id', documentId).order('source_slide_number'),
        supabase.from('rca_actions')
          .select('historical_action_id,slide_id,action_as_written,owner_as_written,plan_date_as_written,source_status_as_written')
          .eq('document_id', documentId).order('slide_id'),
      ])
      if (!active) return
      const nextSlides = slideResult.data ?? []
      const nextActions = actionResult.data ?? []
      if (slideResult.error || actionResult.error || nextSlides.length !== 11 ||
        nextSlides.some((row) => !isSlide(row)) || nextActions.some((row) => !isAction(row)) ||
        nextSlides.some((row, index) => row.source_slide_number !== index + 1)) {
        setDetailStatus('error')
        return
      }
      setSlides(nextSlides as Slide[])
      setActions(nextActions as HistoricalAction[])
      setDetailStatus('ready')
    }
    void loadDocument()
    return () => { active = false }
  }, [documentId])

  useEffect(() => {
    if (detailStatus !== 'ready') return
    const target = Number.isInteger(requestedSlide) && requestedSlide >= 1 && requestedSlide <= 11
      ? document.getElementById(`rca-slide-${requestedSlide}`) : document.getElementById('rca-source-document')
    if (target instanceof HTMLDetailsElement) target.open = true
    if (window.location.hash) target?.scrollIntoView({ block: 'start' })
  }, [detailStatus, documentId, requestedSlide])

  const selected = documents.find((doc) => doc.document_id === documentId)

  return <div className="app-shell">
    <a className="skip-link" href="#rca-content">Skip to source data</a>
    <header className="app-topbar">
      <Link className="brand-link" to="/dashboard">SYNKARA <strong>TRACE-MI</strong></Link>
      <nav aria-label="Source navigation"><Link className="secondary-link" to="/dashboard">← Case 2 workspace</Link></nav>
    </header>
    <main className="dashboard-content" id="rca-content">
      <div className="dashboard-title">
        <p className="scope-label">SOURCE DATA · CASE 2 · HISTORICAL RCA</p>
        <h1>RCA presentations</h1>
        <p>Extracted text from the five supplied investigation decks, organized by original slide number. This is retrospective material.</p>
      </div>
      <p className="route-status" role="status">The original presentations are the source of record. Their 55 slides have not all passed visual review. Extracted text and team PDF renditions are inspection aids; check original slide layouts and relationships before citing verified findings.</p>
      {docStatus === 'loading' && <p role="status" className="route-status">Loading RCA documents…</p>}
      {docStatus === 'error' && <p role="alert" className="route-status">RCA documents could not be loaded or validated.</p>}
      {docStatus === 'ready' && documents.length === 0 && <p role="status" className="route-status">No RCA presentations are supplied to this account.</p>}

      {docStatus === 'ready' && documents.length > 0 && <>
        <section className="panel" id="rca-source-document" aria-labelledby="choose-rca-heading">
          <h2 id="choose-rca-heading">Choose a source presentation</h2>
          <label className="tariff-field">RCA file
            <select value={documentId} onChange={(event) => { setDocumentId(event.target.value); setDetailStatus('loading'); setParams({ document: event.target.value }) }}>
              {documents.map((doc) => <option key={doc.document_id} value={doc.document_id}>{fileName(doc.source_file)} · {doc.plant_code} · {doc.ar_no_as_provided}</option>)}
            </select>
          </label>
          {selected && <>
            <p className="source-note">Source: {selected.source_file} · 11 slides · Incident date: {selected.incident_occurred_date} · Date Reported on slide 2: {selected.reported_date_raw}.</p>
            <p className="source-note">Linked incident ID: {selected.linked_incident_record_id} · AR: {selected.ar_no_as_provided} · Link identity: {selected.link_status}. The link does not verify conclusions on slides.</p>
            <p className="source-note">When the complete conclusions became available: unknown. Reported date is not the publication date of every finding. Source SHA-256: {selected.source_sha256}</p>
            <Link className="text-link" to={`/dashboard/investigation/${encodeURIComponent(selected.linked_incident_record_id)}`}>Return to linked investigation ↗</Link>
          </>}
        </section>

        {selected && <RcaPdfViewer key={selected.document_id} document={selected} />}

        {detailStatus === 'loading' && <p role="status" className="route-status">Loading slide text…</p>}
        {detailStatus === 'error' && <p role="alert" className="route-status">The slide sequence or reviewed historical actions could not be loaded or validated.</p>}
        {detailStatus === 'ready' && <>
          <section className="panel" aria-labelledby="slide-list-heading">
            <h2 id="slide-list-heading">Slides 1–11 · extracted source blocks</h2>
            <p className="source-note">PowerPoint shape order is preserved by the extractor. A table cell's extracted text does not by itself prove the row/column meaning of a visual matrix.</p>
            {slides.map((slide) => <details key={slide.slide_id} id={`rca-slide-${slide.source_slide_number}`} style={{ padding: '13px 0', borderTop: '1px solid #d7e1e3' }}>
              <summary><strong>Slide {slide.source_slide_number}:</strong> {slide.content_role_hint} · visual check {slide.visual_review_status}</summary>
              <p className="source-note">File: {slide.source_file} · Slide ID: {slide.slide_id} · Extracted text blocks: {slide.text_block_count} · Unread visual objects: {slide.unread_visual_count}.</p>
              {slide.blocks_in_powerpoint_order.map((block, index) => <div key={`${block.shape_path}-${index}`} style={{ margin: '10px 0', padding: 12, borderLeft: '3px solid #81aaa6', background: '#f5f7f8' }}>
                <p className="source-note">Shape {block.shape_path} · {block.kind}{block.row ? ` · table row ${block.row}, column ${block.column}` : ''} · extracted; visual context {slide.visual_review_status}</p>
                {block.text === null ? <p>Image/chart not transcribed; inspect original slide.</p> :
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'inherit' }}>{block.text}</pre>}
              </div>)}
            </details>)}
          </section>
          <section className="panel" aria-labelledby="historical-action-heading">
            <h2 id="historical-action-heading">Historically documented RCA actions</h2>
            {actions.length === 0 ? <p>No visually reviewed historical action rows have been imported. This does not mean the original presentations contain no actions.</p> :
              <div style={frame}><table style={table}>
                <thead><tr><th scope="col" style={header}>Slide</th><th scope="col" style={header}>Action as written</th><th scope="col" style={header}>Owner in slide</th><th scope="col" style={header}>Plan date</th><th scope="col" style={header}>Source status</th></tr></thead>
                <tbody>{actions.map((action) => <tr key={action.historical_action_id}>
                  <td style={cell}>{slides.find((slide) => slide.slide_id === action.slide_id)?.source_slide_number ?? 'Unknown'}</td>
                  <th scope="row" style={cell}>{action.action_as_written}</th><td style={cell}>{show(action.owner_as_written)}</td>
                  <td style={cell}>{show(action.plan_date_as_written)}</td><td style={cell}>{show(action.source_status_as_written)}</td>
                </tr>)}</tbody>
              </table></div>}
            <p className="source-note">These are historical source rows, never active application tasks or a claim about current maintenance status.</p>
          </section>
        </>}
      </>}
    </main>
  </div>
}
