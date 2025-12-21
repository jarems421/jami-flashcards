import { Switch, Route, Link, useLocation } from "wouter";
import { Brain, Plus, BarChart3, Settings, Library, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/toaster";

// Pages
import Dashboard from "@/pages/dashboard";
import Study from "@/pages/study";
import Editor from "@/pages/editor";
import Decks from "@/pages/decks";
import DeckDetails from "@/pages/deck-details";
import Browser from "@/pages/browser";
import Stats from "@/pages/stats";
import SettingsPage from "@/pages/settings";
import NotFound from "@/pages/not-found";

function Nav() {
  const [location] = useLocation();
  
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
        <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
          <Brain className="h-5 w-5 text-primary-foreground" />
        </div>
        <span className="font-bold text-lg tracking-tight">FlashRecall</span>
      </div>

      <div className="space-y-1">
        <NavItem href="/" icon={BarChart3} label="Dashboard" />
        <NavItem href="/decks" icon={Library} label="Decks" />
        <NavItem href="/study" icon={Brain} label="Study Now" />
        <NavItem href="/browser" icon={Search} label="Browse Cards" />
        <NavItem href="/stats" icon={BarChart3} label="Stats" />
      </div>

      <div className="mt-8">
        <div className="px-2 text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Create</div>
        <NavItem href="/add" icon={Plus} label="Add Note" />
      </div>

      <div className="mt-auto">
        <NavItem href="/settings" icon={Settings} label="Settings" />
      </div>
    </div>
  );
}

function MobileNav() {
  // Simplified mobile nav for prototype
  return null; 
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
      <Route path="/stats" component={Stats} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-screen bg-background text-foreground font-sans">
        <Nav />
        <main className="flex-1 overflow-auto">
          <Router />
        </main>
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}

export default App;
