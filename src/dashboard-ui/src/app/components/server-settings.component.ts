import { Component, OnInit, output, signal } from "@angular/core";
import type { ServerConfigData } from "../../types";

interface RateLimitRow { model: string; size: number; window: number; }

@Component({
  selector: "app-server-settings",
  standalone: true,
  template: `
    <!-- Backdrop -->
    <div
      class="fixed inset-0 z-40 bg-black/50"
      (click)="close.emit()">
    </div>

    <!-- Panel -->
    <div class="fixed z-50 top-12 right-4 w-96 max-h-[calc(100vh-5rem)] overflow-y-auto
                bg-(--color-bg) border border-(--color-border) rounded-[6px] shadow-2xl">
      <div class="flex items-center justify-between px-4 py-2.5 border-b border-(--color-border) sticky top-0 bg-(--color-bg)">
        <span class="text-xs font-semibold uppercase tracking-[0.07em] text-(--color-indigo)">Server Settings</span>
        <button
          class="text-(--color-muted) hover:text-(--color-text) cursor-pointer bg-transparent border-none text-base leading-none"
          (click)="close.emit()">✕</button>
      </div>

      @if (serverCfg()) {
        <div class="flex flex-col gap-2 p-4">
          <h3 class="text-xs font-semibold text-(--color-muted) uppercase tracking-wider mt-1">Embed</h3>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Provider</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              [value]="serverCfg()!.embed.provider"
              (input)="patchEmbed('provider', $any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Model</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              [value]="serverCfg()!.embed.model"
              (input)="patchEmbed('model', $any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">API Key</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              type="password" [value]="serverCfg()!.embed.api_key"
              (input)="patchEmbed('api_key', $any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Dim</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              type="number" [value]="serverCfg()!.embed.dim"
              (input)="patchEmbed('dim', +$any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Max chars</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              type="number" [value]="serverCfg()!.embed.max_chars"
              (input)="patchEmbed('max_chars', +$any($event.target).value)" />
          </label>

          <h3 class="text-xs font-semibold text-(--color-muted) uppercase tracking-wider mt-3">LLM</h3>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Provider</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              [value]="serverCfg()!.llm.provider"
              (input)="patchLlm('provider', $any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Model</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              [value]="serverCfg()!.llm.model"
              (input)="patchLlm('model', $any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">API Key</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              type="password" [value]="serverCfg()!.llm.api_key"
              (input)="patchLlm('api_key', $any($event.target).value)" />
          </label>

          <h3 class="text-xs font-semibold text-(--color-muted) uppercase tracking-wider mt-3">Router</h3>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Provider</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              [value]="serverCfg()!.router.provider"
              (input)="patchRouter('provider', $any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Model</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              [value]="serverCfg()!.router.model"
              (input)="patchRouter('model', $any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">API Key</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              type="password" [value]="serverCfg()!.router.api_key"
              (input)="patchRouter('api_key', $any($event.target).value)" />
          </label>

          <h3 class="text-xs font-semibold text-(--color-muted) uppercase tracking-wider mt-3">General</h3>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Collection prefix</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              [value]="serverCfg()!.collection_prefix"
              (input)="patchServer('collection_prefix', $any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Port (restart)</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              type="number" [value]="serverCfg()!.port"
              (input)="patchServer('port', +$any($event.target).value)" />
          </label>

          <h3 class="text-xs font-semibold text-(--color-muted) uppercase tracking-wider mt-3">Rate Limits</h3>
          <div class="text-xs text-(--color-muted) mb-1">Max requests per time window, per model.</div>

          @for (row of _rlRows(); track $index) {
            <div class="flex gap-1.5 items-center">
              <input
                placeholder="model name"
                class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
                [value]="row.model"
                (input)="patchRlRow($index, 'model', $any($event.target).value)" />
              <input
                type="number" min="1" placeholder="req"
                class="w-16 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
                [value]="row.size"
                (input)="patchRlRow($index, 'size', +$any($event.target).value)" />
              <input
                type="number" min="1" placeholder="sec"
                class="w-16 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
                [value]="row.window"
                (input)="patchRlRow($index, 'window', +$any($event.target).value)" />
              <button
                class="text-(--color-muted) hover:text-(--color-text) bg-transparent border-none cursor-pointer text-xs leading-none px-1"
                (click)="removeRlRow($index)">✕</button>
            </div>
          }

          @if (hasDuplicateModels()) {
            <div class="text-xs text-red-400 mt-1">Duplicate model names — remove or rename before saving.</div>
          }

          <button
            class="mt-1 self-start px-2 py-1 text-xs font-mono border border-(--color-border) text-(--color-muted) hover:text-(--color-text) rounded cursor-pointer bg-transparent"
            (click)="addRlRow()">+ Add rate limit</button>

          <button
            class="mt-3 self-start px-3 py-1 text-xs font-mono bg-(--color-indigo) text-white rounded cursor-pointer border-none"
            [disabled]="hasDuplicateModels()"
            (click)="saveServer()">Save</button>
        </div>
      } @else {
        <div class="p-4 text-xs text-(--color-muted) font-mono">Loading…</div>
      }

      @if (saved()) {
        <div class="mx-4 mb-4 bg-(--color-surface) border border-(--color-indigo) text-(--color-indigo) text-xs font-mono px-3 py-1.5 rounded">
          Saved
        </div>
      }
    </div>
  `,
})
export class ServerSettingsComponent implements OnInit {
  readonly close = output<void>();

