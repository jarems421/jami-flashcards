import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, ArrowLeft, RefreshCw, Clock } from "lucide-react";
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

export default function Study() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const deckId = searchParams.get("deckId");
  const queryClient = useQueryClient();
  const { toast } = useToast();

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
    },
    onError: () => {
      toast({ title: "Failed to submit answer", variant: "destructive" });
    }
  });
  
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  // Reset index when deck changes or queue reloads
  useEffect(() => {
    // Only reset if we are out of bounds or data changed significantly?
    // Actually, simple queue logic: render current index.
    // If we re-fetch, we might want to stay consistent or just start over.
    // Let's stick to local index for this batch.
  }, [data]);

  
  if (isLoading) {
    return <div className="p-8 flex items-center justify-center h-full"><Skeleton className="h-[400px] w-full max-w-xl rounded-xl" /></div>;
  }

  const queue = data?.queue || [];
  const currentCard = queue[currentIndex];
  const counts = data?.counts;

  // Render template simple replacement
  // For basic template: 
  const frontContent = currentCard?.note?.fields?.Front || currentCard?.note?.fields?.Text || "No content";
  const backContent = currentCard?.note?.fields?.Back || "No answer";


  const handleAnswer = (rating: 'AGAIN' | 'HARD' | 'GOOD' | 'EASY') => {
    if (!currentCard) return;
    
    answerMutation.mutate({ id: currentCard.id, rating });
    setIsFlipped(false);
  };

  if (!queue || queue.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-6">
          <Check className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold mb-2">All Done!</h2>
        <p className="text-muted-foreground mb-8">
          You've reviewed all your cards for today. Great job keeping up with your studies.
        </p>
        <Link href="/">
          <Button>Back to Dashboard</Button>
        </Link>
      </div>
    );
  }

  if (currentIndex >= queue.length) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center max-w-md mx-auto">
        <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-6">
          <RefreshCw className="h-8 w-8" />
        </div>
        <h2 className="text-2xl font-bold mb-2">Session Complete</h2>
        <p className="text-muted-foreground mb-8">
          You finished this batch of {queue.length} cards.
        </p>
        <div className="flex gap-4">
          <Button variant="outline" onClick={() => {
            setCurrentIndex(0);
            refetch();
          }}>Review More</Button>
          <Link href="/">
            <Button>Back to Dashboard</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (!currentCard) return null; // Should be handled by loading or empty check

  return (
    <div className="h-full flex flex-col max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Quit
          </Button>
        </Link>
        
        {/* Progress Stats */}
        <div className="flex gap-4 text-sm font-medium">
          <div className="flex items-center gap-1.5 text-blue-600">
             <span className="w-2 h-2 rounded-full bg-blue-600" />
             {counts?.newAvailable ?? 0} New
          </div>
          <div className="flex items-center gap-1.5 text-red-600">
             <span className="w-2 h-2 rounded-full bg-red-600" />
             {counts?.dueLearning ?? 0} Learn
          </div>
          <div className="flex items-center gap-1.5 text-green-600">
             <span className="w-2 h-2 rounded-full bg-green-600" />
             {counts?.dueReview ?? 0} Review
          </div>
        </div>

        <div className="text-sm font-medium text-muted-foreground">
          <span className="text-foreground">{currentIndex + 1}</span> / {queue.length}
        </div>
      </div>

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
                  <span className="absolute top-6 left-6 text-xs font-bold tracking-wider text-muted-foreground uppercase">
                    Front
                  </span>
                  <div className="font-serif text-2xl md:text-3xl leading-relaxed">
                    {frontContent}
                  </div>
                  <div className="absolute bottom-6 text-xs text-muted-foreground flex items-center gap-2">
                    Click to flip
                  </div>
                </div>

                {/* Back */}
                <div className="absolute inset-0 backface-hidden rotate-y-180 p-8 md:p-12 flex flex-col items-center justify-center text-center bg-card rounded-2xl">
                  <span className="absolute top-6 left-6 text-xs font-bold tracking-wider text-muted-foreground uppercase">
                    Back
                  </span>
                  
                  {/* Small hint of front */}
                  <div className="text-muted-foreground/50 text-sm mb-8 line-clamp-1 max-w-[80%]">
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
            className="w-full max-w-xs text-lg h-14" 
            onClick={() => setIsFlipped(true)}
          >
            Show Answer
          </Button>
        ) : (
          <div className="grid grid-cols-4 gap-3 w-full max-w-2xl">
            <div className="flex flex-col gap-1">
              <Button 
                variant="outline" 
                className="h-14 border-red-200 hover:bg-red-50 hover:text-red-700 hover:border-red-300 dark:border-red-900/50 dark:hover:bg-red-950"
                onClick={() => handleAnswer('AGAIN')}
                disabled={answerMutation.isPending}
              >
                Again
              </Button>
              <span className="text-xs text-center text-muted-foreground font-medium">&lt; 1m</span>
            </div>
            
            <div className="flex flex-col gap-1">
              <Button 
                variant="outline" 
                className="h-14 border-orange-200 hover:bg-orange-50 hover:text-orange-700 hover:border-orange-300 dark:border-orange-900/50 dark:hover:bg-orange-950"
                onClick={() => handleAnswer('HARD')}
                disabled={answerMutation.isPending}
              >
                Hard
              </Button>
              <span className="text-xs text-center text-muted-foreground font-medium">
                {currentCard.state === 'NEW' || currentCard.state === 'LEARNING' ? 'Now' : '2d'}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <Button 
                variant="outline" 
                className="h-14 border-blue-200 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 dark:border-blue-900/50 dark:hover:bg-blue-950"
                onClick={() => handleAnswer('GOOD')}
                disabled={answerMutation.isPending}
              >
                Good
              </Button>
              <span className="text-xs text-center text-muted-foreground font-medium">
                {currentCard.state === 'NEW' ? '10m' : '4d'}
              </span>
            </div>

            <div className="flex flex-col gap-1">
              <Button 
                variant="outline" 
                className="h-14 border-green-200 hover:bg-green-50 hover:text-green-700 hover:border-green-300 dark:border-green-900/50 dark:hover:bg-green-950"
                onClick={() => handleAnswer('EASY')}
                disabled={answerMutation.isPending}
              >
                Easy
              </Button>
              <span className="text-xs text-center text-muted-foreground font-medium">4d</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
