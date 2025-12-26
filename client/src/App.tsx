import { Switch, Route, Link, useLocation } from "wouter";
import { Brain, Plus, BarChart3, Settings, Library, Search, Target, LogOut, Loader2, Menu, X } from "lucide-react";
import fairyIcon from "@assets/generated_images/cute_fairy_app_icon.png";
import { Button } from "@/components/ui/button";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@/hooks/use-auth";
import { useState } from "react";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import Dashboard from "@/pages/dashboard";
import Study from "@/pages/study";
import Editor from "@/pages/editor";
import Decks from "@/pages/decks";
import DeckDetails from "@/pages/deck-details";
import Browser from "@/pages/browser";
import Stats from "@/pages/stats";
import SettingsPage from "@/pages/settings";
import Goals from "@/pages/goals";
import NotFound from "@/pages/not-found";

import { ThemeProvider } from "@/components/theme-provider";

function NavItem({ href, icon: Icon, label, onClick }: { href: string; icon: any; label: string; onClick?: () => void }) {
  const [location] = useLocation();
  const isActive = location === href;
  return (
    <Link href={href} onClick={onClick}>
      <Button 
        variant={isActive ? "secondary" : "ghost"} 
        className={`w-full justify-start gap-3 ${isActive ? 'bg-secondary font-medium' : 'text-muted-foreground'}`}
      >
        <Icon className="h-4 w-4" />
        {label}
      </Button>
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
        <NavItem href="/study" icon={Brain} label="Study Now" onClick={onNavigate} />
        <NavItem href="/goals" icon={Target} label="Goals" onClick={onNavigate} />
        <NavItem href="/browser" icon={Search} label="Browse Cards" onClick={onNavigate} />
        <NavItem href="/stats" icon={BarChart3} label="Stats" onClick={onNavigate} />
      </div>

      <div className="mt-8">
        <div className="px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Create</div>
        <NavItem href="/add" icon={Plus} label="Add Note" onClick={onNavigate} />
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

function Nav() {
  return (
    <div className="w-64 border-r bg-card min-h-screen p-4 flex-col hidden md:flex">
      <div className="flex items-center gap-2 px-2 mb-8 mt-2">
        <img src={fairyIcon} alt="Jami" className="h-8 w-8 rounded-lg object-cover" />
        <span className="font-bold text-lg tracking-tight">Jami</span>
      </div>
      <NavContent />
    </div>
  );
}

function MobileNav() {
  const [open, setOpen] = useState(false);
  
  return (
    <div className="md:hidden flex items-center justify-between p-4 border-b bg-card">
      <div className="flex items-center gap-2">
        <img src={fairyIcon} alt="Jami" className="h-8 w-8 rounded-lg object-cover" />
        <span className="font-bold text-lg tracking-tight">Jami</span>
      </div>
      
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-4">
          <div className="flex items-center gap-2 mb-8 mt-2">
            <img src={fairyIcon} alt="Jami" className="h-8 w-8 rounded-lg object-cover" />
            <span className="font-bold text-lg tracking-tight">Jami</span>
          </div>
          <NavContent onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/study" component={Study} />
      <Route path="/add" component={Editor} />
      <Route path="/decks" component={Decks} />
      <Route path="/deck/:id" component={DeckDetails} />
      <Route path="/browser" component={Browser} />
      <Route path="/goals" component={Goals} />
      <Route path="/stats" component={Stats} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-8">
      <div className="text-center max-w-md">
        <img 
          src={fairyIcon} 
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
            variant="default"
            className="w-full"
            onClick={() => window.location.href = '/api/login'}
            data-testid="button-login-replit"
          >
            <Brain className="h-5 w-5 mr-2" />
            Continue with Replit
          </Button>
          
          <p className="text-xs text-muted-foreground mt-4">
            More options available: GitHub, Apple, or email
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

  if (isLoading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <LandingPage />;
  }

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-background text-foreground font-sans">
      <MobileNav />
      <Nav />
      <main className="flex-1 overflow-auto">
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
