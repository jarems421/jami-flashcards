import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Search, ArrowLeft, Tag } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";

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
            <Card className="hover:bg-muted/50 transition-colors">
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
    </div>
  );
}
