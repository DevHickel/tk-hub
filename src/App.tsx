import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { MobileNavProvider } from "@/contexts/MobileNavContext";
import { useAuth } from "@/contexts/AuthContext";
import { RequireManager } from "@/components/RequireAdmin";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Chat from "./pages/Chat";
import Admin from "./pages/Admin";
import Settings from "./pages/Settings";
import BugReport from "./pages/BugReport";
import Dashboard from "./pages/Dashboard";
import Documents from "./pages/Documents";
import ReportSettings from "./pages/ReportSettings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/** Manager+ → /dashboard | Users → /chat | Loading → null */
function RootRedirect() {
  const { user, isManager, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/login" replace />
  return <Navigate to={isManager ? '/dashboard' : '/chat'} replace />
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <MobileNavProvider>
              <Routes>
                <Route path="/" element={<RootRedirect />} />
                <Route path="/login" element={<Login />} />
                <Route path="/register" element={<Register />} />
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                {/* Manager+ routes */}
                <Route path="/dashboard" element={<RequireManager><Dashboard /></RequireManager>} />
                <Route path="/documents" element={<RequireManager><Documents /></RequireManager>} />
                <Route path="/admin" element={<RequireManager><Admin /></RequireManager>} />
                <Route path="/report-settings" element={<RequireManager><ReportSettings /></RequireManager>} />
                {/* All authenticated users */}
                <Route path="/chat" element={<Chat />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/bug-report" element={<BugReport />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </MobileNavProvider>
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
