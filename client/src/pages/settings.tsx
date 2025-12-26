import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";
import { Moon, Sun, User } from "lucide-react";
import { useState, useEffect } from "react";

export default function Settings() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const { user, updateUsername, isUpdatingUsername } = useAuth();
  const [usernameInput, setUsernameInput] = useState(user?.username || "");

  const handleSave = () => {
    toast({
      title: "Settings saved",
      description: "Your preferences have been updated.",
    });
  };

  const handleUpdateUsername = async () => {
    if (usernameInput.trim().length < 2) {
      toast({
        title: "Invalid username",
        description: "Username must be at least 2 characters.",
        variant: "destructive",
      });
      return;
    }
    try {
      await updateUsername(usernameInput.trim());
      toast({
        title: "Username updated",
        description: "Your username has been changed successfully.",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update username.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground mt-1">Manage your application preferences</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            Account
          </CardTitle>
          <CardDescription>Manage your account settings</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="username">Username</Label>
              <p className="text-sm text-muted-foreground">This is how you'll be greeted in the app</p>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Input
                id="username"
                value={usernameInput}
                onChange={(e) => setUsernameInput(e.target.value)}
                placeholder="Enter username"
                className="flex-1 sm:max-w-[200px]"
                data-testid="input-settings-username"
              />
              <Button 
                onClick={handleUpdateUsername} 
                disabled={isUpdatingUsername || usernameInput === user?.username}
                size="sm"
                data-testid="button-update-username"
              >
                {isUpdatingUsername ? "Saving..." : "Update"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Customize the look and feel of Jami</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between space-x-2">
             <div className="space-y-1">
               <Label>Dark Mode</Label>
               <p className="text-sm text-muted-foreground">Toggle between light and dark themes</p>
             </div>
             <div className="flex items-center gap-2">
               <Sun className="h-4 w-4 text-muted-foreground" />
               <Switch 
                 checked={theme === 'dark'}
                 onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
               />
               <Moon className="h-4 w-4 text-muted-foreground" />
             </div>
          </div>
        </CardContent>
      </Card>

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
          <div className="space-y-4">
            <div className="flex items-center justify-between space-x-2">
              <div className="space-y-1">
                <Label htmlFor="reminders">Daily Study Reminder</Label>
                <p className="text-sm text-muted-foreground">Get a reminder at a specific time each day</p>
              </div>
              <Switch id="reminders" />
            </div>
            <div className="flex items-center gap-4">
              <Label htmlFor="reminder-time" className="text-sm text-muted-foreground">Reminder Time</Label>
              <Input 
                id="reminder-time"
                type="time" 
                defaultValue="19:00"
                className="w-32"
                data-testid="input-reminder-time"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Note: Browser notifications require permission. Click "Save Changes" to enable.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-red-200 dark:border-red-900/50">
        <CardHeader>
          <CardTitle className="text-red-600 dark:text-red-400">Data Management</CardTitle>
          <CardDescription>Backup and restore your collection</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>Export Backup</Label>
              <p className="text-sm text-muted-foreground">Create a downloadable SQL snapshot of your data</p>
            </div>
            <Button variant="outline" onClick={() => toast({ title: "Backup started", description: "This would trigger a SQL dump download." })}>
              Export SQL
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>Import Data</Label>
              <p className="text-sm text-muted-foreground">Restore from a previous backup file</p>
            </div>
            <Button variant="outline" onClick={() => toast({ title: "Import dialog", description: "This would open a file picker." })}>
              Import SQL
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave}>Save Changes</Button>
      </div>
    </div>
  );
}
