import { useEffect, useState } from "react";
import { UploadZone } from "@/components/upload-zone";
import { getOrgContext } from "@/lib/profile-db";

export function UploadPage() {
  const [isNationalTeam, setIsNationalTeam] = useState(false);

  useEffect(() => {
    getOrgContext().then((ctx) => setIsNationalTeam(ctx.profile.isNationalTeam));
  }, []);

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <UploadZone isNationalTeam={isNationalTeam} />
    </div>
  );
}
