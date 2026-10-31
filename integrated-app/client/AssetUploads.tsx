import { useRef, useState } from 'react';
import { FileText, Image as ImageIcon, Upload, X } from 'lucide-react';
import { Button } from '../../frontend/src/components/ui/button';
import type { Material } from '../shared/protocol';

export function AssetUploads({ files = [], materials = [], disabled, onFiles, onRemove, imageUrl }: {
  files?: File[]; materials?: Material[]; disabled?: boolean;
  onFiles: (files: File[]) => void; onRemove?: (index: number) => void;
  imageUrl?: (material: Material) => string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false), [error, setError] = useState('');
  const add = (selected: File[]) => {
    if (disabled) return;
    const oversized = selected.filter(file => file.size > 15 * 1024 * 1024);
    setError(oversized.length ? `Keep each file under 15 MB: ${oversized.map(file => file.name).join(', ')}` : '');
    const accepted = selected.filter(file => file.size <= 15 * 1024 * 1024);
    if (accepted.length) onFiles(accepted);
  };
  const size = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return <section className="asset-uploads" aria-label="Project assets">
    <div className={`asset-drop${dragging ? ' dragging' : ''}`} aria-disabled={disabled}
      onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); add(Array.from(event.dataTransfer.files)); }}>
      <Upload /><strong>Drop assets here</strong><span>Documents, images, spreadsheets, and more · up to 15 MB each</span>
      <input ref={input} type="file" multiple hidden disabled={disabled} aria-label="Upload assets"
        onChange={event => { add(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={() => input.current?.click()}>Choose files</Button>
    </div>
    {error && <p className="asset-error" role="alert">{error}</p>}
    {(files.length > 0 || materials.length > 0) && <ul className="asset-list">
      {materials.map(material => <li key={material.id}>{material.asset ? imageUrl ? <img className="asset-preview" src={imageUrl(material)} alt={material.name} loading="lazy" /> : <ImageIcon /> : <FileText />}<div><strong>{material.name}</strong><small>{size(material.bytes)} · {material.status === 'image-ready' ? 'Available in slides' : material.status === 'extracted' ? 'Text available as context' : 'Saved as a reference file'}</small>{material.imageError && <small className="asset-error">{material.imageError}</small>}</div></li>)}
      {files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}><FileText /><div><strong>{file.name}</strong><small>{size(file.size)} · Ready to upload</small></div>{onRemove && <Button type="button" variant="ghost" size="icon-xs" disabled={disabled} aria-label={`Remove ${file.name}`} onClick={() => onRemove(index)}><X /></Button>}</li>)}
    </ul>}
  </section>;
}
