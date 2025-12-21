import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { ArrowLeft, Play, Trash2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

interface Deck {
  id: string;
  name: string;
  counts: {
    new: number;
    due: number;
    total: number;
  };
}

interface CardData {
  id: string;
  state: string;
  dueAt: string;
  note: {
    fields: any;
  };
}

export default function DeckDetails() {
  const [, params] = useRoute("/deck/:id");
  const deckId = params?.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");

  const { data: decks } = useQuery<Deck[]>({ 
    queryKey: ["/api/decks"] 
  });
  
  const deck = decks?.find(d => d.id === deckId);

  const { data: cards, isLoading } = useQuery<CardData[]>({
    queryKey: ["/api/cards", deckId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/cards?deckId=${deckId}`);
      return res.json();
    },
    enabled: !!deckId
  });

  const deleteCard = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/cards/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cards", deckId] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      toast({ title: "Card deleted" });
    },
  });

  const filteredCards = cards?.filter(card => {
    const front = card.note.fields.Front || card.note.fields.Text || "";
    const back = card.note.fields.Back || "";
    const term = search.toLowerCase();
    return front.toLowerCase().includes(term) || back.toLowerCase().includes(term);
  });

  if (!deck) return <div className="p-8">Loading deck...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/decks">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{deck.name}</h1>
          <p className="text-muted-foreground mt-1">
            {deck.counts.total} cards • {deck.counts.due} due • {deck.counts.new} new
          </p>
        </div>
        <div className="ml-auto">
          <Link href={`/study?deckId=${deckId}`}>
            <Button size="lg" className="gap-2">
              <Play className="h-4 w-4" />
              Study Now
            </Button>
          </Link>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search cards..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-4">
        {isLoading ? (
          <div className="text-center py-12 text-muted-foreground">Loading cards...</div>
        ) : filteredCards?.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
            {search ? "No cards found matching your search." : "No cards in this deck yet."}
          </div>
        ) : (
          filteredCards?.map((card) => (
            <Card key={card.id}>
              <CardContent className="p-4 flex items-center justify-between gap-4">
                <div className="flex-1 grid grid-cols-2 gap-8">
                  <div className="font-medium text-sm">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">Front</span>
                    {card.note.fields.Front || card.note.fields.Text || <span className="text-muted-foreground italic">No content</span>}
                  </div>
                  <div className="text-sm">
                    <span className="text-xs font-bold text-muted-foreground uppercase tracking-wider block mb-1">Back</span>
                    {card.note.fields.Back || <span className="text-muted-foreground italic">No content</span>}
                  </div>
                </div>
                
                <div className="flex items-center gap-4 pl-4 border-l">
                  <div className="text-xs text-muted-foreground text-right">
                    <div className={`font-medium ${
                      card.state === 'NEW' ? 'text-blue-500' : 
                      card.state === 'LEARNING' ? 'text-orange-500' : 
                      'text-green-500'
                    }`}>
                      {card.state}
                    </div>
                    <div>Due: {format(new Date(card.dueAt), 'MMM d')}</div>
                  </div>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Card</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete this card? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction 
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => deleteCard.mutate(card.id)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
