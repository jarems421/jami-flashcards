import { useState, useMemo, useEffect } from "react";
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
import { Search, Filter, ArrowUpDown, MoreHorizontal, Pencil, Trash2, Folder, ArrowLeft, Plus, MoreVertical, Tag, ExternalLink, Palette, BookOpen, Brain, Sparkles, Zap, Star, Heart, Globe, Code, Music, Atom, FlaskConical, Calculator, Dna, Microscope, Orbit, Binary, Languages, Lightbulb, PenTool, Check, X, FolderInput, Tags } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface Deck {
  id: string;
  name: string;
  color?: string | null;
  icon?: string | null;
  parentDeckId?: string | null;
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
  const [editForm, setEditForm] = useState<{front: string, back: string, tags: string[]}>({ front: "", back: "", tags: [] });
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [newDeckName, setNewDeckName] = useState("");
  const [editingDeck, setEditingDeck] = useState<Deck | null>(null);
  const [editDeckName, setEditDeckName] = useState("");
  const [editDeckColor, setEditDeckColor] = useState<string>("");
  const [editDeckIcon, setEditDeckIcon] = useState<string>("");
  
  // Multi-select state
  const [selectedCardIds, setSelectedCardIds] = useState<Set<string>>(new Set());
  const [bulkMoveDialogOpen, setBulkMoveDialogOpen] = useState(false);
  const [bulkTagDialogOpen, setBulkTagDialogOpen] = useState(false);
  const [bulkMoveToDeckId, setBulkMoveToDeckId] = useState<string>("");
  const [bulkTagsToAdd, setBulkTagsToAdd] = useState<string>("");
  const [bulkTagsToRemove, setBulkTagsToRemove] = useState<string>("");

  // Clear selection when switching decks
  useEffect(() => {
    setSelectedCardIds(new Set());
  }, [selectedDeckId]);

  const DECK_COLORS = [
    { name: "Default", value: "" },
    { name: "Blue", value: "#3b82f6" },
    { name: "Purple", value: "#8b5cf6" },
    { name: "Pink", value: "#ec4899" },
    { name: "Red", value: "#ef4444" },
    { name: "Orange", value: "#f97316" },
    { name: "Yellow", value: "#eab308" },
    { name: "Green", value: "#22c55e" },
    { name: "Teal", value: "#14b8a6" },
  ];

  const DECK_ICONS = [
    { name: "Folder", value: "" },
    { name: "Book", value: "book" },
    { name: "Brain", value: "brain" },
    { name: "Atom", value: "atom" },
    { name: "Calculator", value: "calculator" },
    { name: "Flask", value: "flask" },
    { name: "Sigma", value: "sigma" },
    { name: "Pi", value: "pi" },
    { name: "DNA", value: "dna" },
    { name: "Microscope", value: "microscope" },
    { name: "Orbit", value: "orbit" },
    { name: "Function", value: "function" },
    { name: "Binary", value: "binary" },
    { name: "Globe", value: "globe" },
    { name: "Languages", value: "languages" },
    { name: "Lightbulb", value: "lightbulb" },
    { name: "Sparkles", value: "sparkles" },
    { name: "Star", value: "star" },
    { name: "Heart", value: "heart" },
    { name: "Music", value: "music" },
    { name: "Palette", value: "palette" },
    { name: "Pen", value: "pen" },
    { name: "Code", value: "code" },
    { name: "Zap", value: "zap" },
  ];

  const SigmaIcon = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
    <span className={`text-sm font-bold ${className || ''}`} style={style}>Σ</span>
  );
  const PiIcon = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
    <span className={`text-sm font-bold ${className || ''}`} style={style}>π</span>
  );
  const FunctionIcon = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
    <span className={`text-xs font-mono font-bold ${className || ''}`} style={style}>f(x)</span>
  );

  const getDeckIcon = (iconName?: string | null) => {
    const iconMap: Record<string, any> = {
      book: BookOpen,
      brain: Brain,
      atom: Atom,
      calculator: Calculator,
      flask: FlaskConical,
      sigma: SigmaIcon,
      pi: PiIcon,
      dna: Dna,
      microscope: Microscope,
      orbit: Orbit,
      function: FunctionIcon,
      binary: Binary,
      globe: Globe,
      languages: Languages,
      lightbulb: Lightbulb,
      sparkles: Sparkles,
      star: Star,
      heart: Heart,
      music: Music,
      palette: Palette,
      pen: PenTool,
      code: Code,
      zap: Zap,
    };
    return iconMap[iconName || ""] || Folder;
  };
  
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

  const updateDeckMutation = useMutation({
    mutationFn: async ({ id, name, color, icon }: { id: string; name: string; color?: string; icon?: string }) => {
      await apiRequest("PATCH", `/api/decks/${id}`, { name, color: color || null, icon: icon || null });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      setEditingDeck(null);
      setEditDeckName("");
      setEditDeckColor("");
      setEditDeckIcon("");
      toast({ title: "Deck updated" });
    },
    onError: () => {
      toast({ title: "Failed to update deck", variant: "destructive" });
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
    mutationFn: async ({ id, fields, tags }: { id: string, fields: any, tags: string[] }) => {
      await apiRequest("PUT", `/api/notes/${id}`, { fields, tags });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      setEditingCard(null);
      toast({ title: "Card updated" });
    },
    onError: () => {
      toast({ title: "Failed to update card", variant: "destructive" });
    }
  });

  // Bulk operations
  const bulkMoveMutation = useMutation({
    mutationFn: async ({ cardIds, deckId }: { cardIds: string[], deckId: string }) => {
      await apiRequest("POST", `/api/cards/bulk-move`, { cardIds, deckId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      setSelectedCardIds(new Set());
      setBulkMoveDialogOpen(false);
      setBulkMoveToDeckId("");
      toast({ title: "Cards moved successfully" });
    },
    onError: () => {
      toast({ title: "Failed to move cards", variant: "destructive" });
    }
  });

  const bulkTagMutation = useMutation({
    mutationFn: async ({ cardIds, addTags, removeTags }: { cardIds: string[], addTags: string[], removeTags: string[] }) => {
      await apiRequest("POST", `/api/cards/bulk-tags`, { cardIds, addTags, removeTags });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      setSelectedCardIds(new Set());
      setBulkTagDialogOpen(false);
      setBulkTagsToAdd("");
      setBulkTagsToRemove("");
      toast({ title: "Tags updated successfully" });
    },
    onError: () => {
      toast({ title: "Failed to update tags", variant: "destructive" });
    }
  });

  // Selection helpers
  const toggleCardSelection = (cardId: string) => {
    setSelectedCardIds(prev => {
      const next = new Set(prev);
      if (next.has(cardId)) {
        next.delete(cardId);
      } else {
        next.add(cardId);
      }
      return next;
    });
  };

  const selectAllCards = () => {
    if (selectedCardIds.size === filteredCards.length) {
      setSelectedCardIds(new Set());
    } else {
      setSelectedCardIds(new Set(filteredCards.map(c => c.id)));
    }
  };

  const clearSelection = () => {
    setSelectedCardIds(new Set());
  };

  const handleBulkMove = () => {
    if (!bulkMoveToDeckId || selectedCardIds.size === 0) return;
    bulkMoveMutation.mutate({ cardIds: Array.from(selectedCardIds), deckId: bulkMoveToDeckId });
  };

  const handleBulkTags = () => {
    if (selectedCardIds.size === 0) return;
    const addTags = bulkTagsToAdd.split(',').map(t => t.trim()).filter(Boolean);
    const removeTags = bulkTagsToRemove.split(',').map(t => t.trim()).filter(Boolean);
    if (addTags.length === 0 && removeTags.length === 0) return;
    bulkTagMutation.mutate({ cardIds: Array.from(selectedCardIds), addTags, removeTags });
  };

  const handleCreateDeck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDeckName.trim()) return;
    createDeckMutation.mutate(newDeckName);
  };

  const handleUpdateDeck = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingDeck || !editDeckName.trim()) return;
    updateDeckMutation.mutate({ id: editingDeck.id, name: editDeckName, color: editDeckColor, icon: editDeckIcon });
  };

  const handleEditCard = (card: CardData) => {
    setEditingCard(card);
    setEditForm({
      front: card.note.fields.Front || card.note.fields.Text || "",
      back: card.note.fields.Back || "",
      tags: [...card.note.tags]
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
      fields: newFields,
      tags: editForm.tags
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
                        {(() => {
                          const IconComponent = getDeckIcon(deck.icon);
                          return <IconComponent className="h-5 w-5" style={{ color: deck.color || 'hsl(var(--primary))' }} />;
                        })()}
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
                          setEditDeckColor(deck.color || "");
                          setEditDeckIcon(deck.icon || "");
                        }}
                        data-testid={`button-rename-deck-${deck.id}`}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit Deck
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
                              Are you sure you want to delete "{deck.name}"? This will delete all cards inside it. This action cannot be undone.
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

        {/* Edit Deck Dialog */}
        <Dialog open={!!editingDeck} onOpenChange={(open) => { if (!open) { setEditingDeck(null); setEditDeckName(""); setEditDeckColor(""); setEditDeckIcon(""); } }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Deck</DialogTitle>
              <DialogDescription>
                Customize your deck's name, color, and icon.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleUpdateDeck} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="deck-name">Name</Label>
                <Input 
                  id="deck-name"
                  value={editDeckName} 
                  onChange={(e) => setEditDeckName(e.target.value)} 
                  placeholder="Deck name"
                  data-testid="input-rename-deck"
                />
              </div>
              
              <div className="space-y-2">
                <Label>Color</Label>
                <div className="flex flex-wrap gap-2">
                  {DECK_COLORS.map((color) => (
                    <button
                      key={color.value}
                      type="button"
                      onClick={() => setEditDeckColor(color.value)}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        editDeckColor === color.value ? 'ring-2 ring-primary ring-offset-2' : ''
                      }`}
                      style={{ 
                        backgroundColor: color.value || 'hsl(var(--muted))',
                        borderColor: color.value || 'hsl(var(--border))'
                      }}
                      title={color.name}
                      data-testid={`color-${color.name.toLowerCase()}`}
                    />
                  ))}
                </div>
              </div>
              
              <div className="space-y-2">
                <Label>Icon</Label>
                <div className="flex flex-wrap gap-2">
                  {DECK_ICONS.map((icon) => {
                    const IconComponent = getDeckIcon(icon.value);
                    return (
                      <button
                        key={icon.value}
                        type="button"
                        onClick={() => setEditDeckIcon(icon.value)}
                        className={`w-10 h-10 rounded-lg border flex items-center justify-center transition-all ${
                          editDeckIcon === icon.value ? 'ring-2 ring-primary bg-primary/10' : 'hover:bg-muted'
                        }`}
                        title={icon.name}
                        data-testid={`icon-${icon.name.toLowerCase()}`}
                      >
                        <IconComponent className="h-5 w-5" style={{ color: editDeckColor || undefined }} />
                      </button>
                    );
                  })}
                </div>
              </div>
              
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setEditingDeck(null); setEditDeckName(""); setEditDeckColor(""); setEditDeckIcon(""); }}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateDeckMutation.isPending} data-testid="button-save-deck">
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
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-4 sm:space-y-6">
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
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{selectedDeck?.name || "Cards"}</h1>
        <p className="text-sm sm:text-base text-muted-foreground">Browse and manage cards in this deck.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:gap-4 bg-card p-3 sm:p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1 min-w-[150px] sm:min-w-[200px] max-w-sm order-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search cards..." 
            className="pl-9 text-sm" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search"
          />
        </div>
        
        <div className="flex gap-2 order-3 sm:order-2 w-full sm:w-auto">
          <Select value={stateFilter} onValueChange={setStateFilter}>
            <SelectTrigger className="w-full sm:w-[140px]" data-testid="select-state-filter">
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
            <SelectTrigger className="w-full sm:w-[140px]" data-testid="select-tag-filter">
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
        </div>

        <div className="text-xs sm:text-sm text-muted-foreground order-2 sm:order-3 sm:ml-auto">
          {filteredCards.length} cards
        </div>
      </div>

      {/* Bulk action bar */}
      {selectedCardIds.size > 0 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 p-3 sm:p-4 bg-primary/10 border border-primary/20 rounded-lg">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-primary" />
            <span className="font-medium text-sm sm:text-base">{selectedCardIds.size} card{selectedCardIds.size !== 1 ? 's' : ''} selected</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto w-full sm:w-auto">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setBulkMoveDialogOpen(true)}
              className="flex-1 sm:flex-none"
              data-testid="bulk-move-button"
            >
              <FolderInput className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Move to </span>Deck
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setBulkTagDialogOpen(true)}
              className="flex-1 sm:flex-none"
              data-testid="bulk-tags-button"
            >
              <Tags className="h-4 w-4 mr-2" />
              <span className="hidden sm:inline">Edit </span>Tags
            </Button>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={clearSelection}
              data-testid="clear-selection-button"
            >
              <X className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only sm:ml-2">Clear</span>
            </Button>
          </div>
        </div>
      )}

      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]">
                <Checkbox 
                  checked={filteredCards.length > 0 && selectedCardIds.size === filteredCards.length}
                  onCheckedChange={selectAllCards}
                  data-testid="select-all-checkbox"
                />
              </TableHead>
              <TableHead className="min-w-[150px] sm:min-w-[200px] md:w-[300px]">Card Content</TableHead>
              <TableHead className="hidden sm:table-cell">
                 <Button variant="ghost" size="sm" onClick={() => toggleSort('state')}>
                   State <ArrowUpDown className="ml-2 h-3 w-3" />
                 </Button>
              </TableHead>
              <TableHead className="hidden md:table-cell">
                 <Button variant="ghost" size="sm" onClick={() => toggleSort('lastReviewedAt')}>
                   Last Reviewed <ArrowUpDown className="ml-2 h-3 w-3" />
                 </Button>
              </TableHead>
              <TableHead className="text-right hidden lg:table-cell">Reps</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCards.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={6} className="h-24 text-center">
                   No cards found in this deck.
                 </TableCell>
               </TableRow>
            ) : (
              filteredCards.map((card) => (
                <TableRow 
                  key={card.id} 
                  data-testid={`card-row-${card.id}`}
                  className={selectedCardIds.has(card.id) ? 'bg-primary/5' : ''}
                >
                  <TableCell className="pr-0 sm:pr-4">
                    <Checkbox 
                      checked={selectedCardIds.has(card.id)}
                      onCheckedChange={() => toggleCardSelection(card.id)}
                      data-testid={`select-card-${card.id}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <div className="truncate max-w-[150px] sm:max-w-[200px] md:max-w-[300px] text-sm sm:text-base" title={card.note.fields.Front || card.note.fields.Text}>
                       {card.note.fields.Front || card.note.fields.Text || "No Content"}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {card.note.tags.map(t => <Badge key={t} variant="secondary" className="text-[10px] px-1 py-0">{t}</Badge>)}
                      <Badge variant={card.state === 'NEW' ? 'outline' : 'default'} className="uppercase text-[10px] sm:hidden">
                        {card.state}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant={card.state === 'NEW' ? 'outline' : 'default'} className="uppercase text-[10px]">
                      {card.state}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {card.lastReviewedAt ? format(new Date(card.lastReviewedAt), "MMM d, yyyy") : "Never"}
                  </TableCell>
                  <TableCell className="text-right hidden lg:table-cell">{card.reps}</TableCell>
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
                          Edit Card
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

      {/* Bulk Move Dialog */}
      <Dialog open={bulkMoveDialogOpen} onOpenChange={setBulkMoveDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Move Cards to Deck</DialogTitle>
            <DialogDescription>
              Move {selectedCardIds.size} selected card{selectedCardIds.size !== 1 ? 's' : ''} to another deck.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label>Select Destination Deck</Label>
            <Select value={bulkMoveToDeckId} onValueChange={setBulkMoveToDeckId}>
              <SelectTrigger className="mt-2" data-testid="bulk-move-deck-select">
                <SelectValue placeholder="Choose a deck..." />
              </SelectTrigger>
              <SelectContent>
                {decks?.filter(d => d.id !== selectedDeckId).map(deck => (
                  <SelectItem key={deck.id} value={deck.id}>{deck.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkMoveDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleBulkMove} 
              disabled={!bulkMoveToDeckId || bulkMoveMutation.isPending}
              data-testid="bulk-move-confirm"
            >
              {bulkMoveMutation.isPending ? "Moving..." : "Move Cards"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Tags Dialog */}
      <Dialog open={bulkTagDialogOpen} onOpenChange={setBulkTagDialogOpen}>
        <DialogContent className="sm:max-w-[450px]">
          <DialogHeader>
            <DialogTitle>Edit Tags</DialogTitle>
            <DialogDescription>
              Add or remove tags from {selectedCardIds.size} selected card{selectedCardIds.size !== 1 ? 's' : ''}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Tags to Add</Label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-lg bg-muted/30 min-h-[60px]">
                {allTags?.map(tag => {
                  const tagsToAddList = bulkTagsToAdd.split(',').map(t => t.trim()).filter(Boolean);
                  const isSelected = tagsToAddList.includes(tag);
                  return (
                    <Badge 
                      key={tag} 
                      variant={isSelected ? "default" : "outline"}
                      className={`cursor-pointer transition-all ${isSelected ? 'bg-green-600 hover:bg-green-700' : 'hover:bg-muted'}`}
                      onClick={() => {
                        if (isSelected) {
                          setBulkTagsToAdd(tagsToAddList.filter(t => t !== tag).join(', '));
                        } else {
                          setBulkTagsToAdd([...tagsToAddList, tag].join(', '));
                        }
                      }}
                      data-testid={`bulk-add-tag-${tag}`}
                    >
                      {isSelected && <Check className="h-3 w-3 mr-1" />}
                      {tag}
                    </Badge>
                  );
                })}
                {(!allTags || allTags.length === 0) && (
                  <span className="text-sm text-muted-foreground">No existing tags</span>
                )}
              </div>
              <Input 
                placeholder="Or type new tags: tag1, tag2..."
                value={bulkTagsToAdd}
                onChange={(e) => setBulkTagsToAdd(e.target.value)}
                data-testid="bulk-tags-add-input"
                className="mt-2"
              />
            </div>
            <div className="space-y-2">
              <Label>Tags to Remove</Label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-lg bg-muted/30 min-h-[60px]">
                {allTags?.map(tag => {
                  const tagsToRemoveList = bulkTagsToRemove.split(',').map(t => t.trim()).filter(Boolean);
                  const isSelected = tagsToRemoveList.includes(tag);
                  return (
                    <Badge 
                      key={tag} 
                      variant={isSelected ? "default" : "outline"}
                      className={`cursor-pointer transition-all ${isSelected ? 'bg-red-600 hover:bg-red-700' : 'hover:bg-muted'}`}
                      onClick={() => {
                        if (isSelected) {
                          setBulkTagsToRemove(tagsToRemoveList.filter(t => t !== tag).join(', '));
                        } else {
                          setBulkTagsToRemove([...tagsToRemoveList, tag].join(', '));
                        }
                      }}
                      data-testid={`bulk-remove-tag-${tag}`}
                    >
                      {isSelected && <X className="h-3 w-3 mr-1" />}
                      {tag}
                    </Badge>
                  );
                })}
                {(!allTags || allTags.length === 0) && (
                  <span className="text-sm text-muted-foreground">No existing tags</span>
                )}
              </div>
              <Input 
                placeholder="Or type tags to remove..."
                value={bulkTagsToRemove}
                onChange={(e) => setBulkTagsToRemove(e.target.value)}
                data-testid="bulk-tags-remove-input"
                className="mt-2"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkTagDialogOpen(false)}>Cancel</Button>
            <Button 
              onClick={handleBulkTags} 
              disabled={bulkTagMutation.isPending || (!bulkTagsToAdd.trim() && !bulkTagsToRemove.trim())}
              data-testid="bulk-tags-confirm"
            >
              {bulkTagMutation.isPending ? "Updating..." : "Update Tags"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Card Dialog */}
      <Dialog open={!!editingCard} onOpenChange={(open) => !open && setEditingCard(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Card</DialogTitle>
            <DialogDescription>
              Make changes to the content of this flashcard.
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
            <div className="grid gap-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {editForm.tags.map((tag, idx) => (
                  <Badge key={idx} variant="secondary" className="flex items-center gap-1">
                    {tag}
                    <button 
                      type="button"
                      onClick={() => setEditForm(prev => ({ ...prev, tags: prev.tags.filter((_, i) => i !== idx) }))}
                      className="ml-1 hover:text-destructive"
                    >
                      ×
                    </button>
                  </Badge>
                ))}
              </div>
              <Select
                value=""
                onValueChange={(tag) => {
                  if (tag && !editForm.tags.includes(tag)) {
                    setEditForm(prev => ({ ...prev, tags: [...prev.tags, tag] }));
                  }
                }}
              >
                <SelectTrigger data-testid="select-add-tag">
                  <SelectValue placeholder="Add a tag..." />
                </SelectTrigger>
                <SelectContent>
                  {allTags?.filter(t => !editForm.tags.includes(t)).map(tag => (
                    <SelectItem key={tag} value={tag}>{tag}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
