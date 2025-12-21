import { useStats } from "@/lib/store";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend
} from "recharts";

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

  const stateData = [
    { name: 'New', value: stats?.newCards || 0, color: '#3b82f6' },
    { name: 'Learning', value: stats?.learningCards || 0, color: '#f97316' },
    { name: 'Review', value: stats?.reviewCards || 0, color: '#22c55e' },
  ];

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
             <CardTitle className="text-sm font-medium text-muted-foreground">Retention Rate</CardTitle>
           </CardHeader>
           <CardContent>
             <div className="text-2xl font-bold">{stats?.retentionRate || 0}%</div>
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
          <CardContent className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={reviewsData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} />
                <YAxis axisLine={false} tickLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--background)', borderRadius: '8px', border: '1px solid var(--border)' }}
                />
                <Bar dataKey="reviews" fill="var(--primary)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Card State Distribution */}
        <Card className="col-span-1">
          <CardHeader>
            <CardTitle>Card Distribution</CardTitle>
            <CardDescription>Breakdown by card state</CardDescription>
          </CardHeader>
          <CardContent className="h-[300px] flex items-center justify-center">
             <ResponsiveContainer width="100%" height="100%">
               <PieChart>
                 <Pie
                   data={stateData}
                   cx="50%"
                   cy="50%"
                   innerRadius={60}
                   outerRadius={80}
                   paddingAngle={5}
                   dataKey="value"
                 >
                   {stateData.map((entry, index) => (
                     <Cell key={`cell-${index}`} fill={entry.color} />
                   ))}
                 </Pie>
                 <Tooltip />
                 <Legend />
               </PieChart>
             </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
