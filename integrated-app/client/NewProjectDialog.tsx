import { useRef, useState } from 'react';
import { ArrowRight, CircleAlert, LoaderCircle } from 'lucide-react';
import { Button } from '../../frontend/src/components/ui/button';
import { Input } from '../../frontend/src/components/ui/input';
import { Textarea } from '../../frontend/src/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../frontend/src/components/ui/dialog';
import { AssetUploads } from './AssetUploads';
import { createProject, json, uploadMaterial } from './api';
import type { Material, Project, Session } from '../shared/protocol';

export function NewProjectDialog({ open, onClose, onOpen }: { open: boolean; onClose: () => void; onOpen: (id: string) => void }) {
  const [name, setName] = useState(''), [context, setContext] = useState('');
  const [files, setFiles] = useState<File[]>([]), [materials, setMaterials] = useState<Material[]>([]);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [progress, setProgress] = useState('');
  const created = useRef<Project | undefined>(undefined), submitting = useRef(false), opener = useRef<HTMLElement | null>(null);
  const submit = async () => {
    if (submitting.current || !name.trim()) return;
    submitting.current = true; setBusy(true); setError('');
    let session: Session | undefined;
    try {
      setProgress('Creating project…');
      const project = created.current ?? await createProject(name.trim(), context);
      created.current = project;
      const base = `/api/projects/${encodeURIComponent(project.id)}`;
      if (files.length) {
        setProgress('Preparing uploads…');
        session = await json<Session>(`${base}/sessions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'editor' }) });
        for (const [index, file] of files.entries()) {
          setProgress(`Uploading ${index + 1} of ${files.length}: ${file.name}`);
          const material = await uploadMaterial(project.id, session, file);
          setMaterials(current => [...current, material]);
          setFiles(current => current.filter(item => item !== file));
        }
      }
      onOpen(project.id);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (session && created.current) void fetch(`/api/projects/${encodeURIComponent(created.current.id)}/sessions/${session.id}`, {
        method: 'DELETE', headers: { 'X-Session-Id': session.id, 'X-Session-Token': session.token }, keepalive: true,
      }).catch(() => {});
      submitting.current = false; setBusy(false); setProgress('');
    }
  };
  return <Dialog open={open} onOpenChange={value => { if (!value && !busy) onClose(); }}>
    <DialogContent className="new-project-dialog" showCloseButton={!busy}
      onOpenAutoFocus={() => { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }}
      onCloseAutoFocus={event => { if (opener.current?.isConnected) { event.preventDefault(); opener.current.focus(); } }}>
      <DialogTitle>New project</DialogTitle>
      <DialogDescription>Add the context and assets for your presentation, then start talking.</DialogDescription>
      <form className="new-project-form" aria-busy={busy} onSubmit={event => { event.preventDefault(); void submit(); }}>
        {error && <div className="error-banner" role="alert"><CircleAlert /><span>{error} {created.current ? 'Your project and uploaded assets are saved. Retry to upload the remaining files.' : ''}</span></div>}
        <fieldset disabled={busy || !!created.current}>
          <label className="field">Project name<Input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder="What are you presenting?" required maxLength={120} /></label>
          <label className="field">Context<Textarea value={context} onChange={event => setContext(event.target.value)} placeholder="Audience, purpose, key facts, and the style you have in mind…" rows={4} maxLength={100000} /></label>
        </fieldset>
        <div className="new-project-assets"><h3>Assets <span className="muted">Optional</span></h3><AssetUploads files={files} materials={materials} disabled={busy} onFiles={selected => setFiles(current => [...current, ...selected])} onRemove={index => setFiles(current => current.filter((_, i) => i !== index))} /></div>
        {busy && <p className="upload-progress" role="status"><LoaderCircle className="spin" />{progress}</p>}
        <div className="form-actions"><Button type="button" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button><Button disabled={busy || !name.trim()}>{busy ? 'Creating…' : created.current ? 'Continue to project' : 'Create project'}<ArrowRight /></Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
