import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Plus, Presentation, Mic, MicOff, Play, Pause, Square, Monitor, Maximize2, FileText, Upload, MessageSquare, Check, LoaderCircle, CircleAlert, Trash2 } from 'lucide-react';
import { Button } from '../../frontend/src/components/ui/button';
import { Input } from '../../frontend/src/components/ui/input';
import { Textarea } from '../../frontend/src/components/ui/textarea';
import { Transcript as TranscriptView } from '../../frontend/src/features/workspace/Transcript';
import type { RawMicrophoneSnapshot } from '../../frontend/src/services/rawMicrophone';
import type { PracticeRecord } from '../../slide-generation/src/practice/contracts';
import type { IncomingMessage } from '../../slide-generation/src/viewer/protocol';
import type { Mode, Project, Snapshot } from '../shared/protocol';
import { createProject, projects, ProjectConnection } from './api';
import { CanonicalMicrophone } from './microphone';
import { Viewer } from './Viewer';
import type { NavigationTarget } from './navigation';
import { Review } from './Review';
import { Annotations } from '../../frontend/src/features/Annotations';

const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error);
const voiceModes = new Set<Mode>(['talk', 'practice', 'present']);
export function App() {
  const [route, setRoute] = useState(() => new URL(location.href).searchParams);
  useEffect(() => { const update = () => setRoute(new URL(location.href).searchParams); addEventListener('popstate', update); return () => removeEventListener('popstate', update); }, []);
  const navigate = (projectId?: string) => {
    const url = new URL(location.href); url.search = projectId ? `?project=${encodeURIComponent(projectId)}` : '';
    history.pushState({}, '', url); setRoute(url.searchParams);
  };
  const id = route.get('project');
  return id ? <Workspace key={`${id}-${route.get('audience')}`} projectId={id} audience={route.get('audience') === '1'} onBack={() => navigate()} /> : <Projects onOpen={navigate} />;
}
function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<Project[]>([]), [name, setName] = useState(''), [context, setContext] = useState('');
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const load = () => { setLoading(true); void projects().then(setItems).catch(error => setError(messageOf(error))).finally(() => setLoading(false)); };
  useEffect(load, []);
  return <main className="project-home"><header className="home-header"><a className="brand" href="/"><span className="brand-icon"><Presentation /></span>Talkdeck</a></header>
    <div className="projects-heading"><div><p className="eyebrow">Your workspace</p><h1>Projects</h1><p className="muted">Start with an idea. Talk it into a presentation.</p></div><Button onClick={() => setCreating(value => !value)}><Plus />New project</Button></div>
    {error && <div className="error-banner" role="alert"><CircleAlert />{error}<Button variant="ghost" size="sm" onClick={load}>Retry</Button></div>}
    {loading ? <p className="empty-state">Opening your projects…</p> : <div className="project-grid">{items.map(project => <button key={project.id} className="project-card" onClick={() => onOpen(project.id)}><div className="project-card-preview"><Presentation /></div><div><h2>{project.name}</h2><p>{project.context || 'No context added yet'}</p><small>Updated {new Date(project.updatedAt).toLocaleDateString()}</small></div></button>)}</div>}
    {!loading && !items.length && !creating && <div className="empty-state"><Presentation /><h2>A clear idea starts here</h2><p>Create a project, add your context, and start talking.</p><Button variant="secondary" onClick={() => setCreating(true)}><Plus />Create your first project</Button></div>}
    {creating && <form className="create-project" onSubmit={async event => { event.preventDefault(); if (!name.trim() || busy) return; setBusy(true); setError(''); try { onOpen((await createProject(name.trim(), context)).id); } catch (error) { setError(messageOf(error)); } finally { setBusy(false); } }}><h2>New project</h2><label className="field">Project name<Input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="What are you presenting?" required maxLength={120} /></label><label className="field">Context<Textarea value={context} onChange={event => setContext(event.target.value)} placeholder="Audience, purpose, key facts, and the style you have in mind…" rows={4} /></label><div className="form-actions"><Button type="button" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button><Button disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create project'}<ArrowRight /></Button></div></form>}
  </main>;
}
function Workspace({ projectId, audience, onBack }: { projectId: string; audience: boolean; onBack: () => void }) {
  const [connection, setConnection] = useState<ProjectConnection>(), [snapshot, setSnapshot] = useState<Snapshot>();
  const [network, setNetwork] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [navigation, setNavigation] = useState<NavigationTarget>();
  const [publication, setPublication] = useState<IncomingMessage>(), [blackout, setBlackout] = useState(false);
  const [error, setError] = useState(''), [busy, setBusy] = useState(''), [paint, setPaint] = useState('Waiting for viewer');
  const [panel, setPanel] = useState<'transcript' | 'context' | 'notes'>('transcript'), [context, setContext] = useState('');
  const [prompt, setPrompt] = useState(''), [explicitEdit, setExplicitEdit] = useState(false), [inputMode, setInputMode] = useState<'audio' | 'transcript'>(() => sessionStorage.getItem(`talkdeck-input:${projectId}`) === 'transcript' ? 'transcript' : 'audio');
  const [capture, setCapture] = useState<RawMicrophoneSnapshot>({ phase: 'idle', permission: 'not-requested' });
  const [level, setLevel] = useState(0), [pendingAudio, setPendingAudio] = useState(0), [intent, setIntent] = useState(true);
  const [record, setRecord] = useState<PracticeRecord>(), [reviewId, setReviewId] = useState<string>();
  const mic = useRef<CanonicalMicrophone | undefined>(undefined), live = useRef({ snapshot, network, intent, inputMode });
  const sequence = useRef(0), activePractice = useRef(''), currentRecord = useRef(record), main = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null), frameRef = useRef<HTMLDivElement>(null);
  const contextLoaded = useRef(false), mounted = useRef(true), lastMode = useRef('');
  live.current = { snapshot, network, intent, inputMode }; currentRecord.current = record;
  const reportError = useCallback((message: string) => setError(message), []);
  const updateRecord = useCallback((next: PracticeRecord) => { setRecord(next); setReviewId(next.id); }, [projectId]);
  useEffect(() => {
    mounted.current = true;
    const client = new ProjectConnection(projectId, {
      snapshot: next => {
        if (!mounted.current) return;
        setSnapshot(next); setBlackout(next.blackout);
        if (!contextLoaded.current) { setContext(next.project.context); contextLoaded.current = true; }
      }, viewer: next => { if (mounted.current) setPublication(next); },
      navigation: setNavigation,
      blackout: value => { if (mounted.current) setBlackout(value); },
      connection: value => { if (mounted.current) setNetwork(value); }, error: reportError,
    });
    setConnection(client); void client.open(audience ? 'audience' : 'editor').catch(error => { setError(messageOf(error)); setNetwork('disconnected'); });
    return () => { mounted.current = false; mic.current?.dispose(); client.close(); };
  }, [projectId, audience, reportError]);
  useEffect(() => {
    if (!connection || audience) return;
    const microphone = new CanonicalMicrophone({
      canCapture: () => Boolean(live.current.snapshot && voiceModes.has(live.current.snapshot.mode) && live.current.network === 'connected' && live.current.intent && live.current.inputMode === 'audio'),
      serverNow: () => performance.now() + connection.epochOffsetMs,
      binding: () => {
        const state = live.current.snapshot!;
        return { epoch: state.epoch, slideId: connection.navigation?.slideId ?? state.selectedId, practice: state.mode === 'practice', modeStartedAtMs: state.modeStartedAtMs, nextSequence: sequence.current };
      },
      send: async chunk => { const receipt = await connection.audio(chunk); sequence.current = Math.max(sequence.current, chunk.sequence + 1); return receipt; },
      change: setCapture, level: setLevel, pending: setPendingAudio, error: reportError,
    });
    mic.current = microphone;
    return () => { microphone.dispose(); if (mic.current === microphone) mic.current = undefined; };
  }, [connection, audience, reportError]);
  useEffect(() => {
    if (!snapshot || !connection || audience) return;
    const key = `${snapshot.mode}:${snapshot.epoch}`;
    if (lastMode.current !== key) { mic.current?.disconnect(); lastMode.current = key; setIntent(true); }
    if (snapshot.practiceId && activePractice.current !== snapshot.practiceId) {
      activePractice.current = snapshot.practiceId; setRecord(undefined); sequence.current = 0;
      void connection.get<PracticeRecord>(`/practice/${snapshot.practiceId}`).then(next => { sequence.current = next.audio.length; updateRecord(next); }).catch(error => reportError(messageOf(error)));
    }

  }, [snapshot?.mode, snapshot?.epoch, snapshot?.practiceId, connection, audience, projectId, updateRecord]);
  useEffect(() => {
    if (!connection || !reviewId || audience) return;
    let active = true;
    const refresh = async () => {
      try {
        const next = await connection.get<PracticeRecord>(`/practice/${reviewId}`);
        if (active) { setRecord(next); if (next.status === 'recording') sequence.current = Math.max(sequence.current, next.audio.length); }
      } catch (error) { if (active) reportError(messageOf(error)); }
    };
    void refresh();
    const interval = setInterval(() => { if (currentRecord.current?.status === 'processing' || currentRecord.current?.status === 'recording') void refresh(); }, 2000);
    return () => { active = false; clearInterval(interval); };
  }, [connection, reviewId, audience, reportError]);
  useEffect(() => {
    const hide = () => { if (document.hidden) { setIntent(false); void mic.current?.stopAndDrain().catch(error => reportError(messageOf(error))); } };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [reportError]);
  const practiceReady = snapshot?.mode !== 'practice' || record?.id === snapshot.practiceId;
  useEffect(() => {
    if (audience || !mic.current || !snapshot) return;
    if (network !== 'connected') { mic.current.disconnect(); return; }
    if (intent && voiceModes.has(snapshot.mode) && inputMode === 'audio' && practiceReady && !busy) void mic.current.recoverConnection().then(() => mic.current?.start()).catch(error => reportError(messageOf(error)));
  }, [network, intent, inputMode, snapshot?.mode, snapshot?.epoch, practiceReady, busy, audience, reportError]);
  useEffect(() => {
    document.querySelector('.filmstrip .slide-thumbnail-item.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [snapshot?.selectedId, navigation?.slideId]);
  const run = async (label: string, task: () => Promise<unknown>) => {
    if (busy) return; setBusy(label); setError('');
    try { await task(); } catch (error) { setError(messageOf(error)); } finally { setBusy(''); }
  };
  const enter = (mode: Mode) => run(mode, async () => {
    if (!connection) return;
    await mic.current?.stopAndDrain();
    if (snapshot?.mode === 'practice' && record?.status === 'recording' && mode !== 'practice') throw new Error('Finish or cancel this practice recording before changing modes.');
    await connection.command({ type: 'mode', mode, input: inputMode }); setIntent(true);
  });
  const select = (action: 'next' | 'previous' | 'select', slideId?: string) => {
    if (!connection || network !== 'connected' || busy) return;
    setError(''); void connection.navigate(action, slideId).catch(error => setError(messageOf(error)));
  };
  const control = (type: 'next' | 'previous' | 'add' | 'pause' | 'resume' | 'blackout', value?: boolean) => type === 'next' || type === 'previous' ? select(type) : run(type, async () => { await connection?.command({ type, value }); });
  const deleteSlide = (targetId?: string) => run('delete', async () => {
    if (!connection || !snapshot) return;
    const slideId = targetId ?? connection.navigation?.slideId ?? snapshot.selectedId;
    await mic.current?.stopAndDrain();
    await connection.command({ type: 'delete', slideId });
  });
  const toggleCapture = () => run('microphone', async () => {
    const stopping = intent && (capture.phase === 'capturing' || capture.phase === 'requesting');
    setIntent(!stopping);
    if (stopping) { await mic.current?.stopAndDrain(); if (snapshot?.mode === 'practice' && snapshot.practiceId) await connection?.post(`/practice/${snapshot.practiceId}/pause`); }
    else { if (snapshot?.mode === 'practice' && snapshot.practiceId) await connection?.post(`/practice/${snapshot.practiceId}/resume`); await mic.current?.retry(); }
  });
  const finish = () => run('finish', async () => {
    if (!connection || !snapshot?.practiceId) return;
    setIntent(false); await mic.current?.stopAndDrain(); await connection.waitForNavigation();
    updateRecord(await connection.post<PracticeRecord>(`/practice/${snapshot.practiceId}/finish`)); await connection.refresh();
  });
  const cancelPractice = () => run('cancel', async () => {
    if (!connection || !snapshot?.practiceId) return;
    setIntent(false); await mic.current?.stopAndDrain(); await connection.waitForNavigation();
    updateRecord(await connection.post<PracticeRecord>(`/practice/${snapshot.practiceId}/cancel`)); await connection.refresh(); await connection.command({ type: 'mode', mode: 'view' });
  });
  const submitText = () => run('input', async () => {
    if (!connection || !snapshot || !prompt.trim()) return;
    const now = Math.max(0, performance.now() + connection.epochOffsetMs - snapshot.modeStartedAtMs);
    if (snapshot.mode === 'practice' && explicitEdit) await connection.command({ type: 'push-to-edit', slideId: connection.navigation?.slideId ?? snapshot.selectedId, prompt: prompt.trim() });
    else await connection.input({ slideId: connection.navigation?.slideId ?? snapshot.selectedId, text: prompt.trim(), startMs: now, endMs: now }); setPrompt(''); await connection.refresh();
  });
  const fullscreen = () => { const element = main.current ?? document.documentElement; void (document.fullscreenElement ? document.exitFullscreen() : element.requestFullscreen()).catch(error => setError(messageOf(error))); };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).matches('input,textarea,select,[contenteditable=true]')) return;
      if (!snapshot || busy || audience) return;
      if (snapshot.mode === 'present' || snapshot.mode === 'practice') {
        if (['ArrowRight', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); void control('next'); }
        if (['ArrowLeft', 'PageUp'].includes(event.key)) { event.preventDefault(); void control('previous'); }
        if (event.key.toLowerCase() === 'b') { event.preventDefault(); void control('blackout', !blackout); }
        if (event.key.toLowerCase() === 'f') { event.preventDefault(); fullscreen(); }
      }
      if (event.key.toLowerCase() === 'p' && voiceModes.has(snapshot.mode)) { event.preventDefault(); void toggleCapture(); }
    };
    addEventListener('keydown', key); return () => removeEventListener('keydown', key);
  });
  if (audience) return <main className="audience-surface" ref={main}>{connection?.session && <Viewer connection={connection} message={publication} blackout={blackout} />}<button className="audience-fullscreen" aria-label="Fullscreen" onClick={fullscreen}><Maximize2 /></button>{network !== 'connected' && <span className="audience-connection">Reconnecting to presentation…</span>}{error && <div className="audience-connection" role="alert">{error}</div>}</main>;
  if (!snapshot || !connection?.session) return <main className="loading-page"><a className="brand" href="/">Talkdeck</a><h1>Opening your project</h1><p>{error || 'Connecting to the canonical deck…'}</p>{error && <Button onClick={() => location.reload()}>Reconnect</Button>}<Button variant="ghost" onClick={onBack}>Back to projects</Button></main>;
  const displayedId = navigation?.slideId ?? snapshot.selectedId;
  const selected = snapshot.slides.find(slide => slide.id === displayedId), position = snapshot.slides.findIndex(slide => slide.id === displayedId);
  const currentSpeech = snapshot.transcripts.filter(item => snapshot.mode === 'talk' ? true : item.epoch === snapshot.epoch);
  const segments = currentSpeech.map(item => ({ id: item.id, slideId: item.slideId, text: item.text, start: Math.max(0, item.atMs / 1000), end: Math.max(0, item.atMs / 1000), inputSource: 'device' as const }));
  const currentIds = new Set(snapshot.transcripts.filter(item => item.epoch === snapshot.epoch).map(item => item.id));
  const isVoice = voiceModes.has(snapshot.mode), liveCapture = capture.phase === 'capturing';
  return <div className="integrated-workspace">
    <header className="workspace-top"><Button variant="ghost" size="icon-sm" aria-label="Back to projects" onClick={() => { void run('close', async () => { await mic.current?.stopAndDrain(); onBack(); }); }}><ArrowLeft /></Button><a className="brand compact" href="/">Talkdeck</a><span className="top-divider" /><strong className="project-name">{snapshot.project.name}</strong><span className={`connection-badge ${network}`}>{network === 'connected' ? <Check /> : <LoaderCircle className="spin" />}{network === 'connected' ? navigation ? 'Syncing selection' : 'Saved' : network === 'connecting' ? 'Connecting' : 'Reconnecting'}</span><small className="usage">{snapshot.usage.calls}/{snapshot.usage.maxCalls} model calls · {(snapshot.usage.inputTokens + snapshot.usage.outputTokens).toLocaleString()} tokens{snapshot.usage.failures ? ` · ${snapshot.usage.failures} failed` : ''}</small><div className="top-actions"><div className="mode-tabs" aria-label="Workspace mode">{(['view', 'talk', 'practice'] as const).map(mode => <Button key={mode} size="sm" variant={snapshot.mode === mode ? 'secondary' : 'ghost'} disabled={!!busy || network !== 'connected'} onClick={() => { void enter(mode); }}>{mode === 'talk' ? <Mic /> : mode === 'practice' ? <Play /> : <Presentation />}{mode.charAt(0).toUpperCase() + mode.slice(1)}</Button>)}{snapshot.mode === 'review' && <Button size="sm" variant="secondary">Review</Button>}{snapshot.mode === 'present' && <Button size="sm" variant="secondary">Presenting</Button>}</div><Button variant="secondary" size="sm" disabled={!!busy || network !== 'connected'} onClick={() => { void enter('present'); }}><Presentation />Present</Button><div className="mode-actions">{(snapshot.mode === 'present' || snapshot.mode === 'practice') && <><Button variant="secondary" size="sm" onClick={() => { window.open(`/?project=${encodeURIComponent(projectId)}&audience=1`, `talkdeck-audience-${projectId}`, 'noopener'); }}><Monitor />Audience view</Button><Button variant="ghost" size="icon-sm" aria-label="Toggle blackout" aria-pressed={blackout} onClick={() => { void control('blackout', !blackout); }}><Square /></Button><Button variant="ghost" size="icon-sm" aria-label="Fullscreen" onClick={fullscreen}><Maximize2 /></Button></>}{snapshot.mode === 'present' && <Button variant="outline" size="sm" onClick={() => { void enter('view'); }}>End presentation</Button>}{snapshot.mode === 'practice' && <Button size="sm" disabled={!!busy} onClick={() => { void finish(); }}>{busy === 'finish' ? 'Finishing…' : 'Finish practice'}</Button>}</div></div></header>
    {(error || snapshot.error) && <div className="error-banner" role="alert"><CircleAlert /><span>{error || snapshot.error}</span><Button variant="ghost" size="sm" onClick={() => setError('')}>Dismiss</Button></div>}
    <div className="workspace-body"><aside className="editor-sidebar"><div className="sidebar-input">{snapshot.mode === 'view' && <select className="input-mode-select" aria-label="Input method" disabled={!!busy} value={inputMode} onChange={event => { const value = event.target.value as typeof inputMode; setInputMode(value); sessionStorage.setItem(`talkdeck-input:${projectId}`, value); }}><option value="audio">Microphone · PCM</option><option value="transcript">Typed transcript</option></select>}</div><nav className="sidebar-tabs" aria-label="Project information">{(['transcript', 'context', 'notes'] as const).map(tab => <button key={tab} aria-current={panel === tab ? 'page' : undefined} onClick={() => setPanel(tab)}>{tab === 'transcript' ? <MessageSquare /> : tab === 'context' ? <FileText /> : <Presentation />}{tab.charAt(0).toUpperCase() + tab.slice(1)}</button>)}</nav>
      {panel === 'transcript' && <><div className="sidebar-heading"><strong>{snapshot.mode === 'practice' ? 'Rehearsal narration' : snapshot.mode === 'present' ? 'Presentation transcript' : 'Your words'}</strong><small>{snapshot.mode === 'practice' ? 'Saved for end-of-practice review' : snapshot.mode === 'present' ? 'Narration does not edit slides' : `Editing slide ${position + 1}`}</small></div><TranscriptView segments={segments} interim="" sessionIds={currentIds} />{snapshot.mode === 'practice' && inputMode === 'audio' && <p className="sidebar-note">Audio is retained while you rehearse. The final transcript is prepared when you finish.</p>}</>}
      {panel === 'context' && <div className="context-panel"><h2>Project context</h2><p className="muted">Give your presentation a clear audience, purpose, and source of truth.</p><label className="field">Brief and instructions<Textarea rows={10} value={context} onChange={event => setContext(event.target.value)} /></label><Button size="sm" disabled={!!busy || context === snapshot.project.context} onClick={() => { void run('context', async () => { await connection.command({ type: 'context', context }); }); }}>Save context</Button><div className="context-files"><h3>Source material</h3><label className="upload-control"><Upload />Add a file<input type="file" aria-label="Upload source material" onChange={event => {
        const file = event.target.files?.[0]; if (!file) return;
        void run('upload', async () => { const form = new FormData(); form.set('file', file); const response = await fetch(`${connection.base}/materials`, { method: 'POST', headers: connection.headers(), body: form }); if (!response.ok) throw new Error((await response.json()).message ?? 'Upload failed'); await connection.refresh(); });
      }} /></label>{snapshot.materials.map(file => <article key={file.id}><FileText /><div><strong>{file.name}</strong><small>{file.status === 'extracted' ? 'Text extracted and supplied as context' : 'Reference only · bytes saved, not interpreted'}</small></div></article>)}</div></div>}
      {panel === 'notes' && <div className="notes-panel"><h2>Presenter notes</h2><p className="muted">Slide {position + 1} · {selected?.title}</p><p className="notes-content">{selected?.notes || 'Notes will appear here as you build your presentation.'}</p></div>}

    </aside><main className="editor-main" ref={main}>
      {snapshot.mode === 'review' && record ? <Review connection={connection} record={record} onRecord={updateRecord} onError={reportError} selectedSlide={snapshot.selectedId} slides={snapshot.slides} /> : <>
        <div className="slide-stage" ref={stageRef}><Viewer connection={connection} message={publication} navigation={navigation} blackout={blackout} onPaint={setPaint} frameRef={frameRef} />{(snapshot.mode === 'view' || snapshot.mode === 'talk') && <Annotations slideId={`${projectId}:${snapshot.selectedId}`} stageRef={stageRef} frameRef={frameRef} />}{!selected?.title && <div className="slide-hint">Start talking to build your first slide</div>}</div>
        <div className="slide-status"><span>Slide {position + 1} of {snapshot.slides.length}{snapshot.mode === 'present' || snapshot.mode === 'practice' ? ` · Build ${navigation?.build ?? snapshot.build}` : ''}</span><span>{paint}</span><div><Button variant="ghost" size="icon-sm" aria-label="Previous slide or build" disabled={!!busy} onClick={() => { void control('previous'); }}><ArrowLeft /></Button><Button variant="ghost" size="icon-sm" aria-label="Next slide or build" disabled={!!busy} onClick={() => { void control('next'); }}><ArrowRight /></Button></div></div>
        <div className="filmstrip" aria-label="Slide navigation">{snapshot.slides.map((slide, index) => <div key={slide.id} className={`slide-thumbnail-item${slide.id === displayedId ? ' selected' : ''}`}><button className="slide-select" aria-current={slide.id === displayedId ? 'true' : undefined} onClick={() => select('select', slide.id)}><div className="thumbnail"><img src={connection.url(slide.thumbnail.startsWith(connection.base) ? slide.thumbnail.slice(connection.base.length) : slide.thumbnail.startsWith('/') ? slide.thumbnail : `/slides/${encodeURIComponent(slide.id)}/image?revision=${snapshot.revision}`)} alt={`Slide ${index + 1}: ${slide.title || 'Untitled'}`} loading="lazy" /><span className="thumbnail-number" aria-hidden="true">{index + 1}</span></div></button>{(snapshot.mode === 'view' || snapshot.mode === 'talk') && <Button className="thumbnail-delete" variant="ghost" size="icon-xs" aria-label={`Delete slide ${index + 1}`} title={snapshot.slides.length <= 1 ? 'Keep at least one slide' : `Delete slide ${index + 1}`} disabled={!!busy || snapshot.slides.length <= 1 || network !== 'connected'} onClick={() => { void deleteSlide(slide.id); }}>{busy === 'delete' ? <LoaderCircle className="spin" /> : <Trash2 />}</Button>}</div>)}{(snapshot.mode === 'view' || snapshot.mode === 'talk') && <Button className="add-slide" variant="ghost" disabled={!!busy} onClick={() => { void control('add'); }}><Plus />Add slide</Button>}</div>
        {isVoice && <section className="voice-panel"><div className="voice-toolbar"><div className="voice-capsule"><Button variant="ghost" size="icon" aria-label={liveCapture ? 'Pause microphone' : 'Start microphone'} onClick={() => { void toggleCapture(); }} disabled={!!busy || network !== 'connected' || inputMode !== 'audio'}>{liveCapture ? <Pause /> : <Mic />}</Button><div className="waveform" aria-label={liveCapture ? 'Listening' : 'Microphone idle'}>{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ height: liveCapture ? 3 + 26 * level * (0.4 + 0.6 * Math.sin((index + 1) * Math.PI / 19) ** 2) : 3 }} />)}</div><span>{inputMode === 'transcript' ? 'Text input' : capture.phase === 'requesting' ? 'Requesting microphone…' : liveCapture ? 'Listening' : capture.phase === 'error' ? 'Microphone unavailable' : 'Microphone paused'}</span><Button variant="ghost" size="icon" aria-label="Mute microphone" disabled={!liveCapture} onClick={() => { void toggleCapture(); }}><MicOff /></Button></div><select aria-label="Input method" value={inputMode} disabled={!!busy || snapshot.mode === 'practice' && record?.status === 'recording'} onChange={event => { const value = event.target.value as typeof inputMode; void run('input-method', async () => { await mic.current?.stopAndDrain(); setInputMode(value); sessionStorage.setItem(`talkdeck-input:${projectId}`, value); setIntent(true); }); }}><option value="audio">Microphone · PCM</option><option value="transcript">Typed transcript</option></select><span className="input-status">{pendingAudio ? `${pendingAudio} audio ${pendingAudio === 1 ? 'chunk' : 'chunks'} awaiting receipt` : liveCapture ? 'Capture active' : 'No pending audio'}</span></div>{capture.message && <p className="capture-error" role="alert">{capture.message}</p>}{pendingAudio > 0 && !liveCapture && <Button variant="secondary" size="sm" onClick={() => { void run('retry-audio', async () => { await mic.current?.retry(); }); }}>Retry retained audio</Button>}
          {snapshot.mode === 'practice' && <Button className="explicit-edit-toggle" size="sm" variant="secondary" aria-pressed={explicitEdit} onClick={() => { setExplicitEdit(value => !value); setPrompt(''); }}>{explicitEdit ? 'Return to rehearsal narration' : 'Request a live slide edit'}</Button>}{(!(snapshot.mode === 'practice' && inputMode === 'audio') || explicitEdit) && <form className="input-composer" onSubmit={event => { event.preventDefault(); void submitText(); }}><Textarea aria-label={explicitEdit && snapshot.mode === 'practice' ? 'Explicit live edit' : snapshot.mode === 'talk' ? 'Slide instructions' : 'Narration'} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={explicitEdit && snapshot.mode === 'practice' ? 'Explicit live edit — this updates the canonical deck…' : snapshot.mode === 'talk' ? 'Or type an instruction for this slide…' : 'Type your current narration…'} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void submitText(); } }} /><Button disabled={!prompt.trim() || !!busy || network !== 'connected'} aria-label="Send transcript"><ArrowRight /></Button></form>}
          <div className="generation-status" role="status"><span>{snapshot.mode === 'practice' ? 'Practice narration is kept separate from slide editing.' : snapshot.mode === 'present' ? 'Only explicit next/back commands navigate. Narration never edits.' : snapshot.generationPaused ? 'Generation paused. Received input is retained.' : snapshot.actors.filter(actor => !['idle', 'ready'].includes(actor.state)).map(actor => `${actor.role}: ${actor.state}`).join(' · ') || 'Ready for your next idea.'}</span>{snapshot.mode === 'practice' && <Button variant="ghost" size="sm" onClick={() => { void cancelPractice(); }}>Cancel practice</Button>}</div>
        </section>}
      </>}
    </main></div>
  </div>;
}
