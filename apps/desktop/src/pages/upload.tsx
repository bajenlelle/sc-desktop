import { useEffect, useState } from "react";
import { UploadZone } from "@/components/upload-zone";
import { getOrgContext, getSubscriptionStatus } from "@/lib/profile-db";
import type { NtMembership } from "@/types/org";

export function UploadPage() {
  const [ntMemberships, setNtMemberships] = useState<NtMembership[]>([]);
  const [hasClubAccess, setHasClubAccess] = useState(false);

  useEffect(() => {
    Promise.all([getOrgContext(), getSubscriptionStatus()]).then(([ctx, sub]) => {
      setNtMemberships(ctx.ntMemberships);
      setHasClubAccess(!!ctx.profile.orgId || sub.isActive);
    });
  }, []);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <UploadZone ntMemberships={ntMemberships} hasClubAccess={hasClubAccess} />
    </div>
  );
}
