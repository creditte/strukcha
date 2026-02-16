import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, Download, AlertTriangle, Plus, Minus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { getEntityLabel } from "@/lib/entityTypes";
import {
  normaliseDataset,
  computeDiff,
  filterDiffRels,
  type DiffResult,
  type DiffFilter,
  type RawEntity,
  type RawRelationship,
} from "@/lib/structureDiff";
import { loadSnapshotData } from "@/hooks/useSnapshots";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// ── Version option ──

interface VersionOption {
  id: string;
  label: string;
  type: "live" | "scenario" | "snapshot";
  structureId?: string;
  snapshotId?: string;
}

// ── Data loading ──

async function loadLiveData(structureId: string): Promise<{ entities: RawEntity[]; relationships: RawRelationship[] }> {
  const { data: seRows } = await supabase
    .from("structure_entities")
    .select("entity_id")
    .eq("structure_id", structureId);

  const entityIds = (seRows ?? []).map((r) => r.entity_id);
  if (entityIds.length === 0) return { entities: [], relationships: [] };

  const { data: srRows } = await supabase
    .from("structure_relationships")
    .select("relationship_id")
    .eq("structure_id", structureId);

  const relIds = (srRows ?? []).map((r) => r.relationship_id);

  const [entResult, relResult] = await Promise.all([
    supabase
      .from("entities")
      .select("id, name, entity_type, xpm_uuid, abn, acn, is_operating_entity, is_trustee_company, created_at")
      .in("id", entityIds)
      .is("deleted_at", null),
    relIds.length > 0
      ? supabase
          .from("relationships")
          .select("id, from_entity_id, to_entity_id, relationship_type, ownership_percent, ownership_units, ownership_class")
          .in("id", relIds)
          .is("deleted_at", null)
      : Promise.resolve({ data: [] }),
  ]);

  return {
    entities: (entResult.data ?? []) as RawEntity[],
    relationships: (relResult.data ?? []) as RawRelationship[],
  };
}

async function loadSnapshotRaw(snapshotId: string): Promise<{ entities: RawEntity[]; relationships: RawRelationship[] }> {
  const data = await loadSnapshotData(snapshotId);
  const entities: RawEntity[] = data.entities.map((e) => ({
    id: e.id,
    name: e.name,
    entity_type: e.entity_type,
    xpm_uuid: (e as any).xpm_uuid ?? null,
    abn: e.abn,
    acn: e.acn,
    is_operating_entity: e.is_operating_entity,
    is_trustee_company: e.is_trustee_company,
  }));
  const relationships: RawRelationship[] = data.relationships.map((r) => ({
    id: r.id,
    from_entity_id: r.from_entity_id,
    to_entity_id: r.to_entity_id,
    relationship_type: r.relationship_type,
    ownership_percent: r.ownership_percent,
    ownership_units: r.ownership_units,
    ownership_class: r.ownership_class,
  }));
  return { entities, relationships };
}

async function loadVersion(opt: VersionOption) {
  if (opt.type === "snapshot" && opt.snapshotId) {
    return loadSnapshotRaw(opt.snapshotId);
  }
  return loadLiveData(opt.structureId ?? opt.id);
}

