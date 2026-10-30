import { SheetBackButton } from "@/components/shell/GlassButton";
import { Screen } from "@/components/shell/Screen";
import { DevicesSection } from "@/components/DevicesSection";

/** Settings › Devices: where the account is signed in, each removable. */
export default function DevicesPage() {
  return (
    <Screen title="Devices" sheet leading={<SheetBackButton />} grouped contentClassName="px-4 pt-2">
      <DevicesSection />
    </Screen>
  );
}
