import { Globe, Laptop, Smartphone } from "lucide-react";

/** The symbol for each kind of app a device signs in from. */
export const APP_ICON = { web: Globe, desktop: Laptop, mobile: Smartphone } as const;

export { formatRecentDay as lastActive } from "@/lib/format-date";
