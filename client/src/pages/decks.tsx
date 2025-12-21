import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Plus, Folder, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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

export default function Decks() {
  const { data: decks, isLoading } = useQuery<Deck[]>({ 
    queryKey: ["/api/decks"] 
  });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [newDeckName, setNewDeckName] = useState("");

  const createDeck = useMutation({
    mutationFn: async (name: string) => {
      await apiRequest("POST", "/api/decks", { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      setNewDeckName("");
      toast({ title: "Deck created" });
    },
  });

  const deleteDeck = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/decks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      toast({ title: "Deck deleted" });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeckName.trim()) return;
    createDeck.mutate(newDeckName);
  };

  if (isLoading) return <div className="p-8">Loading decks...</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Decks</h1>
          <p className="text-muted-foreground mt-1">Manage your flashcard collections</p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card className="border-dashed flex flex-col justify-center items-center p-6 bg-muted/50">
           <form onSubmit={handleCreate} className="w-full space-y-4">
             <div className="text-center font-medium text-muted-foreground">Create New Deck</div>
             <Input 
               placeholder="Deck Name" 
               value={newDeckName} 
               onChange={(e) => setNewDeckName(e.target.value)} 
               className="bg-background"
             />
             <Button type="submit" className="w-full" disabled={createDeck.isPending}>
               <Plus className="h-4 w-4 mr-2" />
               Create Deck
             </Button>
           </form>
        </Card>

        {decks?.map((deck) => (
          <div key={deck.id} className="relative group">
            <Link href={`/deck/${deck.id}`}>
              <Card className="cursor-pointer hover:border-primary transition-colors h-full">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Folder className="h-5 w-5 text-primary" />
                      <CardTitle className="text-lg">{deck.name}</CardTitle>
                    </div>
                  </div>
                  <CardDescription>
                    {deck.counts.total} cards total
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-4 text-sm">
                    <div className="flex flex-col">
                      <span className="text-blue-500 font-bold">{deck.counts.new}</span>
                      <span className="text-muted-foreground text-xs">New</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-red-500 font-bold">{deck.counts.due}</span>
                      <span className="text-muted-foreground text-xs">Due</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
            
            <div className="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Deck</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{deck.name}"? This will delete all cards and notes inside it. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction 
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => deleteDeck.mutate(deck.id)}
                    >
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
