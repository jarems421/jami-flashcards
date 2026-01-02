import { Switch, Route, Link, useLocation } from "wouter";
import { Plus, BarChart3, Settings, Library, Target, LogOut, Loader2, Menu, RefreshCw, Sparkles, Brain, Search, Download } from "lucide-react";
import appIcon from "@assets/IMG_6630_1767309916255.jpeg";
import { Button } from "@/components/ui/button";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

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
      <motion.div whileHover={{ x: 2 }} whileTap={{ scale: 0.98 }}>
        <Button 
          variant={isActive ? "secondary" : "ghost"} 
          className={`w-full justify-start gap-3 ${isActive ? 'bg-secondary font-medium' : 'text-muted-foreground'}`}
        >
          <motion.div
            animate={isActive ? { scale: [1, 1.2, 1] } : {}}
            transition={{ duration: 0.3 }}
          >
            <Icon className="h-4 w-4" />
          </motion.div>
          {label}
        </Button>
      </motion.div>
    </Link>
  );
}

function NavContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout, isLoggingOut } = useAuth();
  
  return (
    <>
      <div className="space-y-1">
        <NavItem href="/" icon={BarChart3} label="Dashboard" onClick={onNavigate} />
        <NavItem href="/decks" icon={Library} label="Decks" onClick={onNavigate} />
        <NavItem href="/goals" icon={Target} label="Goals" onClick={onNavigate} />
        <NavItem href="/constellations" icon={Sparkles} label="Constellations" onClick={onNavigate} />
        <NavItem href="/stats" icon={BarChart3} label="Stats" onClick={onNavigate} />
      </div>

      <div className="mt-8">
        <div className="px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Create</div>
        <NavItem href="/add" icon={Plus} label="Add Card" onClick={onNavigate} />
      </div>

      <div className="mt-4">
        <NavItem href="/search" icon={Search} label="Search" onClick={onNavigate} />
      </div>

      <div className="mt-auto space-y-2">
        <NavItem href="/settings" icon={Settings} label="Settings" onClick={onNavigate} />
        
        {user && (
          <div className="pt-4 border-t">
            <div className="px-2 mb-2 flex items-center gap-2">
              {user.profileImageUrl && (
                <img 
                  src={user.profileImageUrl} 
                  alt="" 
                  className="h-6 w-6 rounded-full"
                />
              )}
              <span className="text-sm text-muted-foreground truncate">
                {user.username || user.firstName || user.email || 'User'}
              </span>
            </div>
            <Button 
              variant="ghost" 
              className="w-full justify-start gap-3 text-muted-foreground"
              onClick={() => logout()}
              disabled={isLoggingOut}
              data-testid="button-logout"
            >
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

function Nav({ transparent = false }: { transparent?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  
  const handleRefresh = () => {
    qc.invalidateQueries();
    toast({ title: "Refreshed", description: "Content has been updated." });
  };
  
  return (
    <div className={`w-64 border-r min-h-screen p-4 flex-col hidden md:flex ${transparent ? 'bg-black/40 backdrop-blur-sm border-white/10' : 'bg-card'}`}>
      <div className="flex items-center justify-between px-2 mb-8 mt-2">
        <div className="flex items-center gap-2">
          <img src={appIcon} alt="Jami" className="h-8 w-8 rounded-lg object-cover" />
          <span className="font-bold text-lg tracking-tight">Jami</span>
        </div>
        <Button variant="ghost" size="icon" onClick={handleRefresh} className="h-8 w-8" data-testid="button-refresh-desktop">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <NavContent />
    </div>
  );
}

function MobileNav({ transparent = false }: { transparent?: boolean }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();
  
  const handleRefresh = () => {
    qc.invalidateQueries();
    toast({ title: "Refreshed", description: "Content has been updated." });
  };
  
  return (
    <div className={`md:hidden flex items-center justify-between p-4 border-b ${transparent ? 'bg-black/40 backdrop-blur-sm border-white/10' : 'bg-card'}`}>
      <div className="flex items-center gap-2">
        <img src={appIcon} alt="Jami" className="h-8 w-8 rounded-lg object-cover" />
        <span className="font-bold text-lg tracking-tight">Jami</span>
      </div>
      
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" onClick={handleRefresh} data-testid="button-refresh-mobile">
          <RefreshCw className="h-5 w-5" />
        </Button>
        
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
        <SheetContent side="left" className="w-64 p-4">
          <div className="flex items-center gap-2 mb-8 mt-2">
            <img src={appIcon} alt="Jami" className="h-8 w-8 rounded-lg object-cover" />
            <span className="font-bold text-lg tracking-tight">Jami</span>
          </div>
          <NavContent onNavigate={() => setOpen(false)} />
        </SheetContent>
        </Sheet>
      </div>
    </div>
  );
}

function AnimatedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
    >
      <Component />
    </motion.div>
  );
}

function Router() {
  const [location] = useLocation();
  
  return (
    <AnimatePresence mode="wait">
      <Switch location={location} key={location}>
        <Route path="/">{() => <AnimatedRoute component={Dashboard} />}</Route>
        <Route path="/study">{() => <AnimatedRoute component={Study} />}</Route>
        <Route path="/add">{() => <AnimatedRoute component={Editor} />}</Route>
        <Route path="/decks">{() => <AnimatedRoute component={Decks} />}</Route>
        <Route path="/deck/:id">{() => <AnimatedRoute component={DeckDetails} />}</Route>
        <Route path="/goals">{() => <AnimatedRoute component={Goals} />}</Route>
        <Route path="/constellations">{() => <AnimatedRoute component={Constellations} />}</Route>
        <Route path="/stats">{() => <AnimatedRoute component={Stats} />}</Route>
        <Route path="/settings">{() => <AnimatedRoute component={SettingsPage} />}</Route>
        <Route path="/search">{() => <AnimatedRoute component={GlobalSearch} />}</Route>
        <Route path="/export">{() => <AnimatedRoute component={DataExport} />}</Route>
        <Route>{() => <AnimatedRoute component={NotFound} />}</Route>
      </Switch>
    </AnimatePresence>
  );
}

function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8">
      <div className="text-center max-w-md">
        <img 
          src={appIcon} 
          alt="Jami" 
          className="h-24 w-24 mx-auto mb-6 rounded-2xl shadow-lg"
        />
        <h1 className="text-4xl font-bold mb-4">Jami</h1>
        <p className="text-muted-foreground text-lg mb-8">
          Master any subject with spaced repetition flashcards. Create decks, study smarter, and track your progress.
        </p>
        
        <div className="space-y-3">
          <Button 
            size="lg" 
            className="w-full bg-white hover:bg-gray-50 text-gray-900 border border-gray-300"
            onClick={() => window.location.href = '/api/login'}
            data-testid="button-login-google"
          >
            <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            Continue with Google
          </Button>
          
          <Button 
            size="lg" 
            className="w-full bg-black hover:bg-gray-900 text-white"
            onClick={() => window.location.href = '/api/login'}
            data-testid="button-login-apple"
          >
            <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.05 20.28c-.98.95-2.05.8-3.08.35-1.09-.46-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.35C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09l.01-.01zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/>
            </svg>
            Continue with Apple
          </Button>
          
          <Button 
            size="lg" 
            variant="default"
            className="w-full"
            onClick={() => window.location.href = '/api/login'}
            data-testid="button-login-replit"
          >
            <Brain className="h-5 w-5 mr-2" />
            Continue with Replit
          </Button>
          
          <p className="text-xs text-muted-foreground mt-4">
            More options available: GitHub or email
          </p>
        </div>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const { isActive: hasConstellationBg } = useConstellationBackground();
  const [location] = useLocation();
  
  // Don't show constellation background on the constellations page
  const isConstellationsPage = location === "/constellations" || location.startsWith("/constellations");
  const showConstellationBg = hasConstellationBg && !isConstellationsPage;

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <LandingPage />;
  }

  return (
    <div className={`flex flex-col md:flex-row min-h-screen text-foreground font-sans relative ${showConstellationBg ? 'constellation-active' : 'bg-background'}`}>
      <ConstellationBackground />
      <MobileNav transparent={showConstellationBg} />
      <Nav transparent={showConstellationBg} />
      <main className={`flex-1 overflow-auto relative z-10 ${showConstellationBg ? 'constellation-content' : ''}`}>
        <Router />
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="system" storageKey="jami-theme">
        <AuthenticatedApp />
        <Toaster />
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
