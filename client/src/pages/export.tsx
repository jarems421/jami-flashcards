import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Download, FileJson, FileText, CheckCircle } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

interface Deck {
  id: string;
  name: string;
  _count?: { cards: number };
}

interface CardData {
  id: string;
  state: string;
  deckId: string;
  note: {
    id: string;
    fields: any;
    tags: string[];
    deckId: string;
  };
}

interface Goal {
  id: string;
  targetCount: number;
  status: string;
  deck?: { name: string };
}

interface Constellation {
  id: string;
  name: string;
  stars: any[];
}

export default function DataExport() {
  const { toast } = useToast();
  
  const [selectedDeckId, setSelectedDeckId] = useState<string>("all");
  const [includeCards, setIncludeCards] = useState(true);
  const [includeGoals, setIncludeGoals] = useState(true);
  const [includeConstellations, setIncludeConstellations] = useState(true);
  const [format, setFormat] = useState<"json" | "csv">("json");
  const [exported, setExported] = useState(false);

  const { data: decks } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
  });

  const { data: cards } = useQuery<CardData[]>({
    queryKey: ["/api/cards"],
  });

  const { data: goals } = useQuery<Goal[]>({
    queryKey: ["/api/goals"],
  });

  const { data: constellations } = useQuery<Constellation[]>({
    queryKey: ["constellations"],
  });

  const handleExport = () => {
    const exportData: any = {
      exportedAt: new Date().toISOString(),
      version: "1.0"
    };

    if (includeCards) {
      let cardsToExport = cards || [];
      if (selectedDeckId !== "all") {
        cardsToExport = cardsToExport.filter(c => c.deckId === selectedDeckId);
      }
      exportData.cards = cardsToExport.map(c => ({
        front: c.note?.fields?.Front || "",
        back: c.note?.fields?.Back || "",
        frontImage: c.note?.fields?.FrontImage,
        backImage: c.note?.fields?.BackImage,
        tags: c.note?.tags || [],
        state: c.state
      }));
    }

    if (includeGoals) {
      exportData.goals = goals?.map(g => ({
        targetCount: g.targetCount,
        status: g.status,
        deckName: g.deck?.name
      })) || [];
    }

    if (includeConstellations) {
      exportData.constellations = constellations?.map(c => ({
        name: c.name,
        starCount: c.stars?.length || 0,
        stars: c.stars?.map(s => ({
          orderIndex: s.orderIndex,
          rarity: s.rarity,
          positionX: s.positionX,
          positionY: s.positionY
        }))
      })) || [];
    }

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === "json") {
      content = JSON.stringify(exportData, null, 2);
      filename = `jami-export-${new Date().toISOString().split('T')[0]}.json`;
      mimeType = "application/json";
    } else {
      const rows = [["Front", "Back", "Tags", "State"]];
      exportData.cards?.forEach((card: any) => {
        rows.push([
          card.front,
          card.back,
          card.tags.join(", "),
          card.state
        ]);
      });
      content = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
      filename = `jami-export-${new Date().toISOString().split('T')[0]}.csv`;
      mimeType = "text/csv";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    setExported(true);
    toast({ title: "Export complete!", description: `Downloaded ${filename}` });
  };

  const cardCount = selectedDeckId === "all" 
    ? cards?.length || 0 
    : cards?.filter(c => c.deckId === selectedDeckId).length || 0;

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-12">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/settings">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Export Data</h1>
          <p className="text-muted-foreground">Download a backup of your data</p>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Export Options</CardTitle>
            <CardDescription>Choose what to include in your export</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label>Deck</Label>
              <Select value={selectedDeckId} onValueChange={setSelectedDeckId}>
                <SelectTrigger data-testid="select-deck">
                  <SelectValue placeholder="Select deck" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Decks ({cards?.length || 0} cards)</SelectItem>
                  {decks?.map(deck => (
                    <SelectItem key={deck.id} value={deck.id}>
                      {deck.name} ({deck._count?.cards || 0} cards)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-3">
              <Label>Include</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="cards" 
                    checked={includeCards} 
                    onCheckedChange={(c) => setIncludeCards(!!c)}
                    data-testid="checkbox-cards"
                  />
                  <label htmlFor="cards" className="text-sm">
                    Cards ({cardCount})
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="goals" 
                    checked={includeGoals} 
                    onCheckedChange={(c) => setIncludeGoals(!!c)}
                    data-testid="checkbox-goals"
                  />
                  <label htmlFor="goals" className="text-sm">
                    Goals ({goals?.length || 0})
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox 
                    id="constellations" 
                    checked={includeConstellations} 
                    onCheckedChange={(c) => setIncludeConstellations(!!c)}
                    data-testid="checkbox-constellations"
                  />
                  <label htmlFor="constellations" className="text-sm">
                    Constellations ({constellations?.length || 0})
                  </label>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Format</Label>
              <div className="flex gap-3">
                <Button
                  variant={format === "json" ? "default" : "outline"}
                  onClick={() => setFormat("json")}
                  className="flex-1"
                  data-testid="button-format-json"
                >
                  <FileJson className="h-4 w-4 mr-2" />
                  JSON
                </Button>
                <Button
                  variant={format === "csv" ? "default" : "outline"}
                  onClick={() => setFormat("csv")}
                  className="flex-1"
                  data-testid="button-format-csv"
                >
                  <FileText className="h-4 w-4 mr-2" />
                  CSV (cards only)
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Button onClick={handleExport} className="w-full" size="lg" data-testid="button-export">
          {exported ? (
            <>
              <CheckCircle className="h-4 w-4 mr-2" />
              Exported! Click to download again
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Export Data
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
