import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, ArrowLeft, RefreshCw, Clock, Undo2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";

interface CardData {
  id: string;
  state: string;
  note: {
    fields: any;
  };
}

interface QueueResponse {
  queue: CardData[];
  counts: {
    dueLearning: number;
    dueReview: number;
    newAvailable: number;
    totalDueNow: number;
  };
}

interface Deck {
  id: string;
  name: string;
}

export default function Study() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const deckId = searchParams.get("deckId");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [elapsed, setElapsed] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [canUndo, setCanUndo] = useState(false);

  // Timer
  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const { data: decks } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
  });
  const currentDeck = decks?.find(d => d.id === deckId);

  const { data, isLoading, refetch } = useQuery<QueueResponse>({
    queryKey: ["/api/queue/today", deckId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/queue/today${deckId ? `?deckId=${deckId}` : ""}`);
      return res.json();
    }
  });

  const answerMutation = useMutation({
    mutationFn: async ({ id, rating }: { id: string, rating: string }) => {
      await apiRequest("POST", `/api/cards/${id}/grade`, { rating });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/queue/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      // Move to next card locally
      setCurrentIndex(prev => prev + 1);
      setCanUndo(true);
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
      queryClient.invalidateQueries({ queryKey: ["/api/queue/today"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setCurrentIndex(prev => Math.max(0, prev - 1));
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

  const handleAnswer = useCallback((rating: 'AGAIN' | 'HARD' | 'GOOD' | 'EASY') => {
    const queue = data?.queue || [];
    const currentCard = queue[currentIndex];
    if (!currentCard) return;
    
    answerMutation.mutate({ id: currentCard.id, rating });
    setIsFlipped(false);
  }, [data, currentIndex, answerMutation]);

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
        case '1': handleAnswer('AGAIN'); break;
        case '2': handleAnswer('HARD'); break;
        case '3': handleAnswer('GOOD'); break;
        case '4': handleAnswer('EASY'); break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFlipped, handleAnswer, handleUndo]);

  if (isLoading) {
    return <div className="p-8 flex items-center justify-center h-full"><Skeleton className="h-[400px] w-full max-w-xl rounded-xl" /></div>;
  }

  const queue = data?.queue || [];
  const currentCard = queue[currentIndex];
  const counts = data?.counts;

  // Template rendering
  const frontContent = currentCard?.note?.fields?.Front || currentCard?.note?.fields?.Text || "No content";
  const backContent = currentCard?.note?.fields?.Back || "No answer";

  if (!queue || queue.length === 0 || currentIndex >= queue.length) {
    const isFinished = currentIndex >= queue.length && queue.length > 0;
    
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className={`w-16 h-16 ${isFinished ? 'bg-blue-100 text-blue-600' : 'bg-green-100 text-green-600'} rounded-full flex items-center justify-center mb-6`}>
          {isFinished ? <RefreshCw className="h-8 w-8" /> : <Check className="h-8 w-8" />}
        </div>
        <h2 className="text-2xl font-bold mb-2">{isFinished ? 'Session Complete' : 'All Done!'}</h2>
        <p className="text-muted-foreground mb-8">
          {isFinished 
            ? `You finished this batch of ${queue.length} cards in ${formatTime(elapsed)}.`
            : "You've reviewed all your cards for today. Great job!"}
        </p>
        <div className="flex gap-4">
            <Button variant="outline" onClick={() => {
                setCurrentIndex(0);
                refetch();
                setElapsed(0);
            }}>{isFinished ? 'Review Again' : 'Refresh Queue'}</Button>
            <Link href="/">
              <Button>Back to Dashboard</Button>
            </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col max-w-3xl mx-auto p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 bg-card/50 p-4 rounded-xl border backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h2 className="font-semibold text-sm">{currentDeck?.name || "Study Session"}</h2>
            <div className="flex gap-3 text-xs text-muted-foreground mt-0.5">
               <span className="text-blue-600 font-medium">{counts?.newAvailable ?? 0} New</span>
               <span className="text-red-600 font-medium">{counts?.dueLearning ?? 0} Learn</span>
               <span className="text-green-600 font-medium">{counts?.dueReview ?? 0} Review</span>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
           <div className="flex items-center gap-1.5 text-sm font-variant-numeric tabular-nums text-muted-foreground bg-muted/50 px-2 py-1 rounded-md">
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
           >
             <Undo2 className="h-4 w-4" />
           </Button>
        </div>
      </div>

      {/* Card Area */}
      <div className="flex-1 flex flex-col justify-center perspective-1000 relative min-h-[400px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={currentCard.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20, transition: { duration: 0.15 } }}
            transition={{ duration: 0.3 }}
            className="w-full h-full"
          >
            <div 
              className="relative w-full h-full min-h-[400px] cursor-pointer"
              onClick={() => !isFlipped && setIsFlipped(true)}
            >
              {/* Card Container */}
              <motion.div
                className="w-full h-full transform-style-3d transition-all duration-500 shadow-xl rounded-2xl bg-card border"
                animate={{ rotateY: isFlipped ? 180 : 0 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
              >
                {/* Front */}
                <div className="absolute inset-0 backface-hidden p-8 md:p-12 flex flex-col items-center justify-center text-center bg-card rounded-2xl">
                  <span className="absolute top-6 left-6 text-xs font-bold tracking-wider text-muted-foreground uppercase opacity-50">
                    Question
                  </span>
                  <div className="font-serif text-2xl md:text-3xl leading-relaxed">
                    {frontContent}
                  </div>
                  <div className="absolute bottom-6 text-xs text-muted-foreground flex items-center gap-2 opacity-50">
                    Press Space to show answer
                  </div>
                </div>

                {/* Back */}
                <div className="absolute inset-0 backface-hidden rotate-y-180 p-8 md:p-12 flex flex-col items-center justify-center text-center bg-card rounded-2xl">
                  <span className="absolute top-6 left-6 text-xs font-bold tracking-wider text-muted-foreground uppercase opacity-50">
                    Answer
                  </span>
                  
                  <div className="text-muted-foreground/30 text-sm mb-8 line-clamp-1 max-w-[80%] select-none">
                    {frontContent}
                  </div>

                  <div className="font-serif text-2xl md:text-3xl leading-relaxed">
                    {backContent}
                  </div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Controls */}
      <div className="h-24 mt-8 flex items-end justify-center">
        {!isFlipped ? (
          <Button 
            size="lg" 
            className="w-full max-w-sm text-lg h-14 shadow-lg shadow-primary/20" 
            onClick={() => setIsFlipped(true)}
          >
            Show Answer <span className="ml-2 text-xs opacity-50 font-normal">(Space)</span>
          </Button>
        ) : (
          <div className="grid grid-cols-4 gap-3 w-full max-w-2xl">
            <div className="flex flex-col gap-1">
              <Button 
                variant="outline" 
                className="h-14 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300 dark:border-red-900/50 dark:hover:bg-red-950 transition-colors"
                onClick={() => handleAnswer('AGAIN')}
                disabled={answerMutation.isPending}
              >
                Again
              </Button>
              <span className="text-[10px] uppercase tracking-wider text-center text-muted-foreground font-medium">1. &lt; 1m</span>
            </div>
            
            <div className="flex flex-col gap-1">
              <Button 
                variant="outline" 
                className="h-14 border-orange-200 hover:bg-orange-50 hover:text-orange-700 hover:border-orange-300 dark:border-orange-900/50 dark:hover:bg-orange-950 transition-colors"
                onClick={() => handleAnswer('HARD')}
                disabled={answerMutation.isPending}
              >
                Hard
              </Button>
              <span className="text-[10px] uppercase tracking-wider text-center text-muted-foreground font-medium">
                2. {currentCard.state === 'NEW' || currentCard.state === 'LEARNING' ? 'Now' : '2d'}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <Button 
                variant="outline" 
                className="h-14 border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 dark:border-blue-900/50 dark:hover:bg-blue-950 transition-colors"
                onClick={() => handleAnswer('GOOD')}
                disabled={answerMutation.isPending}
              >
                Good
              </Button>
              <span className="text-[10px] uppercase tracking-wider text-center text-muted-foreground font-medium">
                3. {currentCard.state === 'NEW' ? '10m' : '4d'}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <Button 
                variant="outline" 
                className="h-14 border-green-200 hover:bg-green-50 hover:text-green-700 hover:border-green-300 dark:border-green-900/50 dark:hover:bg-green-950 transition-colors"
                onClick={() => handleAnswer('EASY')}
                disabled={answerMutation.isPending}
              >
                Easy
              </Button>
              <span className="text-[10px] uppercase tracking-wider text-center text-muted-foreground font-medium">4. 4d</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
