import { useEffect, useState } from "react";
import { UploadZone } from "@/components/upload-zone";
import { getOrgContext, getSubscriptionStatus } from "@/lib/profile-db";
import type { SecondaryOrg } from "@/types/org";

export function UploadPage() {
  const [ntOrgs, setNtOrgs] = useState<SecondaryOrg[]>([]);
  const [hasClubAccess, setHasClubAccess] = useState(false);

  useEffect(() => {
    Promise.all([getOrgContext(), getSubscriptionStatus()]).then(([ctx, sub]) => {
      setNtOrgs(ctx.secondaryOrgs.filter((s) => s.isNtOrg));
      setHasClubAccess(!!ctx.profile.orgId || sub.isActive);
    });
  }, []);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <UploadZone ntMemberships={ntOrgs} hasClubAccess={hasClubAccess} />
    </div>
  );
}
