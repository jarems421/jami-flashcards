import { useState, useEffect, useRef, useMemo } from "react";
import { useAddNote } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Image, Save, Upload, X } from "lucide-react";
import { Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
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

  // Fetch existing tags for autocomplete
  const { data: existingTags } = useQuery<string[]>({
    queryKey: ["/api/tags"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/tags");
      return res.json();
    }
  });

  const [type, setType] = useState('basic');
  const [deckId, setDeckId] = useState<string>("");
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [frontImage, setFrontImage] = useState('');
  const [backImage, setBackImage] = useState('');
  const [uploadingFront, setUploadingFront] = useState(false);
  const [uploadingBack, setUploadingBack] = useState(false);
  const frontInputRef = useRef<HTMLInputElement>(null);
  const backInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  // Filter tags based on input
  const filteredTags = useMemo(() => {
    if (!existingTags || !tagInput.trim()) return [];
    const input = tagInput.toLowerCase().trim();
    return existingTags
      .filter(tag => tag.toLowerCase().includes(input) && !selectedTags.includes(tag))
      .slice(0, 5);
  }, [existingTags, tagInput, selectedTags]);

  const addTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !selectedTags.includes(trimmed)) {
      setSelectedTags([...selectedTags, trimmed]);
    }
    setTagInput('');
    setShowTagSuggestions(false);
    tagInputRef.current?.focus();
  };

  const removeTag = (tagToRemove: string) => {
    setSelectedTags(selectedTags.filter(t => t !== tagToRemove));
  };

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      if (tagInput.trim()) {
        addTag(tagInput);
      }
    } else if (e.key === 'Backspace' && !tagInput && selectedTags.length > 0) {
      removeTag(selectedTags[selectedTags.length - 1]);
    }
  };

  const uploadImage = async (file: File): Promise<string> => {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/upload", {
      method: "POST",
      body: formData,
      credentials: "include"
    });
    if (!res.ok) throw new Error("Upload failed");
    const data = await res.json();
    return data.url;
  };

  const handleFrontImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingFront(true);
    try {
      const url = await uploadImage(file);
      setFrontImage(url);
      toast({ title: "Image uploaded" });
    } catch {
      toast({ title: "Failed to upload image", variant: "destructive" });
    }
    setUploadingFront(false);
  };

  const handleBackImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBack(true);
    try {
      const url = await uploadImage(file);
      setBackImage(url);
      toast({ title: "Image uploaded" });
    } catch {
      toast({ title: "Failed to upload image", variant: "destructive" });
    }
    setUploadingBack(false);
  };

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
        description: "Please select a deck for this card.",
        variant: "destructive"
      });
      return;
    }

    addNote({
      deckId: deckId,
      type: type,
      content: { 
        Front: front, 
        Back: back,
        FrontImage: frontImage || undefined,
        BackImage: backImage || undefined
      },
      tags: selectedTags,
    }, {
      onSuccess: () => {
        toast({
          title: "Card created",
          description: "Your new flashcard has been added to the deck.",
        });
        setFront('');
        setBack('');
        setFrontImage('');
        setBackImage('');
        setSelectedTags([]);
        setTagInput('');
      },
      onError: () => {
        toast({
          title: "Error",
          description: "Failed to save card.",
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
          <p className="text-muted-foreground mb-6">You need to create a deck before you can add cards.</p>
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
          <h1 className="text-3xl font-bold tracking-tight mb-1">Add Card</h1>
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
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                    <Label>Card Type</Label>
                    <Select value={type} onValueChange={setType}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="basic">Basic Card</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Front</Label>
                  <Textarea 
                    value={front} 
                    onChange={e => setFront(e.target.value)}
                    placeholder="e.g. What is the capital of Japan?"
                    className="font-serif min-h-[100px] resize-y text-lg p-4"
                    data-testid="input-front"
                  />
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Image className="h-3 w-3" />
                      Front Image (optional)
                    </Label>
                    <input
                      ref={frontInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFrontImageUpload}
                    />
                    {frontImage ? (
                      <div className="relative inline-block">
                        <img src={frontImage} alt="Front preview" className="max-h-32 rounded object-contain border" />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute -top-2 -right-2 h-6 w-6"
                          onClick={() => setFrontImage('')}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={uploadingFront}
                        onClick={() => frontInputRef.current?.click()}
                        data-testid="button-upload-front-image"
                      >
                        <Upload className="h-4 w-4" />
                        {uploadingFront ? "Uploading..." : "Upload Image"}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Back</Label>
                  <Textarea 
                    value={back} 
                    onChange={e => setBack(e.target.value)}
                    placeholder="e.g. Tokyo"
                    className="font-serif min-h-[100px] resize-y text-lg p-4"
                    data-testid="input-back"
                  />
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground flex items-center gap-1">
                      <Image className="h-3 w-3" />
                      Back Image (optional)
                    </Label>
                    <input
                      ref={backInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleBackImageUpload}
                    />
                    {backImage ? (
                      <div className="relative inline-block">
                        <img src={backImage} alt="Back preview" className="max-h-32 rounded object-contain border" />
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="absolute -top-2 -right-2 h-6 w-6"
                          onClick={() => setBackImage('')}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={uploadingBack}
                        onClick={() => backInputRef.current?.click()}
                        data-testid="button-upload-back-image"
                      >
                        <Upload className="h-4 w-4" />
                        {uploadingBack ? "Uploading..." : "Upload Image"}
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Tags</Label>
                  <div className="relative">
                    <div className="flex flex-wrap gap-1.5 p-2 border rounded-md bg-background min-h-[42px] focus-within:ring-2 focus-within:ring-ring">
                      {selectedTags.map(tag => (
                        <Badge key={tag} variant="secondary" className="gap-1 px-2 py-0.5">
                          {tag}
                          <button
                            type="button"
                            onClick={() => removeTag(tag)}
                            className="hover:text-destructive"
                            data-testid={`button-remove-tag-${tag}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                      <input
                        ref={tagInputRef}
                        type="text"
                        value={tagInput}
                        onChange={e => {
                          setTagInput(e.target.value);
                          setShowTagSuggestions(true);
                        }}
                        onKeyDown={handleTagInputKeyDown}
                        onFocus={() => setShowTagSuggestions(true)}
                        onBlur={() => setTimeout(() => setShowTagSuggestions(false), 200)}
                        placeholder={selectedTags.length === 0 ? "Type to add tags..." : ""}
                        className="flex-1 min-w-[120px] bg-transparent outline-none text-sm"
                        data-testid="input-tags"
                      />
                    </div>
                    {showTagSuggestions && filteredTags.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-popover border rounded-md shadow-md max-h-40 overflow-auto">
                        {filteredTags.map(tag => (
                          <button
                            key={tag}
                            type="button"
                            className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground"
                            onMouseDown={() => addTag(tag)}
                            data-testid={`button-suggest-tag-${tag}`}
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">Press Enter or comma to add a tag</p>
                </div>

                <div className="pt-4 flex justify-end">
                  <Button type="submit" size="lg" className="gap-2" disabled={isPending}>
                    <Save className="h-4 w-4" />
                    {isPending ? 'Saving...' : 'Add Card'}
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
