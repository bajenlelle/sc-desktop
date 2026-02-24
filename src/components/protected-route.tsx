import { Navigate } from "react-router-dom";
import { useAuth } from "@/lib/auth-context";

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="py-24 text-center text-sm text-muted-foreground">Loading…</div>;
  if (!user) return <Navigate to="/auth/login" replace />;
  return <>{children}</>;
}
