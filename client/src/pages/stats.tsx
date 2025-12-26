import { useStats } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line
} from "recharts";
import { CheckCircle, XCircle } from "lucide-react";

export default function Stats() {
  const { data: stats, isLoading } = useStats();

  if (isLoading) {
    return <div className="p-8"><Skeleton className="h-[400px] w-full rounded-xl" /></div>;
  }

  // Use real history from backend or fallback to empty
  const reviewsData = stats?.dailyHistory || [
    { date: 'Mon', reviews: 0 },
    { date: 'Tue', reviews: 0 },
    { date: 'Wed', reviews: 0 },
    { date: 'Thu', reviews: 0 },
    { date: 'Fri', reviews: 0 },
    { date: 'Sat', reviews: 0 },
    { date: 'Sun', reviews: 0 },
  ];

  const correctAnswers = stats?.correctAnswers || 0;
  const wrongAnswers = stats?.wrongAnswers || 0;
  const totalAnswers = correctAnswers + wrongAnswers;
  const accuracyPercent = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0;
  const deckAccuracy = stats?.deckAccuracy || [];
  const accuracyHistory = stats?.accuracyHistory || [];

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight mb-2">Statistics</h1>
        <p className="text-muted-foreground">Visualize your progress and study habits.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
         <Card>
           <CardHeader className="pb-2">
             <CardTitle className="text-sm font-medium text-muted-foreground">Total Cards</CardTitle>
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold">{stats?.totalCards}</div>
           </CardContent>
         </Card>
         <Card>
           <CardHeader className="pb-2">
             <CardTitle className="text-sm font-medium text-muted-foreground">Accuracy</CardTitle>
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold">{stats?.accuracy || 0}%</div>
           </CardContent>
         </Card>
         <Card>
           <CardHeader className="pb-2">
             <CardTitle className="text-sm font-medium text-muted-foreground">Current Streak</CardTitle>
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold">{stats?.streak || 0} days</div>
           </CardContent>
         </Card>
         <Card>
           <CardHeader className="pb-2">
             <CardTitle className="text-sm font-medium text-muted-foreground">Time Spent</CardTitle>
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold">{stats?.timeSpent || "0m"}</div>
           </CardContent>
         </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Reviews Chart */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Reviews per Day</CardTitle>
            <CardDescription>Activity over the last 7 days</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] -ml-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={reviewsData} margin={{ left: 0, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} fontSize={12} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} fontSize={12} width={30} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '8px', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                  labelStyle={{ color: 'hsl(var(--foreground))' }}
                />
                <Bar dataKey="reviews" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Accuracy Breakdown */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Answer Accuracy</CardTitle>
            <CardDescription>Your correct vs incorrect answers</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex flex-col justify-center space-y-6">
            <div className="flex items-center justify-center">
              <div className="text-center">
                <div className="text-5xl font-bold text-primary mb-2">{accuracyPercent}%</div>
                <p className="text-sm text-muted-foreground">Overall Accuracy</p>
              </div>
            </div>
            
            <Progress value={accuracyPercent} className="h-3" />
            
            <div className="grid grid-cols-2 gap-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-green-50 dark:bg-green-950/30">
                <CheckCircle className="h-8 w-8 text-green-600" />
                <div>
                  <div className="text-xl font-semibold text-green-700 dark:text-green-400">{correctAnswers}</div>
                  <p className="text-xs text-green-600 dark:text-green-500">Correct</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-lg bg-red-50 dark:bg-red-950/30">
                <XCircle className="h-8 w-8 text-red-600" />
                <div>
                  <div className="text-xl font-semibold text-red-700 dark:text-red-400">{wrongAnswers}</div>
                  <p className="text-xs text-red-600 dark:text-red-500">Incorrect</p>
                </div>
              </div>
            </div>
            
            {totalAnswers === 0 && (
              <p className="text-center text-sm text-muted-foreground">
                Start studying to see your accuracy stats
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Accuracy Over Time Chart */}
      <Card>
        <CardHeader>
          <CardTitle>Accuracy Over Time</CardTitle>
          <CardDescription>Your daily correct answer percentage over the last 7 days</CardDescription>
        </CardHeader>
        <CardContent className="h-[300px] -ml-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={accuracyHistory} margin={{ left: 0, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} fontSize={12} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: 'hsl(var(--muted-foreground))' }} fontSize={12} width={40} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
              <Tooltip 
                contentStyle={{ backgroundColor: 'hsl(var(--card))', borderRadius: '8px', border: '1px solid hsl(var(--border))', color: 'hsl(var(--foreground))' }}
                labelStyle={{ color: 'hsl(var(--foreground))' }}
                formatter={(value: any) => value !== null ? [`${value}%`, 'Accuracy'] : ['No data', '']}
              />
              <Line 
                type="monotone" 
                dataKey="accuracy" 
                stroke="hsl(142, 76%, 36%)" 
                strokeWidth={2} 
                dot={{ fill: 'hsl(142, 76%, 36%)', strokeWidth: 2, r: 4 }}
                connectNulls={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Per-Deck Accuracy */}
      {deckAccuracy.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Accuracy by Deck</CardTitle>
            <CardDescription>See how well you're doing in each deck</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {deckAccuracy.map((deck: { deckId: string; deckName: string; correct: number; wrong: number; total: number; accuracy: number }) => (
                <div key={deck.deckId} className="space-y-2" data-testid={`deck-accuracy-${deck.deckId}`}>
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{deck.deckName}</span>
                      <span className="text-xs text-muted-foreground">({deck.total} reviews)</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <span className="text-green-600">{deck.correct} correct</span>
                      <span className="text-red-500">{deck.wrong} wrong</span>
                      <span className="font-bold text-primary">{deck.accuracy}%</span>
                    </div>
                  </div>
                  <Progress value={deck.accuracy} className="h-2" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
