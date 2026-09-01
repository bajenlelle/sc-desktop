import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UploadZone } from "@/components/upload-zone";
import { EmptyState } from "@/components/empty-state";
import { useAuth } from "@/lib/auth-context";
import { getLicenseState } from "@scoutable/shared/lib/license-state";
import type { OrgMembership } from "@/types/org";

export function UploadPage() {
  const { myOrgs, activeOrg, activeOrgId, activeOrgRole, activeOrgIsPersonal, profileLoading } =
    useAuth();
  const navigate = useNavigate();
  const canAccess = activeOrgIsPersonal || activeOrgRole === "coach" || activeOrgRole === "admin";
  const [ntOrgs, setNtOrgs] = useState<OrgMembership[]>([]);
  const [hasClubAccess, setHasClubAccess] = useState(false);

  // Past expiry + grace, importing into the club is paused (the matches
  // trigger enforces this server-side; this is the friendly front door).
  const licenseLocked =
    !activeOrgIsPersonal && !!activeOrg && getLicenseState(activeOrg.expiresAt) === "locked";

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
      {licenseLocked ? (
        <EmptyState
          title="Importing is paused"
          body={`${activeOrg?.orgName ?? "This organization"}'s license has expired. Existing games and playlists stay available — importing resumes once the license is renewed.`}
        />
      ) : (
        <UploadZone ntMemberships={ntOrgs} hasClubAccess={hasClubAccess} />
      )}
    </div>
  );
}
