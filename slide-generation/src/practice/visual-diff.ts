import { createHash } from 'node:crypto';
import type { Rect } from '../browser/types.js';
import type { ReviewCapture, ReviewToken } from '../browser/review-capture.js';

export const DIFF_ALGORITHM_VERSION = 'stable-parts-lcs-1';
/** Design-coordinate tolerance, not scaled browser pixels. Geometry is rounded to 0.01px at capture. */
export const GEOMETRY_TOLERANCE = 0.5;
export type ChangeKind = 'insert'|'delete'|'text'|'move'|'resize'|'style'|'asset'|'build'|'notes'|'order'|'slide-added'|'slide-deleted'|'dependency';
export interface VisualChange {
  id: string; kind: ChangeKind; nodeId: string; authoredId?: string; label: string;
  before: Rect[]; after: Rect[]; properties?: string[]; beforeText?: string; afterText?: string;
  precision: 'text'|'element'|'metadata';
}
export interface VisualDiff {
  proposalVersion: number; algorithmVersion: string; canvas: {width:number;height:number};
  beforeDigest: string|null; afterDigest: string|null;
  beforeSourceDigest: string|null; afterSourceDigest: string|null;
  beforeIndex: number; afterIndex: number;
  changes: VisualChange[];
}
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const same = (a: unknown,b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const boxes = (t: ReviewToken[]) => t.filter(t=>t.text.trim()).flatMap(t=>t.rects);
/** Stable sequence alignment; repeated words are matched in sequence, never by a text-key map. */
export function textDifferences(before: ReviewToken[], after: ReviewToken[]): {before:ReviewToken[];after:ReviewToken[]}[] {
  if (before.length * after.length > 1_000_000) return [{before,after}];
  const width = after.length + 1, grid = new Uint32Array((before.length+1)*width);
  for(let i=before.length-1;i>=0;i--) for(let j=after.length-1;j>=0;j--)
    grid[i*width+j] = before[i].text === after[j].text ? 1+grid[(i+1)*width+j+1] : Math.max(grid[(i+1)*width+j],grid[i*width+j+1]);
  const result:{before:ReviewToken[];after:ReviewToken[]}[]=[];
  let i=0,j=0,chunk:{before:ReviewToken[];after:ReviewToken[]}|undefined;
  const flush=()=>{if(chunk){result.push(chunk);chunk=undefined;}};
  while(i<before.length || j<after.length){
    if(i<before.length && j<after.length && before[i].text===after[j].text){flush();i++;j++;continue;}
    chunk??={before:[],after:[]};
    if(i<before.length && (j===after.length || grid[(i+1)*width+j]>=grid[i*width+j+1])) chunk.before.push(before[i++]);
    else chunk.after.push(after[j++]);
  }
  flush();return result;
}
export function createVisualDiff(args: {
  slideId:string; version:number; before:ReviewCapture|null; after:ReviewCapture|null;
  beforeNotes:string; afterNotes:string; beforeIndex:number; afterIndex:number;
}): VisualDiff {
  const {before,after,slideId}=args;
  const changes:VisualChange[]=[];
  const add=(v:Omit<VisualChange,'id'>)=>changes.push({...v,id:`change-${hash([slideId,v]).slice(0,16)}`});
  const metadata=(kind:ChangeKind,label:string,beforeText?:string,afterText?:string)=>add({kind,nodeId:slideId,label,before:[],after:[],beforeText,afterText,precision:'metadata'});
  if(!before || !after){
    add({kind:before?'slide-deleted':'slide-added',nodeId:slideId,label:before?'Slide removed':'Slide added',
      before:before?[{x:0,y:0,width:1920,height:1080}]:[],after:after?[{x:0,y:0,width:1920,height:1080}]:[],precision:'element'});
  } else {
    const oldNodes=new Map(before.geometry.nodes.map(n=>[n.id,n])), newNodes=new Map(after.geometry.nodes.map(n=>[n.id,n]));
    for(const id of [...new Set([...oldNodes.keys(),...newNodes.keys()])].sort()){
      const a=oldNodes.get(id), b=newNodes.get(id);
      if(!a || !b){
        // Report the highest inserted/deleted container; descendants are covered by its region.
        const n=(a??b)!, side=a?oldNodes:newNodes, other=a?newNodes:oldNodes;
        if(n.parentId && side.has(n.parentId) && !other.has(n.parentId)) continue;
        add({kind:a?'delete':'insert',nodeId:id,authoredId:n.authoredId,label:`${a?'Removed':'Added'} ${n.primitive}`,before:a?[a.rect]:[],after:b?[b.rect]:[],precision:'element'});continue;
      }
      const base={nodeId:id,authoredId:a.authoredId,before:[a.rect],after:[b.rect],precision:'element' as const};
      if(a.parentId!==b.parentId || Math.abs(a.rect.x-b.rect.x)>GEOMETRY_TOLERANCE || Math.abs(a.rect.y-b.rect.y)>GEOMETRY_TOLERANCE)
        add({...base,kind:'move',label:a.parentId!==b.parentId?'Reparented':'Moved / reflowed',properties:a.parentId!==b.parentId?['parent']:['position']});
      if(Math.abs(a.rect.width-b.rect.width)>GEOMETRY_TOLERANCE || Math.abs(a.rect.height-b.rect.height)>GEOMETRY_TOLERANCE)
        add({...base,kind:'resize',label:'Resized / reflowed',properties:['dimensions']});
      const properties=Object.keys(a.style).filter(k=>a.style[k]!==b.style[k]);
      if(properties.length) add({...base,kind:'style',label:`Changed ${properties.join(', ')}`,properties});
      const visual=Object.keys(a.visual).filter(k=>a.visual[k]!==b.visual[k]);
      if(visual.length) add({...base,kind:'asset',label:'Changed icon / asset / decoration',properties:visual});
      if(a.build!==b.build) add({...base,kind:'build',label:`Reveal ${a.build} → ${b.build}; static preview shows all builds`,beforeText:String(a.build),afterText:String(b.build),properties:['build']});
    }
    const oldParts=new Map(before.geometry.parts.map(p=>[p.key,p])), newParts=new Map(after.geometry.parts.map(p=>[p.key,p]));
    for(const key of [...new Set([...oldParts.keys(),...newParts.keys()])].sort()){
      const a=oldParts.get(key),b=newParts.get(key),nodeId=(a??b)!.nodeId;
      if(!oldNodes.has(nodeId)||!newNodes.has(nodeId)) continue;
      if(a?.text!==b?.text){
        for(const difference of textDifferences(a?.tokens??[],b?.tokens??[])){
          const beforeText=difference.before.map(t=>t.text).join(''),afterText=difference.after.map(t=>t.text).join('');
          const oldBoxes=boxes(difference.before),newBoxes=boxes(difference.after);
          const precise=(!beforeText.trim() || oldBoxes.length>0) && (!afterText.trim() || newBoxes.length>0);
          add({kind:beforeText&&afterText?'text':beforeText?'delete':'insert',nodeId,authoredId:oldNodes.get(nodeId)!.authoredId,
            label:precise?'Changed text':'Changed text (whole element; fine ranges unavailable)',beforeText,afterText,
            before:precise?oldBoxes:[oldNodes.get(nodeId)!.rect],after:precise?newBoxes:[newNodes.get(nodeId)!.rect],precision:precise?'text':'element'});
        }
      } else if(a&&b&&!same(a.tokens.map(t=>t.styles),b.tokens.map(t=>t.styles))){
        add({kind:'style',nodeId,authoredId:oldNodes.get(nodeId)!.authoredId,label:'Changed text formatting',before:boxes(a.tokens),after:boxes(b.tokens),properties:['inline formatting'],precision:'text'});
      }
    }
    if(!same(before.dependencies,after.dependencies)) metadata('dependency','Changed render dependencies; previews include refreshed bytes');
    if(before.renderDigest!==after.renderDigest && !changes.length && args.beforeNotes===args.afterNotes && args.beforeIndex===args.afterIndex)
      add({kind:'style',nodeId:slideId,label:'Changed rendered slide (whole-slide comparison)',before:[{x:0,y:0,width:1920,height:1080}],after:[{x:0,y:0,width:1920,height:1080}],precision:'element'});
  }
  if(args.beforeNotes!==args.afterNotes)metadata('notes','Speaker notes changed; compare notes separately',args.beforeNotes,args.afterNotes);
  if(before&&after&&args.beforeIndex!==args.afterIndex)metadata('order',`Slide position ${args.beforeIndex+1} → ${args.afterIndex+1}`,String(args.beforeIndex+1),String(args.afterIndex+1));
  return {proposalVersion:args.version,algorithmVersion:DIFF_ALGORITHM_VERSION,canvas:{width:1920,height:1080},
    beforeDigest:before?.renderDigest??null,afterDigest:after?.renderDigest??null,
    beforeSourceDigest:before?.sourceDigest??null,afterSourceDigest:after?.sourceDigest??null,
    beforeIndex:args.beforeIndex,afterIndex:args.afterIndex,changes};
}
