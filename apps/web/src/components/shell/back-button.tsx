import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A detail page's way back, for the toolbar's `leading` slot: named after
 * where it goes. Tinted on narrow screens, as iOS's back button is; quiet
 * beside the sidebar, as desktop's is.
 */
export function BackButton({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="-ml-1 gap-0.5 px-1.5 text-primary lg:gap-1.5 lg:text-muted-foreground">
      <Link href={href}>
        <ChevronLeft className="size-5 lg:size-4" />
        {label}
      </Link>
    </Button>
  );
}
