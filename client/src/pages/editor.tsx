import { useState, useEffect } from "react";
import { useAddNote } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Image, Type, Save } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

interface Deck {
  id: string;
  name: string;
}

export default function Editor() {
  const { mutate: addNote, isPending } = useAddNote();
  const { toast } = useToast();
  
  // Fetch decks for dropdown
  const { data: decks } = useQuery<Deck[]>({
    queryKey: ["/api/decks"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/decks");
      return res.json();
    }
  });

  const [type, setType] = useState('basic');
  const [deckId, setDeckId] = useState<string>("");
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [tags, setTags] = useState('');

  // Set default deck when data loads
  useEffect(() => {
    if (decks && decks.length > 0 && !deckId) {
      setDeckId(decks[0].id);
    }
  }, [decks, deckId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!front || !back) {
      toast({
        title: "Missing fields",
        description: "Please fill in both sides of the card.",
        variant: "destructive"
      });
      return;
    }

    if (!deckId) {
      toast({
        title: "Missing Deck",
        description: "Please select a deck for this note.",
        variant: "destructive"
      });
      return;
    }

    addNote({
      deckId: deckId,
      type: type,
      content: { Front: front, Back: back },
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
    }, {
      onSuccess: () => {
        toast({
          title: "Note created",
          description: "Your new flashcard has been added to the deck.",
        });
        setFront('');
        setBack('');
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to save note.",
          variant: "destructive"
        });
      }
    });
  };

  if (decks && decks.length === 0) {
    return (
      <div className="max-w-3xl mx-auto p-6 md:p-12">
        <div className="text-center py-16">
          <h1 className="text-3xl font-bold tracking-tight mb-4">No Decks Yet</h1>
          <p className="text-muted-foreground mb-6">You need to create a deck before you can add notes.</p>
          <Link href="/decks">
            <Button size="lg" data-testid="button-create-deck">
              Create Your First Deck
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto p-6 md:p-12">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight mb-1">Add Note</h1>
          <p className="text-muted-foreground">Create new material for your collection.</p>
        </div>
        <Link href="/">
          <Button variant="ghost">Cancel</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardContent className="p-6">
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label>Deck</Label>
                    <Select value={deckId} onValueChange={setDeckId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select deck" />
                      </SelectTrigger>
                      <SelectContent>
                        {decks?.map(deck => (
                          <SelectItem key={deck.id} value={deck.id}>{deck.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="grid gap-2">
                    <Label>Note Type</Label>
                    <Select value={type} onValueChange={setType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="basic">Basic Card</SelectItem>
                        <SelectItem value="cloze">Cloze Deletion (Coming Soon)</SelectItem>
                        <SelectItem value="image-occlusion">Image Occlusion (Coming Soon)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Front</Label>
                  <div className="relative">
                    <Textarea 
                      value={front} 
                      onChange={e => setFront(e.target.value)}
                      placeholder="e.g. What is the capital of Japan?"
                      className="font-serif min-h-[120px] resize-y text-lg p-4"
                    />
                    <div className="absolute top-3 right-3 flex gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6">
                        <Image className="h-3 w-3" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-6 w-6">
                        <Type className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Back</Label>
                  <Textarea 
                    value={back} 
                    onChange={e => setBack(e.target.value)}
                    placeholder="e.g. Tokyo"
                    className="font-serif min-h-[120px] resize-y text-lg p-4"
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Tags</Label>
                  <Input 
                    value={tags} 
                    onChange={e => setTags(e.target.value)}
                    placeholder="geography, capitals, asia" 
                  />
                  <p className="text-xs text-muted-foreground">Comma separated</p>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button type="submit" size="lg" className="gap-2" disabled={isPending}>
                    <Save className="h-4 w-4" />
                    {isPending ? 'Saving...' : 'Add Note'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <div className="bg-muted/30 rounded-xl p-6 border">
            <h3 className="font-semibold mb-2">Tips for good cards</h3>
            <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-4">
              <li>Keep it simple. One fact per card.</li>
              <li>Use images whenever possible to strengthen memory.</li>
              <li>Avoid sets/lists. Break them down into individual items.</li>
              <li>Personalize your answers.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
