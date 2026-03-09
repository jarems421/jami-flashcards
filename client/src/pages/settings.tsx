import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useTheme } from "@/components/theme-provider";
import { useAuth } from "@/hooks/use-auth";
import { usePushNotifications } from "@/hooks/use-push-notifications";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Moon, Sun, User, Bell, BellOff, Loader2, Smartphone, Clock, Target, Globe, Download, Upload } from "lucide-react";

const COMMON_TIMEZONES = [
  { value: "UTC", label: "UTC" },
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "Europe/Paris", label: "Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Berlin (CET/CEST)" },
  { value: "Asia/Tokyo", label: "Tokyo (JST)" },
  { value: "Asia/Shanghai", label: "Shanghai (CST)" },
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Australia/Sydney", label: "Sydney (AEST/AEDT)" },
];
import { useState, useEffect } from "react";

export default function Settings() {
  const { toast } = useToast();
  const { theme, setTheme } = useTheme();
  const { user, updateUsername, isUpdatingUsername } = useAuth();
  const [usernameInput, setUsernameInput] = useState(user?.username || "");
  const { 
    isSupported: pushSupported, 
    isSubscribed: pushSubscribed, 
    permission: pushPermission,
    isLoading: pushLoading,
    error: pushError,
    subscribe: subscribePush,
    unsubscribe: unsubscribePush,
    sendTestNotification
  } = usePushNotifications();

  const handleTogglePush = async () => {
    if (pushSubscribed) {
      const success = await unsubscribePush();
      if (success) {
        toast({ title: "Notifications disabled", description: "You won't receive push notifications anymore." });
      }
    } else {
      const success = await subscribePush();
      if (success) {
        toast({ title: "Notifications enabled", description: "You'll now receive push notifications on this device." });
      } else if (pushError) {
        toast({ title: "Failed to enable notifications", description: pushError, variant: "destructive" });
      }
    }
  };

  const handleTestNotification = async () => {
    const success = await sendTestNotification();
    if (success) {
      toast({ title: "Test notification sent", description: "Check your device for the notification." });
    } else {
      toast({ title: "Failed to send test notification", variant: "destructive" });
    }
  };

  const queryClient = useQueryClient();
  
  const { data: preferences, isLoading: prefsLoading } = useQuery({
    queryKey: ["/api/preferences"],
    queryFn: async () => {
      const res = await fetch("/api/preferences", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch preferences");
      return res.json();
    }
  });

  const updatePrefs = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", "/api/preferences", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/preferences"] });
    }
  });

  const handleDailyReminderToggle = (enabled: boolean) => {
    updatePrefs.mutate({ dailyReminderEnabled: enabled });
    if (enabled && !pushSubscribed) {
      subscribePush();
    }
  };

  const handleReminderTimeChange = (time: string) => {
    updatePrefs.mutate({ dailyReminderTime: time });
  };

  const handleGoalAlertsToggle = (enabled: boolean) => {
    updatePrefs.mutate({ goalDeadlineAlerts: enabled });
    if (enabled && !pushSubscribed) {
      subscribePush();
    }
  };

  const handleAlertDaysChange = (days: string) => {
    updatePrefs.mutate({ goalAlertDaysBefore: parseInt(days, 10) });
  };

  const handleTimezoneChange = (tz: string) => {
    updatePrefs.mutate({ timezone: tz });
  };

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
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Push Notifications
          </CardTitle>
          <CardDescription>Get reminders on your phone or device</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {!pushSupported ? (
            <div className="flex items-center gap-3 p-4 bg-muted/50 rounded-lg">
              <BellOff className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Not Supported</p>
                <p className="text-sm text-muted-foreground">
                  Push notifications aren't available on this browser. For iPhone, install Jami to your home screen first.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between space-x-2">
                <div className="space-y-1">
                  <Label htmlFor="push-notifications">Enable Push Notifications</Label>
                  <p className="text-sm text-muted-foreground">
                    Receive study reminders and goal alerts on this device
                  </p>
                </div>
                <Switch 
                  id="push-notifications"
                  checked={pushSubscribed}
                  onCheckedChange={handleTogglePush}
                  disabled={pushLoading}
                  data-testid="switch-push-notifications"
                />
              </div>

              {pushPermission === "denied" && (
                <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                  Notifications are blocked. Please enable them in your browser settings.
                </div>
              )}

              {pushSubscribed && (
                <>
                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="space-y-1">
                      <Label className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        Your Timezone
                      </Label>
                      <p className="text-sm text-muted-foreground">Used for scheduling notifications</p>
                    </div>
                    <Select 
                      value={preferences?.timezone ?? "UTC"}
                      onValueChange={handleTimezoneChange}
                    >
                      <SelectTrigger className="w-48" data-testid="select-timezone">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COMMON_TIMEZONES.map(tz => (
                          <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="space-y-1">
                      <Label className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        Daily Study Reminder
                      </Label>
                      <p className="text-sm text-muted-foreground">Get a reminder at a specific time each day</p>
                    </div>
                    <Switch 
                      checked={preferences?.dailyReminderEnabled ?? false}
                      onCheckedChange={handleDailyReminderToggle}
                      disabled={updatePrefs.isPending}
                      data-testid="switch-daily-reminder"
                    />
                  </div>

                  {preferences?.dailyReminderEnabled && (
                    <div className="flex items-center justify-between pl-6">
                      <Label className="text-sm text-muted-foreground">Reminder Time</Label>
                      <Input 
                        type="time"
                        value={preferences?.dailyReminderTime ?? "19:00"}
                        onChange={(e) => handleReminderTimeChange(e.target.value)}
                        className="w-32"
                        data-testid="input-reminder-time"
                      />
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="space-y-1">
                      <Label className="flex items-center gap-2">
                        <Target className="h-4 w-4" />
                        Goal Deadline Alerts
                      </Label>
                      <p className="text-sm text-muted-foreground">Get notified when goals are nearing their deadline</p>
                    </div>
                    <Switch 
                      checked={preferences?.goalDeadlineAlerts ?? true}
                      onCheckedChange={handleGoalAlertsToggle}
                      disabled={updatePrefs.isPending}
                      data-testid="switch-goal-alerts"
                    />
                  </div>

                  {preferences?.goalDeadlineAlerts && (
                    <div className="flex items-center justify-between pl-6">
                      <Label className="text-sm text-muted-foreground">Alert me</Label>
                      <Select 
                        value={String(preferences?.goalAlertDaysBefore ?? 1)}
                        onValueChange={handleAlertDaysChange}
                      >
                        <SelectTrigger className="w-40" data-testid="select-alert-days">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">On the day</SelectItem>
                          <SelectItem value="1">1 day before</SelectItem>
                          <SelectItem value="2">2 days before</SelectItem>
                          <SelectItem value="3">3 days before</SelectItem>
                          <SelectItem value="7">1 week before</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-2 border-t">
                    <div className="space-y-1">
                      <Label>Test Notification</Label>
                      <p className="text-sm text-muted-foreground">Send a test to verify it's working</p>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={handleTestNotification}
                      disabled={pushLoading}
                      data-testid="button-test-notification"
                    >
                      {pushLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send Test"}
                    </Button>
                  </div>
                </>
              )}

              <div className="flex items-start gap-3 p-4 bg-primary/5 rounded-lg">
                <Smartphone className="h-5 w-5 text-primary mt-0.5" />
                <div className="text-sm">
                  <p className="font-medium">iPhone Users</p>
                  <p className="text-muted-foreground">
                    To receive notifications on iPhone, tap the Share button in Safari and select "Add to Home Screen" to install Jami as an app.
                  </p>
                </div>
              </div>
            </>
          )}
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
              <p className="text-sm text-muted-foreground">Download a JSON backup of all your data</p>
            </div>
            <Button variant="outline" data-testid="button-export-backup" onClick={async () => {
              try {
                const res = await fetch("/api/export/backup", { credentials: "include" });
                if (!res.ok) throw new Error("Export failed");
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `jami-backup-${new Date().toISOString().split("T")[0]}.json`;
                a.click();
                URL.revokeObjectURL(url);
                toast({ title: "Backup downloaded", description: "Your data has been exported successfully." });
              } catch {
                toast({ title: "Export failed", description: "Could not download backup.", variant: "destructive" });
              }
            }}>
              <Download className="h-4 w-4 mr-2" /> Export
            </Button>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label>Import Data</Label>
              <p className="text-sm text-muted-foreground">Restore from a previous backup file</p>
            </div>
            <Button variant="outline" data-testid="button-import-backup" onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".json";
              input.onchange = async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                try {
                  const text = await file.text();
                  const backup = JSON.parse(text);
                  const res = await apiRequest("POST", "/api/import/backup", backup);
                  const result = await res.json();
                  toast({ title: "Import complete", description: `Imported ${result.importedDecks} decks, ${result.importedNotes} notes, ${result.importedCards} cards.` });
                  queryClient.invalidateQueries();
                } catch {
                  toast({ title: "Import failed", description: "Could not parse or import backup file.", variant: "destructive" });
                }
              };
              input.click();
            }}>
              <Upload className="h-4 w-4 mr-2" /> Import
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