  readonly serverCfg = signal<ServerConfigData | null>(null);
  readonly saved     = signal(false);
  readonly _rlRows   = signal<RateLimitRow[]>([]);

  ngOnInit(): void {
    void fetch("/api/config/server")
      .then(r => r.json() as Promise<ServerConfigData>)
      .then(d => {
        this.serverCfg.set(d);
        this._rlRows.set(this._fromParts(d.rate_limits ?? {}));
      });
  }

  patchServer(key: keyof ServerConfigData, value: unknown): void {
    const cur = this.serverCfg();
    if (cur) this.serverCfg.set({ ...cur, [key]: value });
  }

  patchEmbed(key: string, value: unknown): void {
    const cur = this.serverCfg();
    if (cur) this.serverCfg.set({ ...cur, embed: { ...cur.embed, [key]: value } });
  }

  patchLlm(key: string, value: unknown): void {
    const cur = this.serverCfg();
    if (cur) this.serverCfg.set({ ...cur, llm: { ...cur.llm, [key]: value } });
  }

  patchRouter(key: string, value: unknown): void {
    const cur = this.serverCfg();
    if (cur) this.serverCfg.set({ ...cur, router: { ...cur.router, [key]: value } });
  }

  saveServer(): void {
    if (this.hasDuplicateModels()) return;
    this.patchServer("rate_limits", this._toParts(this._rlRows()));
    void fetch("/api/config/server", {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(this.serverCfg()),
    }).then(() => this.flash());
  }

  addRlRow(): void {
    this._rlRows.update(rows => [...rows, { model: "", size: 15, window: 60 }]);
  }

  removeRlRow(i: number): void {
    this._rlRows.update(rows => rows.filter((_, idx) => idx !== i));
  }

  patchRlRow(i: number, key: keyof RateLimitRow, value: string | number): void {
    this._rlRows.update(rows => rows.map((r, idx) => idx === i ? { ...r, [key]: value } : r));
  }

  hasDuplicateModels(): boolean {
    const models = this._rlRows().map(r => r.model).filter(Boolean);
    return models.length !== new Set(models).size;
  }

  private _fromParts(obj: Record<string, { size: number; window: number }>): RateLimitRow[] {
    return Object.entries(obj).map(([model, v]) => ({ model, size: v.size, window: v.window }));
  }

  private _toParts(rows: RateLimitRow[]): Record<string, { size: number; window: number }> {
    return Object.fromEntries(
      rows.filter(r => r.model).map(r => [r.model, { size: r.size, window: r.window }])
    );
  }

  private flash(): void {
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2000);
  }
}
