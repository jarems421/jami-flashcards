import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ArrowLeft, Tag, X } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

interface CardData {
  id: string;
  state: string;
  note: {
    id: string;
    fields: any;
    tags: string[];
    deckId: string;
  };
  deck?: {
    id: string;
    name: string;
  };
}

interface Deck {
  id: string;
  name: string;
}

export default function GlobalSearch() {
  const [query, setQuery] = useState("");
  const [editingCard, setEditingCard] = useState<CardData | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: cards } = useQuery<CardData[]>({
    queryKey: ["/api/cards/search", query],
    queryFn: async () => {
      if (!query.trim()) return [];
      const res = await apiRequest("GET", `/api/cards?search=${encodeURIComponent(query)}`);
      return res.json();
    },
    enabled: query.length >= 2
  });

  const { data: decks } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
  });

  const { data: existingTags } = useQuery<string[]>({
    queryKey: ["/api/tags"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/tags");
      return res.json();
    }
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ noteId, fields, tags }: { noteId: string; fields: any; tags: string[] }) => {
      const res = await apiRequest("PUT", `/api/notes/${noteId}`, { fields, tags });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cards/search"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tags"] });
      toast({ title: "Card updated successfully" });
      setEditingCard(null);
    },
    onError: () => {
      toast({ title: "Failed to update card", variant: "destructive" });
    }
  });

  const deckMap = useMemo(() => {
    const map = new Map<string, string>();
    decks?.forEach(d => map.set(d.id, d.name));
    return map;
  }, [decks]);

  const filteredCards = useMemo(() => {
    if (!cards || !query.trim()) return [];
    const q = query.toLowerCase();
    return cards.filter(card => {
      const front = String(card.note?.fields?.Front || "").toLowerCase();
      const back = String(card.note?.fields?.Back || "").toLowerCase();
      const tags = card.note?.tags?.join(" ").toLowerCase() || "";
      return front.includes(q) || back.includes(q) || tags.includes(q);
    }).slice(0, 50);
  }, [cards, query]);

  const filteredTagSuggestions = useMemo(() => {
    if (!existingTags || !tagInput.trim()) return [];
    const input = tagInput.toLowerCase().trim();
    return existingTags
      .filter(tag => tag.toLowerCase().includes(input) && !editTags.includes(tag))
      .slice(0, 5);
  }, [existingTags, tagInput, editTags]);

  const openEditDialog = (card: CardData) => {
    setEditingCard(card);
    setEditFront(card.note?.fields?.Front || "");
    setEditBack(card.note?.fields?.Back || "");
    setEditTags(card.note?.tags || []);
    setTagInput("");
  };

  const handleSaveEdit = () => {
    if (!editingCard) return;
    
    const finalTags = [...editTags];
    if (tagInput.trim() && !finalTags.includes(tagInput.trim())) {
      finalTags.push(tagInput.trim());
    }
    
    updateNoteMutation.mutate({
      noteId: editingCard.note.id,
      fields: { Front: editFront, Back: editBack },
      tags: finalTags
    });
  };

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !editTags.includes(trimmed)) {
      setEditTags([...editTags, trimmed]);
      setTagInput("");
    }
  };

  const removeTag = (tag: string) => {
    setEditTags(editTags.filter(t => t !== tag));
  };

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-12">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Search Cards</h1>
          <p className="text-muted-foreground">Find any card across all your decks</p>
        </div>
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by content or tags..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          className="pl-10 h-12 text-lg"
          data-testid="input-search"
          autoFocus
        />
      </div>

      {query.length >= 2 && (
        <p className="text-sm text-muted-foreground mb-4">
          {filteredCards.length} result{filteredCards.length !== 1 ? 's' : ''} found
        </p>
      )}

      <div className="space-y-3">
        {filteredCards.map((card, index) => (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.03 }}
          >
            <Card 
              className="hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => openEditDialog(card)}
              data-testid={`card-result-${card.id}`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate" data-testid={`text-front-${card.id}`}>
                      {card.note?.fields?.Front || "No content"}
                    </p>
                    <p className="text-sm text-muted-foreground truncate mt-1">
                      {card.note?.fields?.Back || ""}
                    </p>
                    {card.note?.tags?.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {card.note.tags.map(tag => (
                          <Badge key={tag} variant="secondary" className="text-xs">
                            <Tag className="h-2.5 w-2.5 mr-1" />
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <Badge variant={card.state === "NEW" ? "default" : "secondary"}>
                      {card.state}
                    </Badge>
                    <p className="text-xs text-muted-foreground mt-1">
                      {deckMap.get(card.note?.deckId) || "Unknown deck"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {query.length >= 2 && filteredCards.length === 0 && (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>No cards found matching "{query}"</p>
        </div>
      )}

      {query.length < 2 && (
        <div className="text-center py-12 text-muted-foreground">
          <Search className="h-12 w-12 mx-auto mb-4 opacity-30" />
          <p>Type at least 2 characters to search</p>
        </div>
      )}

      <Dialog open={!!editingCard} onOpenChange={(open) => !open && setEditingCard(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Edit Card</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-front">Front</Label>
              <Textarea
                id="edit-front"
                value={editFront}
                onChange={(e) => setEditFront(e.target.value)}
                placeholder="Question or prompt..."
                className="min-h-[80px]"
                data-testid="input-edit-front"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-back">Back</Label>
              <Textarea
                id="edit-back"
                value={editBack}
                onChange={(e) => setEditBack(e.target.value)}
                placeholder="Answer..."
                className="min-h-[80px]"
                data-testid="input-edit-back"
              />
            </div>
            <div className="space-y-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-2 mb-2">
                {editTags.map(tag => (
                  <Badge key={tag} variant="secondary" className="flex items-center gap-1">
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-1 hover:text-destructive"
                      data-testid={`button-remove-tag-${tag}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <div className="relative">
                <Input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag(tagInput);
                    }
                  }}
                  onBlur={() => {
                    if (tagInput.trim()) {
                      addTag(tagInput);
                    }
                  }}
                  placeholder="Add tags..."
                  data-testid="input-edit-tags"
                />
                {filteredTagSuggestions.length > 0 && tagInput && (
                  <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md">
                    {filteredTagSuggestions.map(tag => (
                      <button
                        key={tag}
                        type="button"
                        className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                        onClick={() => addTag(tag)}
                        data-testid={`button-suggest-tag-${tag}`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingCard(null)} data-testid="button-cancel-edit">
              Cancel
            </Button>
            <Button 
              onClick={handleSaveEdit} 
              disabled={updateNoteMutation.isPending}
              data-testid="button-save-edit"
            >
              {updateNoteMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
