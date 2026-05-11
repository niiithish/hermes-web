"use client";

import { useState, useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/app/lib/api-client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { RiTerminalLine, RiRefreshLine } from "@remixicon/react";

export default function HomePage() {
  const router = useRouter();
  const [refreshKey, setRefreshKey] = useState(0);

  const [agentData, setAgentData] = useState<Record<string, unknown> | null>(
    null,
  );
  const [cronJobCount, setCronJobCount] = useState<number | null>(null);
  const [agentLoading, setAgentLoading] = useState(true);
  const [agentError, setAgentError] = useState<string | null>(null);

  const [profiles, setProfiles] = useState<{ name: string; gateway: string }[]>(
    [],
  );
  const [gwLoading, setGwLoading] = useState(true);

  const [authProviders, setAuthProviders] = useState<
    { name: string; set: boolean }[]
  >([]);
  const [authLoading, setAuthLoading] = useState(true);

  const [setupChecks, setSetupChecks] = useState<
    { ok: boolean; label: string; detail?: string }[]
  >([]);
  const [setupLoading, setSetupLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setAgentLoading(true);
    setGwLoading(true);
    setAuthLoading(true);
    setSetupLoading(true);
    setAgentError(null);

    try {
      const [agentRes, profilesRes, cronRes] = await Promise.all([
        api.get<Record<string, unknown>>("/api/agent/status").catch(() => null),
        api
          .get<{
            ok: boolean;
            profiles: { name: string; gateway: string }[];
          }>("/api/profiles")
          .catch(() => null),
        api
          .post<{ ok: boolean; jobs: unknown[] }>("/api/cron/list", {})
          .catch(() => null),
      ]);

      if (agentRes && agentRes.ok) {
        setAgentData(agentRes);
      } else {
        setAgentError(
          (agentRes as { error?: string } | null)?.error ||
            "Failed to load agent status",
        );
      }

      if (profilesRes && profilesRes.ok) {
        setProfiles(profilesRes.profiles || []);
      } else {
        setProfiles([]);
      }

      if (cronRes && cronRes.ok) {
        setCronJobCount((cronRes.jobs || []).length);
      } else {
        setCronJobCount(0);
      }
    } catch {
      setAgentError("Failed to load system status");
    } finally {
      setAgentLoading(false);
      setGwLoading(false);
    }

    try {
      const authRes = await api.get<{
        ok: boolean;
        providers: { name: string; set: boolean }[];
      }>("/api/auth/providers");
      if (authRes && authRes.ok) {
        setAuthProviders(authRes.providers || []);
      }
    } catch {
      // leave empty
    } finally {
      setAuthLoading(false);
    }

    try {
      const checkRes = await api.get<{
        ok: boolean;
        checks: { ok: boolean; label: string; detail?: string }[];
      }>("/api/setup/check");
      if (checkRes && checkRes.ok) {
        setSetupChecks(checkRes.checks || []);
      }
    } catch {
      // leave empty
    } finally {
      setSetupLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData, refreshKey]);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-lg font-bold uppercase tracking-wider">Home</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            System overview
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => router.push("/chat")}>
            <RiTerminalLine />
            Terminal
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
          >
            <RiRefreshLine />
            Refresh
          </Button>
        </div>
      </div>

      {/* 4-Column Grid */}
      <div className="grid grid-cols-4 gap-4">
        {/* Agent Overview */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Agent Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {agentLoading ? (
              <Spinner />
            ) : agentError ? (
              <p className="text-destructive">{agentError}</p>
            ) : agentData ? (
              <>
                <StatRow
                  label="Model"
                  value={String(agentData.model || "N/A")}
                />
                <StatRow
                  label="Provider"
                  value={String(agentData.provider || "N/A")}
                />
                <StatRow
                  label="Gateway"
                  value={String(agentData.gatewayStatus || "N/A")}
                  variant={
                    String(agentData.gatewayStatus || "").includes("running")
                      ? "success"
                      : "destructive"
                  }
                />
                <StatRow
                  label="API Keys"
                  value={
                    agentData.apiKeys
                      ? `${(agentData.apiKeys as { active: number; total: number }).active}/${(agentData.apiKeys as { active: number; total: number }).total} active`
                      : "N/A"
                  }
                />
                <StatRow
                  label="Platforms"
                  value={
                    Array.isArray(agentData.platforms)
                      ? (
                          agentData.platforms as {
                            name: string;
                            configured: boolean;
                          }[]
                        )
                          .filter((p) => p.configured)
                          .map((p) => p.name)
                          .join(", ") || "None"
                      : "N/A"
                  }
                />
                <StatRow label="Cron" value={`${cronJobCount ?? 0} jobs`} />
                <StatRow
                  label="Sessions"
                  value={`${agentData.activeSessions ?? 0} active`}
                />
              </>
            ) : (
              <p className="text-muted-foreground">No data available</p>
            )}
          </CardContent>
        </Card>

        {/* Gateways */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Gateways
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {gwLoading ? (
              <Spinner />
            ) : profiles.length > 0 ? (
              profiles.map((p) => (
                <StatRow
                  key={p.name}
                  label={p.name}
                  value={
                    p.gateway?.includes("running") ? "● running" : "○ stopped"
                  }
                  variant={
                    p.gateway?.includes("running") ? "success" : "destructive"
                  }
                />
              ))
            ) : (
              <p className="text-muted-foreground">No profiles</p>
            )}
          </CardContent>
        </Card>

        {/* Hermes Auth */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Hermes Auth
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {authLoading ? (
              <Spinner />
            ) : authProviders.length > 0 ? (
              authProviders.map((p) => (
                <StatRow
                  key={p.name}
                  label={p.name}
                  value={p.set ? "● set" : "○ not set"}
                  variant={p.set ? "success" : "destructive"}
                />
              ))
            ) : (
              <p className="text-muted-foreground">Auth info unavailable</p>
            )}
          </CardContent>
        </Card>

        {/* Setup Health */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Setup Health
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-xs">
            {setupLoading ? (
              <Spinner />
            ) : setupChecks.length > 0 ? (
              setupChecks.map((c, i) => (
                <div key={i} className="flex items-center gap-1.5 py-0.5">
                  <span
                    className={c.ok ? "text-green-500" : "text-destructive"}
                  >
                    {c.ok ? "●" : "○"}
                  </span>
                  <span>{c.label}</span>
                  {c.detail && (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {c.detail}
                    </span>
                  )}
                </div>
              ))
            ) : (
              <p className="text-muted-foreground">No check data available</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── StatRow helper ───────────────────────────────────────────────────────────

function StatRow({
  label,
  value,
  variant,
}: {
  label: string;
  value: string;
  variant?: "success" | "destructive";
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <Badge
        variant={
          variant === "destructive"
            ? "destructive"
            : variant === "success"
              ? "secondary"
              : "secondary"
        }
        className="font-normal"
      >
        {value}
      </Badge>
    </div>
  );
}
