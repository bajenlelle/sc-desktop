import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadZone } from "@/components/upload-zone";
import { useAuth } from "@/lib/auth-context";
import type { OrgMembership } from "@/types/org";

export function UploadPage() {
  const { myOrgs, activeOrgId, activeOrgRole, activeOrgIsPersonal, profileLoading } = useAuth();
  const navigate = useNavigate();
  const canAccess = activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";
  const [ntOrgs, setNtOrgs] = useState<OrgMembership[]>([]);
  const [hasClubAccess, setHasClubAccess] = useState(false);

  useEffect(() => {
    if (profileLoading) return;
    if (activeOrgId && !canAccess) navigate("/my-playlists", { replace: true });
  }, [activeOrgId, canAccess, profileLoading, navigate]);

  useEffect(() => {
    const activeOrg = myOrgs.find((o) => o.orgId === activeOrgId);
    setNtOrgs(activeOrg?.isNtOrg ? [activeOrg] : []);
    setHasClubAccess(!!activeOrg && !activeOrg.isNtOrg);
  }, [activeOrgId, myOrgs]);

  if (!profileLoading && !canAccess) return null;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <UploadZone ntMemberships={ntOrgs} hasClubAccess={hasClubAccess} />
    </div>
  );
}
