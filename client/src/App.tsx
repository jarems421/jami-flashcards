import { signInWithGoogle } from "@/lib/firebase";
import { Switch, Route, Link, useLocation } from "wouter";
import { Plus, BarChart3, Settings, Library, Target, LogOut, Loader2, Menu, RefreshCw, Sparkles, Search } from "lucide-react";
import appIcon from "@assets/IMG_6630_1767309916255.jpeg";
import { Button } from "@/components/ui/button";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence, LayoutGroup } from "framer-motion";

import Dashboard from "@/pages/dashboard";
import Study from "@/pages/study";
import Editor from "@/pages/editor";
import DeckDetails from "@/pages/deck-details";
import Decks from "@/pages/browser";
import Stats from "@/pages/stats";
import SettingsPage from "@/pages/settings";
import Goals from "@/pages/goals";
import Constellations from "@/pages/constellations";
import NotFound from "@/pages/not-found";
import GlobalSearch from "@/pages/search";
import DataExport from "@/pages/export";

import { ThemeProvider } from "@/components/theme-provider";
import { ConstellationBackground, useConstellationBackground } from "@/components/constellation-background";

function NavItem({ href, icon: Icon, label, onClick }: { href: string; icon: any; label: string; onClick?: () => void }) {
  const [location] = useLocation();
  const isActive = location === href;
  return (
    <Link href={href} onClick={onClick}>
      <motion.div whileHover={{ x: 4 }} whileTap={{ scale: 0.97 }} className="relative">
        <AnimatePresence>
          {isActive && (
            <motion.div
              layoutId="nav-indicator"
              className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 bg-primary rounded-full"
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: -8 }}
              exit={{ opacity: 0, x: -4 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
            />
          )}
        </AnimatePresence>
        <Button
          variant={isActive ? "secondary" : "ghost"}
          className={`w-full justify-start gap-3 ${isActive ? "bg-secondary/80 font-medium" : ""}`}
        >
          <Icon className="h-4 w-4" />
          <span>{label}</span>
        </Button>
      </motion.div>
    </Link>
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout } = useAuth();

  return (
    <LayoutGroup>
      <div className="space-y-1">
        <NavItem href="/" icon={BarChart3} label="Dashboard" onClick={onNavigate} />
        <NavItem href="/decks" icon={Library} label="Decks" onClick={onNavigate} />
        <NavItem href="/goals" icon={Target} label="Goals" onClick={onNavigate} />
        <NavItem href="/constellations" icon={Sparkles} label="Constellations" onClick={onNavigate} />
        <NavItem href="/stats" icon={BarChart3} label="Stats" onClick={onNavigate} />
      </div>

      <div className="mt-8">
        <NavItem href="/add" icon={Plus} label="Add Card" onClick={onNavigate} />
      </div>

      <div className="mt-4">
        <NavItem href="/search" icon={Search} label="Search" onClick={onNavigate} />
      </div>

      {user && (
        <div className="mt-auto pt-4 border-t">
          <span className="text-sm text-muted-foreground block mb-2">
            {user.displayName || user.email || "User"}
          </span>
          <Button variant="ghost" className="w-full justify-start" onClick={() => logout()}>
            <LogOut className="h-4 w-4 mr-2" />
            Sign Out
          </Button>
        </div>
      )}
    </LayoutGroup>
  );
}

function Nav() {
  return (
    <div className="w-64 border-r min-h-screen p-4 hidden md:flex flex-col bg-card">
      <div className="flex items-center gap-2 mb-8">
        <img src={appIcon} className="h-8 w-8 rounded-lg" />
        <span className="font-bold">Jami</span>
      </div>
      <NavContent />
    </div>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden flex justify-between p-4 border-b bg-card">
      <span className="font-bold">Jami</span>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost"><Menu /></Button>
        </SheetTrigger>
        <SheetContent side="left">
          <NavContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Router() {
  const [location] = useLocation();
  return (
    <AnimatePresence mode="wait">
      <Switch location={location} key={location}>
        <Route path="/" component={Dashboard} />
        <Route path="/study" component={Study} />
        <Route path="/add" component={Editor} />
        <Route path="/decks" component={Decks} />
        <Route path="/deck/:id" component={DeckDetails} />
        <Route path="/goals" component={Goals} />
        <Route path="/constellations" component={Constellations} />
        <Route path="/stats" component={Stats} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/search" component={GlobalSearch} />
        <Route path="/export" component={DataExport} />
        <Route component={NotFound} />
      </Switch>
    </AnimatePresence>
  );
}

function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <img src={appIcon} className="h-24 w-24 mb-6 rounded-xl" />
      <h1 className="text-4xl font-bold mb-4">Jami</h1>
      <p className="text-muted-foreground mb-6 text-center">
        Master any subject with spaced repetition.
      </p>

      <div className="space-y-3 w-full max-w-sm">
        <Button
          size="lg"
          className="w-full"
         onClick={signInWithGoogle}
        >
          Sign in with Google
        </Button>

    
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const { isActive } = useConstellationBackground();

  if (isLoading) {
    return <div className="p-10 flex justify-center"><Loader2 className="animate-spin" /></div>;
  }

  if (!user) {
    return <LandingPage />;
  }

  return (
    <div className="flex min-h-screen">
      <ConstellationBackground />
      <MobileNav />
      <Nav />
      <main className="flex-1">
        <Router />
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthenticatedApp />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
