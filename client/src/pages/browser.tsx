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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { format } from "date-fns";
import { Search, Filter, ArrowUpDown, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Card {
  id: string;
  state: string;
  dueAt: string;
  intervalDays: number;
  easeFactor: number;
  lapses: number;
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
  const [sortField, setSortField] = useState<keyof Card | 'lastReviewedAt'>("dueAt");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [editingCard, setEditingCard] = useState<Card | null>(null);
  const [editForm, setEditForm] = useState<{front: string, back: string}>({ front: "", back: "" });
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: cards, isLoading } = useQuery<Card[]>({
    queryKey: ["/api/cards"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/cards");
      return res.json();
    }
  });

  const deleteCardMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/cards/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
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

  const handleEdit = (card: Card) => {
    setEditingCard(card);
    setEditForm({
      front: card.note.fields.Front || card.note.fields.Text || "",
      back: card.note.fields.Back || ""
    });
  };

  const handleSaveEdit = () => {
    if (!editingCard) return;
    
    // Construct fields object based on what was there before
    // Heuristic: if it had Text, keep Text. If Front/Back, keep Front/Back.
    const newFields = { ...editingCard.note.fields };
    
    if (newFields.Text !== undefined) {
       newFields.Text = editForm.front;
       // Back usually doesn't exist for cloze note types in same way, but let's assume Basic structure mainly
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
      // Search text in fields
      const content = Object.values(card.note.fields).join(" ").toLowerCase();
      if (search && !content.includes(search.toLowerCase())) return false;

      // State filter
      if (stateFilter !== "ALL" && card.state !== stateFilter) return false;

      return true;
    }).sort((a, b) => {
      let valA = a[sortField];
      let valB = b[sortField];

      // Handle nested or nulls if needed
      if (sortField === 'dueAt' || sortField === 'lastReviewedAt') {
         const timeA = typeof valA === 'string' ? new Date(valA).getTime() : 0;
         const timeB = typeof valB === 'string' ? new Date(valB).getTime() : 0;
         return sortDir === "asc" ? timeA - timeB : timeB - timeA;
      }

      if (valA === valB) return 0;
      
      // Null handling
      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;
      
      if (valA > valB) return sortDir === "asc" ? 1 : -1;
      return sortDir === "asc" ? -1 : 1;
    });
  }, [cards, search, stateFilter, sortField, sortDir]);

  const toggleSort = (field: keyof Card | 'lastReviewedAt') => {
    if (sortField === field) {
      setSortDir(prev => prev === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">Card Browser</h1>
        <p className="text-muted-foreground">Manage and review your entire collection.</p>
      </div>

      <div className="flex items-center gap-4 bg-card p-4 rounded-lg border shadow-sm">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Search cards..." 
            className="pl-9" 
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        
        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-[180px]">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <SelectValue placeholder="State" />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All States</SelectItem>
            <SelectItem value="NEW">New</SelectItem>
            <SelectItem value="LEARNING">Learning</SelectItem>
            <SelectItem value="REVIEW">Review</SelectItem>
            <SelectItem value="RELEARNING">Relearning</SelectItem>
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
                 <Button variant="ghost" size="sm" onClick={() => toggleSort('dueAt')}>
                   Due <ArrowUpDown className="ml-2 h-3 w-3" />
                 </Button>
              </TableHead>
              <TableHead>
                 <Button variant="ghost" size="sm" onClick={() => toggleSort('intervalDays')}>
                   Interval <ArrowUpDown className="ml-2 h-3 w-3" />
                 </Button>
              </TableHead>
              <TableHead>
                 <Button variant="ghost" size="sm" onClick={() => toggleSort('easeFactor')}>
                   Ease <ArrowUpDown className="ml-2 h-3 w-3" />
                 </Button>
              </TableHead>
              <TableHead className="text-right">Reps</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCards.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={7} className="h-24 text-center">
                   No cards found.
                 </TableCell>
               </TableRow>
            ) : (
              filteredCards.map((card) => (
                <TableRow key={card.id}>
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
                    {format(new Date(card.dueAt), "MMM d, yyyy")}
                    {new Date(card.dueAt) < new Date() && <span className="ml-2 text-red-500 text-xs">Due</span>}
                  </TableCell>
                  <TableCell>{card.intervalDays}d</TableCell>
                  <TableCell>{card.easeFactor.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{card.reps}</TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                          <span className="sr-only">Open menu</span>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => handleEdit(card)}>
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
            <Button onClick={handleSaveEdit} disabled={updateNoteMutation.isPending}>
              {updateNoteMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
