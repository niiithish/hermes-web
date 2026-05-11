"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { api } from "@/app/lib/api-client";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Skill {
  num?: string;
  name: string;
  description: string;
  source: string;
  trust: string;
  identifier?: string;
}

interface Profile {
  name: string;
  active: boolean;
  alias?: string;
  model?: string;
}

// ─── Parse CLI box-drawing table output ──────────────────────────────────────

function parseSkillTable(output: string): Skill[] {
  const text = String(output || "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  const lines = text.split("\n");
  const skills: Skill[] = [];
  const rowPattern =
    /[│┃]\s*([^│┃\s][^│┃]*?)\s*[│┃]\s*([^│┃]*?)\s*[│┃]\s*(\S+)\s*[│┃]\s*(\S+)\s*[│┃]\s*([^│┃]*?)\s*[│┃]/;
  for (const line of lines) {
    if (
      line.includes("┏") ||
      line.includes("┗") ||
      line.includes("┡") ||
      line.includes("┩") ||
      line.includes("╍")
    )
      continue;
    const match = line.match(rowPattern);
    if (match) {
      const name = match[1].trim();
      if (!name || name === "Name" || name === "#") continue;
      skills.push({
        name,
        description: match[2].trim(),
        source: match[3].trim(),
        trust: match[4].trim(),
        identifier: match[5].trim(),
      });
    }
  }
  return skills;
}

function parseBrowseTable(output: string): Skill[] {
  const text = String(output || "").replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
  const lines = text.split("\n");
  const skills: Skill[] = [];
  for (const line of lines) {
    if (
      line.includes("┏") ||
      line.includes("┗") ||
      line.includes("┡") ||
      line.includes("┩") ||
      line.includes("╍")
    )
      continue;
    const match = line.match(
      /[│|]\s*(\d+)\s*[│|]\s*([^\s│|]+)\s*[│|]\s*(.{10,}?)\s*[│|]\s*(\S+)\s*[│|]\s*(.+?)\s*[│|]/,
    );
    if (match) {
      skills.push({
        num: match[1],
        name: match[2].trim(),
        description: match[3].trim().replace(/\.\.\.$/, ""),
        source: match[4].trim(),
        trust: match[5].trim(),
      });
    }
  }
  return skills;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [installedSkills, setInstalledSkills] = useState<Set<string>>(
    new Set(),
  );
  const [profiles, setProfiles] = useState<Profile[]>([]);

  // Inspect dialog
  const [inspectTarget, setInspectTarget] = useState<string | null>(null);
  const [inspectOutput, setInspectOutput] = useState<string>("");
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectError, setInspectError] = useState<string | null>(null);

  // Install dialog
  const [installTarget, setInstallTarget] = useState<string | null>(null);
  const [installStatus, setInstallStatus] = useState<string>("");
  const [installLoading, setInstallLoading] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState("");

  // ── Load profiles & installed skills ──────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const profRes = await api.get<{ ok: boolean; profiles: Profile[] }>(
          "/api/profiles",
        );
        if (!cancelled && profRes.ok && profRes.profiles) {
          setProfiles(profRes.profiles);
          const activeProfile = profRes.profiles.find((p) => p.active);
          const profileName = activeProfile?.name || "default";
          setSelectedProfile(profileName);

          try {
            const instRes = await api.get<{ ok: boolean; output: string }>(
              `/api/skills/list/${encodeURIComponent(profileName)}`,
            );
            if (!cancelled && instRes.ok && instRes.output) {
              const names = new Set<string>();
              const lines = instRes.output.split("\n");
              for (const line of lines) {
                const match = line.match(/[│┃]\s*([^\s│┃][^\s│┃]*)\s*[│┃]/);
                if (match) names.add(match[1].trim());
              }
              setInstalledSkills(names);
            }
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* ignore */
      }
    }
    init();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Load page ─────────────────────────────────────────────────────────────

  const loadPage = useCallback(async (page: number) => {
    setLoading(true);
    setError(null);
    setIsSearching(false);
    setCurrentPage(page);
    try {
      const res = await api.get<{
        ok: boolean;
        error?: string;
        output?: string;
      }>(`/api/skills/browse/${page}`);
      if (!res.ok) {
        setError(res.error || "Failed to load skills");
        setSkills([]);
        return;
      }
      const output = res.output || "";
      const pageMatch = output.match(/page (\d+)\/(\d+)/i);
      if (pageMatch) {
        setCurrentPage(parseInt(pageMatch[1]));
        setTotalPages(parseInt(pageMatch[2]));
      }
      setSkills(parseBrowseTable(output));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load skills");
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPage(1);
  }, [loadPage]);

  // ── Search handler ────────────────────────────────────────────────────────

  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      if (value.trim().length < 2) {
        setIsSearching(false);
        loadPage(1);
        return;
      }
      searchTimerRef.current = setTimeout(async () => {
        setLoading(true);
        setError(null);
        setIsSearching(true);
        try {
          const res = await api.get<{
            ok: boolean;
            error?: string;
            output?: string;
          }>(`/api/skills/search/${encodeURIComponent(value.trim())}`);
          if (res.ok && res.output) {
            setSkills(parseSkillTable(res.output));
          } else {
            setError(res.error || "Search failed");
            setSkills([]);
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "Search failed");
          setSkills([]);
        } finally {
          setLoading(false);
        }
      }, 350);
    },
    [loadPage],
  );

  useEffect(
    () => () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    },
    [],
  );

  // ── Inspect ───────────────────────────────────────────────────────────────

  const handleInspect = useCallback(async (name: string) => {
    setInspectTarget(name);
    setInspectOutput("");
    setInspectError(null);
    setInspectLoading(true);
    try {
      const res = await api.get<{
        ok: boolean;
        error?: string;
        output?: string;
      }>(`/api/skills/inspect/${encodeURIComponent(name)}`);
      if (res.ok) setInspectOutput(res.output || "");
      else setInspectError(res.error || "Failed to load preview");
    } catch (e) {
      setInspectError(
        e instanceof Error ? e.message : "Failed to load preview",
      );
    } finally {
      setInspectLoading(false);
    }
  }, []);

  // ── Install ───────────────────────────────────────────────────────────────

  const handleInstall = useCallback(
    (name: string) => {
      setInstallTarget(name);
      setInstallStatus("");
      setInstallLoading(false);
      const activeProfile = profiles.find((p) => p.active);
      if (activeProfile) setSelectedProfile(activeProfile.name);
    },
    [profiles],
  );

  const doInstall = useCallback(async () => {
    if (!installTarget) return;
    setInstallLoading(true);
    setInstallStatus("");
    try {
      const res = await api.post<{
        ok: boolean;
        error?: string;
        output?: string;
      }>("/api/skills/install", {
        skill: installTarget,
        profile: selectedProfile,
      });
      if (res.ok) {
        setInstallStatus(`Installed to ${selectedProfile || "default"}!`);
        setInstalledSkills((prev) => new Set(prev).add(installTarget));
        setTimeout(() => {
          setInstallTarget(null);
          setInstallStatus("");
        }, 1500);
      } else {
        setInstallStatus(res.output || res.error || "Install failed");
      }
    } catch (e) {
      setInstallStatus(e instanceof Error ? e.message : "Install failed");
    } finally {
      setInstallLoading(false);
    }
  }, [installTarget, selectedProfile]);

  const isInstalled = useCallback(
    (skill: Skill) => {
      return installedSkills.has(skill.identifier || skill.name);
    },
    [installedSkills],
  );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="p-6 h-full overflow-y-auto space-y-4">
      {/* Page Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-xl font-bold tracking-wider uppercase">
            Skills Hub
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Browse, install, and manage skills
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <Input
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            className="w-56"
          />
          <Button variant="outline" onClick={() => loadPage(currentPage)}>
            Refresh
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && <div className="text-destructive text-sm py-2">{error}</div>}

      {/* Loading */}
      {loading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
          <Spinner className="size-4" />
          {isSearching ? "Searching..." : `Loading page ${currentPage}...`}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && skills.length === 0 && (
        <Card className="items-center justify-center py-10">
          <CardContent>
            {isSearching
              ? `No skills found for "${searchQuery}"`
              : `No skills found on page ${currentPage}`}
          </CardContent>
        </Card>
      )}

      {/* Search results header */}
      {!loading && isSearching && skills.length > 0 && (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Search Results ({skills.length})</CardTitle>
          </CardHeader>
        </Card>
      )}

      {/* Skill cards grid */}
      {!loading && skills.length > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {skills.map((s, i) => {
            const installed = isInstalled(s);
            return (
              <Card key={s.num || s.identifier || s.name || i}>
                <CardHeader>
                  <CardTitle>{s.name}</CardTitle>
                  <CardDescription>{s.description}</CardDescription>
                </CardHeader>
                <CardContent className="flex gap-1.5 items-center flex-wrap">
                  <Badge
                    variant={s.source === "official" ? "default" : "outline"}
                  >
                    {s.source}
                  </Badge>
                  {s.trust && <Badge variant="secondary">{s.trust}</Badge>}
                </CardContent>
                <CardFooter className="gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleInspect(s.identifier || s.name)}
                  >
                    Preview
                  </Button>
                  {installed ? (
                    <Button variant="outline" size="sm" disabled>
                      Installed
                    </Button>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleInstall(s.identifier || s.name)}
                    >
                      Install
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}

      {/* Pagination */}
      {!isSearching && totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          {currentPage > 1 && (
            <Button variant="outline" onClick={() => loadPage(currentPage - 1)}>
              {`Page ${currentPage - 1}`}
            </Button>
          )}
          <span className="text-muted-foreground self-center text-sm px-2">
            Page {currentPage} / {totalPages}
          </span>
          {currentPage < totalPages && (
            <Button variant="outline" onClick={() => loadPage(currentPage + 1)}>
              {`Page ${currentPage + 1}`}
            </Button>
          )}
        </div>
      )}

      {/* Inspect Dialog */}
      <Dialog
        open={!!inspectTarget}
        onOpenChange={(open) => !open && setInspectTarget(null)}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{inspectTarget}</DialogTitle>
          </DialogHeader>
          {inspectLoading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
              <Spinner className="size-4" /> Loading preview...
            </div>
          ) : inspectError ? (
            <div className="text-destructive text-sm py-2">{inspectError}</div>
          ) : (
            <pre className="bg-muted/50 border border-border rounded-lg p-3 text-xs leading-relaxed whitespace-pre-wrap break-all max-h-[50vh] overflow-y-auto font-mono m-0">
              {inspectOutput}
            </pre>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setInspectTarget(null)}>
              Close
            </Button>
            {!isInstalled({
              name: inspectTarget || "",
              description: "",
              source: "",
              trust: "",
            }) && (
              <Button
                variant="default"
                onClick={() => {
                  setInspectTarget(null);
                  handleInstall(inspectTarget!);
                }}
              >
                Install
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Install Dialog */}
      <Dialog
        open={!!installTarget}
        onOpenChange={(open) => !open && setInstallTarget(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Install: {installTarget}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">
              Select agent profile
            </label>
            <div className="flex flex-col gap-1">
              {profiles.length > 0 ? (
                profiles.map((p) => (
                  <label
                    key={p.name}
                    className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer border transition-colors ${
                      selectedProfile === p.name
                        ? "border-primary bg-primary/10"
                        : "border-border bg-card"
                    }`}
                  >
                    <input
                      type="radio"
                      name="install-profile"
                      value={p.name}
                      checked={selectedProfile === p.name}
                      onChange={(e) => setSelectedProfile(e.target.value)}
                      className="accent-primary"
                    />
                    <span className="font-semibold text-sm">{p.name}</span>
                    {p.alias && p.alias !== p.name && (
                      <span className="text-muted-foreground text-xs">
                        ({p.alias})
                      </span>
                    )}
                    {p.active && (
                      <Badge variant="default" className="text-[9px]">
                        active
                      </Badge>
                    )}
                    <span className="text-muted-foreground text-xs ml-auto">
                      {p.model || ""}
                    </span>
                  </label>
                ))
              ) : (
                <div className="text-muted-foreground p-3">
                  No profiles found
                </div>
              )}
            </div>
          </div>

          {installStatus && (
            <div
              className={`text-sm py-2 ${installStatus.startsWith("Installed") ? "text-green-500" : "text-destructive"}`}
            >
              {installStatus}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setInstallTarget(null)}
              disabled={installLoading}
            >
              Cancel
            </Button>
            <Button
              variant="default"
              onClick={doInstall}
              disabled={installLoading || !selectedProfile}
            >
              {installLoading ? "Installing..." : "Install"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
