import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Target, Plus, Trash2, Calendar, TrendingUp, Pause, Play } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format, startOfDay, differenceInDays } from "date-fns";

interface Deck {
  id: string;
  name: string;
}

interface GoalProgress {
  id: string;
  dateBucket: string;
  completedCount: number;
}

interface StudyGoal {
  id: string;
  deckId: string | null;
  cadence: 'DAILY' | 'WEEKLY';
  targetCount: number;
  targetAccuracy: number | null;
  deadline: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'PAUSED';
  deck: Deck | null;
  progress: GoalProgress[];
  createdAt: string;
}

export default function Goals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newGoal, setNewGoal] = useState({
    deckId: '',
    cadence: 'DAILY' as 'DAILY' | 'WEEKLY',
    targetCount: 20,
    targetAccuracy: 80,
    deadline: '',
    deadlineTime: '23:59'
  });

  const { data: goals, isLoading } = useQuery<StudyGoal[]>({
    queryKey: ["/api/goals"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/goals");
      return res.json();
    }
  });

  const { data: decks } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
  });

  const { data: todayProgress } = useQuery<GoalProgress[]>({
    queryKey: ["/api/goals/progress/today"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/goals/progress/today");
      return res.json();
    }
  });

  const createGoalMutation = useMutation({
    mutationFn: async (data: typeof newGoal) => {
      let deadlineDateTime = null;
      if (data.deadline) {
        const [hours, minutes] = data.deadlineTime.split(':').map(Number);
        const date = new Date(data.deadline);
        date.setHours(hours, minutes, 0, 0);
        deadlineDateTime = date.toISOString();
      }
      const res = await apiRequest("POST", "/api/goals", {
        deckId: data.deckId || null,
        cadence: data.cadence,
        targetCount: data.targetCount,
        targetAccuracy: data.targetAccuracy,
        deadline: deadlineDateTime
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      setIsDialogOpen(false);
      setNewGoal({ deckId: '', cadence: 'DAILY', targetCount: 20, targetAccuracy: 80, deadline: '', deadlineTime: '23:59' });
      toast({ title: "Goal created successfully" });
    },
    onError: () => {
      toast({ title: "Failed to create goal", variant: "destructive" });
    }
  });

  const updateGoalMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PUT", `/api/goals/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: "Goal updated" });
    }
  });

  const deleteGoalMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/goals/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      toast({ title: "Goal deleted" });
    }
  });

  const getTodayCount = (goalId: string) => {
    const progress = todayProgress?.find(p => (p as any).goalId === goalId);
    return progress?.completedCount || 0;
  };

  const getProgressPercent = (goal: StudyGoal) => {
    const todayCount = getTodayCount(goal.id);
    return Math.min(100, (todayCount / goal.targetCount) * 100);
  };

  const getDaysUntilDeadline = (deadline: string | null) => {
    if (!deadline) return null;
    const days = differenceInDays(new Date(deadline), startOfDay(new Date()));
    return days;
  };

  if (isLoading) {
    return <div className="p-8">Loading goals...</div>;
  }

  const now = new Date();
  const activeGoals = goals?.filter(g => {
    if (g.status !== 'ACTIVE') return false;
    if (g.deadline && new Date(g.deadline) < now) return false;
    return true;
  }) || [];
  const pausedGoals = goals?.filter(g => g.status === 'PAUSED') || [];
  const completedGoals = goals?.filter(g => g.status === 'COMPLETED') || [];
  const expiredGoals = goals?.filter(g => g.status === 'ACTIVE' && g.deadline && new Date(g.deadline) < now) || [];

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">Study Goals</h1>
          <p className="text-muted-foreground">Set targets to keep yourself on track</p>
        </div>

        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2" data-testid="button-add-goal">
              <Plus className="h-4 w-4" />
              Add Goal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Study Goal</DialogTitle>
            </DialogHeader>
            
            <div className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Deck (optional)</Label>
                <Select value={newGoal.deckId || "all"} onValueChange={(v) => setNewGoal(g => ({ ...g, deckId: v === "all" ? "" : v }))}>
                  <SelectTrigger data-testid="select-deck">
                    <SelectValue placeholder="All decks" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All decks</SelectItem>
                    {decks?.map(d => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Cadence</Label>
                <Select value={newGoal.cadence} onValueChange={(v) => setNewGoal(g => ({ ...g, cadence: v as 'DAILY' | 'WEEKLY' }))}>
                  <SelectTrigger data-testid="select-cadence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">Daily</SelectItem>
                    <SelectItem value="WEEKLY">Weekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Target Cards</Label>
                <Input 
                  type="number" 
                  min={1} 
                  value={newGoal.targetCount}
                  onChange={(e) => setNewGoal(g => ({ ...g, targetCount: parseInt(e.target.value) || 1 }))}
                  data-testid="input-target-count"
                />
              </div>

              <div className="space-y-2">
                <Label>Target Accuracy %</Label>
                <Input 
                  type="number" 
                  min={1}
                  max={100}
                  value={newGoal.targetAccuracy}
                  onChange={(e) => setNewGoal(g => ({ ...g, targetAccuracy: Math.min(100, Math.max(1, parseInt(e.target.value) || 80)) }))}
                  data-testid="input-target-accuracy"
                />
                <p className="text-xs text-muted-foreground">Target percentage of correct answers</p>
              </div>

              <div className="space-y-2">
                <Label>Deadline (optional)</Label>
                <div className="flex gap-2">
                  <Input 
                    type="date"
                    value={newGoal.deadline}
                    onChange={(e) => setNewGoal(g => ({ ...g, deadline: e.target.value }))}
                    data-testid="input-deadline"
                    className="flex-1"
                  />
                  <Input 
                    type="time"
                    value={newGoal.deadlineTime}
                    onChange={(e) => setNewGoal(g => ({ ...g, deadlineTime: e.target.value }))}
                    data-testid="input-deadline-time"
                    className="w-32"
                    disabled={!newGoal.deadline}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Goal will disappear after this date and time</p>
              </div>

              <Button 
                className="w-full" 
                onClick={() => createGoalMutation.mutate(newGoal)}
                disabled={createGoalMutation.isPending}
                data-testid="button-create-goal"
              >
                Create Goal
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {activeGoals.length === 0 && pausedGoals.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Target className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <h3 className="font-semibold mb-2">No study goals yet</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
              Set daily or weekly targets to stay consistent with your studying
            </p>
            <Button variant="outline" onClick={() => setIsDialogOpen(true)} data-testid="button-create-first-goal">
              Create your first goal
            </Button>
          </CardContent>
        </Card>
      )}

      {activeGoals.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-green-600" />
            Active Goals
          </h2>
          <div className="grid gap-4">
            {activeGoals.map(goal => {
              const todayCount = getTodayCount(goal.id);
              const progressPercent = getProgressPercent(goal);
              const daysLeft = getDaysUntilDeadline(goal.deadline);

              return (
                <Card key={goal.id} data-testid={`card-goal-${goal.id}`}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-semibold">
                            {goal.deck?.name || "All Decks"}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {goal.cadence}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Target: {goal.targetCount} cards per {goal.cadence === 'DAILY' ? 'day' : 'week'}
                          {goal.targetAccuracy && ` • ${goal.targetAccuracy}% accuracy`}
                        </p>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => updateGoalMutation.mutate({ id: goal.id, status: 'PAUSED' })}
                          title="Pause goal"
                          data-testid={`button-pause-goal-${goal.id}`}
                        >
                          <Pause className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => deleteGoalMutation.mutate(goal.id)}
                          className="text-destructive hover:text-destructive"
                          data-testid={`button-delete-goal-${goal.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>{todayCount} / {goal.targetCount} cards</span>
                        <span className={progressPercent >= 100 ? "text-green-600 font-medium" : "text-muted-foreground"}>
                          {progressPercent >= 100 ? "Complete!" : `${Math.max(0, goal.targetCount - todayCount)} to go`}
                        </span>
                      </div>
                      <Progress value={progressPercent} className="h-2" />
                      {progressPercent >= 100 && (
                        <p className="text-xs text-green-600">You've reached your {goal.cadence === 'DAILY' ? 'daily' : 'weekly'} goal!</p>
                      )}
                    </div>

                    {goal.deadline && (
                      <div className="mt-4 flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className={daysLeft !== null && daysLeft <= 3 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
                          {daysLeft !== null && daysLeft > 0 
                            ? `${daysLeft} days until deadline` 
                            : daysLeft === 0 
                              ? 'Due today!' 
                              : 'Overdue'}
                          {' - '}
                          {format(new Date(goal.deadline), "MMM d, yyyy 'at' h:mm a")}
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {pausedGoals.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-muted-foreground">Paused Goals</h2>
          <div className="grid gap-4">
            {pausedGoals.map(goal => (
              <Card key={goal.id} className="opacity-60" data-testid={`card-goal-paused-${goal.id}`}>
                <CardContent className="p-6 flex items-center justify-between">
                  <div>
                    <span className="font-medium">{goal.deck?.name || "All Decks"}</span>
                    <span className="text-muted-foreground ml-2">
                      {goal.targetCount} cards/{goal.cadence === 'DAILY' ? 'day' : 'week'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => updateGoalMutation.mutate({ id: goal.id, status: 'ACTIVE' })}
                      title="Resume goal"
                      data-testid={`button-resume-goal-${goal.id}`}
                    >
                      <Play className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteGoalMutation.mutate(goal.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {expiredGoals.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-muted-foreground">Expired Goals</h2>
          <p className="text-sm text-muted-foreground">These goals passed their deadline and are no longer tracked.</p>
          <div className="grid gap-4">
            {expiredGoals.map(goal => (
              <Card key={goal.id} className="opacity-50 border-dashed" data-testid={`card-goal-expired-${goal.id}`}>
                <CardContent className="p-6 flex items-center justify-between">
                  <div>
                    <span className="font-medium">{goal.deck?.name || "All Decks"}</span>
                    <span className="text-muted-foreground ml-2">
                      {goal.targetCount} cards/{goal.cadence === 'DAILY' ? 'day' : 'week'}
                    </span>
                    {goal.deadline && (
                      <span className="text-xs text-red-500 ml-2">
                        Expired {format(new Date(goal.deadline), "MMM d, yyyy 'at' h:mm a")}
                      </span>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => deleteGoalMutation.mutate(goal.id)}
                    className="text-destructive hover:text-destructive"
                    title="Delete goal"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
