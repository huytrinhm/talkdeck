import type { Finding, ValidationPipeline, ValidationReport } from './contracts.js';

/** No fake success: the scaffold cannot commit until all required stages exist. */
export class UnavailableValidation implements ValidationPipeline {
  async check(): Promise<ValidationReport> {
    return { complete: false, pendingNodeIds: [], findings: [{
      check: 'validation-unavailable', slideId: '', nodeId: '', severity: 'error', magnitude: 1,
      message: 'Expansion, strict primitive schemas, rendering, fonts/assets, and Chromium checks are not wired yet.',
    }] };
  }
}
export function introducedErrors(before: Finding[], after: Finding[]): Finding[] {
  const key = (finding: Finding) => JSON.stringify([finding.check, finding.slideId, finding.nodeId, finding.subject ?? '']);
  const prior = new Map<string, number>();
  for (const finding of before) if (finding.severity === 'error') prior.set(key(finding), Math.max(prior.get(key(finding)) ?? -1, finding.magnitude));
  return after.filter(finding => finding.severity === 'error' && finding.magnitude > (prior.get(key(finding)) ?? -1));
}
export function ready(report: ValidationReport): boolean {
  return report.complete && report.pendingNodeIds.length === 0 && report.findings.every(finding => finding.severity !== 'error');
}
