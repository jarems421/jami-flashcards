import { useState, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ArrowLeft, Upload, FileText, Image, CheckCircle, AlertCircle, Loader2 } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";

interface Deck {
  id: string;
  name: string;
}

interface ParsedCard {
  front: string;
  back: string;
  frontImage?: string;
  backImage?: string;
  tags?: string[];
}

export default function BulkImport() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const [deckId, setDeckId] = useState("");
  const [textInput, setTextInput] = useState("");
  const [parsedCards, setParsedCards] = useState<ParsedCard[]>([]);
  const [importStatus, setImportStatus] = useState<"idle" | "parsing" | "importing" | "done">("idle");
  const [uploadedImages, setUploadedImages] = useState<Map<string, string>>(new Map());
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });

  const { data: decks } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
  });

  const uploadImageMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        credentials: "include"
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    }
  });

  const importMutation = useMutation({
    mutationFn: async (cards: ParsedCard[]) => {
      const results = [];
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const res = await apiRequest("POST", "/api/notes", {
          deckId,
          type: "basic",
          content: {
            Front: card.front,
            Back: card.back,
            FrontImage: card.frontImage,
            BackImage: card.backImage
          },
          tags: card.tags || []
        });
        results.push(await res.json());
        setImportProgress({ done: i + 1, total: cards.length });
      }
      return results;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cards"] });
      queryClient.invalidateQueries({ queryKey: ["/api/decks"] });
      toast({ 
        title: "Import complete!", 
        description: `Successfully imported ${data.length} cards.`
      });
      setImportStatus("done");
    },
    onError: () => {
      toast({ title: "Import failed", variant: "destructive" });
      setImportStatus("idle");
    }
  });

  const parseTextInput = () => {
    parseTextFromString(textInput);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const text = await file.text();
    setTextInput(text);
    parseTextFromString(text);
  };

  const parseTextFromString = (input: string) => {
    setImportStatus("parsing");
    const lines = input.trim().split("\n");
    const cards: ParsedCard[] = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      
      const separators = ["\t", ";;", "|", " - "];
      let front = "", back = "";
      
      for (const sep of separators) {
        if (line.includes(sep)) {
          const parts = line.split(sep);
          front = parts[0]?.trim() || "";
          back = parts.slice(1).join(sep).trim();
          break;
        }
      }
      
      if (!front && !back) {
        front = line.trim();
        back = "";
      }
      
      if (front) {
        cards.push({ front, back });
      }
    }

    setParsedCards(cards);
    setImportStatus("idle");
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    toast({ title: `Uploading ${files.length} images...` });

    for (const file of files) {
      try {
        const result = await uploadImageMutation.mutateAsync(file);
        setUploadedImages(prev => new Map(prev).set(file.name, result.url));
      } catch {
        toast({ title: `Failed to upload ${file.name}`, variant: "destructive" });
      }
    }

    toast({ title: "Images uploaded successfully" });
  };

  const handleImport = () => {
    if (!deckId) {
      toast({ title: "Please select a deck", variant: "destructive" });
      return;
    }
    if (parsedCards.length === 0) {
      toast({ title: "No cards to import", variant: "destructive" });
      return;
    }
    setImportStatus("importing");
    importMutation.mutate(parsedCards);
  };

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-12">
      <div className="flex items-center gap-4 mb-8">
        <Link href="/decks">
          <Button variant="ghost" size="icon" data-testid="button-back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Bulk Import</h1>
          <p className="text-muted-foreground">Import multiple cards at once</p>
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>1. Select Deck</CardTitle>
            <CardDescription>Choose which deck to add cards to</CardDescription>
          </CardHeader>
          <CardContent>
            <Select value={deckId} onValueChange={setDeckId}>
              <SelectTrigger data-testid="select-deck">
                <SelectValue placeholder="Choose a deck" />
              </SelectTrigger>
              <SelectContent>
                {decks?.map(deck => (
                  <SelectItem key={deck.id} value={deck.id}>{deck.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. Add Cards</CardTitle>
            <CardDescription>Paste text or upload a file. Separate front and back with Tab, ;;, |, or -</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs defaultValue="text">
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="text">
                  <FileText className="h-4 w-4 mr-2" />
                  Paste Text
                </TabsTrigger>
                <TabsTrigger value="file">
                  <Upload className="h-4 w-4 mr-2" />
                  Upload File
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="text" className="space-y-4">
                <Textarea
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  placeholder={`Question 1\tAnswer 1\nQuestion 2\tAnswer 2\nWhat is 2+2? ;; 4`}
                  className="min-h-[200px] font-mono text-sm"
                  data-testid="input-text"
                />
                <Button onClick={parseTextInput} variant="secondary" data-testid="button-parse">
                  Parse Text
                </Button>
              </TabsContent>
              
              <TabsContent value="file" className="space-y-4">
                <div 
                  className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">Click to upload .txt or .csv file</p>
                </div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.csv"
                  className="hidden"
                  onChange={handleFileUpload}
                />
              </TabsContent>
            </Tabs>

            <div className="pt-4 border-t">
              <Label className="flex items-center gap-2 text-sm font-medium mb-2">
                <Image className="h-4 w-4" />
                Upload Images (optional)
              </Label>
              <div 
                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => imageInputRef.current?.click()}
              >
                <p className="text-sm text-muted-foreground">Click to upload images</p>
              </div>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handleImageUpload}
              />
              {uploadedImages.size > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {Array.from(uploadedImages.entries()).map(([name, url]) => (
                    <div key={name} className="relative">
                      <img src={url} alt={name} className="h-16 w-16 object-cover rounded" />
                      <p className="text-xs text-muted-foreground truncate max-w-[64px]">{name}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {parsedCards.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>3. Preview ({parsedCards.length} cards)</CardTitle>
              <CardDescription>Review before importing</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="max-h-[300px] overflow-y-auto space-y-2">
                {parsedCards.slice(0, 20).map((card, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="p-3 bg-muted/50 rounded-lg"
                  >
                    <p className="font-medium text-sm">{card.front}</p>
                    <p className="text-sm text-muted-foreground">{card.back || "(no answer)"}</p>
                  </motion.div>
                ))}
                {parsedCards.length > 20 && (
                  <p className="text-center text-sm text-muted-foreground py-2">
                    ...and {parsedCards.length - 20} more
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex gap-3">
          <Button 
            onClick={handleImport} 
            disabled={!deckId || parsedCards.length === 0 || importStatus === "importing"}
            className="flex-1"
            data-testid="button-import"
          >
            {importStatus === "importing" ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Importing {importProgress.done}/{importProgress.total}...
              </>
            ) : importStatus === "done" ? (
              <>
                <CheckCircle className="h-4 w-4 mr-2" />
                Import Complete!
              </>
            ) : (
              <>Import {parsedCards.length} Cards</>
            )}
          </Button>
          
          {importStatus === "done" && (
            <Link href="/decks">
              <Button variant="secondary" data-testid="button-view-deck">
                View Deck
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
