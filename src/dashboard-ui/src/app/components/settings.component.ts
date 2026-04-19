import { Component, effect, input, signal } from "@angular/core";
import { CommonModule }                     from "@angular/common";
import type { ProjectConfigData } from "../../types";

@Component({
  selector: "app-settings",
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="settings overflow-y-auto h-full p-4">
      <h2 class="text-[0.9rem] font-semibold uppercase tracking-[0.07em] text-(--color-indigo) mb-3">Project Settings</h2>
      @if (projectCfg()) {
        <div class="flex flex-col gap-2 mb-6">
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Display name</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              [value]="projectCfg()!.display_name"
              (input)="patchProject('display_name', $any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-center text-xs">
            <span class="w-28 text-(--color-muted)">Project dir</span>
            <input class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text)"
              [value]="projectCfg()!.project_dir"
              (input)="patchProject('project_dir', $any($event.target).value)" />
          </label>
          <label class="flex gap-2 items-start text-xs">
            <span class="w-28 text-(--color-muted) mt-1">Include paths</span>
            <textarea class="flex-1 bg-(--color-surface) border border-(--color-border) rounded px-2 py-1 text-xs font-mono text-(--color-text) min-h-[80px] resize-y"
              [value]="projectCfg()!.include_paths.join('\\n')"
              (input)="onIncludePathsInput($any($event.target).value)"></textarea>
          </label>

          <h3 class="text-xs font-semibold text-(--color-muted) uppercase tracking-wider mt-2">Indexer</h3>
          <div class="flex gap-2 items-center">
            <button class="px-3 py-1 text-xs font-mono bg-(--color-surface) border border-(--color-border) rounded cursor-pointer"
              (click)="setIndexerState('running')">Start</button>
            <button class="px-3 py-1 text-xs font-mono bg-(--color-surface) border border-(--color-border) rounded cursor-pointer"
              (click)="setIndexerState('paused')">Pause</button>
            <button class="px-3 py-1 text-xs font-mono bg-(--color-surface) border border-(--color-border) rounded cursor-pointer"
              (click)="setIndexerState('stopped')">Stop</button>
            <span class="text-xs text-(--color-muted)">Current: {{ projectCfg()!.indexer_state }}</span>
          </div>

          <button
            class="mt-2 self-start px-3 py-1 text-xs font-mono bg-(--color-indigo) text-white rounded cursor-pointer border-none"
            (click)="saveProject()">Save Project Settings</button>
        </div>
      }

      @if (saved()) {
        <div class="fixed bottom-4 right-4 bg-(--color-surface) border border-(--color-indigo) text-(--color-indigo) text-xs font-mono px-3 py-1.5 rounded">
          Saved
        </div>
      }
    </div>
  `,
})
export class SettingsComponent {
  readonly projectId  = input<string>("");
  readonly projectCfg = signal<ProjectConfigData | null>(null);
  readonly saved      = signal(false);

  constructor() {
    effect(() => {
      const pid = this.projectId() || new URLSearchParams(window.location.search).get("project") || "default";
      void fetch(`/api/projects/${pid}`)
        .then(r => r.ok ? r.json() as Promise<ProjectConfigData> : null)
        .then(d => { this.projectCfg.set(d); });
    });
  }

  patchProject(key: keyof ProjectConfigData, value: unknown): void {
    const cur = this.projectCfg();
    if (cur) this.projectCfg.set({ ...cur, [key]: value });
  }

  onIncludePathsInput(value: string): void {
    this.patchProject("include_paths", value.split("\n").map(s => s.trim()).filter(Boolean));
  }

  saveProject(): void {
    const cfg = this.projectCfg();
    if (!cfg) return;
    void fetch(`/api/projects/${cfg.project_id}`, {
      method:  "PUT",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(cfg),
    }).then(() => this.flash());
  }

  setIndexerState(state: "running" | "paused" | "stopped"): void {
    this.patchProject("indexer_state", state);
    this.saveProject();
  }

  private flash(): void {
    this.saved.set(true);
    setTimeout(() => this.saved.set(false), 2000);
  }
}
