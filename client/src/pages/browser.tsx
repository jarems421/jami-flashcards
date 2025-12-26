import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { format } from "date-fns";
import { Search, Filter, ArrowUpDown, MoreHorizontal, Pencil, Trash2, Folder, ArrowLeft, Plus, MoreVertical, Tag, ExternalLink } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface Deck {
  id: string;
  name: string;
  _count?: { cards: number };
  counts?: {
    new: number;
    studied: number;
    total: number;
  };
}

interface CardData {
  id: string;
  state: string;
  reps: number;
  lastReviewedAt: string | null;
  note: {
    id: string;
    fields: any;
    tags: string[];
    deckId: string;
  };
  deckId: string;
}

export default function Browser() {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("ALL");
  const [tagFilter, setTagFilter] = useState<string>("ALL");
  const [sortField, setSortField] = useState<keyof CardData | 'lastReviewedAt'>("lastReviewedAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editingCard, setEditingCard] = useState<CardData | null>(null);
  const [editForm, setEditForm] = useState<{front: string, back: string}>({ front: "", back: "" });
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [newDeckName, setNewDeckName] = useState("");
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null);
  const [editDeckName, setEditDeckName] = useState("");
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: decks, isLoading: decksLoading } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
  });

  const { data: allTags } = useQuery<string[]>({
    queryKey: ["/api/tags"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/tags");
      return res.json();
    }
  });

  const { data: cards, isLoading: cardsLoading } = useQuery<CardData[]>({
    queryKey: ["/api/cards"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/cards");
      return res.json();
    }
  });

  // Deck mutations
  const createDeckMutation = useMutation({
    mutationFn: async (name: string) => {
      await apiRequest("POST", "/api/decks", { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      setNewDeckName("");
      toast({ title: "Deck created" });
    },
    onError: () => {
      toast({ title: "Failed to create deck", variant: "destructive" });
    }
  });

  const deleteDeckMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/decks/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
      toast({ title: "Deck deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete deck", variant: "destructive" });
    }
  });

  const renameDeckMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await apiRequest("PATCH", `/api/decks/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      setEditingDeck(null);
      setEditDeckName("");
      toast({ title: "Deck renamed" });
    },
    onError: () => {
      toast({ title: "Failed to rename deck", variant: "destructive" });
    }
  });

  // Card mutations
  const deleteCardMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/cards/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      toast({ title: "Card deleted" });
    },
    onError: () => {
      toast({ title: "Failed to delete card", variant: "destructive" });
    }
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ id, fields }: { id: string, fields: any }) => {
      await apiRequest("PUT", `/api/notes/${id}`, { fields });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
      setEditingCard(null);
      toast({ title: "Card updated" });
    },
    onError: () => {
      toast({ title: "Failed to update card", variant: "destructive" });
    }
  });

  const handleCreateDeck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeckName.trim()) return;
    createDeckMutation.mutate(newDeckName);
  };

  const handleRenameDeck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDeck || !editDeckName.trim()) return;
    renameDeckMutation.mutate({ id: editingDeck.id, name: editDeckName });
  };

  const handleEditCard = (card: CardData) => {
    setEditingCard(card);
    setEditForm({
      front: card.note.fields.Front || card.note.fields.Text || "",
      back: card.note.fields.Back || ""
    });
  };

  const getCardsForDeck = (deckId: string) => {
    return cards?.filter(c => c.deckId === deckId) || [];
  };

  const selectedDeck = decks?.find(d => d.id === selectedDeckId);

  const handleSaveCardEdit = () => {
    if (!editingCard) return;
    
    const newFields = { ...editingCard.note.fields };
    
    if (newFields.Text !== undefined) {
       newFields.Text = editForm.front;
    } else {
       newFields.Front = editForm.front;
       newFields.Back = editForm.back;
    }

    updateNoteMutation.mutate({ 
      id: editingCard.note.id, 
      fields: newFields 
    });
  };

  const filteredCards = useMemo(() => {
    if (!cards) return [];
    
    return cards.filter(card => {
      if (selectedDeckId && card.deckId !== selectedDeckId) return false;
      const content = Object.values(card.note.fields).join(" ").toLowerCase();
      if (search && !content.includes(search.toLowerCase())) return false;
      if (stateFilter !== "ALL" && card.state !== stateFilter) return false;
      if (tagFilter !== "ALL" && !card.note.tags.includes(tagFilter)) return false;
      return true;
    }).sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      if (sortField === 'lastReviewedAt') {
         const timeA = typeof valA === 'string' ? new Date(valA).getTime() : 0;
         const timeB = typeof valB === 'string' ? new Date(valB).getTime() : 0;
         return sortDir === "asc" ? timeA - timeB : timeB - timeA;
      }

      if (valA === valB) return 0;
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return sortDir === "asc" ? -1 : 1;
    });
  }, [cards, search, stateFilter, tagFilter, sortField, sortDir, selectedDeckId]);

  const toggleSort = (field: keyof CardData | 'lastReviewedAt') => {
    if (sortField === field) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  if (decksLoading) return <div className="p-8">Loading decks...</div>;

  // Deck selection view
  if (!selectedDeckId) {
    return (
      <div className="p-8 max-w-5xl mx-auto space-y-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight">Decks</h1>
          <p className="text-muted-foreground">Manage your flashcard collections</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Card className="border-dashed flex flex-col justify-center items-center p-6 bg-muted/50">
            <form onSubmit={handleCreateDeck} className="w-full space-y-4">
              <div className="text-center font-medium text-muted-foreground">Create New Deck</div>
              <Input 
                placeholder="Deck Name" 
                value={newDeckName} 
                onChange={(e) => setNewDeckName(e.target.value)} 
                className="bg-background"
                data-testid="input-new-deck-name"
              />
              <Button type="submit" className="w-full" disabled={createDeckMutation.isPending} data-testid="button-create-deck">
                <Plus className="h-4 w-4 mr-2" />
                Create Deck
              </Button>
            </form>
          </Card>

          {decks?.map((deck) => {
            const deckCards = getCardsForDeck(deck.id);
            const newCount = deck.counts?.new ?? deckCards.filter(c => c.state === 'NEW').length;
            const studiedCount = deck.counts?.studied ?? deckCards.filter(c => c.state !== 'NEW').length;
            const totalCount = deck.counts?.total ?? deckCards.length;
            
            return (
              <div key={deck.id} className="relative group">
                <Card 
                  className="cursor-pointer hover:border-primary transition-colors h-full"
                  onClick={() => setSelectedDeckId(deck.id)}
                  data-testid={`card-deck-${deck.id}`}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Folder className="h-5 w-5 text-primary" />
                        <CardTitle className="text-lg">{deck.name}</CardTitle>
                      </div>
                    </div>
                    <CardDescription>
                      {totalCount} cards total
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-4 text-sm">
                      <div className="flex flex-col">
                        <span className="text-blue-500 font-bold">{newCount}</span>
                        <span className="text-muted-foreground text-xs">New</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-green-500 font-bold">{studiedCount}</span>
                        <span className="text-muted-foreground text-xs">Studied</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                
                <div className="absolute top-4 right-4 z-10">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`button-deck-menu-${deck.id}`}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <Link href={`/deck/${deck.id}`}>
                        <DropdownMenuItem data-testid={`button-details-deck-${deck.id}`}>
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Deck Details
                        </DropdownMenuItem>
                      </Link>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem 
                        onClick={(e) => { 
                          e.stopPropagation();
                          setEditingDeck(deck); 
                          setEditDeckName(deck.name); 
                        }}
                        data-testid={`button-rename-deck-${deck.id}`}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Rename
                      </DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem 
                            onSelect={(e) => e.preventDefault()} 
                            className="text-destructive focus:text-destructive"
                            data-testid={`button-delete-deck-${deck.id}`}
                          >
                            <Trash2 className="h-4 w-4 mr-2" />
                            Delete
                          </DropdownMenuItem>
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
                              onClick={() => deleteDeckMutation.mutate(deck.id)}
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            );
          })}
          
          {(!decks || decks.length === 0) && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              No decks yet. Create your first deck above!
            </div>
          )}
        </div>

        {/* Rename Deck Dialog */}
        <Dialog open={!!editingDeck} onOpenChange={(open) => { if (!open) { setEditingDeck(null); setEditDeckName(""); } }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename Deck</DialogTitle>
              <DialogDescription>
                Enter a new name for your deck.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleRenameDeck}>
              <Input 
                value={editDeckName} 
                onChange={(e) => setEditDeckName(e.target.value)} 
                placeholder="Deck name"
                className="mb-4"
                data-testid="input-rename-deck"
              />
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setEditingDeck(null); setEditDeckName(""); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={renameDeckMutation.isPending} data-testid="button-save-rename">
                  Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Card browser view for selected deck
  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <Button 
          variant="ghost" 
          className="w-fit -ml-2 mb-2"
          onClick={() => setSelectedDeckId(null)}
          data-testid="back-to-decks"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Decks
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">{selectedDeck?.name || "Cards"}</h1>
        <p className="text-muted-foreground">Browse and manage cards in this deck.</p>
      </div>

      <div className="flex flex-wrap items-center gap-4 bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search cards..." 
            className="pl-9" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search"
          />
        </div>
        
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-state-filter">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="State" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All States</SelectItem>
            <SelectItem value="NEW">New</SelectItem>
            <SelectItem value="STUDIED">Studied</SelectItem>
          </SelectContent>
        </Select>

        <Select value={tagFilter} onValueChange={setTagFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-tag-filter">
            <div className="flex items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="Tag" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All Tags</SelectItem>
            {allTags?.map(tag => (
              <SelectItem key={tag} value={tag}>{tag}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto text-sm text-muted-foreground">
          Showing {filteredCards.length} cards
        </div>
      </div>

      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[300px]">Card Content</TableHead>
              <TableHead>
                 <Button variant="ghost" size="sm" onClick={() => toggleSort('state')}>
                   State <ArrowUpDown className="ml-2 h-3 w-3" />
                 </Button>
              </TableHead>
              <TableHead>
                 <Button variant="ghost" size="sm" onClick={() => toggleSort('lastReviewedAt')}>
                   Last Reviewed <ArrowUpDown className="ml-2 h-3 w-3" />
                 </Button>
              </TableHead>
              <TableHead className="text-right">Reps</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCards.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={5} className="h-24 text-center">
                   No cards found in this deck.
                 </TableCell>
               </TableRow>
            ) : (
              filteredCards.map((card) => (
                <TableRow key={card.id} data-testid={`card-row-${card.id}`}>
                  <TableCell className="font-medium">
                    <div className="truncate max-w-[300px]" title={card.note.fields.Front || card.note.fields.Text}>
                       {card.note.fields.Front || card.note.fields.Text || "No Content"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {card.note.tags.map(t => <Badge key={t} variant="secondary" className="mr-1 text-[10px] px-1 py-0">{t}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={card.state === 'NEW' ? 'outline' : 'default'} className="uppercase text-[10px]">
                      {card.state}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {card.lastReviewedAt ? format(new Date(card.lastReviewedAt), "MMM d, yyyy") : "Never"}
                  </TableCell>
                  <TableCell className="text-right">{card.reps}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0" data-testid={`card-menu-${card.id}`}>
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => handleEditCard(card)} data-testid={`edit-card-${card.id}`}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit Note
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem 
                          className="text-red-600 focus:text-red-600 focus:bg-red-100 dark:focus:bg-red-900/20"
                          onClick={() => {
                            if (confirm("Are you sure? This will delete the card and its history.")) {
                              deleteCardMutation.mutate(card.id);
                            }
                          }}
                          data-testid={`delete-card-${card.id}`}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete Card
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Card Dialog */}
      <Dialog open={!!editingCard} onOpenChange={(open) => !open && setEditingCard(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Note</DialogTitle>
            <DialogDescription>
              Make changes to the content of this card. This may affect other cards generated from this note.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="front">Front / Text</Label>
              <Textarea
                id="front"
                value={editForm.front}
                onChange={(e) => setEditForm(prev => ({ ...prev, front: e.target.value }))}
                className="min-h-[100px]"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="back">Back</Label>
              <Textarea
                id="back"
                value={editForm.back}
                onChange={(e) => setEditForm(prev => ({ ...prev, back: e.target.value }))}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCard(null)}>Cancel</Button>
            <Button onClick={handleSaveCardEdit} disabled={updateNoteMutation.isPending}>
              {updateNoteMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
