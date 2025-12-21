import { Switch, Route, Link, useLocation } from "wouter";
import { Brain, Plus, BarChart3, Settings, Library, Search, Target, LogOut, Loader2 } from "lucide-react";
import fairyIcon from "@assets/generated_images/cute_fairy_app_icon.png";
import { Button } from "@/components/ui/button";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { useAuth } from "@/hooks/use-auth";

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

function Nav() {
  const [location] = useLocation();
  const { user, logout, isLoggingOut } = useAuth();
  
  const NavItem = ({ href, icon: Icon, label }: { href: string; icon: any; label: string }) => {
    const isActive = location === href;
    return (
      <Link href={href}>
        <Button 
          variant={isActive ? "secondary" : "ghost"} 
          className={`w-full justify-start gap-3 ${isActive ? 'bg-secondary font-medium' : 'text-muted-foreground'}`}
        >
          <Icon className="h-4 w-4" />
          {label}
        </Button>
      </Link>
    );
  };

  return (
    <div className="w-64 border-r bg-card min-h-screen p-4 flex flex-col hidden md:flex">
      <div className="flex items-center gap-2 px-2 mb-8 mt-2">
        <img src={fairyIcon} alt="Jami" className="h-8 w-8 rounded-lg object-cover" />
        <span className="font-bold text-lg tracking-tight">Jami</span>
      </div>

      <div className="space-y-1">
        <NavItem href="/" icon={BarChart3} label="Dashboard" />
        <NavItem href="/decks" icon={Library} label="Decks" />
        <NavItem href="/study" icon={Brain} label="Study Now" />
        <NavItem href="/goals" icon={Target} label="Goals" />
        <NavItem href="/browser" icon={Search} label="Browse Cards" />
        <NavItem href="/stats" icon={BarChart3} label="Stats" />
      </div>

      <div className="mt-8">
        <div className="px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Create</div>
        <NavItem href="/add" icon={Plus} label="Add Note" />
      </div>

      <div className="mt-auto space-y-2">
        <NavItem href="/settings" icon={Settings} label="Settings" />
        
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
                {user.firstName || user.email || 'User'}
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
        <Button 
          size="lg" 
          className="w-full"
          onClick={() => window.location.href = '/api/login'}
          data-testid="button-login"
        >
          <Brain className="h-5 w-5 mr-2" />
          Sign in with Replit
        </Button>
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
    <div className="flex min-h-screen bg-background text-foreground font-sans">
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
