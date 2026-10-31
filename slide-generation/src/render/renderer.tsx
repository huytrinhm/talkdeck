import { RENDER_PIPELINE_DIGEST } from './pipeline.js';
import { jsx, type Child, type JSXNode } from 'hono/jsx';
import { compile } from 'tailwindcss';
import { SourceError, type AssetReference, type AssetResolver, type Literal } from '../contracts.js';
import { expandSource, type ExpandedNode } from '../expansion.js';
import { readIcon, LUCIDE_DIGEST, LUCIDE_VERSION } from './icons.js';
import { APCA_VERSION, parseHex } from './contrast.js';
import { color, foreground, normalizeTypography, resolveTheme, textRole, TEXT_FLOORS, type Theme } from './theme.js';
import { digest, resolveFonts, resolveImage, verifyGlyphs } from './assets.js';
import type { RenderArtifact, RenderDependency } from './types.js';

export const RENDERER_VERSION = 'hono-slide-renderer-1';
export const COMPILER_VERSION = 'tailwindcss-4.3.3';
const BASE_CSS = `
*{box-sizing:border-box}html,body{margin:0;padding:0;width:1920px;height:1080px;background:transparent}
.td-slide{position:relative;isolation:isolate;width:1920px;height:1080px;overflow:hidden;display:flex;flex-direction:column;line-height:1.25;font-synthesis:weight style}
.td-slide>:not(.td-shape):not(.td-frame){z-index:1}.td-node{position:relative;min-width:0;min-height:0;flex-shrink:0}
.td-stack,.td-panel,.td-band{display:flex;flex-direction:column}.td-stack,.td-row,.td-grid,.td-split,.td-center{gap:var(--td-space-md)}.td-panel,.td-band{padding:var(--td-space-md);gap:var(--td-space-sm)}.td-panel{border-radius:var(--td-radius-md)}.td-row{display:flex;flex-direction:row}.td-grid,.td-split{display:grid}.td-center{display:flex;flex:1;flex-direction:column;align-items:center;justify-content:center}
.td-text{margin:0;white-space:pre-wrap;overflow-wrap:normal}.td-stat{display:flex;flex-direction:column}.td-stat-value{display:block;white-space:nowrap;font-variant-numeric:tabular-nums;line-height:normal}.td-secondary{display:block}
.td-bullets{display:flex;flex-direction:column;margin:0;padding:0;list-style:none}.td-bullet{display:flex;align-items:baseline;gap:.55em;min-width:0}.td-bullet-marker{flex:none;min-width:.6em}.td-bullet>.td-text{flex:1}
.td-quote{margin:0;display:flex;flex-direction:column}.td-quote-body{margin:0;white-space:pre-wrap}.td-badge{align-self:flex-start;display:inline-block;white-space:pre-wrap}
.td-image{display:flex;flex:1 1 0;min-width:0;min-height:160px;align-self:stretch}.td-image img{display:block;width:100%;height:100%;min-width:0;min-height:0;object-fit:contain}
.td-icon{display:block;width:1em;height:1em;flex:none;overflow:visible}.td-rule{flex:none}.td-shape{position:absolute;z-index:0;pointer-events:none}.td-frame{position:absolute;z-index:2;display:flex;justify-content:space-between;align-items:center;left:96px;right:96px;line-height:1.2}
.td-pending{min-height:64px;border:2px dashed currentColor;padding:20px;background:linear-gradient(100deg,transparent,rgba(127,127,127,.15),transparent)}
.td-index{display:inline-flex;align-items:center;justify-content:center;flex:none;font-variant-numeric:tabular-nums}
strong{font-weight:700}em{font-style:italic}code{font:inherit;letter-spacing:0;background:rgba(127,127,127,.12);border-radius:.12em;padding:0 .12em}
`;
type Styles = Record<string, string | number | undefined>;
const styleString = (styles: Styles) => Object.entries(styles).filter(([,value]) => value !== undefined).map(([key,value]) => `${key}:${value}`).join(';');
const children = (node: ExpandedNode) => node.children.filter((c): c is ExpandedNode => typeof c !== 'string');
function text(node: ExpandedNode): string { return node.children.map(c => typeof c === 'string' ? c : text(c)).join(''); }
function inline(value: string): Child[] {
  const parts: Child[] = [], pattern = /\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`/g;
  let index = 0;
  for (const match of value.matchAll(pattern)) {
    parts.push(value.slice(index, match.index));
    parts.push(jsx(match[1] ? 'strong' : match[2] ? 'em' : 'code', null, match[1] ?? match[2] ?? match[3]));
    index = match.index! + match[0].length;
  }
  parts.push(value.slice(index)); return parts;
}
function secondaryColor(hex: string) { const rgb = parseHex(hex); return `rgba(${rgb.join(',')},0.75)`; }
const alignMap: Record<string, string> = { start: 'flex-start', end: 'flex-end', center: 'center', stretch: 'stretch' };
const justifyMap: Record<string, string> = { start: 'flex-start', end: 'flex-end', center: 'center', between: 'space-between', around: 'space-around', evenly: 'space-evenly' };
interface Context { theme: Theme; foreground: string; fill: string; inCard: boolean; scale: number; listRole?: string; page: number; fontFamily: string }
export interface RendererOptions { assets?: AssetResolver; cacheSize?: number }

export class HonoSlideRenderer {
  private readonly pinnedDependencies = new Map<string,string>();
  private readonly cache = new Map<string, RenderArtifact>();
  constructor(private readonly options: RendererOptions = {}) {
    if (options.cacheSize !== undefined && (!Number.isInteger(options.cacheSize) || options.cacheSize < 0 || options.cacheSize > 128)) throw new Error('Render cacheSize must be an integer 0–128');
  }
  async normalize(source: string) { return normalizeTypography(source); }
  async render(input: string, slideId: string): Promise<RenderArtifact> {
    const source = await this.normalize(input), expanded = expandSource(source, { resolveIcon: readIcon });
    const slide = expanded.slides.find(s => s.id === slideId);
    if (!slide) throw new SourceError('missing_node', `Slide ${slideId} does not exist`, slideId);
    const theme = resolveTheme(source), fonts = await resolveFonts(theme.font, this.options.assets);
    for (const [name,value] of Object.entries(theme.tokens)) if (name.startsWith('--font-') && !name.startsWith('--font-weight-')) {
      if (!['bundled-default',fonts.family,...fonts.faces.map(f=>f.font.familyName)].includes(value))
        throw new SourceError('font_reference', `${name} must name the resolved font; select custom font bytes through Theme.font with an explicit version`);
    }
    const weightFor = (role: string) => Number(theme.tokens[`--font-weight-${role}`] ?? (['title','heading','display','numeral','stat','hero'].includes(role) ? 700 : 400));
    const trackingFor = (role: string) => theme.tokens[`--tracking-${role}`] ?? (role === 'display' ? '-0.02em' : undefined);
    const radius = (step: string) => {
      const value = theme.tokens[`--radius-${step}`] ?? (step === 'lg' ? '32px' : '16px');
      if (!/^(?:0|\d+(?:\.\d+)?(?:px|rem|em|%))$/.test(value)) throw new SourceError('theme_token', `Invalid radius token ${step}`);
      return value;
    };
    const dependencies: RenderDependency[] = [
      { kind: 'renderer', id: 'hono-slide-renderer', version: RENDERER_VERSION, sha256: RENDER_PIPELINE_DIGEST },
      { kind: 'compiler', id: 'tailwindcss', version: COMPILER_VERSION, sha256: digest(COMPILER_VERSION) },
      { kind: 'contrast', id: 'apca-w3', version: APCA_VERSION, sha256: digest(APCA_VERSION) },
      ...fonts.dependencies,
      { kind: 'catalog', id: 'lucide', version: LUCIDE_VERSION, sha256: LUCIDE_DIGEST },
    ];
    const imageUrls = new Map<string, string>();
    const visit = async (node: ExpandedNode): Promise<void> => {
      if (node.tag === 'Image') {
        const resolved = await resolveImage(node.props.asset as unknown as AssetReference, this.options.assets);
        imageUrls.set(node.id, resolved.url); dependencies.push(resolved.dependency);
      }
      await Promise.all(children(node).map(visit));
    };
    await visit(slide);
    dependencies.sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    for (const dependency of dependencies) {
      const identity=JSON.stringify([dependency.kind,dependency.id,dependency.version]), prior=this.pinnedDependencies.get(identity);
      if (prior && prior!==dependency.sha256) throw new SourceError('asset_immutable', `Resolved ${dependency.id}@${dependency.version} changed bytes`);
      this.pinnedDependencies.set(identity,dependency.sha256);
    }
    const artifactKey = digest(JSON.stringify([source, slideId, dependencies]));
    const existing = this.cache.get(artifactKey);
    if (existing) return structuredClone(existing);
    const glyphText: string[] = [];
    const roleProps = (role: string, ctx: Context) => ({ 'data-role': role, 'data-font-floor': role === 'display' ? Math.max(144, 1.5 * theme.text.title) : TEXT_FLOORS[role],
      style: styleString({ 'font-size': `${theme.text[role]}px`, 'font-weight': weightFor(role),
        'letter-spacing': trackingFor(role) }) });
    const render = (node: ExpandedNode, parent: Context): JSXNode => {
      const props = node.props, ctx = { ...parent }, styles: Styles = {};
      const transform = props.transform as { scale?: number; translate?: [number,number] } | undefined;
      ctx.scale *= transform?.scale ?? 1;
      if (transform?.scale) styles.zoom = transform.scale;
      if (transform?.translate) styles.transform = `translate(${transform.translate[0]*100}%,${transform.translate[1]*100}%)`;
      if (props.color) ctx.foreground = color(theme, String(props.color), node.origin.authoredId);
      const surface = ['Slide', 'Panel', 'Band', 'Badge'].includes(node.tag);
      const filled = surface && !(node.tag === 'Panel' && ['outline','ghost'].includes(String(props.variant)));
      if (surface) {
        const fill = String(props.fill ?? (node.tag === 'Slide' ? 'bg' : node.tag === 'Badge' ? 'accent' : 'bg-alt'));
        if (filled) { ctx.fill = fill; ctx.foreground = props.color ? color(theme, String(props.color), node.origin.authoredId) : foreground(theme, fill, node.origin.authoredId); styles['background-color'] = color(theme, fill, node.origin.authoredId); }
        else if (node.tag === 'Panel' && props.variant === 'outline') styles.border = `2px solid ${color(theme, fill, node.origin.authoredId)}`;
      }
      if (filled || props.color) styles.color = ctx.foreground;
      if (props.gap) styles.gap = `${theme.space[String(props.gap)]}px`;
      if (props.align && !['Text','Stat'].includes(node.tag)) styles['align-items'] = alignMap[String(props.align)];
      if (props.justify) styles['justify-content'] = justifyMap[String(props.justify)];
      if (props.grow) { styles.flex = '1 1 0'; styles['flex-shrink'] = 1; }
      const common: Record<string, unknown> = { 'data-node': node.id, 'data-primitive': node.tag, 'data-authored-node': node.origin.authoredId,
        'data-component': node.origin.instanceId, 'data-definition-node': node.origin.definitionId, 'data-item-node': node.origin.itemId, 'data-build': Number(props.build ?? 0), class: `td-node td-${node.tag.toLowerCase()}${props.class ? ` ${props.class}` : ''}` };
      const finish = (tag: string, contents: Child[] = [], extra: Record<string,unknown> = {}) => jsx(tag, { ...common, ...extra, style: styleString(styles) }, ...contents);
      const role = textRole(node, parent.inCard, parent.listRole);
      if (role && node.tag !== 'Bullets') {
        styles['font-size'] = `${theme.text[role]}px`;
        styles['font-weight'] = weightFor(role);
        styles['letter-spacing'] = trackingFor(role);
      }
      const native = (value: string) => { glyphText.push(value); return inline(value); };
      const renderChildren = (childCtx = ctx) => children(node).map(child => render(child, childCtx));
      switch (node.tag) {
        case 'Slide': {
          const pad = theme.space[String(props.pad ?? 'xl')], framed = props.frame !== false && !!theme.frame;
          styles.padding = `${pad + (framed ? 32 : 0)}px ${pad}px ${pad + (framed ? 24 : 0)}px`;
          styles.gap ??= `${theme.space.md}px`;
          for (const [key,value] of Object.entries(theme.space)) styles[`--td-space-${key}`] = `${value}px`;
          styles['--td-radius-md'] = radius('md');
          styles['font-family'] = `"${fonts.family}"`; styles['font-size'] = `${theme.text.body}px`;
          const content: Child[] = renderChildren();
          if (framed) {
            const labels = theme.frame!.props.labels as Record<string,string> | undefined ?? {};
            const base = `@frame:${node.id}:${theme.frame!.id}`;
            const label = (side: string, value: string) => { glyphText.push(value); return jsx('span', { 'data-node': `${base}:${side}`, 'data-authored-node': theme.frame!.id, 'data-content': 'true', 'data-content-part': side, ...roleProps('label', ctx) }, value); };
            content.push(jsx('div', { class: 'td-frame', style: `top:40px;color:${ctx.foreground};${theme.frame!.props.rule ? `padding-bottom:16px;border-bottom:2px solid ${color(theme,'accent')}` : ''}` }, label('left', labels.left ?? ''), label('right', labels.right ?? '')));
            content.push(jsx('div', { class: 'td-frame', style: `bottom:36px;color:${ctx.foreground}` }, label('footer', labels.footer ?? ''), theme.frame!.props.page ? label('page', String(ctx.page)) : null));
          }
          return finish('main', content, { 'data-slide-canvas': 'true', 'data-display-floor': Math.max(144,1.5*theme.text.title), 'data-surface': ctx.fill });
        }
        case 'Stack': case 'Row': case 'Center': {
          if (node.tag === 'Row') { styles['flex-wrap'] = props.wrap ? 'wrap' : 'nowrap'; styles['align-items'] ??= 'stretch'; }
          return finish('div', renderChildren());
        }
        case 'Grid': styles['grid-template-columns'] = `repeat(${props.cols},minmax(0,1fr))`; return finish('div', renderChildren());
        case 'Split': styles['grid-template-columns'] = String(props.ratio ?? '1:1').split(':').map(v => `minmax(0,${v}fr)`).join(' '); return finish('div', renderChildren());
        case 'Spacer': styles.flex = '1 1 0'; return finish('div');
        case 'Panel': case 'Band':
          if (props.pad) styles.padding = `${theme.space[String(props.pad)]}px`;
          if (node.tag === 'Panel' && props.radius) styles['border-radius'] = props.radius === 'none' ? '0' : radius(String(props.radius));
          return finish('section', renderChildren({ ...ctx, inCard: true }), { 'data-surface': filled ? ctx.fill : 'transparent' });
        case 'Text':
          styles['text-align'] = String(props.align ?? 'left');
          return finish('p', native(text(node)), { 'data-content': 'true', 'data-content-part': 'body', 'data-role': role, 'data-font-floor': roleProps(role!,ctx)['data-font-floor'] });
        case 'Stat': {
          styles['text-align'] = String(props.align ?? 'left'); styles.gap = `${theme.space.xs}px`;
          glyphText.push(String(props.value));
          const value = jsx('span', { class: 'td-stat-value', 'data-content': 'true', 'data-stat-value': String(props.value), 'data-content-part': 'value', ...roleProps(role!,ctx) }, String(props.value));
          const label = props.label === undefined ? null : jsx('span', { class: 'td-secondary', 'data-content': 'true', 'data-content-part': 'label', 'data-role': 'caption', 'data-font-floor': TEXT_FLOORS.caption,
            style: `font-size:${theme.text.caption}px;font-weight:${weightFor('caption')};color:${secondaryColor(ctx.foreground)}` }, ...native(String(props.label)));
          return finish('div', [value, label]);
        }
        case 'Bullets': {
          styles.gap ??= `${theme.space.sm}px`; styles['font-size'] = `${theme.text[role!]}px`;
          return finish('ul', children(node).map((child,i) => {
            const marker = props.marker === 'number' ? `${i+1}.` : props.marker === 'dash' ? '—' : props.marker === 'none' ? '' : '•';
            glyphText.push(marker);
            return jsx('li', { class: 'td-bullet' }, marker ? jsx('span', { class:'td-bullet-marker', 'data-content-part': `marker:${child.id}`, 'aria-hidden':'true', ...roleProps(role!, ctx) }, marker) : null, render(child,{ ...ctx,listRole:role }));
          }));
        }
        case 'Quote':
          styles.gap = `${theme.space.sm}px`;
          return finish('blockquote', [jsx('p',{ class:'td-quote-body','data-content':'true','data-content-part':'body',...roleProps('quote',ctx) },...native(text(node))), props.by === undefined ? null : jsx('cite',{ 'data-content':'true','data-content-part':'attribution','data-role':'caption','data-font-floor':TEXT_FLOORS.caption,
            style:`font-size:${theme.text.caption}px;font-weight:${weightFor('caption')};font-style:normal;color:${secondaryColor(ctx.foreground)}` },...native(String(props.by)))]);
        case 'Badge': styles.padding = '0.35em 0.7em'; styles['border-radius'] = '999px'; return finish('span', native(text(node)), { 'data-content':'true','data-content-part':'body','data-role':'label','data-font-floor':TEXT_FLOORS.label,'data-surface':ctx.fill });
        case 'Image': return finish('div',[jsx('img',{src:imageUrls.get(node.id),alt:String(props.alt),draggable:false})]);
        case 'Icon': {
          const icon = readIcon(String(props.name),String(props.catalogVersion));
          return finish('svg',icon.node.map(([tag,attrs])=>jsx(tag,attrs)),{ xmlns:'http://www.w3.org/2000/svg',viewBox:icon.viewBox,fill:'none',stroke:'currentColor','stroke-width':2,'stroke-linecap':'round','stroke-linejoin':'round',
            role:props.alt ? 'img' : undefined,'aria-label':props.alt || undefined,'aria-hidden':props.alt ? undefined : 'true','data-icon':icon.name,'data-catalog-version':icon.catalogVersion });
        }
        case 'Rule': {
          const vertical = props.orient === 'v', weight = props.weight === 'bold' ? 6 : 2;
          styles['background-color'] = color(theme,String(props.color ?? 'accent'),node.origin.authoredId);
          styles.width = vertical ? `${weight}px` : props.length === 'short' ? '160px' : '100%';
          styles.height = vertical ? '100%' : `${weight}px`;
          if (props.length === 'bleed') { styles.width = '1920px'; styles['align-self']='center'; }
          return finish('div',[],{'aria-hidden':'true','data-bleed':props.length === 'bleed' ? 'true' : undefined});
        }
        case 'Shape': {
          const size = ({sm:240,md:400,lg:640,xl:960} as Record<string,number>)[String(props.size ?? 'md')], fill = color(theme,String(props.fill ?? 'accent'),node.origin.authoredId);
          const at = String(props.at ?? 'br'), offset = props.bleed ? -.25*size : theme.space.xs;
          styles.width=styles.height=`${size}px`; styles.opacity=({faint:.08,soft:.18,solid:1} as Record<string,number>)[String(props.opacity ?? 'soft')];
          if (at.includes('l')) styles.left=`${offset}px`; else if(at.includes('r')) styles.right=`${offset}px`; else styles.left=`${(1920-size)/2}px`;
          if(at.includes('t')) styles.top=`${offset}px`; else if(at.includes('b')) styles.bottom=`${offset}px`; else styles.top=`${(1080-size)/2}px`;
          const kind=String(props.kind); styles['background-color']=fill;
          if(['disc','ring','glow'].includes(kind)) styles['border-radius']='50%';
          if(kind==='ring'){styles['background-color']='transparent';styles.border=`${size*.08}px solid ${fill}`;}
          if(kind==='blob') styles['border-radius']='42% 58% 61% 39% / 54% 31% 69% 46%';
          if(kind==='pill'){styles.height=`${size*.4}px`;styles['border-radius']='999px';}
          if(kind==='arc'){styles['background-color']='transparent';styles.border=`${size*.08}px solid ${fill}`;styles['border-radius']='50%';styles['clip-path']='inset(0 0 50% 0)';}
          if(kind==='dots'){styles['background-color']='transparent';styles['background-image']=`radial-gradient(${fill} 15%,transparent 17%)`;styles['background-size']='32px 32px';}
          if(kind==='grid'){styles['background-color']='transparent';styles['background-image']=`linear-gradient(${fill} 2px,transparent 2px),linear-gradient(90deg,${fill} 2px,transparent 2px)`;styles['background-size']='40px 40px';}
          if(kind==='glow') styles.filter='blur(64px)';
          if(kind==='sparkle') styles['clip-path']='polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%)';
          return finish('div',[],{'aria-hidden':'true','data-shape':kind,'data-shape-opacity':props.opacity ?? 'soft','data-bleed':props.bleed ? 'true':undefined});
        }
        case 'Pending': styles.color=ctx.foreground; return finish('div',native(`Pending: ${String(props.kind)}`),{'data-pending':'true','data-content':'true','data-content-part':'body','data-role':'body','data-font-floor':TEXT_FLOORS.body});
        case 'Index':
          styles.padding = props.look && props.look !== 'plain' ? '.2em .45em' : '0'; styles['border-radius']=props.look==='circle'?'50%':props.look==='pill'?'999px':undefined;
          if(props.look && props.look!=='plain')styles.border='2px solid currentColor';
          return finish('span',native(String(props.value ?? '')),{'data-content':'true','data-content-part':'body','data-role':role,'data-font-floor':roleProps(role!,ctx)['data-font-floor']});
        default: throw new SourceError('render_primitive',`Unexpanded/unsupported visual primitive ${node.tag}`,node.origin.authoredId);
      }
    };
    const html = await render(slide,{ theme, foreground:theme.colors.fg, fill:'bg', inCard:false, scale:1, page:expanded.slides.indexOf(slide)+1,fontFamily:fonts.family }).toString();
    const requestedFonts=verifyGlyphs(fonts,glyphText.join(''));
    const themeCss = `@theme{--color-*:initial;--font-*:initial;--text-*:initial;--spacing-*:initial;${Object.entries(theme.colors).map(([k,v])=>`--color-${k}:${v};`).join('')}${Object.entries(theme.space).map(([k,v])=>`--spacing-${k}:${v}px;`).join('')}--radius-md:${radius('md')};--radius-lg:${radius('lg')};}\n@tailwind utilities;`;
    const candidates=[...new Set([...html.matchAll(/\sclass="([^"]*)"/g)].flatMap(m=>m[1].split(/\s+/)))];
    const css=fonts.css+'\n'+BASE_CSS+'\n'+(await compile(themeCss)).build(candidates);
    const artifact:RenderArtifact={html,css,slideId,source,dependencies,fonts:requestedFonts,pendingNodeIds:expanded.pendingNodeIds,artifactKey};
    this.cache.set(artifactKey,artifact);
    while(this.cache.size>(this.options.cacheSize??32))this.cache.delete(this.cache.keys().next().value!);
    return structuredClone(artifact);
  }
}