// ── Capitalize helper ──
function capitalize(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Component ──

export default function StructureCompare() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const [structureName, setStructureName] = useState("");
  const [versions, setVersions] = useState<VersionOption[]>([]);
  const [leftId, setLeftId] = useState<string>("");
  const [rightId, setRightId] = useState<string>("");
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<DiffFilter>("all");

  // Load available versions
  useEffect(() => {
    if (!id) return;

    async function loadVersions() {
      // Current structure
      const { data: struct } = await supabase
        .from("structures")
        .select("name, is_scenario, scenario_label, parent_structure_id")
        .eq("id", id)
        .single();

      setStructureName(struct?.name ?? "");

      const opts: VersionOption[] = [];

      // Live structure
      opts.push({
        id: `live:${id}`,
        label: `Live — ${struct?.name ?? "Structure"}`,
        type: "live",
        structureId: id,
      });

      // Scenarios derived from this structure
      const { data: scenarios } = await supabase
        .from("structures")
        .select("id, name, scenario_label")
        .eq("parent_structure_id", id)
        .eq("is_scenario", true)
        .is("deleted_at", null);

      for (const s of scenarios ?? []) {
        opts.push({
          id: `scenario:${s.id}`,
          label: `Scenario — ${s.name}${s.scenario_label ? ` (${s.scenario_label})` : ""}`,
          type: "scenario",
          structureId: s.id,
        });
      }

      // If this IS a scenario, also include parent
      if ((struct as any)?.is_scenario && (struct as any)?.parent_structure_id) {
        const parentId = (struct as any).parent_structure_id;
        const { data: parent } = await supabase
          .from("structures")
          .select("name")
          .eq("id", parentId)
          .single();
        opts.push({
          id: `live:${parentId}`,
          label: `Live — ${parent?.name ?? "Parent"}`,
          type: "live",
          structureId: parentId,
        });
      }

      // Snapshots for this structure
      const { data: snaps } = await supabase
        .from("structure_snapshots")
        .select("id, name, created_at, structure_id")
        .eq("structure_id", id)
        .order("created_at", { ascending: false });

      for (const s of snaps ?? []) {
        opts.push({
          id: `snapshot:${s.id}`,
          label: `Snapshot — ${s.name} (${new Date(s.created_at).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })})`,
          type: "snapshot",
          snapshotId: s.id,
          structureId: id,
        });
      }

      // Also load snapshots for scenarios
      const scenarioIds = (scenarios ?? []).map((s) => s.id);
      if (scenarioIds.length > 0) {
        const { data: scenarioSnaps } = await supabase
          .from("structure_snapshots")
          .select("id, name, created_at, structure_id")
          .in("structure_id", scenarioIds)
          .order("created_at", { ascending: false });

        for (const s of scenarioSnaps ?? []) {
          const scenario = (scenarios ?? []).find((sc) => sc.id === s.structure_id);
          opts.push({
            id: `snapshot:${s.id}`,
            label: `Snapshot — ${s.name} (${scenario?.name ?? "Scenario"}, ${new Date(s.created_at).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })})`,
            type: "snapshot",
            snapshotId: s.id,
            structureId: s.structure_id,
          });
        }
      }

      setVersions(opts);

      // Set defaults
      const defaultRight = searchParams.get("right");
      setLeftId(opts[0]?.id ?? "");
      if (defaultRight && opts.some((o) => o.id === defaultRight)) {
        setRightId(defaultRight);
      } else if (opts.length > 1) {
        setRightId(opts[1]?.id ?? "");
      }
    }

    loadVersions();
  }, [id, searchParams]);

  // Run comparison
  const runCompare = useCallback(async () => {
    const left = versions.find((v) => v.id === leftId);
    const right = versions.find((v) => v.id === rightId);
    if (!left || !right || left.id === right.id) return;

    setLoading(true);
    try {
      const [leftData, rightData] = await Promise.all([loadVersion(left), loadVersion(right)]);
      const baseNorm = normaliseDataset(leftData.entities, leftData.relationships);
      const compareNorm = normaliseDataset(rightData.entities, rightData.relationships);
      setDiff(computeDiff(baseNorm, compareNorm));
    } catch (e) {
      console.error("Compare failed:", e);
    } finally {
      setLoading(false);
    }
  }, [leftId, rightId, versions]);

  useEffect(() => {
    if (leftId && rightId && leftId !== rightId) {
      runCompare();
    }
  }, [leftId, rightId, runCompare]);

  // Filtered relationships
  const filteredDiff = useMemo(() => {
    if (!diff) return null;
    return {
      ...diff,
      relsAdded: filterDiffRels(diff.relsAdded, filter),
      relsRemoved: filterDiffRels(diff.relsRemoved, filter),
      relsChanged: diff.relsChanged.filter((rc) => {
        if (filter === "all") return true;
        const types = filter === "ownership"
          ? new Set(["shareholder", "beneficiary", "partner", "member"])
          : new Set(["director", "trustee", "appointer", "settlor"]);
        return types.has(rc.rel.relationship_type);
      }),
      directionChanges: filterDiffRels(
        diff.directionChanges.map((d) => ({ ...d, relationship_type: d.baseRel.relationship_type })),
        filter
      ).map((d) => ({ baseRel: (d as any).baseRel ?? d, compareRel: (d as any).compareRel ?? d })) as typeof diff.directionChanges,
    };
  }, [diff, filter]);

  const leftLabel = versions.find((v) => v.id === leftId)?.label ?? "Base";
  const rightLabel = versions.find((v) => v.id === rightId)?.label ?? "Compare";

  // Export PDF
  const exportSummaryPdf = useCallback(() => {
    if (!filteredDiff) return;
    const d = filteredDiff;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();

    pdf.setFontSize(16);
    pdf.text("Compare Summary", 14, 16);
    pdf.setFontSize(9);
    pdf.setTextColor(100);
    pdf.text(`Base: ${leftLabel}`, 14, 24);
    pdf.text(`Compare: ${rightLabel}`, 14, 29);
    pdf.text(`Generated: ${new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" })}`, 14, 34);
    pdf.setTextColor(0);

    let y = 42;
    pdf.setFontSize(11);
    pdf.text("Summary", 14, y); y += 6;
    pdf.setFontSize(9);
    pdf.text(`Entities: +${d.entitiesAdded.length} added / -${d.entitiesRemoved.length} removed / ~${d.entitiesChanged.length} changed`, 14, y); y += 5;
    pdf.text(`Relationships: +${d.relsAdded.length} added / -${d.relsRemoved.length} removed / ~${d.relsChanged.length} changed`, 14, y); y += 5;
    if (d.directionChanges.length > 0) {
      pdf.text(`Direction changes: ${d.directionChanges.length}`, 14, y); y += 5;
    }
    y += 4;

    // Entity changes table
    if (d.entitiesAdded.length + d.entitiesRemoved.length + d.entitiesChanged.length > 0) {
      pdf.setFontSize(11);
      pdf.text("Entity Changes", 14, y); y += 2;
      const entRows: string[][] = [];
      for (const e of d.entitiesAdded) entRows.push(["Added", e.name, getEntityLabel(e.entity_type), ""]);
      for (const e of d.entitiesRemoved) entRows.push(["Removed", e.name, getEntityLabel(e.entity_type), ""]);
      for (const ec of d.entitiesChanged) entRows.push(["Changed", ec.entity.name, getEntityLabel(ec.entity.entity_type), ec.changes.map((c) => `${c.field}: ${c.before} → ${c.after}`).join("; ")]);

      autoTable(pdf, {
        startY: y,
        head: [["Status", "Name", "Type", "Details"]],
        body: entRows,
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
        columnStyles: { 3: { cellWidth: 60 } },
      });
      y = (pdf as any).lastAutoTable.finalY + 6;
    }

    // Relationship changes table
    if (d.relsAdded.length + d.relsRemoved.length + d.relsChanged.length + d.directionChanges.length > 0) {
      pdf.setFontSize(11);
      pdf.text("Relationship Changes", 14, y); y += 2;
      const relRows: string[][] = [];
      for (const r of d.relsAdded) relRows.push(["Added", `${r.fromName} → ${r.toName}`, capitalize(r.relationship_type), ""]);
      for (const r of d.relsRemoved) relRows.push(["Removed", `${r.fromName} → ${r.toName}`, capitalize(r.relationship_type), ""]);
      for (const rc of d.relsChanged) relRows.push(["Changed", `${rc.rel.fromName} → ${rc.rel.toName}`, capitalize(rc.rel.relationship_type), rc.changes.map((c) => `${c.field}: ${c.before} → ${c.after}`).join("; ")]);
      for (const dc of d.directionChanges) relRows.push(["Direction", `${dc.baseRel.fromName} → ${dc.baseRel.toName} became ${dc.compareRel.fromName} → ${dc.compareRel.toName}`, capitalize(dc.baseRel.relationship_type), ""]);

      autoTable(pdf, {
        startY: y,
        head: [["Status", "Relationship", "Type", "Details"]],
        body: relRows,
        styles: { fontSize: 8, cellPadding: 1.5 },
        headStyles: { fillColor: [59, 130, 246], fontSize: 8 },
        columnStyles: { 3: { cellWidth: 50 } },
      });
    }

    pdf.save(`${structureName.replace(/\s+/g, "_")}_compare_summary.pdf`);
  }, [filteredDiff, leftLabel, rightLabel, structureName]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
          <Link to={`/structures/${id}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <h1 className="text-lg font-bold tracking-tight">Compare: {structureName}</h1>
      </div>

      {/* Version selectors */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Base</label>
          <Select value={leftId} onValueChange={setLeftId}>
            <SelectTrigger className="text-sm"><SelectValue placeholder="Select base..." /></SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.id} disabled={v.id === rightId}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <ArrowRight className="h-4 w-4 text-muted-foreground mt-5 shrink-0" />

        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted-foreground mb-1 block">Compare</label>
          <Select value={rightId} onValueChange={setRightId}>
            <SelectTrigger className="text-sm"><SelectValue placeholder="Select compare..." /></SelectTrigger>
            <SelectContent>
              {versions.map((v) => (
                <SelectItem key={v.id} value={v.id} disabled={v.id === leftId}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end gap-2 mt-5">
          <Select value={filter} onValueChange={(v) => setFilter(v as DiffFilter)}>
            <SelectTrigger className="h-9 w-[130px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="ownership">Ownership</SelectItem>
              <SelectItem value="control">Control</SelectItem>
            </SelectContent>
          </Select>

          {diff && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={exportSummaryPdf}>
              <Download className="h-3.5 w-3.5" /> Export Summary
            </Button>
          )}
        </div>
      </div>

      {/* Ambiguity warning */}
      {diff && diff.ambiguousCount > 0 && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Possible match ambiguity</AlertTitle>
          <AlertDescription>
            {diff.ambiguousCount} entit{diff.ambiguousCount === 1 ? "y has" : "ies have"} duplicate names and types, making cross-version matching less reliable. Results for these entities use ID-based matching (only accurate within the same structure copy).
          </AlertDescription>
        </Alert>
      )}

      {loading && <p className="text-sm text-muted-foreground">Computing differences…</p>}

      {filteredDiff && !loading && (
        <>
          {/* Summary cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Entities</CardTitle></CardHeader>
              <CardContent className="flex items-center gap-3">
                <Badge variant="outline" className="gap-1 text-xs"><Plus className="h-3 w-3" />{filteredDiff.entitiesAdded.length}</Badge>
                <Badge variant="outline" className="gap-1 text-xs"><Minus className="h-3 w-3" />{filteredDiff.entitiesRemoved.length}</Badge>
                <Badge variant="outline" className="gap-1 text-xs"><RefreshCw className="h-3 w-3" />{filteredDiff.entitiesChanged.length}</Badge>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Relationships</CardTitle></CardHeader>
              <CardContent className="flex items-center gap-3">
                <Badge variant="outline" className="gap-1 text-xs"><Plus className="h-3 w-3" />{filteredDiff.relsAdded.length}</Badge>
                <Badge variant="outline" className="gap-1 text-xs"><Minus className="h-3 w-3" />{filteredDiff.relsRemoved.length}</Badge>
                <Badge variant="outline" className="gap-1 text-xs"><RefreshCw className="h-3 w-3" />{filteredDiff.relsChanged.length}</Badge>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium">Other</CardTitle></CardHeader>
              <CardContent className="flex items-center gap-3">
                {filteredDiff.directionChanges.length > 0 && (
                  <Badge variant="outline" className="gap-1 text-xs"><RefreshCw className="h-3 w-3" />{filteredDiff.directionChanges.length} direction</Badge>
                )}
                {filteredDiff.relsChanged.length > 0 && (
                  <Badge variant="outline" className="gap-1 text-xs">{filteredDiff.relsChanged.length} ownership Δ</Badge>
                )}
                {filteredDiff.directionChanges.length === 0 && filteredDiff.relsChanged.length === 0 && (
                  <span className="text-xs text-muted-foreground">No other changes</span>
                )}
              </CardContent>
            </Card>
          </div>

          {/* No changes */}
          {filteredDiff.entitiesAdded.length === 0 &&
           filteredDiff.entitiesRemoved.length === 0 &&
           filteredDiff.entitiesChanged.length === 0 &&
           filteredDiff.relsAdded.length === 0 &&
           filteredDiff.relsRemoved.length === 0 &&
           filteredDiff.relsChanged.length === 0 &&
           filteredDiff.directionChanges.length === 0 && (
            <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No differences found between the selected versions.</CardContent></Card>
          )}

          {/* Entities Added */}
          {filteredDiff.entitiesAdded.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5 text-green-600" /> Entities Added ({filteredDiff.entitiesAdded.length})
              </h3>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>ABN</TableHead><TableHead>ACN</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredDiff.entitiesAdded.map((e) => (
                    <TableRow key={e.key}><TableCell className="font-medium">{e.name}</TableCell><TableCell>{getEntityLabel(e.entity_type)}</TableCell><TableCell>{e.abn ?? "–"}</TableCell><TableCell>{e.acn ?? "–"}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Entities Removed */}
          {filteredDiff.entitiesRemoved.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Minus className="h-3.5 w-3.5 text-red-600" /> Entities Removed ({filteredDiff.entitiesRemoved.length})
              </h3>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>ABN</TableHead><TableHead>ACN</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredDiff.entitiesRemoved.map((e) => (
                    <TableRow key={e.key}><TableCell className="font-medium">{e.name}</TableCell><TableCell>{getEntityLabel(e.entity_type)}</TableCell><TableCell>{e.abn ?? "–"}</TableCell><TableCell>{e.acn ?? "–"}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Entities Changed */}
          {filteredDiff.entitiesChanged.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 text-amber-600" /> Entities Changed ({filteredDiff.entitiesChanged.length})
              </h3>
              <Table>
                <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Field</TableHead><TableHead>Before</TableHead><TableHead>After</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredDiff.entitiesChanged.flatMap((ec) =>
                    ec.changes.map((c, i) => (
                      <TableRow key={`${ec.entity.key}-${i}`}>
                        {i === 0 ? <TableCell rowSpan={ec.changes.length} className="font-medium align-top">{ec.entity.name}</TableCell> : null}
                        <TableCell>{c.field}</TableCell>
                        <TableCell className="text-muted-foreground">{c.before}</TableCell>
                        <TableCell>{c.after}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Relationships Added */}
          {filteredDiff.relsAdded.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Plus className="h-3.5 w-3.5 text-green-600" /> Relationships Added ({filteredDiff.relsAdded.length})
              </h3>
              <Table>
                <TableHeader><TableRow><TableHead>From</TableHead><TableHead>Type</TableHead><TableHead>To</TableHead><TableHead>Ownership</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredDiff.relsAdded.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>{r.fromName}</TableCell>
                      <TableCell>{capitalize(r.relationship_type)}</TableCell>
                      <TableCell>{r.toName}</TableCell>
                      <TableCell className="text-xs">
                        {r.ownership_percent != null ? `${r.ownership_percent}%` : ""}
                        {r.ownership_units != null ? ` ${r.ownership_units} units` : ""}
                        {r.ownership_class ? ` (${r.ownership_class})` : ""}
                        {r.ownership_percent == null && r.ownership_units == null ? "–" : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Relationships Removed */}
          {filteredDiff.relsRemoved.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Minus className="h-3.5 w-3.5 text-red-600" /> Relationships Removed ({filteredDiff.relsRemoved.length})
              </h3>
              <Table>
                <TableHeader><TableRow><TableHead>From</TableHead><TableHead>Type</TableHead><TableHead>To</TableHead><TableHead>Ownership</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredDiff.relsRemoved.map((r) => (
                    <TableRow key={r.key}>
                      <TableCell>{r.fromName}</TableCell>
                      <TableCell>{capitalize(r.relationship_type)}</TableCell>
                      <TableCell>{r.toName}</TableCell>
                      <TableCell className="text-xs">
                        {r.ownership_percent != null ? `${r.ownership_percent}%` : ""}
                        {r.ownership_units != null ? ` ${r.ownership_units} units` : ""}
                        {r.ownership_class ? ` (${r.ownership_class})` : ""}
                        {r.ownership_percent == null && r.ownership_units == null ? "–" : ""}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Relationships Changed */}
          {filteredDiff.relsChanged.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 text-amber-600" /> Ownership Changes ({filteredDiff.relsChanged.length})
              </h3>
              <Table>
                <TableHeader><TableRow><TableHead>Relationship</TableHead><TableHead>Field</TableHead><TableHead>Before</TableHead><TableHead>After</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredDiff.relsChanged.flatMap((rc) =>
                    rc.changes.map((c, i) => (
                      <TableRow key={`${rc.rel.key}-${i}`}>
                        {i === 0 ? (
                          <TableCell rowSpan={rc.changes.length} className="font-medium align-top text-xs">
                            {rc.rel.fromName} —({capitalize(rc.rel.relationship_type)})→ {rc.rel.toName}
                          </TableCell>
                        ) : null}
                        <TableCell>{c.field}</TableCell>
                        <TableCell className="text-muted-foreground">{c.before}</TableCell>
                        <TableCell>{c.after}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}

          {/* Direction Changes */}
          {filteredDiff.directionChanges.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <RefreshCw className="h-3.5 w-3.5 text-blue-600" /> Direction Changes ({filteredDiff.directionChanges.length})
              </h3>
              <Table>
                <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Base Direction</TableHead><TableHead>Compare Direction</TableHead></TableRow></TableHeader>
                <TableBody>
                  {filteredDiff.directionChanges.map((dc, i) => (
                    <TableRow key={i}>
                      <TableCell>{capitalize(dc.baseRel.relationship_type)}</TableCell>
                      <TableCell className="text-muted-foreground">{dc.baseRel.fromName} → {dc.baseRel.toName}</TableCell>
                      <TableCell>{dc.compareRel.fromName} → {dc.compareRel.toName}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
