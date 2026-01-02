import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { StarCanvas, ConstellationCompletionAnimation } from "@/components/star-canvas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Star } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { motion, AnimatePresence } from "framer-motion";
import { calculateStarSize } from "@shared/starSize";

function CSSStarPreview({ size, label }: { size: number; label: string }) {
  const glowOpacity = 0.6;
  const glowSize = Math.max(size * 1.5, 30);
  const containerSize = Math.max(80, size * 1.2);
  
  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="relative bg-slate-900 rounded-lg flex items-center justify-center"
        style={{ width: containerSize, height: containerSize }}
      >
        <div
          className="relative"
          style={{ width: glowSize, height: glowSize }}
        >
          <div 
            className="absolute inset-0 animate-pulse"
            style={{
              background: `radial-gradient(circle, rgba(255, 255, 255, ${glowOpacity * 0.5}) 0%, transparent 60%)`,
              animationDuration: '3s',
            }}
          />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ 
              width: size, 
              height: size,
              filter: size > 40 ? 'blur(0.5px)' : undefined,
            }}
          >
            <div
              className="absolute top-1/2 left-0 -translate-y-1/2"
              style={{
                width: '100%',
                height: Math.max(2, size * 0.06),
                background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,${glowOpacity * 0.7}) 35%, white 50%, rgba(255,255,255,${glowOpacity * 0.7}) 65%, transparent 100%)`,
                borderRadius: '50%',
              }}
            />
            <div
              className="absolute left-1/2 top-0 -translate-x-1/2"
              style={{
                height: '100%',
                width: Math.max(2, size * 0.06),
                background: `linear-gradient(180deg, transparent 0%, rgba(255,255,255,${glowOpacity * 0.7}) 35%, white 50%, rgba(255,255,255,${glowOpacity * 0.7}) 65%, transparent 100%)`,
                borderRadius: '50%',
              }}
            />
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{
                width: Math.max(3, size * 0.2),
                height: Math.max(3, size * 0.2),
                background: 'radial-gradient(circle, white 0%, rgba(255,255,255,0.8) 50%, rgba(255,255,255,0) 100%)',
                boxShadow: `0 0 ${size * 0.15}px white, 0 0 ${size * 0.3}px rgba(255,255,255,0.6), 0 0 ${size * 0.5}px rgba(255,255,255,0.3)`,
              }}
            />
          </div>
        </div>
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-muted-foreground/60">{size.toFixed(0)}px</span>
    </div>
  );
}

interface StarData {
  id: string;
  constellationId?: string;
  orderIndex: number;
  positionX: number;
  positionY: number;
  rarity: "NORMAL" | "BRIGHT" | "BRILLIANT";
  earnedAt: string;
  goalTargetCount?: number;
  targetAccuracy?: number;
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
  const [demoMode, setDemoMode] = useState(false);
  const [demoStars, setDemoStars] = useState<Array<{
    id: string;
    orderIndex: number;
    positionX: number;
    positionY: number;
    rarity: "NORMAL" | "BRIGHT" | "BRILLIANT";
    earnedAt: string;
    goalTargetCount: number;
  }>>([]);
  const [demoCardCount, setDemoCardCount] = useState('50');
  const [demoAccuracy, setDemoAccuracy] = useState('80');

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
      setLocalStars(currentConstellation.stars.map(s => ({
        id: s.id,
        constellationId: s.constellationId,
        orderIndex: s.orderIndex,
        positionX: s.positionX,
        positionY: s.positionY,
        rarity: s.rarity,
        earnedAt: s.earnedAt,
      })));
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
                <div className="flex flex-col gap-3">
                  {editingName ? (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <Input
                        value={nameInput}
                        onChange={(e) => setNameInput(e.target.value)}
                        className="flex-1"
                        placeholder="Constellation name"
                        data-testid="input-constellation-name"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSave} className="flex-1 sm:flex-none" data-testid="button-save">
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={handleCancelEdit} className="flex-1 sm:flex-none" data-testid="button-cancel">
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                      <div className="flex items-center gap-2 flex-wrap">
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
                      <div className="flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant={isBackgroundSet ? "default" : "outline"}
                          onClick={isBackgroundSet ? handleClearBackground : handleSetBackground}
                          className="flex-1 sm:flex-none text-xs sm:text-sm"
                          data-testid="button-set-background"
                        >
                          {isBackgroundSet ? "Clear BG" : "Set as BG"}
                        </Button>
                        <Dialog open={isFullscreen} onOpenChange={setIsFullscreen}>
                          <DialogTrigger asChild>
                            <Button size="sm" variant="outline" className="flex-1 sm:flex-none" data-testid="button-fullscreen">
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
                  )}
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

          {/* Star Preview Demo */}
          <Card className="mt-4">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Star Preview</CardTitle>
                <Button 
                  size="sm" 
                  variant={demoMode ? "default" : "outline"}
                  onClick={() => {
                    setDemoMode(!demoMode);
                    if (demoMode) setDemoStars([]);
                  }}
                  data-testid="button-toggle-demo"
                >
                  {demoMode ? "Exit Demo" : "Try Demo"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {!demoMode ? (
                <>
                  <div className="flex justify-center gap-8">
                    <CSSStarPreview 
                      size={calculateStarSize(10, 80)} 
                      label="10 cards" 
                    />
                    <CSSStarPreview 
                      size={calculateStarSize(200, 95)} 
                      label="200 cards" 
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-3">
                    Bigger goals earn bigger stars! Click "Try Demo" to preview custom stars.
                  </p>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Target Cards</label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={demoCardCount}
                        onChange={(e) => setDemoCardCount(e.target.value)}
                        placeholder="50"
                        data-testid="input-demo-cards"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Target Accuracy %</label>
                      <Input
                        type="number"
                        inputMode="numeric"
                        value={demoAccuracy}
                        onChange={(e) => setDemoAccuracy(e.target.value)}
                        placeholder="80"
                        data-testid="input-demo-accuracy"
                      />
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">Preview:</span>
                      <CSSStarPreview 
                        size={calculateStarSize(parseInt(demoCardCount) || 10, parseInt(demoAccuracy) || 80)} 
                        label={`${demoCardCount || 0} cards @ ${demoAccuracy || 80}%`} 
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          const newStar = {
                            id: `demo-${Date.now()}`,
                            orderIndex: demoStars.length + (currentConstellation?.stars.length || 0) + 1,
                            positionX: 0.2 + Math.random() * 0.6,
                            positionY: 0.2 + Math.random() * 0.6,
                            rarity: "NORMAL" as const,
                            earnedAt: new Date().toISOString(),
                            goalTargetCount: parseInt(demoCardCount) || 10,
                            targetAccuracy: parseInt(demoAccuracy) || 80,
                          };
                          setDemoStars([...demoStars, newStar]);
                        }}
                        data-testid="button-add-demo-star"
                      >
                        Add to Preview
                      </Button>
                      {demoStars.length > 0 && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDemoStars([])}
                          data-testid="button-clear-demo"
                        >
                          Clear ({demoStars.length})
                        </Button>
                      )}
                    </div>
                  </div>

                  {demoStars.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">Demo Preview (not saved) - drag stars to arrange:</p>
                      <StarCanvas
                        stars={[
                          ...(currentConstellation?.stars || []),
                          ...demoStars
                        ]}
                        editable={true}
                        onStarMove={(starId, positionX, positionY) => {
                          if (starId.startsWith('demo-')) {
                            setDemoStars(prev => prev.map(s => 
                              s.id === starId ? { ...s, positionX, positionY } : s
                            ));
                          }
                        }}
                        className="w-full aspect-[4/3] md:aspect-[16/9] border-2 border-dashed border-amber-500/30"
                      />
                      <p className="text-xs text-amber-500 text-center">
                        This is just a preview - complete goals to earn real stars!
                      </p>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

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
