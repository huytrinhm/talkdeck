import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDeck } from '../src/bootstrap.js';
import { allocateIds } from '../src/source/candidate.js';
import { HonoSlideRenderer } from '../src/render/renderer.js';
import { LUCIDE_COUNT, LUCIDE_VERSION, readIcon, searchIcons } from '../src/render/icons.js';
import { apcaContrast, parseHex } from '../src/render/contrast.js';
import { normalizeTypography, paletteReport, resolveTheme } from '../src/render/theme.js';
import { MemoryAssetResolver, resolveImage, resolveFonts } from '../src/render/assets.js';
import { parseSource, nodeById } from '../src/parser.js';
const source = (content: string) => allocateIds(createDeck().source.replace('<SpeakerNotes id="n12" />', `<SpeakerNotes id="n12">PRIVATE NOTES</SpeakerNotes>${content}`)).source;

test('APCA exact pinned upstream reference vectors retain polarity', () => {
  const vectors: [string,string,number][] = [
    ['#888','#fff',63.056469930209424], ['#fff','#888',-68.54146436644962],
    ['#000','#aaa',58.146262578561334], ['#aaa','#000',-56.24113336839742],
    ['#123','#def',91.66830811481631], ['#def','#123',-93.06770049484275],
    ['#123','#444',8.32326136957393], ['#444','#123',-7.526878460278154],
  ];
  for (const [fg,bg,lc] of vectors) assert.ok(Math.abs(apcaContrast(parseHex(fg),parseHex(bg))-lc)<1e-10);
  assert.throws(()=>apcaContrast([NaN,0,0],[0,0,0]));
});
test('all pinned catalog icons reachable once; aliases search canonical identities; cursors scoped', () => {
  const names:string[]=[]; let cursor:string|undefined;
  do { const page=searchIcons('',cursor,100); names.push(...page.icons.map(i=>i.name));cursor=page.cursor; } while(cursor);
  assert.equal(names.length,LUCIDE_COUNT);assert.equal(new Set(names).size,1877);
  assert.equal(searchIcons('activity-square').icons[0].name,'square-activity');
  assert.throws(()=>searchIcons('other',searchIcons('',undefined,1).cursor),/Cursor/);
  assert.throws(()=>readIcon('arrow-right','latest'),/catalogVersion/);
  assert.throws(()=>readIcon('imaginary',LUCIDE_VERSION),/Unknown/);
  const icon=readIcon('arrow-right',LUCIDE_VERSION);
  assert.match(icon.svg,/stroke="currentColor"/);assert.match(icon.svg,/stroke-width="2"/);assert.equal(icon.node.length,2);
});
test('theme derived fills meet body contrast; explicit palette values stay untouched', () => {
  const original=createDeck().source, theme=resolveTheme(original);
  assert.equal(theme.colors.accent,'#0f766e');
  for(const surface of paletteReport(original).surfaces.filter(p=>theme.derived.includes(p.fill)))assert.ok(surface.bodyReadable);
  const explicit=original.replace('<Scale','<Token name="--color-bg-alt" value="#123456" /><Token name="--color-bg-alt-fg" value="#abcdef" /><Scale');
  assert.equal(resolveTheme(explicit).colors['bg-alt'],'#123456');
});
test('typography normalizes cumulative transforms and is idempotent without changing words', () => {
  const original=source('<Bullets transform={{scale:0.6}}><Text id="t80" transform={{scale:0.6}}>  Exact words.  </Text></Bullets>');
  const normalized=normalizeTypography(original), theme=resolveTheme(normalized);
  assert.ok(theme.text.lead*.36>=36); assert.equal(normalizeTypography(normalized),normalized);
  assert.equal(nodeById(parseSource(normalized),'t80').children[0],'  Exact words.  ');
});
test('Hono renders every visual primitive, escaped inline text, real compiled CSS, and private metadata excluded', async () => {
  const renderer=new HonoSlideRenderer();
  const content=`<Text role="title">Title &lt;script&gt;bad&lt;/script&gt;</Text><Row><Panel><Text>**Bold** *Italic* \u0060Code\u0060</Text></Panel><Band><Stat value="42%" label="exact label" /></Band></Row><Grid cols={2}><Quote by="Mara">Exact quote.</Quote><Bullets><Text>A</Text><Text>B</Text></Bullets></Grid><Split><Center><Badge>Ready</Badge></Center><Stack><Icon name="arrow-right" catalogVersion="${LUCIDE_VERSION}" alt="Next" /><Rule/></Stack></Split><Spacer/><Shape kind="ring"/><Pending kind="image"/>`;
  const artifact=await renderer.render(source(content),'n10');
  assert.match(artifact.html,/&lt;script&gt;/); assert.doesNotMatch(artifact.html,/<script>|PRIVATE NOTES|SpeakerNotes|Transcript/);
  assert.match(artifact.html,/<strong>Bold<\/strong>/); assert.match(artifact.html,/<em>Italic<\/em>/);
  assert.match(artifact.html,/<svg[^>]*stroke="currentColor"/); assert.match(artifact.html,/data-stat-value="42%"/);
  assert.match(artifact.css,/@font-face/); assert.match(artifact.css,/data:font\/ttf;base64,/);
  assert.equal(artifact.fonts.length,2); assert.ok(artifact.dependencies.some(d=>d.kind==='catalog'));
  const again=await renderer.render(source(content),'n10');assert.deepEqual(again,artifact);
  again.dependencies.length=0;assert.ok((await renderer.render(source(content),'n10')).dependencies.length>0);
});
test('definition utilities compile and theme/asset bytes participate in artifact identity', async () => {
  const initial=createDeck().source.replace('<Library id="n9" />','<Library id="n9"><Component name="Card" description="Card"><Panel class="p-xl gap-lg"><Slot name="body" kind="text" /></Panel></Component></Library>');
  const doc=allocateIds(initial.replace('<SpeakerNotes id="n12" />','<SpeakerNotes id="n12" /><Card><Slot name="body"><Text>Words</Text></Slot></Card>')).source;
  const renderer=new HonoSlideRenderer(), artifact=await renderer.render(doc,'n10');
  assert.match(artifact.css,/\.p-xl/); assert.match(artifact.css,/\.gap-lg/);
  const changed=await renderer.render(doc.replace('#0f766e','#993300'),'n10'); assert.notEqual(changed.artifactKey,artifact.artifactKey);
});
test('exact asset versions, SVG safety, bundled font glyph coverage and custom font bytes', async () => {
  const resolver=new MemoryAssetResolver(),ref={id:'image',version:'1'};
  resolver.add({reference:ref,mediaType:'image/svg+xml',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0L24 24"/></svg>')});
  assert.match((await resolveImage(ref,resolver)).url,/data:image\/svg\+xml;base64,/);
  await assert.rejects(resolveImage({...ref,version:'2'},resolver),/Missing asset/);
  assert.throws(()=>resolver.add({reference:ref,mediaType:'image/svg+xml',bytes:Buffer.from('changed')}),/cannot change/);
  resolver.add({reference:{id:'evil',version:'1'},mediaType:'image/svg+xml',bytes:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')});
  await assert.rejects(resolveImage({id:'evil',version:'1'},resolver),/Unsupported SVG/);
  await assert.rejects(new HonoSlideRenderer().render(source('<Text>😀</Text>'),'n10'),/lacks U\+1F600/);
  const bytes=await readFile('assets/fonts/NotoSans-Regular.ttf');resolver.add({reference:{id:'font',version:'1'},mediaType:'font/ttf',bytes});
  const font=await resolveFonts({id:'font',version:'1'},resolver);assert.match(font.family,/Talkdeck Custom/);assert.equal(font.dependencies[0].version,'1');
});

test('frame numbers follow current deck order, reserve labels, and stay out when disabled', async () => {
  const initial=createDeck().source.replace('  </Theme>','    <Frame labels={{left:"Workshop",right:"Review",footer:"Exact footer"}} page={true} rule={true}/>\n  </Theme>')
    .replace('<Archive id="n13" />','<Slide id="n80" freeForm={{reason:"Second"}}><Transcript/><SpeakerNotes/><Text>Second</Text></Slide><Archive id="n13"/>');
  const renderer=new HonoSlideRenderer(),doc=allocateIds(initial).source;
  const second=await renderer.render(doc,'n80');
  assert.match(second.html,/Workshop/);assert.match(second.html,/Exact footer/);assert.match(second.html,/data-node="@frame:n80:[^"]+:page"[^>]*>2<\/span>/);
  const disabled=doc.replace('<Slide id="n80"','<Slide frame={false} id="n80"');assert.doesNotMatch((await renderer.render(disabled,'n80')).html,/td-frame/);
  assert.throws(()=>new HonoSlideRenderer({cacheSize:-1}),/cacheSize/);
});

test('renderer detects provider byte changes under an unchanged asset version', async () => {
  let value='red';
  const resolver={async resolve(reference:{id:string;version:string}) {return {reference,mediaType:'image/svg+xml',bytes:Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" fill="${value}"/></svg>`)};}};
  const renderer=new HonoSlideRenderer({assets:resolver}),doc=source('<Image asset={{id:"figure",version:"1"}} alt="Figure"/>');
  assert.match((await renderer.render(doc,'n10')).html,/object|td-image/);
  value='blue';await assert.rejects(renderer.render(doc,'n10'),/changed bytes/);
});
