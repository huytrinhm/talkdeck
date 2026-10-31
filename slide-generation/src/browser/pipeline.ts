import { createHash } from 'node:crypto';
import { SourceError, type ValidationPipeline, type ValidationReport } from '../contracts.js';
import { childNodes } from '../schema.js';
import { parseSource } from '../parser.js';
import type { RenderArtifact } from '../render/types.js';
import { preparePage, measurePage } from './measure.js';
import { evaluateMeasurement, CHECK_POLICY_VERSION } from './policy.js';
import { BrowserPool, type BrowserPoolOptions } from './pool.js';
import type { BrowserCheckResult, CheckEvidence } from './types.js';
import { APCA_VERSION } from '../render/contrast.js';

export interface ArtifactRenderer { render(source: string, slideId: string): Promise<RenderArtifact> }
export interface BrowserValidationReport extends ValidationReport { evidence: CheckEvidence[] }
export interface CapturedSlide { slideId: string; jpeg: Uint8Array; sourceDigest: string; artifactDigest: string }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function artifactDigest(artifact: RenderArtifact) {
  return digest(JSON.stringify({ html: artifact.html, css: artifact.css, source: artifact.source, slideId: artifact.slideId,
    fonts: artifact.fonts, dependencies: artifact.dependencies, policy: CHECK_POLICY_VERSION, contrast: APCA_VERSION }));
}
export class BrowserValidationPipeline implements ValidationPipeline {
  private readonly pool: BrowserPool;
  constructor(private readonly renderer: ArtifactRenderer, options: BrowserPoolOptions = {}) { this.pool = new BrowserPool(options); }
  private async render(source: string, slideId: string): Promise<RenderArtifact> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([this.renderer.render(source, slideId), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SourceError('validation_unavailable', 'Render/font/asset resolution timed out')), this.pool.timeoutMs);
      })]);
    } finally { if (timer) clearTimeout(timer); }
  }
  async inspect(artifact: RenderArtifact): Promise<BrowserCheckResult> {
    const start = performance.now();
    return this.pool.withPage(async (page, browserVersion, externalRequests) => {
      await preparePage(page, artifact);
      const measurement = await measurePage(page, artifact);
      if (externalRequests.length) throw new SourceError('validation_unavailable', 'Renderer attempted an external network request');
      const findings = evaluateMeasurement(measurement);
      return { findings, measurement, evidence: { slideId: artifact.slideId, sourceDigest: digest(artifact.source),
        artifactDigest: artifactDigest(artifact), browserVersion, policyVersion: `${CHECK_POLICY_VERSION}/${APCA_VERSION}`,
        checkedAt: new Date().toISOString(), durationMs: performance.now() - start,
        textRuns: measurement.texts.length, measuredNodes: measurement.nodes.length } };
    });
  }
  async check(source: string): Promise<BrowserValidationReport> {
    try {
      const slideIds = childNodes(parseSource(source)).filter(n => n.tag === 'Slide').map(n => n.id!);
      if (!slideIds.length || slideIds.some(id => !id)) throw new SourceError('validation_unavailable', 'Deck has no identified slides');
      return await this.checkSlides(source, slideIds);
    } catch (error) { return this.unavailable(error); }
  }
  async checkSlides(source: string, slideIds: string[]): Promise<BrowserValidationReport> {
    if (!slideIds.length || new Set(slideIds).size !== slideIds.length) throw new SourceError('request', 'Check requires unique slide IDs');
    const report: BrowserValidationReport = { complete: true, findings: [], pendingNodeIds: [], evidence: [] };
    try {
      // Render one immutable artifact per slide. No baseline cache is used until a complete
      // key and dependency-invalidation corpus is established.
      for (const slideId of slideIds) {
        const artifact = await this.render(source, slideId);
        const checked = await this.inspect(artifact);
        report.findings.push(...checked.findings); report.pendingNodeIds.push(...artifact.pendingNodeIds, ...checked.measurement.pendingNodeIds);
        report.evidence.push(checked.evidence);
      }
      report.pendingNodeIds = [...new Set(report.pendingNodeIds)];
      return report;
    } catch (error) {
      const incomplete = this.unavailable(error);
      return { ...report, complete: false, findings: [...report.findings, ...incomplete.findings] };
    }
  }
  private unavailable(error: unknown): BrowserValidationReport {
    return { complete: false, pendingNodeIds: [], evidence: [], findings: [{ check: 'validation-unavailable', slideId: '', nodeId: '',
      severity: 'error', magnitude: 1, message: error instanceof Error ? error.message : 'Browser validation could not complete' }] };
  }
  async screenshot(source: string, slideIds: string[]): Promise<CapturedSlide[]> {
    if (!slideIds.length || slideIds.length > 4 || new Set(slideIds).size !== slideIds.length)
      throw new SourceError('request', 'Screenshot requires one to four unique slide IDs');
    const captures: CapturedSlide[] = [];
    for (const slideId of slideIds) {
      const artifact = await this.render(source, slideId);
      const capture = await this.pool.withPage(async (page, _version, externalRequests) => {
        await preparePage(page, artifact);
        if (externalRequests.length) throw new SourceError('validation_unavailable', 'Renderer attempted an external network request');
        return page.screenshot({ type: 'jpeg', quality: 90, animations: 'disabled', fullPage: false });
      });
      captures.push({ slideId, jpeg: capture, sourceDigest: digest(artifact.source), artifactDigest: artifactDigest(artifact) });
    }
    return captures;
  }
  close() { return this.pool.close(); }
}
