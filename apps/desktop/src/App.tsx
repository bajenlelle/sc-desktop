import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Outlet, useNavigate, useLocation } from "react-router-dom";
import { initAnalytics, trackEvent } from "@/lib/analytics";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth-context";
import { ProtectedRoute } from "@/components/protected-route";
import { RootLayout } from "@/components/root-layout";
import { HomePage } from "@/pages/home";
import { MatchesPage } from "@/pages/matches";
import { MatchDetailPage } from "@/pages/match-detail";
import { UploadPage } from "@/pages/upload";
import { PlaylistsPage } from "@/pages/playlists";
import { MyPlaylistsPage } from "@/pages/my-playlists";
import { SettingsPage } from "@/pages/settings";
import { ProfilePage } from "@/pages/profile";
import { OrganizationPage } from "@/pages/organization";
import { LoginPage } from "@/pages/auth/login";
import { SignupPage } from "@/pages/auth/signup";
import { ForgotPasswordPage } from "@/pages/auth/forgot-password";
import { ResetPasswordPage } from "@/pages/auth/reset-password";
import { OnboardingPage } from "@/pages/onboarding";
import { onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { createClient } from "@/lib/supabase/client";
import { UpdateChecker } from "@/components/UpdateChecker";
import { Toaster } from "sonner";
import { useTheme } from "next-themes";

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      position="bottom-center"
      duration={4000}
      toastOptions={resolvedTheme === "dark" ? {
        style: {
          background: "oklch(0.18 0.02 240)",
          border: "1px solid oklch(0.27 0.02 240)",
          color: "oklch(0.9 0.01 240)",
        },
      } : undefined}
    />
  );
}

initAnalytics()

function PageTracker() {
  const location = useLocation()
  useEffect(() => {
    trackEvent('page_viewed', { path: location.pathname })
  }, [location.pathname])
  return null
}

function DeepLinkHandler() {
  const navigate = useNavigate();

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    onOpenUrl((urls) => {
      const url = urls[0];
      if (!url) return;

      // Parse hash fragment: scoutable://auth/callback#access_token=...&refresh_token=...&type=...
      const hashIndex = url.indexOf("#");
      if (hashIndex === -1) return;

      const params = new URLSearchParams(url.slice(hashIndex + 1));
      const access_token = params.get("access_token");
      const refresh_token = params.get("refresh_token");
      const type = params.get("type");

      if (!access_token || !refresh_token) return;

      const supabase = createClient();
      supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
        if (error) return;
        if (type === "recovery") {
          navigate("/auth/reset-password");
        } else {
          navigate("/");
        }
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [navigate]);

  return null;
}

function AuthLayout() {
  return (
    <div className="min-h-screen bg-background font-sans antialiased">
      <Outlet />
    </div>
  );
}

export default function App() {
  useEffect(() => { trackEvent('app_started', { app_version: '0.1.2' }) }, [])

  return (
    <AuthProvider>
      <ThemeProvider>
        <UpdateChecker />
        <ThemedToaster />
        <BrowserRouter>
          <DeepLinkHandler />
          <PageTracker />
          <Routes>
            <Route element={<AuthLayout />}>
              <Route path="/auth/login" element={<LoginPage />} />
              <Route path="/auth/signup" element={<SignupPage />} />
              <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
            </Route>
            <Route path="/onboarding" element={<ProtectedRoute><OnboardingPage /></ProtectedRoute>} />
            <Route element={<RootLayout />}>
              <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
              <Route
                path="/matches"
                element={
                  <ProtectedRoute>
                    <MatchesPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/matches/:id"
                element={
                  <ProtectedRoute>
                    <MatchDetailPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/upload"
                element={
                  <ProtectedRoute>
                    <UploadPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/playlists"
                element={
                  <ProtectedRoute>
                    <PlaylistsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/my-playlists"
                element={
                  <ProtectedRoute>
                    <MyPlaylistsPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/settings"
                element={
                  <ProtectedRoute>
                    <SettingsPage />
                  </ProtectedRoute>
                }
              />
              <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
              <Route path="/organization" element={<ProtectedRoute><OrganizationPage /></ProtectedRoute>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  );
}
