import { Component, OnInit, signal, effect, computed } from "@angular/core";
import { SseService }          from "./services/sse.service";
import type { ToolStats }      from "../types";
import { ServerInfoComponent } from "./components/server-info.component";
import { StatsTableComponent } from "./components/stats-table.component";
import { RequestLogComponent } from "./components/request-log.component";
import { PlaygroundComponent } from "./components/playground.component";
import { MemoryComponent }     from "./components/memory.component";
import { SettingsComponent }   from "./components/settings.component";
import { FormsModule }         from "@angular/forms";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ServerInfoComponent, StatsTableComponent, RequestLogComponent, PlaygroundComponent, MemoryComponent, SettingsComponent, FormsModule],
  templateUrl: "./app.component.html",
})
export class AppComponent implements OnInit {
  readonly init = window.__INIT__;
  readonly tab  = signal<'dashboard' | 'playground' | 'memory' | 'settings'>('dashboard');
  readonly selectedProject = signal<string>("");

  readonly filteredLog = computed(() => {
    const proj = this.selectedProject();
    const log  = this.sse.log();
    return proj ? log.filter(e => !e.projectId || e.projectId === proj) : log;
  });

  readonly filteredStats = computed(() => {
    const entries = this.filteredLog();
    const acc: Record<string, { calls: number; bytesIn: number; bytesOut: number; totalMs: number; errors: number }> = {};
    for (const e of entries) {
      const key  = e.source === "watcher" ? "indexer" : e.tool;
      const prev = acc[key] ?? { calls: 0, bytesIn: 0, bytesOut: 0, totalMs: 0, errors: 0 };
      acc[key] = {
        calls:    prev.calls    + 1,
        bytesIn:  prev.bytesIn  + e.bytesIn,
        bytesOut: prev.bytesOut + e.bytesOut,
        totalMs:  prev.totalMs  + e.ms,
        errors:   prev.errors   + (e.ok ? 0 : 1),
      };
    }
    const result: Record<string, ToolStats> = {};
    for (const [tool, s] of Object.entries(acc)) {
      result[tool] = { ...s, avgMs: s.calls > 0 ? s.totalMs / s.calls : 0, tokensEst: Math.round((s.bytesIn + s.bytesOut) / 4) } satisfies ToolStats;
    }
    return result;
  });

  constructor(readonly sse: SseService) {
    effect(() => {
      const proj = this.selectedProject();
      const url = new URL(window.location.href);
      if (proj) {
        url.searchParams.set("project", proj);
      } else {
        url.searchParams.delete("project");
      }
      window.history.replaceState({}, "", url.toString());
    });
  }

  ngOnInit(): void {
    const url = new URL(window.location.href);
    const proj = url.searchParams.get("project") || this.init.serverInfo.projectId;
    this.selectedProject.set(proj);

    this.sse.connect(this.init);
  }

  fmtTime(ts: number): string { return new Date(ts).toTimeString().slice(0, 8); }
}
