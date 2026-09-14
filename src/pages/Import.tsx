import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Upload,
  CheckCircle,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  X,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useCacheInvalidation } from "@/hooks/useSharedQueries";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { useBilling } from "@/hooks/useBilling";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import ExportInstructionsPanel from "@/components/import/ExportInstructionsPanel";
import ImportErrorAlert from "@/components/import/ImportErrorAlert";
import ImportWarnings from "@/components/import/ImportWarnings";
import { ImportError, importToastPayload, readFunctionError } from "@/lib/importErrors";

const SAMPLE_CSV = `Name,Entity Type,ABN,ACN,Relationship Type,Related To
"Smith Family Trust",Trust,12345678901,,"trustee","Smith Corp Pty Ltd"
"Smith Corp Pty Ltd",Company,98765432109,123456789,"director","John Smith"
"John Smith",Individual,,,,"";`;

/** Largest single upload we accept; above this the request body is rejected. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;
/** Key used to re-attach to a running job after a page refresh. */
const ACTIVE_JOB_KEY = "strukcha.import.activeJob";

interface Progress {
  phase?: string;
  rowIndex?: number;
  totalRowsParsed?: number;
  entitiesCreated?: number;
  entitiesUpdated?: number;
  relationshipsCreated?: number;
  relationshipsSkipped?: number;
  structuresCreated?: number;
  structuresSkippedLimit?: number;
  rowsSkippedLimit?: number;
  structureLimit?: number;
  limitCode?: string | null;
  blockedGroups?: string[];
  warnings?: string[];
  error?: string;
  errorCode?: string;
}

