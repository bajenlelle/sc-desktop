import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { REPORT_MAX_CUSTOM_BLOCKS, blocksOf, type ReportBlockKind, type ReportDraft } from "@scoutable/shared/lib/report-draft";

const ADDABLE: { kind: ReportBlockKind; label: string; hint: string }[] = [
  { kind: "keys", label: "Keys", hint: "What every player should remember" },
  { kind: "profile", label: "How they play", hint: "Their season numbers at both ends" },
  { kind: "games", label: "Their games", hint: "Results and games to come" },
];

/** What the report can still add: the kinds of section it doesn't have, and whether one of the coach's own fits. */
export function addableSections(draft: ReportDraft): { missing: typeof ADDABLE; canAddOwn: boolean } {
  const blocks = blocksOf(draft);
  return {
    missing: ADDABLE.filter((a) => !blocks.some((b) => b.kind === a.kind)),
    canAddOwn: blocks.filter((b) => b.kind === "custom").length < REPORT_MAX_CUSTOM_BLOCKS,
  };
}

/**
 * The sections a report can add, as menu items: the document's Add section
 * at its end and the Sections panel's + show the same list. With
 * `onAddPlayers`, Add players… leads it.
 */
export function AddSectionItems({
  draft,
  onAddBlock,
  onAddPlayers,
}: {
  draft: ReportDraft;
  onAddBlock: (kind: ReportBlockKind) => void;
  onAddPlayers?: () => void;
}) {
  const { missing, canAddOwn } = addableSections(draft);
  return (
    <>
      {onAddPlayers && (
        <DropdownMenuItem onSelect={onAddPlayers} className="flex flex-col items-start gap-0">
          <span>Players…</span>
          <span className="text-caption text-muted-foreground">A section for each, with their clips</span>
        </DropdownMenuItem>
      )}
      {onAddPlayers && (missing.length > 0 || canAddOwn) && <DropdownMenuSeparator />}
      {missing.map((a) => (
        <DropdownMenuItem key={a.kind} onSelect={() => onAddBlock(a.kind)} className="flex flex-col items-start gap-0">
          <span>{a.label}</span>
          <span className="text-caption text-muted-foreground">{a.hint}</span>
        </DropdownMenuItem>
      ))}
      {missing.length > 0 && canAddOwn && <DropdownMenuSeparator />}
      {canAddOwn && (
        <DropdownMenuItem onSelect={() => onAddBlock("custom")} className="flex flex-col items-start gap-0">
          <span>Your own section</span>
          <span className="text-caption text-muted-foreground">A name, words and clips</span>
        </DropdownMenuItem>
      )}
    </>
  );
}
