import { useEffect, useRef, useState } from 'react';
import { Check, X, RefreshCw, ChevronLeft, ChevronRight, Eye, MessageSquare } from 'lucide-react';
import { Button } from '../../frontend/src/components/ui/button';
import { Textarea } from '../../frontend/src/components/ui/textarea';
import type { PracticeRecord, PreparedProposal, Preview } from '../../slide-generation/src/practice/contracts';
import type { ProjectConnection } from './api';

type Rect = { x: number; y: number; width: number; height: number };
type Change = { id: string; kind: string; nodeId: string; label: string; before: Rect[]; after: Rect[]; properties?: string[]; beforeText?: string; afterText?: string; precision: string };
type Diff = { proposalVersion: number; changes: Change[]; beforeIndex?: number; afterIndex?: number; canvas: { width: number; height: number } };
type ComparedPreview = Preview & { visualDiff?: Diff };
export function Review({ connection, record, onRecord, onError, selectedSlide, slides }: {
  connection: ProjectConnection; record: PracticeRecord; onRecord: (record: PracticeRecord) => void;
  onError: (error: string) => void; selectedSlide: string; slides: { id: string; title: string }[];
}) {
  const [proposalId, setProposalId] = useState(''), [slideId, setSlideId] = useState(selectedSlide);
  const [highlights, setHighlights] = useState(true), [zoom, setZoom] = useState(1);
  const [changeIndex, setChangeIndex] = useState(0), [prompt, setPrompt] = useState('');
  const [requestSlide, setRequestSlide] = useState(selectedSlide);
  const [busy, setBusy] = useState(''), [notice, setNotice] = useState('');
  const [mobileSide, setMobileSide] = useState<'before' | 'after' | 'both'>('both');
  const panes = useRef<(HTMLDivElement | null)[]>([]), syncing = useRef(false);
  const proposal = record.proposals.find(p => p.id === proposalId) ?? record.proposals[0];
  const previews = (proposal?.previews ?? []) as ComparedPreview[];
  const preview = previews.find(p => p.slideId === slideId) ?? previews[0];
  const diff = preview?.visualDiff;
  const changes = diff?.changes ?? [], change = changes[changeIndex];
  const exact = proposal && previews.length > 0 && previews.every(p => p.visualDiff?.proposalVersion === proposal.version);
  useEffect(() => { setChangeIndex(0); setNotice(''); }, [proposal?.id, proposal?.version, preview?.slideId]);
  const reload = async () => { onRecord(await connection.get<PracticeRecord>(`/practice/${record.id}`)); await connection.refresh(); };
  const run = async (action: string) => {
    if (!proposal || busy) return;
    setBusy(action); setNotice('');
    try {
      const result = await connection.post<PreparedProposal | PracticeRecord>(`/practice/${record.id}/proposals/${encodeURIComponent(proposal.id)}/${action}`, action === 'accept' ? { version: proposal.version } : action === 'revise' ? { prompt } : {});
      if (action === 'revise' && 'proposals' in result) { onRecord(result); setPrompt(''); }
      else {
        if (action === 'accept' && 'previews' in result) setNotice(result.status === 'accepted' ? 'Accepted into the deck.' : result.status === 'ready' ? 'The preview changed. Review both panes, then accept the new version.' : `Not applied: ${result.error ?? result.status}`);
        await reload();
      }
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(''); }
  };
  const request = async () => {
    if (!prompt.trim() || busy) return;
    if (proposal && (requestSlide === preview?.slideId || proposal.previews.some(item => item.slideId === requestSlide)) && proposal.status !== 'accepted' && proposal.status !== 'rejected' && proposal.status !== 'superseded') { await run('revise'); return; }
    setBusy('request');
    try { onRecord(await connection.post<PracticeRecord>(`/practice/${record.id}/request-change`, { slideId: requestSlide, prompt })); setPrompt(''); }
    catch (error) { onError(String(error)); } finally { setBusy(''); }
  };
  const syncScroll = (index: number) => {
    if (syncing.current) return; syncing.current = true;
    const from = panes.current[index], to = panes.current[1 - index];
    if (from && to) { to.scrollLeft = from.scrollLeft; to.scrollTop = from.scrollTop; }
    requestAnimationFrame(() => { syncing.current = false; });
  };
  if (record.status === 'processing') return <section className="review-processing"><div className="spinner" /><h2>Reviewing your practice</h2><p>Building feedback and validating private slide previews.</p><p className="muted">Your deck stays unchanged until you accept a proposal.</p><Button variant="secondary" onClick={() => { void connection.post<PracticeRecord>(`/practice/${record.id}/cancel`).then(onRecord).catch(error => onError(String(error))); }}>Cancel review</Button></section>;
  if (record.status === 'failed' || record.status === 'cancelled') return <section className="review-processing"><h2>{record.status === 'failed' ? 'Review needs attention' : 'Review cancelled'}</h2><p role="alert">{record.error ?? 'Your rehearsal remains saved.'}</p><Button onClick={() => { void connection.post<PracticeRecord>(`/practice/${record.id}/retry`).then(onRecord).catch(error => onError(String(error))); }}>Retry saved rehearsal</Button></section>;
  return <section className="integrated-review" aria-label="Practice review" onKeyDown={event => {
    if ((event.target as HTMLElement).matches('input,textarea,select')) return;
    if (event.key === ']') setChangeIndex(index => Math.min(changes.length - 1, index + 1));
    if (event.key === '[') setChangeIndex(index => Math.max(0, index - 1));
  }}>
    <header className="review-summary"><div><p className="eyebrow">Practice review</p><h2>{record.review?.summary ?? 'Your rehearsal is saved'}</h2></div></header>
    {!!record.review?.feedback.length && <details className="feedback" open={!proposal}><summary>{record.review.feedback.length} feedback {record.review.feedback.length === 1 ? 'item' : 'items'}</summary>{record.review.feedback.map(item => <article key={item.id}><strong>{item.observation}</strong><p>{item.suggestion}</p></article>)}</details>}
    <div className="review-proposals" aria-label="Proposed changes">{record.proposals.map(p => <button className={p.id === proposal?.id ? 'selected' : ''} key={p.id} onClick={() => setProposalId(p.id)}><span>{p.title}</span><small>{p.status} · v{p.version}</small></button>)}</div>
    {proposal ? <>
      {!!record.context?.speech.filter(span => proposal.evidenceIds.includes(span.id)).length && <blockquote className="rehearsal-evidence"><small>From your rehearsal</small>{record.context.speech.filter(span => proposal.evidenceIds.includes(span.id)).map(span => <p key={span.id}>“{span.text}”</p>)}</blockquote>}
      <div className="review-toolbar"><div><h3>{proposal.title}</h3><p className="muted">{proposal.rationale}</p></div><span className={`proposal-status status-${proposal.status}`}>{proposal.status === 'accepted' ? 'Accepted' : proposal.status} · version {proposal.version}</span></div>
      {!!proposal.error && <p className="error-banner" role="alert">{proposal.error}</p>}
      {!!proposal.findings.length && <details className="feedback"><summary>Validation findings ({proposal.findings.length})</summary>{proposal.findings.map((finding, index) => <p key={index}>{finding.message}</p>)}</details>}
      <nav className="affected-slides" aria-label="Affected slides">{previews.map((p, index) => <Button key={p.slideId} size="sm" variant={p.slideId === preview?.slideId ? 'secondary' : 'ghost'} onClick={() => setSlideId(p.slideId)}>{p.after === null ? 'Removed' : p.before === null ? 'Added' : 'Slide'} {p.visualDiff?.afterIndex !== undefined ? p.visualDiff.afterIndex + 1 : index + 1}</Button>)}</nav>
      {preview && <>
        <div className="comparison-tools"><Button variant="ghost" size="sm" aria-pressed={highlights} onClick={() => setHighlights(value => !value)}><Eye /> {highlights ? 'Hide highlights' : 'Show highlights'}</Button><label>Zoom <input aria-label="Linked preview zoom" type="range" min="1" max="3" step="0.25" value={zoom} onChange={event => setZoom(Number(event.target.value))} /><span>{Math.round(zoom * 100)}%</span></label><select aria-label="Comparison layout" value={mobileSide} onChange={event => setMobileSide(event.target.value as typeof mobileSide)}><option value="both">Side by side</option><option value="before">Before</option><option value="after">After</option></select></div>
        <div className={`comparison-pair compare-${mobileSide}`} data-testid="comparison-pair">{(['before', 'after'] as const).map((side, index) => <section key={side} className={`comparison-pane comparison-${side}`}><h3>{side === 'before' ? 'Original' : 'Updated'} <span>{side === 'before' ? '−' : '+'}</span></h3><div className="comparison-scroll" ref={node => { panes.current[index] = node; }} onScroll={() => syncScroll(index)}><div className="comparison-canvas" style={{ width: `${zoom * 100}%` }}>
          {preview[side] ? <><img alt={`${side === 'before' ? 'Original' : 'Updated'} slide ${preview.slideId}`} src={`data:image/jpeg;base64,${preview[side]!.jpeg}`} draggable={false} />{highlights && diff && <svg viewBox={`0 0 ${diff.canvas.width} ${diff.canvas.height}`} aria-label={`${side} change highlights`} className="diff-overlay">{changes.flatMap(item => item[side].map((rect, rectIndex) => <g key={`${item.id}-${rectIndex}`} className={item.id === change?.id ? 'focused-change' : ''}><rect x={rect.x} y={rect.y} width={Math.max(2, rect.width)} height={Math.max(2, rect.height)} data-change={item.id} data-kind={item.kind} className={['move', 'resize'].includes(item.kind) ? 'geometry-change' : ''}><title>{item.label}{item.precision === 'element' ? ' (whole element)' : ''}</title></rect></g>))}</svg>}</> : <div className="missing-slide">{side === 'before' ? 'Slide did not exist' : 'Slide removed'}</div>}
        </div></div>{changes.some(item => item.kind === 'notes') && <div className="notes-diff"><strong>Speaker notes</strong><p>{preview[side]?.notes || 'No notes'}</p></div>}</section>)}</div>
        {!diff && <p className="error-banner">Comparison evidence is missing. Refresh this preview before accepting.</p>}
        {!!changes.length && <div className="change-navigation"><div><Button variant="ghost" size="icon-sm" aria-label="Previous change" disabled={changeIndex <= 0} onClick={() => setChangeIndex(i => i - 1)}><ChevronLeft /></Button><span>{changeIndex + 1} / {changes.length}</span><Button variant="ghost" size="icon-sm" aria-label="Next change" disabled={changeIndex >= changes.length - 1} onClick={() => setChangeIndex(i => i + 1)}><ChevronRight /></Button></div><p><strong>{change?.kind.replaceAll('-', ' ')}:</strong> {change?.label}{change?.precision === 'element' ? ' · whole-element highlight' : ''}</p></div>}
        <details className="change-list"><summary>All changes{changes.every(item => ['notes', 'order', 'build'].includes(item.kind)) ? ' · slide appearance unchanged' : ''}</summary><ol>{changes.map((item, index) => <li key={item.id}><button onClick={() => setChangeIndex(index)} className={index === changeIndex ? 'selected' : ''}>{item.label}{item.beforeText !== undefined && <del>{item.beforeText}</del>}{item.afterText !== undefined && <ins>{item.afterText}</ins>}</button></li>)}</ol></details>
      </>}
      <div className="review-actions"><Button disabled={busy !== '' || proposal.status !== 'ready' || !exact} onClick={() => { void run('accept'); }}><Check />{busy === 'accept' ? 'Accepting…' : 'Accept change'}</Button><Button variant="outline" disabled={busy !== '' || !['ready', 'invalid', 'stale'].includes(proposal.status)} onClick={() => { void run('reject'); }}><X />Reject</Button><Button variant="ghost" disabled={busy !== '' || ['accepted', 'rejected', 'superseded'].includes(proposal.status)} onClick={() => { void run('refresh'); }}><RefreshCw />Refresh preview</Button><small className="muted">{proposal.status === 'accepted' ? 'Canonical acceptance confirmed.' : 'Changes stay private until accepted.'}</small></div>
      {notice && <p className="notice" role="status">{notice}</p>}
    </> : <div className="empty-proposals"><h3>No slide changes proposed</h3><p>Your reviewer’s feedback is above. You can request a private alternative for the selected slide.</p></div>}
    <form className="request-change" onSubmit={event => { event.preventDefault(); void request(); }}><label htmlFor="counter-prompt">Request {proposal ? 'another version' : 'a change'}</label><select aria-label="Slide to request changes for" value={requestSlide} onChange={event => setRequestSlide(event.target.value)}>{slides.map((slide, index) => <option key={slide.id} value={slide.id}>Slide {index + 1}: {slide.title}</option>)}</select><Textarea id="counter-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} placeholder="Describe what you would like to change…" /><Button variant="secondary" disabled={!prompt.trim() || busy !== ''}><MessageSquare />{busy === 'revise' || busy === 'request' ? 'Preparing…' : 'Prepare private preview'}</Button></form>
  </section>;
}
