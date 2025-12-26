import type { Express } from "express";
import { authStorage } from "./storage";
import { isAuthenticated } from "./replitAuth";
import { db } from "../../db";

// Register auth-specific routes
export function registerAuthRoutes(app: Express): void {
  // Get current authenticated user
  app.get("/api/auth/user", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const user = await authStorage.getUser(userId);
      res.json(user);
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Update username
  app.put("/api/auth/username", isAuthenticated, async (req: any, res) => {
    try {
      const userId = req.user.claims.sub;
      const { username } = req.body;
      
      if (!username || typeof username !== 'string' || username.trim().length < 2) {
        return res.status(400).json({ message: "Username must be at least 2 characters" });
      }
      
      const trimmedUsername = username.trim();
      
      const updatedUser = await db.user.update({
        where: { id: userId },
        data: { username: trimmedUsername }
      });
      
      res.json(updatedUser);
    } catch (error) {
      console.error("Error updating username:", error);
      res.status(500).json({ message: "Failed to update username" });
    }
  });
}
