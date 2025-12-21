import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export default function Settings() {
  const { toast } = useToast();

  const handleSave = () => {
    toast({
      title: "Settings saved",
      description: "Your preferences have been updated.",
    });
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your application preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Study Preferences</CardTitle>
          <CardDescription>Configure how your study sessions behave</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-1">
              <Label htmlFor="autoplay">Auto-play Audio</Label>
              <p className="text-sm text-muted-foreground">Automatically play audio when cards are shown</p>
            </div>
            <Switch id="autoplay" />
          </div>
          
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-1">
              <Label htmlFor="timer">Show Timer</Label>
              <p className="text-sm text-muted-foreground">Display a timer during review sessions</p>
            </div>
            <Switch id="timer" defaultChecked />
          </div>

          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-1">
              <Label htmlFor="shortcuts">Keyboard Shortcuts</Label>
              <p className="text-sm text-muted-foreground">Enable keyboard shortcuts for grading</p>
            </div>
            <Switch id="shortcuts" defaultChecked />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>Manage your daily reminders</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-1">
              <Label htmlFor="reminders">Daily Study Reminder</Label>
              <p className="text-sm text-muted-foreground">Get notified when you have cards due</p>
            </div>
            <Switch id="reminders" />
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave}>Save Changes</Button>
      </div>
    </div>
  );
}
