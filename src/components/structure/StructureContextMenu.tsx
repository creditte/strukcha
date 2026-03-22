import { useEffect, useRef } from "react";
import { Plus, Trash2, Link2, Edit, Copy, User, Building2, Landmark, Shield, Users, ChevronRight } from "lucide-react";
import { getEntityIcon, getEntityLabel } from "@/lib/entityTypes";

export type ContextMenuType = "pane" | "node" | "edge";

export interface ContextMenuState {
  type: ContextMenuType;
  x: number;
  y: number;
  nodeId?: string;
  nodeName?: string;
  edgeId?: string;
  edgeLabel?: string;
  /** React Flow position for pane clicks (for placing new entities) */
  flowPosition?: { x: number; y: number };
}

interface Props {
  menu: ContextMenuState;
  onClose: () => void;
  onAddEntity: (flowPosition?: { x: number; y: number }) => void;
  onAddEntityWithType?: (entityType: string, flowPosition?: { x: number; y: number }) => void;
  onAddRelationship: (nodeId: string) => void;
  onRemoveEntity: (nodeId: string) => void;
  onRemoveRelationship: (edgeId: string) => void;
  onEditEntity?: (nodeId: string) => void;
  onDuplicateEntity?: (nodeId: string) => void;
}

const QUICK_ENTITY_TYPES = [
  { type: "Individual", label: "Individual" },
  { type: "Company", label: "Company" },
  { type: "trust_discretionary", label: "Discretionary Trust" },
  { type: "trust_unit", label: "Unit Trust" },
  { type: "smsf", label: "SMSF" },
  { type: "Partnership", label: "Partnership" },
];

export default function StructureContextMenu({
  menu, onClose, onAddEntity, onAddEntityWithType, onAddRelationship,
  onRemoveEntity, onRemoveRelationship, onEditEntity, onDuplicateEntity,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  // Pane context menu with entity type submenu
  if (menu.type === "pane") {
    return (
      <div
        ref={ref}
        className="fixed z-50 min-w-[220px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
        style={{ left: menu.x, top: menu.y }}
      >
        <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Add Entity
        </div>
        {QUICK_ENTITY_TYPES.map(({ type, label }) => {
          const Icon = getEntityIcon(type);
          return (
            <button
              key={type}
              className="flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
              onClick={() => {
                if (onAddEntityWithType) {
                  onAddEntityWithType(type, menu.flowPosition);
                } else {
                  onAddEntity(menu.flowPosition);
                }
                onClose();
              }}
            >
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  // Node context menu
  if (menu.type === "node") {
    return (
      <div
        ref={ref}
        className="fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
        style={{ left: menu.x, top: menu.y }}
      >
        {menu.nodeName && (
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground truncate max-w-[200px]">
            {menu.nodeName}
          </div>
        )}
        {onEditEntity && (
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
            onClick={() => { onEditEntity(menu.nodeId!); onClose(); }}
          >
            <Edit className="h-3.5 w-3.5" /> Edit
          </button>
        )}
        <button
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
          onClick={() => { onAddRelationship(menu.nodeId!); onClose(); }}
        >
          <Link2 className="h-3.5 w-3.5" /> Add relationship
        </button>
        {onDuplicateEntity && (
          <button
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent"
            onClick={() => { onDuplicateEntity(menu.nodeId!); onClose(); }}
          >
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </button>
        )}
        <button
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent text-destructive hover:text-destructive"
          onClick={() => { onRemoveEntity(menu.nodeId!); onClose(); }}
        >
          <Trash2 className="h-3.5 w-3.5" /> Delete
        </button>
      </div>
    );
  }

  // Edge context menu
  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[180px] rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 zoom-in-95"
      style={{ left: menu.x, top: menu.y }}
    >
      {menu.edgeLabel && (
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground truncate max-w-[200px]">
          {menu.edgeLabel}
        </div>
      )}
      <button
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm transition-colors hover:bg-accent text-destructive hover:text-destructive"
        onClick={() => { onRemoveRelationship(menu.edgeId!); onClose(); }}
      >
        <Trash2 className="h-3.5 w-3.5" /> Remove Relationship
      </button>
    </div>
  );
}
