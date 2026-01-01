import { useStats, useDueCards } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, TrendingUp, Clock, CalendarDays } from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import studyIllustration from "@assets/generated_images/minimalist_abstract_study_shapes_in_calm_blue_and_slate.png";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useState } from "react";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useStats();
  const { user, updateUsername, isUpdatingUsername } = useAuth();
  const [showUsernameDialog, setShowUsernameDialog] = useState(() => !user?.username);
  const [usernameInput, setUsernameInput] = useState("");
  const [usernameError, setUsernameError] = useState("");
  
  const decksCount = stats?.decksWithDueCards || 0;
  const displayName = user?.username || user?.firstName || "Scholar";
  
  const handleSetUsername = async () => {
    if (usernameInput.trim().length < 2) {
      setUsernameError("Username must be at least 2 characters");
      return;
    }
    try {
      await updateUsername(usernameInput.trim());
      setShowUsernameDialog(false);
      setUsernameError("");
    } catch (error: any) {
      setUsernameError(error.message || "Failed to set username");
    }
  };
  
  if (statsLoading) {
    return <div className="p-8"><Skeleton className="h-[200px] w-full rounded-xl" /></div>;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Dialog open={showUsernameDialog && !user?.username} onOpenChange={setShowUsernameDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Welcome to Jami!</DialogTitle>
            <DialogDescription>
              Choose a username for your personalized learning experience.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                placeholder="Enter your username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSetUsername()}
                data-testid="input-username"
              />
              {usernameError && <p className="text-sm text-red-500">{usernameError}</p>}
            </div>
          </div>
          <DialogFooter>
            <Button onClick={handleSetUsername} disabled={isUpdatingUsername} data-testid="button-save-username">
              {isUpdatingUsername ? "Saving..." : "Save Username"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <div className="flex-1 flex flex-col justify-center px-6 md:px-12 lg:px-20 py-12 max-w-4xl mx-auto w-full">
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="space-y-12"
        >
          <div className="text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              {new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
            </p>
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight" data-testid="text-welcome-message">
              Welcome back, {displayName}
            </h1>
            <p className="text-lg text-muted-foreground">
              {decksCount > 0 
                ? `You have ${decksCount} deck${decksCount !== 1 ? 's' : ''} ready to review`
                : "You're all caught up!"}
            </p>
          </div>

          <Link href="/study">
            <motion.div 
              whileHover={{ scale: 1.02, y: -2 }}
              whileTap={{ scale: 0.98 }}
              className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary via-primary/90 to-primary/80 cursor-pointer group shadow-xl shadow-primary/20"
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
              <div className="absolute top-0 right-0 w-64 h-full opacity-20 pointer-events-none">
                <img src={studyIllustration} className="w-full h-full object-cover" alt="" />
              </div>
              
              <div className="p-8 md:p-10 relative z-10 flex items-center justify-between gap-6">
                <div className="flex items-center gap-5">
                  <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                    <Play className="h-6 w-6 text-white fill-current ml-0.5" />
                  </div>
                  <div className="text-white">
                    <h2 className="text-2xl font-bold">Start Studying</h2>
                    <p className="text-white/80 text-sm mt-0.5">
                      {decksCount > 0 ? "Continue your learning journey" : "Review your progress"}
                    </p>
                  </div>
                </div>
                
                <div className="text-white/60 group-hover:text-white group-hover:translate-x-1 transition-all">
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            </motion.div>
          </Link>

          <div className="flex justify-center gap-8 md:gap-16">
            {[
              { label: "Cards", value: stats?.totalCards || 0 },
              { label: "Streak", value: `${stats?.streak || 0}d` },
              { label: "Time", value: stats?.timeSpent || "0m" },
            ].map((stat, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: 0.1 * i }}
                className="text-center"
              >
                <div className="text-2xl md:text-3xl font-bold">{stat.value}</div>
                <p className="text-xs md:text-sm text-muted-foreground mt-1">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}

// Icons
import { Library } from "lucide-react";
