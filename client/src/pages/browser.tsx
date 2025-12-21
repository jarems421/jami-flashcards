import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Search, Filter, ArrowUpDown } from "lucide-react";

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

  const { data: cards, isLoading } = useQuery<Card[]>({
    queryKey: ["/api/cards"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/cards");
      return res.json();
    }
  });

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCards.length === 0 ? (
               <TableRow>
                 <TableCell colSpan={6} className="h-24 text-center">
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
