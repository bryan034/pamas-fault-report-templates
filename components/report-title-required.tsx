"use client";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export default function ReportTitleRequired({
  open,
  onOpenChange,
  onAddTitle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAddTitle: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Report title required</AlertDialogTitle>
          <AlertDialogDescription>
            A report title needs to be added before this draft can be saved.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button
            onClick={() => {
              onOpenChange(false);
              requestAnimationFrame(onAddTitle);
            }}
          >
            Add report title
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
