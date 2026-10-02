import { Download, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  onDownloadSample: () => void;
}

/** Side panel explaining how to produce the file — sits right of the upload area. */
export default function ExportInstructionsPanel({ onDownloadSample }: Props) {
  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Info className="h-4 w-4 shrink-0 text-primary" />
          How to export from XPM
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 space-y-4 pt-0 text-sm text-muted-foreground">
        <ol className="list-decimal space-y-2 pl-4">
          <li>
            In Xero Practice Manager, go to <strong className="text-foreground">Business → Reports</strong>.
          </li>
          <li>
            Open the <strong className="text-foreground">Client Relationships Report</strong>.
          </li>
          <li>Set the filters you need — all clients, or a specific group.</li>
          <li>
            Choose <strong className="text-foreground">Export</strong> and pick{" "}
            <strong className="text-foreground">CSV</strong> or <strong className="text-foreground">XML</strong>.
          </li>
          <li>Save the file, then upload it here.</li>
        </ol>

        <button
          type="button"
          onClick={onDownloadSample}
          className="flex items-center gap-2 text-sm font-medium text-primary hover:underline"
        >
          <Download className="h-4 w-4 shrink-0" />
          Download sample CSV
        </button>

        <div className="space-y-1 border-t border-border/60 pt-3">
          <p className="text-xs font-medium text-foreground">What happens after import</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            <li>Existing clients are matched and updated, not duplicated.</li>
            <li>New clients and relationships are created automatically.</li>
            <li>One structure is created per client group in the file.</li>
            <li>Possible duplicates can be merged from the Review page.</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