export default function Import() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { invalidateStructures } = useCacheInvalidation();
  const { billing, reload: reloadBilling } = useBilling();

  const [file, setFile] = useState<File | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Progress | null>(null);
  const [importError, setImportError] = useState<unknown>(null);
  const [resumableJobId, setResumableJobId] = useState<string | null>(null);
  const [stage, setStage] = useState<"idle" | "uploading" | "preparing" | "importing" | "finishing">("idle");
  const [percent, setPercent] = useState(0);
  const [records, setRecords] = useState<{ done: number; total: number } | null>(null);
  const [importLogs, setImportLogs] = useState<any[]>([]);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const cancelled = useRef(false);

  // ── Capacity, straight from the server-side subscription check ───────────
  const unlimitedStructures = billing?.unlimited_structures === true;
  const accessEnabled = billing ? billing.access_enabled !== false : true;
  const structureLimit = unlimitedStructures ? null : billing?.diagram_limit ?? null;
  const structureCount = billing?.diagram_count ?? null;
  const freeSlots =
    structureLimit !== null && structureCount !== null
      ? Math.max(0, structureLimit - structureCount)
      : null;
  const limitReached = freeSlots === 0;
  const blockedByBilling = !accessEnabled;

  const [analysing, setAnalysing] = useState(false);
  const [preflight, setPreflight] = useState<{
    groups: number;
    newGroups: number;
    existingGroups: number;
    newNames: string[];
    rows: number;
    freeSlots: number | null;
    fits: boolean;
  } | null>(null);

  /** Pull the client-group names out of an XPM CSV/XML export, client-side. */
  const extractGroupNames = (text: string, isXml: boolean): { names: Set<string>; rows: number; looksValid: boolean } => {
    const names = new Set<string>();
    const push = (raw: string) => {
      for (const g of raw.split(";").map((s) => s.trim()).filter(Boolean)) names.add(g);
    };
    if (isXml) {
      const re = /<Client-Groups>([\s\S]*?)<\/Client-Groups>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) push(m[1].trim());
      const rows = (text.match(/<Record>/gi) ?? []).length;
      return { names, rows, looksValid: rows > 0 && /<Client-Client>/i.test(text) };
    }
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) return { names, rows: 0, looksValid: false };
    const splitLine = (line: string): string[] => {
      const out: string[] = [];
      let cur = "";
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q;
        } else if (ch === "," && !q) { out.push(cur.trim()); cur = ""; }
        else cur += ch;
      }
      out.push(cur.trim());
      return out;
    };
    const header = splitLine(lines[0]).map((h) => h.replace(/^"+|"+$/g, "").trim().toLowerCase());
    const gi = header.findIndex((h) => h.includes("group"));
    const ci = header.findIndex((h) => h.includes("client"));
    const ri = header.findIndex((h) => h.includes("relationship"));
    if (gi >= 0) {
      for (let i = 1; i < lines.length; i++) {
        const cols = splitLine(lines[i]).map((c) => c.replace(/^"+|"+$/g, "").trim());
        if (cols[gi]) push(cols[gi]);
      }
    }
    return { names, rows: lines.length - 1, looksValid: ci >= 0 && ri >= 0 };
  };

  /** Read the file once, validate it, and check it against real capacity. */
  const analyseFile = async (f: File) => {
    setAnalysing(true);
    setPreflight(null);
    setFileText(null);
    try {
      if (f.size > MAX_FILE_BYTES) {
        throw new ImportError(
          "file_too_large",
          "File too large",
          `${(f.size / 1024 / 1024).toFixed(1)} MB uploaded, ${MAX_FILE_BYTES / 1024 / 1024} MB maximum.`,
        );
      }
      let text: string;
      try {
        text = await f.text();
      } catch (e) {
        throw new ImportError("file_unreadable", "Could not read file", String(e));
      }
      const isXml = f.name.toLowerCase().endsWith(".xml");
      const { names, rows, looksValid } = extractGroupNames(text, isXml);
      if (rows === 0) throw new ImportError("no_records", "No records in file");
      if (!looksValid) throw new ImportError("wrong_report", "Not a Client Relationships Report");

      setFileText(text);

      const { data: existing } = await supabase
        .from("structures")
        .select("name")
        .is("deleted_at", null)
        .is("archived_at", null);
      const existingNames = new Set((existing ?? []).map((s: any) => String(s.name)));
      const newNames: string[] = [];
      names.forEach((g) => {
        if (!existingNames.has(g)) newNames.push(g);
      });
      setPreflight({
        groups: names.size,
        newGroups: newNames.length,
        existingGroups: names.size - newNames.length,
        newNames,
        rows,
        freeSlots,
        fits: freeSlots === null || newNames.length <= freeSlots,
      });
    } catch (err) {
      setFile(null);
      setFileText(null);
      setImportError(err);
      const payload = importToastPayload(err);
      toast({ title: payload.title, description: payload.description, variant: "destructive" });
    } finally {
      setAnalysing(false);
    }
  };

  /** Monotonic progress — never let the bar jump backwards. */
  const advance = (next: number) => setPercent((prev) => Math.max(prev, Math.min(99, next)));

  const STAGE_LABEL: Record<string, string> = {
    uploading: "Uploading file…",
    preparing: "Preparing data…",
    importing: "Importing records…",
    finishing: "Almost done…",
  };

  const fetchLogs = useCallback(async () => {
    const { data } = await supabase
      .from("import_logs")
      .select("id, file_name, status, result, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (data) setImportLogs(data);
  }, []);

  useEffect(() => {
    if (!user) return;
    void fetchLogs();
  }, [user, result, fetchLogs]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".csv") && !lower.endsWith(".xml")) {
      toast({
        title: "Unsupported file type",
        description: "Export the Client Relationships Report as CSV or XML and upload that file.",
        variant: "destructive",
      });
      return;
    }
    setFile(f);
    setResult(null);
    setImportError(null);
    setResumableJobId(null);
    void analyseFile(f);
  };

  const clearFile = () => {
    setFile(null);
    setFileText(null);
    setPreflight(null);
    setImportError(null);
  };

  /** Poll a job with backoff until it finishes. Safe to call after a refresh. */
  const trackJob = useCallback(async (jobId: string): Promise<{ status: string; result: Progress }> => {
    const started = Date.now();
    const TIMEOUT_MS = 30 * 60 * 1000;
    let delay = 800;
    while (Date.now() - started < TIMEOUT_MS) {
      if (cancelled.current) return { status: "processing", result: {} };
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(5000, Math.round(delay * 1.25));
      const { data } = await supabase
        .from("import_logs")
        .select("status, result")
        .eq("id", jobId)
        .maybeSingle();
      if (!data) continue;
      const res = (data.result ?? {}) as Progress;
      if (data.status === "processing") {
        const total = Number(res?.totalRowsParsed ?? 0);
        const done = Number(res?.rowIndex ?? 0);
        if (total > 0) {
          setRecords({ done, total });
          advance(15 + (done / total) * 82);
          setStage(done >= total ? "finishing" : "importing");
        } else {
          setStage("importing");
        }
        continue;
      }
      return { status: data.status, result: res };
    }
    throw new ImportError(
      "worker_timeout",
      "Import exceeded the maximum tracking window",
      `Job ${jobId} was still processing after 30 minutes.`,
    );
  }, []);

  /** Shared tail: apply a finished job's outcome to the UI. */
  const finishJob = useCallback(
    (jobId: string, final: { status: string; result: Progress }) => {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      if (final.status === "failed") {
        setResumableJobId(jobId);
        throw {
          code: final.result?.errorCode,
          message: final.result?.error || "The import failed while processing.",
          detail: final.result?.error ?? "",
        };
      }
      setStage("finishing");
      setPercent(100);
      setResult(final.result);
      setResumableJobId(null);
      invalidateStructures();
      void reloadBilling();
      const skipped = final.result?.structuresSkippedLimit ?? 0;
      toast({
        title: skipped > 0 ? "Import finished with skipped groups" : "Import complete",
        description:
          skipped > 0
            ? `${final.result?.entitiesCreated ?? 0} clients imported. ${skipped} client group${skipped === 1 ? "" : "s"} could not be created — no structure slots left.`
            : `${final.result?.entitiesCreated ?? 0} clients and ${final.result?.relationshipsCreated ?? 0} relationships processed.`,
      });
    },
    [invalidateStructures, reloadBilling, toast],
  );

  const runImport = async (opts?: { resumeJobId?: string }) => {
    if (!user) return;
    const resumeJobId = opts?.resumeJobId;
    if (!resumeJobId) {
      if (!file || !fileText) return;
      if (blockedByBilling) {
        const payload = importToastPayload(new ImportError("subscription_inactive"));
        toast({ title: payload.title, description: payload.description, variant: "destructive" });
        return;
      }
      if (limitReached) {
        const payload = importToastPayload(new ImportError("capacity_blocked"));
        toast({ title: payload.title, description: payload.description, variant: "destructive" });
        return;
      }
    }

    cancelled.current = false;
    setImporting(true);
    setResult(null);
    setImportError(null);
    setRecords(null);
    setPercent(0);
    setStage(resumeJobId ? "importing" : "uploading");

    const creep = setInterval(() => setPercent((prev) => (prev < 95 ? prev + 0.4 : prev)), 400);

    try {
      let jobId = resumeJobId;

      if (!jobId) {
        const { data, error } = await supabase.functions.invoke("import-xpm", {
          body: { fileName: file!.name, content: fileText },
        });
        if (error) throw await readFunctionError(error);
        if (data?.error) throw { code: data.code, message: data.error, detail: data.detail ?? "" };
        advance(15);
        setStage("preparing");
        jobId = data?.jobId as string | undefined;
        if (!jobId) {
          setResult(data);
          invalidateStructures();
          toast({ title: "Import complete", description: "Your workspace has been updated." });
          return;
        }
        if (data?.totalRowsParsed) setRecords({ done: 0, total: data.totalRowsParsed });
      } else {
        const { data, error } = await supabase.functions.invoke("import-xpm", {
          body: { resumeJobId: jobId },
        });
        if (error) throw await readFunctionError(error);
        if (data?.error) throw { code: data.code, message: data.error, detail: data.detail ?? "" };
      }

      localStorage.setItem(ACTIVE_JOB_KEY, jobId);
      const final = await trackJob(jobId);
      if (cancelled.current) return;
      finishJob(jobId, final);
    } catch (err: unknown) {
      if (cancelled.current) return;
      setImportError(err);
      const payload = importToastPayload(err);
      toast({ title: payload.title, description: payload.description, variant: "destructive" });
    } finally {
      clearInterval(creep);
      setImporting(false);
      setStage("idle");
      void fetchLogs();
    }
  };

  // Re-attach to a job that was running when the page was refreshed.
  useEffect(() => {
    if (!user) return;
    const jobId = localStorage.getItem(ACTIVE_JOB_KEY);
    if (!jobId) return;
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("import_logs")
        .select("status, result")
        .eq("id", jobId)
        .maybeSingle();
      if (!alive || !data) {
        localStorage.removeItem(ACTIVE_JOB_KEY);
        return;
      }
      if (data.status !== "processing") {
        localStorage.removeItem(ACTIVE_JOB_KEY);
        if (data.status === "failed") setResumableJobId(jobId);
        else setResult((data.result ?? {}) as Progress);
        return;
      }
      cancelled.current = false;
      setImporting(true);
      setStage("importing");
      try {
        const final = await trackJob(jobId);
        if (!alive || cancelled.current) return;
        finishJob(jobId, final);
      } catch (err) {
        if (alive && !cancelled.current) setImportError(err);
      } finally {
        if (alive) {
          setImporting(false);
          setStage("idle");
        }
      }
    })();
    return () => {
      alive = false;
      cancelled.current = true;
    };
    // Runs once per signed-in session mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const stopTracking = () => {
    cancelled.current = true;
    setImporting(false);
    setStage("idle");
    toast({
      title: "Stopped watching",
      description: "The import keeps running in the background. Check Import History for the result.",
    });
  };

  const handleDownloadSample = () => {
    const url = URL.createObjectURL(new Blob([SAMPLE_CSV], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "sample-import.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return (
          <Badge variant="default" className="bg-primary/15 text-primary border-primary/20">
            Completed
          </Badge>
        );
      case "failed":
        return <Badge variant="destructive">Failed</Badge>;
      case "processing":
        return <Badge variant="secondary">Processing</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getRecordCount = (log: any) => {
    if (!log.result) return "—";
    const r = log.result as Progress;
    const entities = (r.entitiesCreated ?? 0) + (r.entitiesUpdated ?? 0);
    return `${entities} clients, ${r.relationshipsCreated ?? 0} relationships`;
  };

  const canImport =
    !!file && !!fileText && !importing && !analysing && !limitReached && !blockedByBilling &&
    (!preflight || preflight.fits);

  return (
    <div className="mb-2 min-w-0 space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Import</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Upload a Client Relationships Report from Xero Practice Manager to build structures.
        </p>
      </div>

      {/* Upload on the left, export instructions on the right */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-6">
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Upload XPM report</CardTitle>
            <CardDescription>CSV or XML, up to {MAX_FILE_BYTES / 1024 / 1024} MB.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {blockedByBilling && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Subscription isn't active</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p className="text-sm">New structures can't be created until billing is up to date.</p>
                  <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                    <Link to="/settings?tab=billing">Open billing</Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {!blockedByBilling && limitReached && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>No structure slots left</AlertTitle>
                <AlertDescription className="space-y-2">
                  <p className="text-sm">
                    You're using all {structureLimit} structures in your plan. Free up a slot or upgrade
                    before importing another report.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <Link to="/structures">Manage structures</Link>
                    </Button>
                    <Button asChild size="sm" className="h-7 text-xs">
                      <Link to="/settings?tab=billing">Upgrade plan</Link>
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            {/* Capacity summary — always honest, for every firm */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                Structures used:{" "}
                <strong className="text-foreground">{structureCount?.toLocaleString() ?? "—"}</strong>
              </span>
              <span className="text-muted-foreground">
                Limit:{" "}
                <strong className="text-foreground">
                  {unlimitedStructures ? "Unlimited" : structureLimit?.toLocaleString() ?? "—"}
                </strong>
              </span>
              <span className="text-muted-foreground">
                Available:{" "}
                <strong className="text-foreground">
                  {unlimitedStructures ? "Unlimited" : freeSlots?.toLocaleString() ?? "—"}
                </strong>
              </span>
            </div>

            <label
              aria-disabled={limitReached || blockedByBilling || importing}
              className={`flex min-h-[6rem] flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-input p-4 text-muted-foreground transition-colors sm:p-6 ${
                limitReached || blockedByBilling || importing
                  ? "pointer-events-none cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:border-primary hover:text-foreground"
              }`}
            >
              <Upload className="h-5 w-5 shrink-0" />
              <span className="min-w-0 max-w-full break-words text-center text-sm font-medium">
                {limitReached || blockedByBilling
                  ? "Upload unavailable"
                  : file
                    ? file.name
                    : "Choose a CSV or XML file"}
              </span>
              {file && (
                <span className="text-xs text-muted-foreground">
                  {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              )}
              <input
                type="file"
                accept=".csv,.xml"
                className="hidden"
                disabled={limitReached || blockedByBilling || importing}
                onChange={handleFileChange}
              />
            </label>

            {file && !importing && (
              <button
                type="button"
                onClick={clearFile}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
                Remove file
              </button>
            )}

            {analysing && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Checking the file and your available space…
              </p>
            )}

            {file && !analysing && preflight && !limitReached && !blockedByBilling && (
              <Alert variant={preflight.fits ? "default" : "destructive"}>
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>
                  {preflight.fits ? "Ready to import" : "Not enough structure slots"}
                </AlertTitle>
                <AlertDescription className="space-y-2 text-xs">
                  <p>
                    {preflight.rows.toLocaleString()} record{preflight.rows === 1 ? "" : "s"} ·{" "}
                    {preflight.groups.toLocaleString()} client group
                    {preflight.groups === 1 ? "" : "s"} — {preflight.newGroups.toLocaleString()} new,{" "}
                    {preflight.existingGroups.toLocaleString()} already in your workspace.
                    {preflight.rows > 5000 && " Large files can take a few minutes."}
                  </p>
                  {!preflight.fits && preflight.freeSlots !== null && (
                    <>
                      <p>
                        This file needs {preflight.newGroups.toLocaleString()} new structures but only{" "}
                        {preflight.freeSlots.toLocaleString()} slot
                        {preflight.freeSlots === 1 ? "" : "s"} remain. These groups would be skipped:{" "}
                        {preflight.newNames.slice(preflight.freeSlots, preflight.freeSlots + 5).join(", ")}
                        {preflight.newGroups - preflight.freeSlots > 5
                          ? ` and ${(preflight.newGroups - preflight.freeSlots - 5).toLocaleString()} more`
                          : ""}
                        .
                      </p>
                      <div className="flex flex-wrap gap-2 pt-0.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => void runImport()}
                        >
                          Import what fits
                        </Button>
                        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                          <Link to="/structures">Manage structures</Link>
                        </Button>
                        <Button asChild size="sm" className="h-7 text-xs">
                          <Link to="/settings?tab=billing">Upgrade plan</Link>
                        </Button>
                      </div>
                    </>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <Button onClick={() => void runImport()} disabled={!canImport} className="w-full">
              {importing ? "Importing…" : analysing ? "Checking file…" : "Import"}
            </Button>

            {importing && (
              <div className="space-y-1.5 rounded-md border bg-muted/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">{STAGE_LABEL[stage] ?? "Importing records…"}</p>
                  <span className="text-xs tabular-nums text-muted-foreground">{Math.round(percent)}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out"
                    style={{ width: `${Math.max(3, percent)}%` }}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  {records && records.total > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {records.done.toLocaleString()} of {records.total.toLocaleString()} records
                    </p>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    onClick={stopTracking}
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                  >
                    Stop watching
                  </button>
                </div>
              </div>
            )}

            {importError && (
              <ImportErrorAlert
                error={importError}
                retrying={importing}
                retryLabel={resumableJobId ? "Resume import" : "Try again"}
                onRetry={() =>
                  void runImport(resumableJobId ? { resumeJobId: resumableJobId } : undefined)
                }
              />
            )}
          </CardContent>
        </Card>

        <ExportInstructionsPanel onDownloadSample={handleDownloadSample} />
      </div>

      {/* Import result */}
      {result && (
        <Card className="min-w-0">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              {(result.warnings?.length ?? 0) > 0 || (result.structuresSkippedLimit ?? 0) > 0 ? (
                <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
              ) : (
                <CheckCircle className="h-5 w-5 shrink-0 text-primary" />
              )}
              Import results
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Records read", value: result.totalRowsParsed ?? 0 },
                {
                  label: "Clients created / updated",
                  value: `${result.entitiesCreated ?? 0} / ${result.entitiesUpdated ?? 0}`,
                },
                {
                  label: "Relationships created",
                  value: result.relationshipsCreated ?? 0,
                },
                { label: "Structures created", value: result.structuresCreated ?? 0 },
              ].map((m) => (
                <div key={m.label}>
                  <p className="text-lg font-semibold tabular-nums text-foreground">
                    {typeof m.value === "number" ? m.value.toLocaleString() : m.value}
                  </p>
                  <p className="text-xs text-muted-foreground">{m.label}</p>
                </div>
              ))}
            </div>

            {(result.structuresSkippedLimit ?? 0) > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>
                  {result.limitCode === "subscription_inactive"
                    ? "Groups skipped — subscription inactive"
                    : "Groups skipped — no structure slots"}
                </AlertTitle>
                <AlertDescription className="space-y-2 text-xs">
                  <p>
                    {result.structuresSkippedLimit?.toLocaleString()} client group
                    {result.structuresSkippedLimit === 1 ? "" : "s"} could not be created
                    {(result.rowsSkippedLimit ?? 0) > 0
                      ? `, affecting ${result.rowsSkippedLimit!.toLocaleString()} record${result.rowsSkippedLimit === 1 ? "" : "s"}`
                      : ""}
                    . Clients and relationships were still imported.
                  </p>
                  {(result.blockedGroups?.length ?? 0) > 0 && (
                    <p>
                      Skipped: {result.blockedGroups!.slice(0, 8).join(", ")}
                      {result.blockedGroups!.length > 8
                        ? ` and ${(result.blockedGroups!.length - 8).toLocaleString()} more`
                        : ""}
                      .
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2 pt-0.5">
                    <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                      <Link to="/structures">Manage structures</Link>
                    </Button>
                    <Button asChild size="sm" className="h-7 text-xs">
                      <Link to="/settings?tab=billing">Upgrade plan</Link>
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>
            )}

            <ImportWarnings warnings={result.warnings ?? []} />

            <Button asChild variant="outline" size="sm" className="h-8 text-xs">
              <Link to="/structures">View structures</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Import history */}
      <Card className="mb-2 min-w-0">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Import history</CardTitle>
          <CardDescription>Previous imports for your workspace.</CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 p-3 pt-0 sm:p-6 sm:pt-0">
          {importLogs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">No imports yet.</p>
          ) : (
            <div className="-mx-1 overflow-x-auto rounded-md border sm:mx-0">
              <Table className="min-w-[36rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Date</TableHead>
                    <TableHead>File</TableHead>
                    <TableHead className="min-w-[10rem]">Imported</TableHead>
                    <TableHead className="whitespace-nowrap">Status</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importLogs.map((log) => {
                    const r = (log.result ?? {}) as Progress;
                    const open = expandedLog === log.id;
                    return (
                      <>
                        <TableRow
                          key={log.id}
                          className="cursor-pointer"
                          onClick={() => setExpandedLog(open ? null : log.id)}
                        >
                          <TableCell className="whitespace-nowrap align-top text-xs">
                            {format(new Date(log.created_at), "d MMM yyyy, h:mm a")}
                          </TableCell>
                          <TableCell className="max-w-[10rem] break-words align-top text-xs font-medium sm:max-w-[14rem]">
                            {log.file_name || "—"}
                          </TableCell>
                          <TableCell className="max-w-[14rem] break-words align-top text-xs">
                            {getRecordCount(log)}
                          </TableCell>
                          <TableCell className="whitespace-nowrap align-top">
                            {getStatusBadge(log.status)}
                          </TableCell>
                          <TableCell className="align-top">
                            {open ? (
                              <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow key={`${log.id}-detail`}>
                            <TableCell colSpan={5} className="bg-muted/30">
                              <div className="space-y-2 py-1 text-xs">
                                <p className="text-muted-foreground">
                                  {(r.rowIndex ?? 0).toLocaleString()} of{" "}
                                  {(r.totalRowsParsed ?? 0).toLocaleString()} records processed ·{" "}
                                  {(r.structuresCreated ?? 0).toLocaleString()} structures created ·{" "}
                                  {(r.relationshipsSkipped ?? 0).toLocaleString()} relationships skipped
                                </p>
                                {(r.structuresSkippedLimit ?? 0) > 0 && (
                                  <p className="text-destructive">
                                    {r.structuresSkippedLimit!.toLocaleString()} group
                                    {r.structuresSkippedLimit === 1 ? "" : "s"} skipped —{" "}
                                    {r.limitCode === "subscription_inactive"
                                      ? "subscription inactive"
                                      : "structure limit reached"}
                                    {(r.blockedGroups?.length ?? 0) > 0
                                      ? `: ${r.blockedGroups!.slice(0, 5).join(", ")}${r.blockedGroups!.length > 5 ? "…" : ""}`
                                      : ""}
                                  </p>
                                )}
                                {log.status === "failed" && (
                                  <div className="space-y-2">
                                    <ImportErrorAlert
                                      error={{ code: r.errorCode, message: r.error, detail: r.error }}
                                      retrying={importing}
                                      retryLabel="Resume import"
                                      onRetry={() => void runImport({ resumeJobId: log.id })}
                                    />
                                  </div>
                                )}
                                {(r.warnings?.length ?? 0) > 0 && (
                                  <ImportWarnings warnings={r.warnings ?? []} />
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
