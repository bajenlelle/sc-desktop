import { Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { AppSidebar } from "@/components/app-sidebar";

export function RootLayout() {
  const { pathname } = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-background font-sans antialiased">
      <AppSidebar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <motion.div
          key={pathname}
          className="flex-1 min-h-0 overflow-y-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12 }}
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  );
}
