import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusScreen } from "@/components/status-screen";

export default function NotFound() {
  return (
    <StatusScreen
      className="min-h-dvh"
      icon={<Compass />}
      title="Page not found"
      body="The link may be broken, or the page may have moved."
      actions={
        <Button asChild>
          <Link href="/">Go to Scoutable</Link>
        </Button>
      }
    />
  );
}
