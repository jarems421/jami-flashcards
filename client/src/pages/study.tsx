import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ArrowLeft, RefreshCw, Clock, RotateCcw, Library, Shuffle, Tag } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

interface CardData {
  id: string;
  state: string;
  note: {
    fields: any;
  };
  reps: number;
}

interface QueueResponse {
  queue: CardData[];
  counts: {
    totalCards: number;
    newCards: number;
    studiedCards: number;
    studiedToday: number;
    queueSize: number;
  };
}

interface Deck {
  id: string;
  name: string;
  _count?: { cards: number };
}

interface StudyGoal {
  id: string;
  deckId: string | null;
  targetCount: number;
  status: string;
}

export default function Study() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const initialDeckId = searchParams.get("deckId");
  const modeParam = searchParams.get("mode");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [elapsed, setElapsed] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  // Deck selection state
  const [selectedDeckIds, setSelectedDeckIds] = useState<string[]>(initialDeckId ? [initialDeckId] : []);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [hasStartedSession, setHasStartedSession] = useState(!!initialDeckId);
  const [shuffleMode, setShuffleMode] = useState(false);

  const handleChangeDeckSelection = () => {
    setHasStartedSession(false);
    setSelectedDeckIds([]);
    setSelectedTags([]);
    setActiveQueue([]);
    setWrongCards([]);
    setRightCards([]);
    setCurrentIndex(0);
    setSessionComplete(false);
    setElapsed(0);
  };

  // Local Session State
  const [activeQueue, setActiveQueue] = useState<CardData[]>([]);
  const [wrongCards, setWrongCards] = useState<CardData[]>([]);
  const [rightCards, setRightCards] = useState<CardData[]>([]);
  const [sessionComplete, setSessionComplete] = useState(false);

  // Timer - stops when session is complete
  useEffect(() => {
    if (sessionComplete) return;
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, [sessionComplete]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const { data: decks } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
  });

  const { data: allTags } = useQuery<string[]>({
    queryKey: ["/api/tags"],
  });

  const { data: activeGoals } = useQuery<StudyGoal[]>({
    queryKey: ["/api/goals/active"],
  });

  const updateGoalProgressMutation = useMutation({
    mutationFn: async (goalId: string) => {
      const res = await apiRequest("POST", `/api/goals/${goalId}/progress`, { increment: true, count: 1 });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/goals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/goals/active"] });
      queryClient.invalidateQueries({ queryKey: ["/api/goals/progress/today"] });
      
      if (data?.starAwarded) {
        queryClient.invalidateQueries({ queryKey: ["constellations"] });
        queryClient.invalidateQueries({ queryKey: ["constellation"] });
        toast({ 
          title: "Goal Complete! You earned a star!", 
          description: "Check your Constellations to see it."
        });
      }
    }
  });

  const { data, isLoading, refetch } = useQuery<QueueResponse>({
    queryKey: ["/api/queue/today", selectedDeckIds, selectedTags],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedDeckIds.length > 0) {
        selectedDeckIds.forEach(id => params.append("deckIds", id));
      }
      if (selectedTags.length > 0) {
        selectedTags.forEach(tag => params.append("tags", tag));
      }
      const res = await apiRequest("GET", `/api/queue/today?${params.toString()}`);
      return res.json();
    },
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    enabled: hasStartedSession
  });

  // Shuffle function
  const shuffleArray = <T,>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  // Initialize active queue when data loads
  useEffect(() => {
    if (data?.queue) {
      const queue = shuffleMode ? shuffleArray(data.queue) : data.queue;
      setActiveQueue(queue);
      setWrongCards([]);
      setRightCards([]);
      setCurrentIndex(0);
      setSessionComplete(false);
    }
  }, [data, shuffleMode]);

  const answerMutation = useMutation({
    mutationFn: async ({ id, rating }: { id: string, rating: string }) => {
      await apiRequest("POST", `/api/cards/${id}/grade`, { rating });
    },
    onSuccess: (_, variables) => {
      // Don't invalidate queue to keep the current session cards in memory
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      
      const currentCard = activeQueue[currentIndex];
      if (variables.rating === 'WRONG') {
        setWrongCards(prev => [...prev, currentCard]);
      } else {
        setRightCards(prev => [...prev, currentCard]);
      }

      // Update progress for applicable goals (both deck-specific and global)
      if (activeGoals) {
        const applicableGoals = activeGoals.filter(goal => 
          goal.status === 'ACTIVE' && (goal.deckId === null || selectedDeckIds.includes(goal.deckId))
        );
        applicableGoals.forEach(goal => {
          updateGoalProgressMutation.mutate(goal.id);
        });
      }

      // Move to next card locally
      if (currentIndex < activeQueue.length - 1) {
        setCurrentIndex(prev => prev + 1);
        setCanUndo(true);
      } else {
        setSessionComplete(true);
      }
    },
    onError: () => {
      toast({ title: "Failed to submit answer", variant: "destructive" });
    }
  });

  const undoMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/study/undo");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["stats"] });
      
      // Remove from last pile it was added to
      const lastWasRight = rightCards.some(c => c.id === activeQueue[currentIndex - 1]?.id);
      
      if (lastWasRight) {
        setRightCards(prev => prev.slice(0, -1));
      } else {
        setWrongCards(prev => prev.slice(0, -1));
      }

      setCurrentIndex(prev => Math.max(0, prev - 1));
      setSessionComplete(false);
      setCanUndo(false);
      toast({ title: "Undone last review" });
    },
    onError: () => {
      toast({ 
        title: "Undo failed", 
        description: "Undo functionality requires backend implementation.",
        variant: "destructive" 
      });
    }
  });

  const handleAnswer = useCallback((rating: 'WRONG' | 'CORRECT') => {
    const currentCard = activeQueue[currentIndex];
    if (!currentCard) return;
    
    answerMutation.mutate({ id: currentCard.id, rating });
    setIsFlipped(false);
  }, [activeQueue, currentIndex, answerMutation]);

  const handleUndo = useCallback(() => {
    if (!canUndo) return;
    undoMutation.mutate();
  }, [canUndo, undoMutation]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        if (!isFlipped) {
          setIsFlipped(true);
          e.preventDefault();
        }
      }
      
      // Ctrl+Z for Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
         e.preventDefault();
         handleUndo();
         return;
      }

      if (!isFlipped) return;

      switch(e.key) {
        case '1': handleAnswer('WRONG'); break;
        case '2': handleAnswer('CORRECT'); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, handleAnswer, handleUndo]);

  // Deck selection screen
  if (!hasStartedSession) {
    const toggleDeck = (deckId: string) => {
      setSelectedDeckIds(prev => 
        prev.includes(deckId) 
          ? prev.filter(id => id !== deckId)
          : [...prev, deckId]
      );
    };

    const selectAll = () => {
      if (decks) setSelectedDeckIds(decks.map(d => d.id));
    };

    const selectNone = () => {
      setSelectedDeckIds([]);
    };

    const startStudy = () => {
      setHasStartedSession(true);
      setElapsed(0);
    };

    return (
      <div className="p-8 max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4 mb-6">
          <Link href="/">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Select Decks to Study</h1>
            <p className="text-muted-foreground">Choose one or more decks for your study session</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={selectAll} data-testid="button-select-all">
              Select All
            </Button>
            <Button variant="outline" size="sm" onClick={selectNone} data-testid="button-select-none">
              Clear
            </Button>
          </div>
          
          <div className="flex items-center gap-2">
            <Switch 
              id="shuffle" 
              checked={shuffleMode} 
              onCheckedChange={setShuffleMode}
              data-testid="switch-shuffle"
            />
            <Label htmlFor="shuffle" className="flex items-center gap-1.5 cursor-pointer">
              <Shuffle className="h-4 w-4" />
              Shuffle
            </Label>
          </div>
        </div>

        <div className="grid gap-3">
          {decks?.map(deck => (
            <Card 
              key={deck.id} 
              className={`cursor-pointer transition-all ${selectedDeckIds.includes(deck.id) ? 'ring-2 ring-primary bg-primary/5' : 'hover:bg-muted/50'}`}
              onClick={() => toggleDeck(deck.id)}
              data-testid={`card-deck-select-${deck.id}`}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <Checkbox 
                  checked={selectedDeckIds.includes(deck.id)} 
                  onCheckedChange={() => toggleDeck(deck.id)}
                  data-testid={`checkbox-deck-${deck.id}`}
                />
                <div className="flex-1">
                  <div className="font-medium">{deck.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {deck._count?.cards ?? 0} cards
                  </div>
                </div>
                <Library className="h-5 w-5 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tag Filter */}
        {allTags && allTags.length > 0 && (
          <div className="space-y-3 pt-4 border-t">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Tag className="h-4 w-4" />
              Filter by Tags (optional)
            </div>
            <div className="flex flex-wrap gap-2">
              {allTags.map(tag => (
                <Badge 
                  key={tag}
                  variant={selectedTags.includes(tag) ? "default" : "outline"}
                  className="cursor-pointer hover:bg-primary/20 transition-colors"
                  onClick={() => {
                    setSelectedTags(prev => 
                      prev.includes(tag) 
                        ? prev.filter(t => t !== tag)
                        : [...prev, tag]
                    );
                  }}
                  data-testid={`tag-filter-${tag}`}
                >
                  {tag}
                </Badge>
              ))}
            </div>
            {selectedTags.length > 0 && (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setSelectedTags([])}
                className="text-xs"
              >
                Clear tags
              </Button>
            )}
          </div>
        )}

        {(!decks || decks.length === 0) && (
          <div className="text-center py-12 text-muted-foreground">
            <Library className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No decks found. Create a deck first to start studying.</p>
            <Link href="/decks">
              <Button variant="outline" className="mt-4">Go to Decks</Button>
            </Link>
          </div>
        )}

        <Button 
          className="w-full h-12 text-lg mt-6" 
          disabled={selectedDeckIds.length === 0}
          onClick={startStudy}
          data-testid="button-start-study"
        >
          Start Studying {selectedDeckIds.length > 0 && `(${selectedDeckIds.length} deck${selectedDeckIds.length > 1 ? 's' : ''})`}
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return <div className="p-8 flex items-center justify-center h-full"><Skeleton className="h-[400px] w-full max-w-xl rounded-xl" /></div>;
  }

  const currentCard = activeQueue[currentIndex];
  const counts = data?.counts;
  const selectedDeckNames = decks?.filter(d => selectedDeckIds.includes(d.id)).map(d => d.name).join(', ') || 'All Decks';

  // Template rendering
  const frontContent = currentCard?.note?.fields?.Front || currentCard?.note?.fields?.Text || "No content";
  const backContent = currentCard?.note?.fields?.Back || "No answer";
  const frontImage = currentCard?.note?.fields?.FrontImage;
  const backImage = currentCard?.note?.fields?.BackImage;

  // ...
  if (sessionComplete || !activeQueue || activeQueue.length === 0) {
    const hasCards = activeQueue && activeQueue.length > 0;
    
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className={`w-16 h-16 ${sessionComplete ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'} rounded-full flex items-center justify-center mb-6`}>
          {sessionComplete ? <RefreshCw className="h-8 w-8" /> : <Check className="h-8 w-8" />}
        </div>
        <h2 className="text-2xl font-bold mb-2">{sessionComplete ? 'Session Complete' : 'All Done!'}</h2>
        
        {sessionComplete && (
          <div className="grid grid-cols-2 gap-4 w-full mb-8">
             <div className="bg-green-50 dark:bg-green-950/30 p-4 rounded-xl border border-green-100 dark:border-green-900/50">
               <div className="text-2xl font-bold text-green-600 dark:text-green-400">{rightCards.length}</div>
               <div className="text-sm text-green-700/70 dark:text-green-400/70 font-medium">Right</div>
             </div>
             <div className="bg-red-50 dark:bg-red-950/30 p-4 rounded-xl border border-red-100 dark:border-red-900/50">
               <div className="text-2xl font-bold text-red-600 dark:text-red-400">{wrongCards.length}</div>
               <div className="text-sm text-red-700/70 dark:text-red-400/70 font-medium">Wrong</div>
             </div>
          </div>
        )}

        <p className="text-muted-foreground mb-8">
          {sessionComplete 
            ? `You reviewed ${activeQueue.length} cards in ${formatTime(elapsed)}.`
            : "You've reviewed all your cards for today. Great job!"}
        </p>
        
        <div className="flex flex-col gap-3 w-full">
            {wrongCards.length > 0 && (
              <Button 
                variant="default" 
                className="w-full bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-500/20"
                onClick={() => {
                  // Redo wrong cards
                  setActiveQueue([...wrongCards]);
                  setWrongCards([]);
                  setRightCards([]);
                  setCurrentIndex(0);
                  setSessionComplete(false);
                  setElapsed(0);
                  toast({ title: "Redoing incorrect cards", description: `Queued ${wrongCards.length} cards for review.` });
              }}>
                Redo Incorrect Cards ({wrongCards.length})
              </Button>
            )}

            <div className="flex gap-3 w-full">
              <Button 
                variant="outline" 
                className="flex-1"
                disabled={!sessionComplete} 
                onClick={() => {
                  // Restart full session
                  setActiveQueue(data?.queue || []);
                  setWrongCards([]);
                  setRightCards([]);
                  setCurrentIndex(0);
                  setSessionComplete(false);
                  setIsFlipped(false);
                  setElapsed(0);
              }}>Redo All</Button>
              
              <Button 
                variant="outline" 
                className="flex-1"
                onClick={async () => {
                  setIsFlipped(false);
                  setCurrentIndex(0);
                  setElapsed(0);
                  const { data: newData } = await refetch();
                  if (newData?.queue) {
                     setActiveQueue(newData.queue);
                     setWrongCards([]);
                     setRightCards([]);
                     setSessionComplete(false);
                  }
                  
                  if (!newData?.queue?.length) {
                    toast({ title: "No new cards found", description: "You're all caught up!" });
                  } else {
                    toast({ title: "Queue refreshed", description: `Found ${newData.queue.length} cards.` });
                  }
              }}>Refresh</Button>
            </div>

            <Button 
              variant="outline" 
              className="w-full"
              onClick={handleChangeDeckSelection}
              data-testid="button-change-decks"
            >
              <Library className="h-4 w-4 mr-2" />
              Change Decks
            </Button>

            <Link href="/">
              <Button variant="ghost" className="w-full">Back to Dashboard</Button>
            </Link>
        </div>
      </div>
    );
  }


  return (
    <div className="min-h-[calc(100vh-60px)] md:min-h-screen flex flex-col max-w-3xl mx-auto p-3 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6 bg-card/50 p-3 md:p-4 rounded-xl border backdrop-blur-sm">
        <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div className="min-w-0">
            <h2 className="font-semibold text-sm truncate">{selectedDeckNames}</h2>
            <div className="flex gap-2 md:gap-3 text-xs text-muted-foreground mt-0.5">
              <span className="text-blue-600 font-medium">{counts?.newCards ?? 0} New</span>
              <span className="text-green-600 font-medium">{counts?.studiedCards ?? 0} Studied</span>
              <span className="text-muted-foreground hidden sm:inline">{counts?.studiedToday ?? 0} today</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-1 md:gap-2 shrink-0">           
           <div className="hidden sm:flex items-center gap-1.5 text-sm font-variant-numeric tabular-nums text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">
             <Clock className="h-3.5 w-3.5" />
             {formatTime(elapsed)}
           </div>
           
           <Button 
             variant="ghost" 
             size="icon" 
             className="h-8 w-8 text-muted-foreground hover:text-foreground"
             disabled={!canUndo || undoMutation.isPending}
             onClick={handleUndo}
             title="Undo (Ctrl+Z)"
             data-testid="button-undo"
           >
             <RotateCcw className="h-4 w-4" />
           </Button>

           <Button 
             variant="ghost" 
             size="icon" 
             className="h-8 w-8 text-muted-foreground hover:text-foreground"
             onClick={handleChangeDeckSelection}
             title="Change Decks"
             data-testid="button-change-decks-header"
           >
             <Library className="h-4 w-4" />
           </Button>
        </div>
      </div>

      {/* Card Area */}
      <div className="flex-1 flex flex-col justify-center relative min-h-[250px] md:min-h-[400px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentCard.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
            transition={{ duration: 0.3 }}
            className="w-full"
          >
            <div 
              className="relative w-full cursor-pointer"
              onClick={() => !isFlipped && setIsFlipped(true)}
            >
              {/* Card - No 3D flip on mobile for better compatibility */}
              <div className="w-full shadow-xl rounded-2xl bg-card border overflow-hidden">
                {!isFlipped ? (
                  /* Front */
                  <div className="p-6 md:p-12 flex flex-col items-center justify-center text-center min-h-[250px] md:min-h-[350px]">
                    <span className="absolute top-4 left-4 md:top-6 md:left-6 text-xs font-bold tracking-wider text-muted-foreground uppercase opacity-50">
                      Question
                    </span>
                    {frontImage && (
                      <img src={frontImage} alt="" className="max-h-32 md:max-h-48 rounded-lg object-contain mb-4" />
                    )}
                    <div className="font-serif text-xl md:text-3xl leading-relaxed px-2">
                      {frontContent}
                    </div>
                    <div className="absolute bottom-4 md:bottom-6 text-xs text-muted-foreground flex items-center gap-2 opacity-50">
                      <span className="hidden md:inline">Press Space or</span> Tap to show answer
                    </div>
                  </div>
                ) : (
                  /* Back */
                  <div className="p-6 md:p-12 flex flex-col items-center justify-center text-center min-h-[250px] md:min-h-[350px]">
                    <span className="absolute top-4 left-4 md:top-6 md:left-6 text-xs font-bold tracking-wider text-muted-foreground uppercase opacity-50">
                      Answer
                    </span>
                    
                    <div className="text-muted-foreground/30 text-sm mb-4 md:mb-8 line-clamp-1 max-w-[80%] select-none">
                      {frontContent}
                    </div>

                    {backImage && (
                      <img src={backImage} alt="" className="max-h-32 md:max-h-48 rounded-lg object-contain mb-4" />
                    )}
                    <div className="font-serif text-xl md:text-3xl leading-relaxed px-2">
                      {backContent}
                    </div>

                    {/* Stats on Back */}
                    <div className="absolute bottom-4 md:bottom-6 flex items-center gap-6 text-xs text-muted-foreground/60 font-medium">
                        <div className="flex items-center gap-1.5">
                           <div className="w-1.5 h-1.5 rounded-full bg-primary/50"></div>
                           <span>Reviews: {currentCard.reps || 0}</span>
                        </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className="py-4 md:py-6 mt-4 flex items-end justify-center">
        {!isFlipped ? (
          <Button 
            size="lg" 
            className="w-full max-w-sm text-base md:text-lg h-12 md:h-14 shadow-lg shadow-primary/20" 
            onClick={() => setIsFlipped(true)}
          >
            Show Answer <span className="ml-2 text-xs opacity-50 font-normal hidden md:inline">(Space)</span>
          </Button>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:gap-4 w-full max-w-lg">
            <Button 
              variant="outline" 
              className="h-14 md:h-16 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300 dark:border-red-900/50 dark:hover:bg-red-950 transition-colors text-base md:text-lg font-medium"
              onClick={() => handleAnswer('WRONG')}
              disabled={answerMutation.isPending}
            >
              Wrong
            </Button>

            <Button 
              variant="outline" 
              className="h-14 md:h-16 border-green-200 hover:bg-green-50 hover:text-green-700 hover:border-green-300 dark:border-green-900/50 dark:hover:bg-green-950 transition-colors text-base md:text-lg font-medium"
              onClick={() => handleAnswer('CORRECT')}
              disabled={answerMutation.isPending}
            >
              Right
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}