import { chromium, type Browser, type Page, type BrowserContext } from 'playwright';
import { CANVAS, SourceError } from '../contracts.js';

export interface BrowserPoolOptions { concurrency?: number; queueLimit?: number; timeoutMs?: number }
interface Waiter { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
export class BrowserPool {
  private browser?: Promise<Browser>;
  private active = 0;
  private waiters: Waiter[] = [];
  private contexts = new Set<BrowserContext>();
  private closed = false;
  readonly concurrency: number;
  readonly queueLimit: number;
  readonly timeoutMs: number;
  constructor(options: BrowserPoolOptions = {}) {
    this.concurrency = options.concurrency ?? 2; this.queueLimit = options.queueLimit ?? 16; this.timeoutMs = options.timeoutMs ?? 20_000;
    for (const value of [this.concurrency, this.queueLimit, this.timeoutMs]) if (!Number.isSafeInteger(value) || value < 1)
      throw new Error('Browser pool limits must be positive integers');
  }
  private async acquire() {
    if (this.closed) throw new SourceError('validation_unavailable', 'Browser pool is closed');
    if (this.active < this.concurrency) { this.active++; return; }
    if (this.waiters.length >= this.queueLimit) throw new SourceError('validation_unavailable', 'Browser validation queue is full');
    await new Promise<void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, timer: setTimeout(() => {
        this.waiters = this.waiters.filter(w => w !== waiter);
        reject(new SourceError('validation_unavailable', 'Browser validation queue timed out'));
      }, this.timeoutMs) };
      this.waiters.push(waiter);
    });
  }
  private release() {
    const next = this.waiters.shift();
    if (next) { clearTimeout(next.timer); next.resolve(); }
    else this.active--;
  }
  async withPage<T>(run: (page: Page, browserVersion: string, externalRequests: string[]) => Promise<T>): Promise<T> {
    await this.acquire();
    let context: BrowserContext | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (this.closed) throw new SourceError('validation_unavailable', 'Browser pool is closed');
      this.browser ??= chromium.launch({ headless: true, timeout: this.timeoutMs }).then(browser => {
        browser.on('disconnected', () => { this.browser = undefined; }); return browser;
      }).catch(error => { this.browser = undefined; throw error; });
      const browser = await this.browser;
      context = await browser.newContext({ viewport: CANVAS, deviceScaleFactor: 1, javaScriptEnabled: false,
        serviceWorkers: 'block', acceptDownloads: false, colorScheme: 'light' });
      this.contexts.add(context);
      const externalRequests: string[] = [];
      await context.route('**/*', route => {
        const url = route.request().url();
        externalRequests.push(url.replace(/[?#].*$/, ''));
        return route.abort('blockedbyclient');
      });
      const page = await context.newPage(); page.setDefaultTimeout(this.timeoutMs); page.setDefaultNavigationTimeout(this.timeoutMs);
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new SourceError('validation_unavailable', 'Browser measurement timed out'));
          void context?.close().catch(() => {});
        }, this.timeoutMs);
      });
      return await Promise.race([run(page, browser.version(), externalRequests), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
      if (context) { this.contexts.delete(context); await context.close().catch(() => {}); }
      this.release();
    }
  }
  async close() {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) { clearTimeout(waiter.timer); waiter.reject(new SourceError('validation_unavailable', 'Browser pool closed')); }
    await Promise.all([...this.contexts].map(c => c.close().catch(() => {})));
    await (await this.browser?.catch(() => undefined))?.close(); this.browser = undefined;
  }
}
