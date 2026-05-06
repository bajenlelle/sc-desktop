import { useEffect, useState } from "react";
import { UploadZone } from "@/components/upload-zone";
import { useAuth } from "@/lib/auth-context";
import type { OrgMembership } from "@/types/org";

export function UploadPage() {
  const { myOrgs, activeOrgId } = useAuth();
  const [ntOrgs, setNtOrgs] = useState<OrgMembership[]>([]);
  const [hasClubAccess, setHasClubAccess] = useState(false);

  useEffect(() => {
    const activeOrg = myOrgs.find((o) => o.orgId === activeOrgId);
    setNtOrgs(activeOrg?.isNtOrg ? [activeOrg] : []);
    setHasClubAccess(!!activeOrg && !activeOrg.isNtOrg);
  }, [activeOrgId, myOrgs]);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <UploadZone ntMemberships={ntOrgs} hasClubAccess={hasClubAccess} />
    </div>
  );
}
