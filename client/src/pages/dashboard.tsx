import { useStats, useDueCards } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Play, TrendingUp, Clock, CalendarDays, Activity } from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import studyIllustration from "@assets/generated_images/minimalist_abstract_study_shapes_in_calm_blue_and_slate.png";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useStats();
  // We can pre-fetch due cards count from stats, but fetching the actual list is okay too
  
  const dueCount = stats?.dueCards || 0;
  
  if (statsLoading) {
    return <div className="p-8"><Skeleton className="h-[200px] w-full rounded-xl" /></div>;
  }

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome back, Scholar</h1>
          <p className="text-muted-foreground">You have {dueCount} cards due for review today.</p>
        </div>
        <div className="text-sm text-right text-muted-foreground">
          <div className="font-medium text-foreground">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
          <div>Keep up the momentum</div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="md:col-span-2 relative overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm"
        >
          <div className="absolute top-0 right-0 w-64 h-full opacity-10 pointer-events-none">
            <img src={studyIllustration} className="w-full h-full object-cover" alt="" />
          </div>
          
          <div className="p-6 relative z-10 flex flex-col h-full justify-between">
            <div>
              <h2 className="text-xl font-semibold mb-1">Daily Review</h2>
              <p className="text-muted-foreground mb-6 max-w-md">
                Consistency is key. Reviewing your cards daily strengthens neural pathways and improves long-term retention.
              </p>
            </div>
            
            <div className="flex items-center gap-4">
              <Link href="/study">
                <Button size="lg" className="gap-2 shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-shadow">
                  <Play className="h-4 w-4 fill-current" />
                  Start Session ({dueCount})
                </Button>
              </Link>
              {dueCount === 0 && (
                <span className="text-sm text-green-600 font-medium bg-green-50 px-3 py-2 rounded-md">
                  All caught up! 🎉
                </span>
              )}
            </div>
          </div>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1 }}
        >
          <Card className="h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-4xl font-bold mb-1">{stats?.reviewCards}</div>
              <p className="text-xs text-muted-foreground mb-4">Active Cards</p>
              
              <div className="space-y-3 pt-4 border-t">
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <Activity className="h-3 w-3" /> Learning
                  </span>
                  <span className="font-medium">{stats?.learningCards}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <TrendingUp className="h-3 w-3" /> New
                  </span>
                  <span className="font-medium">{stats?.newCards}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total Cards", value: stats?.totalCards, icon: Library },
          { label: "Retention Rate", value: `${stats?.retentionRate || 0}%`, icon: Activity },
          { label: "Streak", value: `${stats?.streak || 0} days`, icon: TrendingUp },
          { label: "Time Spent", value: stats?.timeSpent || "0m", icon: Clock },
        ].map((stat, i) => (
          <Card key={i} className="bg-muted/30 border-none shadow-none">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                <div className="text-xl font-bold mt-1">{stat.value}</div>
              </div>
              <stat.icon className="h-5 w-5 text-muted-foreground/50" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

// Icons
import { Library } from "lucide-react";
