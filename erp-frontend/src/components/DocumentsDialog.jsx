import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import DocumentsPanel from "@/components/DocumentsPanel";

/**
 * The generic "attach paperwork to this row" dialog — a DocumentsPanel over any
 * document owner, opened from a list. Used by the master-data screens (vendors,
 * drivers, trucks & dumpers) where the documents are the point of the record:
 * a driver row is four fields and a CNIC scan.
 *
 * Nothing here is fleet-specific; any ownerType the server accepts works.
 * Mounted only while open, so the shared document store is never asked to hold
 * two owners at once.
 */
const DocumentsDialog = ({ open, onOpenChange, ownerType, ownerId, title, subtitle, defaultDocType }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent size="lg">
      <DialogHeader>
        <DialogTitle>{title || "Documents"}</DialogTitle>
        <DialogDescription>
          {subtitle || "Scans and certificates attached to this record. Internal only — never shown on the customer portal."}
        </DialogDescription>
      </DialogHeader>
      {open && ownerId && (
        <DocumentsPanel
          ownerType={ownerType}
          ownerId={ownerId}
          defaultDocType={defaultDocType}
          allowPublish={false}
          bare
          gallery
        />
      )}
    </DialogContent>
  </Dialog>
);

export default DocumentsDialog;
