import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StarCanvas, ConstellationCompletionAnimation } from "@/components/star-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Check, X, Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";

interface StarData {
  id: string;
  constellationId: string;
  orderIndex: number;
  positionX: number;
  positionY: number;
  rarity: "NORMAL" | "BRIGHT" | "BRILLIANT";
  earnedAt: string;
}

interface Constellation {
  id: string;
  userId: string;
  name: string;
  isComplete: boolean;
  createdAt: string;
  updatedAt: string;
  stars: StarData[];
}

interface ConstellationSettings {
  activeConstellationId: string | null;
  backgroundConstellationId: string | null;
}

async function fetchConstellations(): Promise<Constellation[]> {
  const res = await fetch("/api/constellations", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch constellations");
  return res.json();
}

async function fetchActiveConstellation(): Promise<Constellation> {
  const res = await fetch("/api/constellations/active", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch active constellation");
  return res.json();
}

async function fetchSettings(): Promise<ConstellationSettings> {
  const res = await fetch("/api/constellation-settings", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to fetch settings");
  return res.json();
}

export default function Constellations() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [selectedConstellation, setSelectedConstellation] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [showCompletion, setShowCompletion] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [localStars, setLocalStars] = useState<StarData[]>([]);

  const { data: constellations, isLoading } = useQuery({
    queryKey: ["constellations"],
    queryFn: fetchConstellations,
  });

  const { data: activeConstellation } = useQuery({
    queryKey: ["constellation", "active"],
    queryFn: fetchActiveConstellation,
  });

  const { data: settings } = useQuery({
    queryKey: ["constellation-settings"],
    queryFn: fetchSettings,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, name, stars }: { id: string; name?: string; stars?: { id: string; positionX: number; positionY: number }[] }) => {
      const res = await fetch(`/api/constellations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name, stars }),
      });
      if (!res.ok) throw new Error("Failed to update constellation");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["constellations"] });
      queryClient.invalidateQueries({ queryKey: ["constellation"] });
    },
  });

  const setBackgroundMutation = useMutation({
    mutationFn: async (constellationId: string | null) => {
      const res = await fetch("/api/constellation-settings/background", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ constellationId }),
      });
      if (!res.ok) throw new Error("Failed to set background");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["constellation-settings"] });
      toast({ title: "Background updated" });
    },
  });

  const currentConstellation = selectedConstellation
    ? constellations?.find((c) => c.id === selectedConstellation)
    : activeConstellation;

  const displayStars = localStars.length > 0 ? localStars : (currentConstellation?.stars || []);

  const handleStartEdit = () => {
    if (currentConstellation) {
      setNameInput(currentConstellation.name);
      setEditingName(true);
      setLocalStars(currentConstellation.stars.map(s => ({ ...s })));
    }
  };

  const handleSave = () => {
    if (!currentConstellation) return;
    
    const starUpdates = localStars.map((s) => ({
      id: s.id,
      positionX: s.positionX,
      positionY: s.positionY,
    }));

    updateMutation.mutate({
      id: currentConstellation.id,
      name: nameInput || currentConstellation.name,
      stars: starUpdates,
    });
    
    setEditingName(false);
    setLocalStars([]);
    toast({ title: "Constellation saved" });
  };

  const handleCancelEdit = () => {
    setEditingName(false);
    setLocalStars([]);
    setNameInput("");
  };

  const handleStarMove = (starId: string, positionX: number, positionY: number) => {
    setLocalStars((prev) =>
      prev.map((s) => (s.id === starId ? { ...s, positionX, positionY } : s))
    );
  };

  const handleSetBackground = () => {
    if (currentConstellation) {
      setBackgroundMutation.mutate(currentConstellation.id);
    }
  };

  const handleClearBackground = () => {
    setBackgroundMutation.mutate(null);
  };

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <div className="animate-pulse text-muted-foreground">Loading constellations...</div>
      </div>
    );
  }

  const isBackgroundSet = settings?.backgroundConstellationId === currentConstellation?.id;

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <ConstellationCompletionAnimation
        isVisible={showCompletion}
        onComplete={() => setShowCompletion(false)}
      />

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-title">Knowledge Constellations</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Each star represents a completed goal. Arrange them to create your own constellation.
          </p>
        </div>
      </div>

      <Tabs defaultValue="current" className="space-y-4">
        <TabsList>
          <TabsTrigger value="current" data-testid="tab-current">Current</TabsTrigger>
          <TabsTrigger value="gallery" data-testid="tab-gallery">Gallery ({constellations?.length || 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="space-y-4">
          {currentConstellation && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  {editingName ? (
                    <div className="flex items-center gap-2 flex-1">
                      <Input
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        className="max-w-xs"
                        placeholder="Constellation name"
                        data-testid="input-constellation-name"
                      />
                      <Button size="sm" onClick={handleSave} data-testid="button-save">
                        <Check className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={handleCancelEdit} data-testid="button-cancel">
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <CardTitle className="flex items-center gap-2">
                        <Star className="h-5 w-5 text-amber-400" />
                        {currentConstellation.name}
                        {currentConstellation.isComplete && (
                          <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                            Complete
                          </span>
                        )}
                      </CardTitle>
                      <Button size="sm" variant="ghost" onClick={handleStartEdit} data-testid="button-edit">
                        Edit
                      </Button>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={isBackgroundSet ? "default" : "outline"}
                      onClick={isBackgroundSet ? handleClearBackground : handleSetBackground}
                      data-testid="button-set-background"
                    >
                      {isBackgroundSet ? "Clear Background" : "Set as Background"}
                    </Button>
                    <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="outline" data-testid="button-fullscreen">
                          Fullscreen
                        </Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-[95vw] max-h-[95vh] w-full h-full p-0 bg-transparent border-0">
                        <DialogHeader className="sr-only">
                          <DialogTitle>{currentConstellation.name}</DialogTitle>
                          <DialogDescription>Fullscreen view of your constellation</DialogDescription>
                        </DialogHeader>
                        <div className="w-full h-full min-h-[80vh]">
                          <StarCanvas
                            stars={displayStars}
                            editable={false}
                            className="w-full h-full"
                          />
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <StarCanvas
                  stars={displayStars}
                  editable={editingName}
                  onStarMove={handleStarMove}
                  className="w-full aspect-[4/3] md:aspect-[16/9]"
                />
                <p className="text-xs text-muted-foreground mt-3 text-center">
                  {editingName
                    ? "Drag stars to rearrange them. Click Save when done."
                    : "Click Edit to rearrange stars and rename your constellation."}
                </p>
              </CardContent>
            </Card>
          )}

          {!currentConstellation && (
            <Card>
              <CardContent className="py-12 text-center">
                <Star className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
                <p className="text-muted-foreground">
                  Complete goals to earn stars and build your first constellation!
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="gallery" className="space-y-4">
          {constellations && constellations.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {constellations.map((constellation) => (
                <Card
                  key={constellation.id}
                  className={`cursor-pointer transition-all hover:ring-2 hover:ring-primary/50 ${
                    selectedConstellation === constellation.id ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => setSelectedConstellation(constellation.id)}
                  data-testid={`card-constellation-${constellation.id}`}
                >
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center justify-between">
                      <span className="flex items-center gap-2">
                        <Star className="h-4 w-4 text-amber-400" />
                        {constellation.name}
                      </span>
                      {constellation.isComplete && (
                        <span className="text-xs bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded-full">
                          Complete
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <StarCanvas
                      stars={constellation.stars}
                      className="w-full aspect-video"
                    />
                    <p className="text-xs text-muted-foreground mt-2 text-center">
                      {constellation.stars.length} stars
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <Star className="h-12 w-12 mx-auto mb-4 text-muted-foreground/40" />
                <p className="text-muted-foreground">No constellations yet</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
